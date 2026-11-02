// Phase 1 spike (throwaway). The send/receive loops mirror the web app's
// send-file.ts / receive-file.ts so the numbers are comparable:
//   - one data channel per file, labelled "file:<index>"
//   - first message is JSON metadata, then binary chunks
//   - sender backs off on bufferedAmount / bufferedamountlow
//   - receiver closes the channel when it has all the bytes
// Every chunk starts with its uint32 index; a few sampled bytes follow a fixed pattern.

export type Channel = any;

const now = () => performance.now();
const debug = (line: string) => (globalThis as any).__spikeLog?.(line);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const expectedByte = (position: number) => (position * 131 + 17) & 255;
const samples = (length: number) =>
  [4, 5, 6, 7, 100, length >> 1, length - 1].filter((p) => p >= 4 && p < length);

export function makeBase(length: number) {
  const base = new Uint8Array(length);
  for (let i = 0; i < length; i++) base[i] = expectedByte(i);
  return base;
}

/** Builds chunk `index` of `length` bytes from the shared base pattern. */
export function makeChunk(base: Uint8Array, index: number, length: number) {
  const chunk = new Uint8Array(length);
  chunk.set(length === base.length ? base : base.subarray(0, length));
  new DataView(chunk.buffer).setUint32(0, index);
  return chunk;
}

/** Returns the number of problems found in a chunk (0 = fine). */
export function verifyChunk(chunk: Uint8Array, expectedIndex: number) {
  let problems = 0;
  if (chunk.byteLength >= 4) {
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    if (view.getUint32(0) !== expectedIndex) problems++;
  }
  for (const p of samples(chunk.byteLength)) {
    if (chunk[p] !== expectedByte(p)) {
      problems++;
      break;
    }
  }
  return problems;
}

/** 'buffer': the web app's approach (bufferedAmount / bufferedamountlow). 'ack': receiver acks every N chunks, sender keeps at most `window` unacked. */
export type FlowOptions = {
  flow?: 'buffer' | 'ack';
  window?: number;
  /** Wait for the receiver's {ready:true} before sending metadata/data (up to 3 s, then proceed). */
  handshake?: boolean;
};

export type SendResult = {
  handshake?: 'ready' | 'timeout';
  handshakeMs?: number;
  maxInFlight?: number;
  bytes: number;
  chunks: number;
  queuedMs: number;
  totalMs: number | null;
  mbps: number | null;
  eventWakes: number;
  timeoutWakes: number;
};

/** Produces chunk `index` (exactly `length` bytes). Real sends read this from disk asynchronously. */
export type ReadChunk = (index: number, length: number) => Promise<Uint8Array>;

export async function sendFile(
  channel: Channel,
  sizeBytes: number,
  chunkBytes: number,
  readChunk?: ReadChunk,
  options: FlowOptions = {},
): Promise<SendResult> {
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = chunkBytes * 5;

  if (channel.readyState !== 'open') {
    await new Promise<void>((resolve) => {
      channel.onopen = () => resolve();
    });
  }

  const closed = new Promise<number>((resolve) => {
    channel.onclose = () => resolve(now());
  });

  const base = makeBase(chunkBytes);
  const read: ReadChunk = readChunk ?? (async (index, length) => makeChunk(base, index, length));
  channel.onbufferedamountlow = () => {
    const w = waiter;
    waiter = null;
    w?.('event');
  };

  let waiter: ((how: string) => void) | null = null;
  const useAcks = options.flow === 'ack';
  const window = options.window ?? 64;
  let acked = 0;
  let maxInFlight = 0;
  let isReady = !options.handshake;
  let readyWaiter: (() => void) | null = null;
  if (useAcks || options.handshake) {
    // Control messages from the receiver: {ready:true} and {ack:n}.
    channel.onmessage = (event: { data: string | ArrayBuffer }) => {
      if (typeof event.data !== 'string') return;
      try {
        const message = JSON.parse(event.data);
        if (message.ready) {
          isReady = true;
          readyWaiter?.();
        } else if (typeof message.ack === 'number') {
          acked = Math.max(acked, message.ack);
          const w = waiter;
          waiter = null;
          w?.('event');
        }
      } catch {}
    };
  }

  let handshake: SendResult['handshake'];
  let handshakeMs: number | undefined;
  if (options.handshake) {
    const waitStart = now();
    if (!isReady) {
      await Promise.race([
        new Promise<void>((resolve) => {
          readyWaiter = resolve;
        }),
        sleep(3000),
      ]);
    }
    handshakeMs = Math.round(now() - waitStart);
    handshake = isReady ? 'ready' : 'timeout';
  }

  channel.send(
    JSON.stringify({ name: 'spike.bin', size: sizeBytes, mimeType: 'application/octet-stream' }),
  );

  let sent = 0;
  let index = 0;
  let eventWakes = 0;
  let timeoutWakes = 0;
  const start = now();

  while (sent < sizeBytes) {
    const mustWait = useAcks
      ? index - acked >= window
      : channel.bufferedAmount > channel.bufferedAmountLowThreshold;
    if (mustWait) {
      // Wait for the event, but never deadlock: wake after 500 ms and count it,
      // so the result shows whether bufferedamountlow fires reliably.
      const how = await Promise.race([
        new Promise<string>((resolve) => {
          waiter = resolve;
        }),
        sleep(500).then(() => 'timeout'),
      ]);
      waiter = null;
      if (how === 'event') eventWakes++;
      else timeoutWakes++;
      continue;
    }

    const length = Math.min(chunkBytes, sizeBytes - sent);
    channel.send(await read(index, length));
    sent += length;
    index++;
    maxInFlight = Math.max(maxInFlight, index - acked);
  }

  const queuedMs = now() - start;
  const closedAt = await Promise.race([closed, sleep(120000).then(() => null)]);
  const totalMs = closedAt === null ? null : closedAt - start;

  return {
    bytes: sent,
    chunks: index,
    queuedMs,
    totalMs,
    mbps: totalMs ? sizeBytes / 1048576 / (totalMs / 1000) : null,
    eventWakes,
    timeoutWakes,
    ...(useAcks ? { maxInFlight } : {}),
    ...(options.handshake ? { handshake, handshakeMs } : {}),
  };
}

export type ReceiveResult = {
  meta: { name: string; size: number; mimeType: string };
  bytes: number;
  chunks: number;
  badChunks: number;
  ms: number;
  mbps: number | null;
  // only when a sink is used (mirrors receive-file.ts: chunks queue up, writes are sequential)
  maxQueuedChunks?: number;
  drainMs?: number;
};

/** Where received bytes go. Mirrors receive-file.ts's writer. */
export type Sink = {
  write(chunk: Uint8Array): Promise<void>;
  /** If present, chunks are written synchronously inside onmessage (no queue can build up). */
  writeSync?(chunk: Uint8Array): void;
  close(): Promise<void>;
};

export function receiveFile(
  channel: Channel,
  sink?: Sink,
  options: { ackEvery?: number; handshake?: boolean } = {},
): Promise<ReceiveResult> {
  return new Promise((resolve) => {
    channel.binaryType = 'arraybuffer';
    let meta: ReceiveResult['meta'] | null = null;
    let got = 0;
    let index = 0;
    let bad = 0;
    let first = 0;
    let last = 0;
    const queue: Uint8Array[] = [];
    let maxQueued = 0;
    let draining = false;
    let finished: ReceiveResult | null = null;

    const finish = async () => {
      if (!finished) return;
      if (sink) {
        finished.drainMs = Math.round(now() - last);
        await sink.close();
      }
      resolve(finished);
    };

    const drain = async () => {
      if (draining || !sink) return;
      draining = true;
      try {
        while (queue.length) await sink.write(queue.shift()!);
      } catch (error) {
        debug(`sink.write FAILED: ${String(error)}`);
      }
      draining = false;
      if (finished) void finish();
    };

    debug(`receiveFile: attached onmessage (label=${channel.label}, readyState=${channel.readyState})`);
    let seen = 0;
    channel.onmessage = (event: { data: string | ArrayBuffer }) => {
      const data = event.data;
      if (seen++ < 3) {
        debug(`recv message #${seen}: ${typeof data === 'string' ? `string(${data.length}) ${data.slice(0, 60)}` : `binary(${(data as ArrayBuffer).byteLength})`}; meta=${!!meta}`);
      }
      if (!meta) {
        if (typeof data === 'string') meta = JSON.parse(data);
        return;
      }
      if (typeof data === 'string') return;

      const chunk = new Uint8Array(data);
      const t = now();
      if (!first) first = t;
      last = t;
      bad += verifyChunk(chunk, index);
      index++;
      got += chunk.byteLength;
      if (index % 250 === 0) debug(`recv progress: chunks=${index} MB=${(got / 1048576).toFixed(1)} queue=${queue.length} draining=${draining}`);
      if (options.ackEvery && index % options.ackEvery === 0) {
        channel.send(JSON.stringify({ ack: index }));
      }

      if (sink?.writeSync) {
        sink.writeSync(chunk);
      } else if (sink) {
        queue.push(chunk);
        maxQueued = Math.max(maxQueued, queue.length);
        void drain();
      }

      if (got >= meta.size) {
        const ms = last - first;
        finished = {
          meta,
          bytes: got,
          chunks: index,
          badChunks: bad,
          ms,
          mbps: ms > 0 ? got / 1048576 / (ms / 1000) : null,
          ...(sink ? { maxQueuedChunks: maxQueued } : {}),
        };
        channel.close();
        if (!sink) resolve(finished);
        else if (!draining && queue.length === 0) void finish();
      }
    };

    // Tell the sender the handler is attached, so it does not send into the void.
    if (options.handshake) channel.send(JSON.stringify({ ready: true }));
  });
}

// Sends and receives ONE file over ONE data channel. This is protocol v2 from the Phase 1
// spike (plan section 6.1, src/spike/transfer.ts) without the test patterns:
//
//   1. the receiver sends {"ready":true} once its handler is attached; the sender waits up to
//      3 s for it, so it never sends into a channel nobody is listening on
//   2. the sender sends the file's metadata as JSON, then the file as 50 KB binary chunks
//   3. the receiver acks every 16 chunks ({"ack":n}); the sender keeps at most 64 unacked
//      (react-native-webrtc's bufferedAmount cannot be trusted, plan section 6.1 finding 3)
//   4. the receiver writes each chunk synchronously inside the message handler (awaiting disk
//      writes lets a queue, and memory, build up: finding 4), sends {"done":true} when it has
//      every byte, and closes the channel
//
// Steps 2 stays the web app's wire format ("file:<index>" channels, JSON metadata first, then
// chunks); 1, 3 and 4 are extras a web peer ignores.
import type { FileMeta } from '@/features/sample-data';

// react-native-webrtc has no usable types for the data channel.
export type Channel = any;

export const CHUNK_BYTES = 50 * 1024;
const ACK_EVERY = 16;
const WINDOW = 64;
const READY_WAIT_MS = 3000;
const DONE_WAIT_MS = 120_000;

export class TransferError extends Error {}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Reads chunk `index` of `length` bytes from the source file. */
export type ReadChunk = (index: number, length: number) => Promise<Uint8Array>;

/** Where received bytes go. Writes are synchronous so nothing queues up. */
export type Sink = { writeSync(chunk: Uint8Array): void; close(): void };

type SendOptions = {
  /** Bytes handed to the channel so far. */
  onProgress?: (bytes: number) => void;
  signal?: AbortSignal;
};

export async function sendFile(
  channel: Channel,
  meta: FileMeta,
  readChunk: ReadChunk,
  { onProgress, signal }: SendOptions = {},
): Promise<void> {
  channel.binaryType = 'arraybuffer';

  let acked = 0;
  let ready = false;
  let done = false;
  let closed = channel.readyState === 'closed';
  let wake: (() => void) | null = null;
  const poke = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  /** Sleeps until something happens (an ack, a message, a close) or `ms` pass. */
  const pause = (ms: number) =>
    Promise.race([new Promise<void>((resolve) => (wake = resolve)), sleep(ms)]).then(() => {
      wake = null;
    });
  const check = () => {
    if (signal?.aborted) {
      try {
        channel.close();
      } catch {}
      throw new TransferError('Cancelled.');
    }
    if (closed) throw new TransferError('The connection was lost.');
  };

  channel.onclose = () => {
    closed = true;
    poke();
  };
  channel.onmessage = (event: { data: unknown }) => {
    if (typeof event.data !== 'string') return;
    try {
      const message = JSON.parse(event.data);
      if (message.ready) ready = true;
      else if (typeof message.ack === 'number') acked = Math.max(acked, message.ack);
      else if (message.done) done = true;
    } catch {}
    poke();
  };

  // The channel is usually open already (react-native-webrtc raises no 'open' event then).
  const openDeadline = Date.now() + 30_000;
  while (channel.readyState !== 'open') {
    check();
    if (Date.now() > openDeadline) throw new TransferError('The connection did not open.');
    await pause(200);
  }

  // Wait for the receiver to say it is listening; carry on after 3 s for peers that never do.
  const readyDeadline = Date.now() + READY_WAIT_MS;
  while (!ready && Date.now() < readyDeadline) {
    check();
    await pause(Math.max(1, readyDeadline - Date.now()));
  }

  try {
    channel.send(JSON.stringify({ name: meta.name, size: meta.size, mimeType: meta.mimeType }));

    let sent = 0;
    let index = 0;
    while (sent < meta.size) {
      check();
      if (index - acked >= WINDOW) {
        await pause(500); // never deadlock if an ack goes missing
        continue;
      }
      const length = Math.min(CHUNK_BYTES, meta.size - sent);
      const chunk = await readChunk(index, length);
      if (chunk.byteLength !== length) {
        throw new TransferError(`Couldn’t read “${meta.name}” from this device.`);
      }
      channel.send(chunk);
      sent += length;
      index++;
      onProgress?.(sent);
    }

    // Everything is queued. Wait for the receiver to confirm (or, for a peer that does not
    // send {"done"}, to close the channel, which it does when it has every byte).
    const deadline = Date.now() + DONE_WAIT_MS;
    while (!done && !closed) {
      check();
      if (Date.now() > deadline) throw new TransferError('The other device stopped responding.');
      await pause(500);
    }
  } catch (error) {
    if (error instanceof TransferError) throw error;
    // channel.send throws once the channel is closing
    throw new TransferError('The connection was lost.');
  } finally {
    try {
      channel.close();
    } catch {}
  }
}

type ReceiveOptions = {
  /** Called when the sender's metadata arrives. */
  onMeta?: (meta: FileMeta) => void;
  /** Bytes written so far. */
  onProgress?: (bytes: number) => void;
  signal?: AbortSignal;
};

export function receiveFile(
  channel: Channel,
  sink: Sink,
  { onMeta, onProgress, signal }: ReceiveOptions = {},
): Promise<FileMeta> {
  return new Promise<FileMeta>((resolve, reject) => {
    channel.binaryType = 'arraybuffer';

    let meta: FileMeta | null = null;
    let received = 0;
    let chunks = 0;
    let finished = false;

    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      reject(error);
    };
    const finish = (complete: FileMeta) => {
      if (finished) return;
      finished = true;
      try {
        channel.send(JSON.stringify({ done: true }));
      } catch {}
      try {
        channel.close();
      } catch {}
      resolve(complete);
    };

    channel.onclose = () => fail(new TransferError('The connection was lost.'));
    signal?.addEventListener('abort', () => {
      try {
        channel.close();
      } catch {}
      fail(new TransferError('Cancelled.'));
    });

    channel.onmessage = (event: { data: unknown }) => {
      if (finished) return;
      try {
        const data = event.data;
        if (!meta) {
          if (typeof data !== 'string') return;
          const parsed = JSON.parse(data);
          if (typeof parsed.size !== 'number' || typeof parsed.name !== 'string') {
            throw new TransferError('The other device sent an unreadable file description.');
          }
          meta = { name: parsed.name, size: parsed.size, mimeType: parsed.mimeType ?? '' };
          onMeta?.(meta);
          if (meta.size === 0) finish(meta);
          return;
        }
        if (typeof data === 'string') return; // a control message we do not use

        const chunk = new Uint8Array(data as ArrayBuffer);
        sink.writeSync(chunk);
        received += chunk.byteLength;
        chunks++;
        if (chunks % ACK_EVERY === 0) channel.send(JSON.stringify({ ack: chunks }));
        onProgress?.(Math.min(received, meta.size));
        if (received >= meta.size) finish(meta);
      } catch (error) {
        fail(error instanceof Error ? error : new TransferError('Receiving failed.'));
      }
    };

    // The handler is attached: tell the sender it may start.
    const sayReady = () => {
      try {
        channel.send(JSON.stringify({ ready: true }));
      } catch {}
    };
    if (channel.readyState === 'open') sayReady();
    else channel.onopen = sayReady;
  });
}

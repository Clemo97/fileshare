// Phase 1 spike (throwaway). WebRTC checks using react-native-webrtc the same way
// the web app's connect-peer.ts uses the browser API: new RTCPeerConnection() with
// no arguments, addEventListener, setLocalDescription() with no arguments, plain
// JSON for descriptions/candidates, a "test" channel then a "file:0" channel.
import { RTCPeerConnection } from 'react-native-webrtc';

import { createSpikeFile, openFileSink } from './fileio';
import { postJson, getJson } from './http';
import { receiveFile, sendFile, type Channel } from './transfer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PC = any;

const now = () => performance.now();

export type PeerJob = {
  kind: 'loopback' | 'interop';
  sizeMB: number;
  chunkKB: number;
  // interop only
  room?: string;
  role?: 'caller' | 'callee';
  dir?: 'send' | 'recv';
  ice?: string;
  /** 'file' (default): read from / write to disk with awaited calls. 'file-sync': received chunks written with writeBytesSync. 'memory': no disk. */
  io?: 'memory' | 'file' | 'file-sync';
  /** 'buffer' (default) = bufferedAmount like the web app; 'ack' = receiver acks every 16 chunks, sender window of `window` chunks. */
  flow?: 'buffer' | 'ack';
  window?: number;
  iceServers?: IceServer[];
  /** Receiver sends {ready:true}; sender waits for it before sending anything. */
  handshake?: boolean;
  /** 'relay' forces all traffic through TURN. */
  policy?: 'all' | 'relay';
};

const ACK_EVERY = 16;
const flowOf = (job: PeerJob) =>
  ({ flow: job.flow ?? 'buffer', window: job.window ?? 64, handshake: !!job.handshake }) as const;
const ackEveryOf = (job: PeerJob) => (job.flow === 'ack' ? ACK_EVERY : 0);

type IceServer = { urls: string; username?: string; credential?: string };

/** `ice` is a STUN shorthand; `iceServers`/`policy` allow TURN with credentials and relay-only. */
function newConnection(job?: Pick<PeerJob, 'ice' | 'iceServers' | 'policy'>): PC {
  const iceServers: IceServer[] = job?.iceServers ?? (job?.ice ? [{ urls: job.ice }] : []);
  if (!iceServers.length && !job?.policy) {
    // the web app calls this with no arguments; checking the library accepts that
    return new RTCPeerConnection();
  }
  return new RTCPeerConnection({
    iceServers,
    ...(job?.policy ? { iceTransportPolicy: job.policy } : {}),
  });
}

function trackStates(pc: PC, t0: number) {
  const states: [number, string, string][] = [];
  const record = (event: string, value: string) =>
    states.push([+((now() - t0) / 1000).toFixed(2), event, value]);
  pc.addEventListener('connectionstatechange', () => record('connectionState', pc.connectionState));
  pc.addEventListener('iceconnectionstatechange', () =>
    record('iceConnectionState', pc.iceConnectionState),
  );
  pc.addEventListener('icegatheringstatechange', () =>
    record('iceGatheringState', pc.iceGatheringState),
  );
  return states;
}

async function selectedPair(pc: PC) {
  try {
    const stats = await pc.getStats();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byId: Record<string, any> = {};
    let pairId: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stats.forEach((report: any, key: string) => {
      byId[report.id ?? key] = report;
      if (report.type === 'transport' && report.selectedCandidatePairId) {
        pairId = report.selectedCandidatePairId;
      }
    });
    const pair =
      (pairId && byId[pairId]) ||
      Object.values(byId).find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (r: any) => r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected),
      );
    if (!pair) return { note: 'no selected pair' };
    const local = byId[pair.localCandidateId];
    const remote = byId[pair.remoteCandidateId];
    return { local: local?.candidateType, remote: remote?.candidateType, protocol: local?.protocol };
  } catch (error) {
    return { error: String(error) };
  }
}

function waitConnected(pc: PC, t0: number, timeoutMs = 45000) {
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), timeoutMs);
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'connected') {
        clearTimeout(timer);
        resolve(now() - t0);
      }
      if (pc.connectionState === 'failed') {
        clearTimeout(timer);
        reject(new Error('connectionState=failed'));
      }
    });
  });
}

/** Two peer connections inside one JS runtime, signaling handed over in memory. */
export async function runLoopback(job: PeerJob) {
  const t0 = now();
  const a = newConnection();
  const b = newConnection();
  const states = trackStates(a, t0);
  const candidateKeys: string[][] = [];

  const forward = (from: PC, to: PC) =>
    from.addEventListener('icecandidate', (event: { candidate?: object }) => {
      if (!event.candidate) return;
      const json = JSON.parse(JSON.stringify(event.candidate));
      candidateKeys.push(Object.keys(json));
      to.addIceCandidate(json).catch(() => {});
    });
  forward(a, b);
  forward(b, a);

  const connected = Promise.all([waitConnected(a, t0), waitConnected(b, t0)]);
  const incoming = new Promise<Channel>((resolve) => {
    b.addEventListener('datachannel', (event: { channel: Channel }) => {
      if (event.channel.label.startsWith('file:')) resolve(event.channel);
    });
  });

  const dummy = a.createDataChannel('test');
  await a.setLocalDescription();
  await b.setRemoteDescription(JSON.parse(JSON.stringify(a.localDescription)));
  await b.setLocalDescription();
  await a.setRemoteDescription(JSON.parse(JSON.stringify(b.localDescription)));

  const [connectMs] = await connected;
  dummy.close();
  const pair = await selectedPair(a);

  const sizeBytes = job.sizeMB * 1048576;
  const chunkBytes = job.chunkKB * 1024;
  const io = job.io ?? 'file';
  const source = io !== 'memory' ? await createSpikeFile(job.sizeMB, job.chunkKB) : undefined;
  const target = io !== 'memory' ? openFileSink(io === 'file-sync') : undefined;
  const sender = a.createDataChannel('file:0');
  let send, receive;
  try {
    [send, receive] = await Promise.all([
      sendFile(sender, sizeBytes, chunkBytes, source?.readChunk, flowOf(job)),
      incoming.then((channel) => receiveFile(channel, target?.sink, { ackEvery: ackEveryOf(job), handshake: !!job.handshake })),
    ]);
  } finally {
    source?.cleanup();
  }
  const sizeOnDisk = target?.sizeOnDisk();
  target?.cleanup();

  const result = {
    ok:
      receive.badChunks === 0 &&
      receive.bytes === sizeBytes &&
      (sizeOnDisk === undefined || sizeOnDisk === sizeBytes),
    io,
    sizeOnDisk,
    connectMs: Math.round(connectMs),
    pair,
    send,
    receive,
    candidateJsonKeys: candidateKeys[0] ?? null,
    states,
  };
  a.close();
  b.close();
  return result;
}

/**
 * One side of a connection between this app and the browser peer page, using the
 * local spike server as the signaling channel (stands in for web_rtc_signals).
 */
export async function runInterop(job: PeerJob) {
  const room = job.room!;
  const role = job.role!;
  const dir = job.dir!;
  const peerRole = role === 'caller' ? 'callee' : 'caller';
  const t0 = now();
  const errors: string[] = [];

  const pc = newConnection(job);
  const states = trackStates(pc, t0);
  let remoteSet = false;
  const pending: object[] = [];
  let candidateJsonKeys: string[] | null = null;
  const gathered: Record<string, number> = {};

  const signal = (msg: object) => postJson('/signal', { room, to: peerRole, msg });
  const addRemote = async (candidate: object) => {
    try {
      await pc.addIceCandidate(candidate);
    } catch (error) {
      errors.push('addIceCandidate: ' + String(error));
    }
  };

  pc.addEventListener('icecandidate', (event: { candidate?: object }) => {
    if (!event.candidate) return;
    const payload = JSON.parse(JSON.stringify(event.candidate));
    candidateJsonKeys = candidateJsonKeys ?? Object.keys(payload);
    const type = /\btyp (\w+)/.exec(payload.candidate)?.[1] ?? 'unknown';
    const key = payload.candidate.includes('.local ') ? `${type}(mdns)` : type;
    gathered[key] = (gathered[key] ?? 0) + 1;
    signal({ kind: 'candidate', payload });
  });

  const connected = waitConnected(pc, t0);
  connected.catch(() => {});
  const fileChannel = new Promise<Channel>((resolve) => {
    pc.addEventListener('datachannel', (event: { channel: Channel }) => {
      void postJson('/log', {
        who: 'app',
        line: `datachannel event: label=${event.channel.label} readyState=${event.channel.readyState}`,
      }).catch(() => {});
      if (event.channel.label.startsWith('file:')) resolve(event.channel);
    });
  });

  let running = true;
  const pump = (async () => {
    let after = 0;
    while (running) {
      const response = await getJson<{ msgs: { n: number; msg: { kind: string; payload: object } }[] }>(
        `/signal?room=${room}&to=${role}&after=${after}`,
      ).catch(() => ({ msgs: [] }));
      for (const { n, msg } of response.msgs) {
        after = n;
        if (msg.kind === 'offer' || msg.kind === 'answer') {
          await pc.setRemoteDescription(msg.payload);
          remoteSet = true;
          for (const candidate of pending.splice(0)) await addRemote(candidate);
          if (msg.kind === 'offer') {
            await pc.setLocalDescription();
            await signal({
              kind: 'answer',
              payload: JSON.parse(JSON.stringify(pc.localDescription)),
            });
          }
        } else if (msg.kind === 'candidate') {
          if (remoteSet) await addRemote(msg.payload);
          else pending.push(msg.payload);
        }
      }
    }
  })();

  let dummy: Channel | undefined;
  if (role === 'caller') {
    dummy = pc.createDataChannel('test');
    await pc.setLocalDescription();
    await signal({ kind: 'offer', payload: JSON.parse(JSON.stringify(pc.localDescription)) });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = { room, role, dir };
  try {
    result.connectMs = Math.round(await connected);
    dummy?.close();
    result.pair = await selectedPair(pc);

    const sizeBytes = job.sizeMB * 1048576;
    const chunkBytes = job.chunkKB * 1024;
    const io = job.io ?? 'file';
    result.io = io;
    if (dir === 'send') {
      const source = io !== 'memory' ? await createSpikeFile(job.sizeMB, job.chunkKB) : undefined;
      try {
        result.transfer = await sendFile(
          pc.createDataChannel('file:0'),
          sizeBytes,
          chunkBytes,
          source?.readChunk,
          flowOf(job),
        );
      } finally {
        source?.cleanup();
      }
      result.ok = result.transfer.totalMs !== null;
    } else {
      const target = io !== 'memory' ? openFileSink(io === 'file-sync') : undefined;
      result.transfer = await receiveFile(await fileChannel, target?.sink, { ackEvery: ackEveryOf(job), handshake: !!job.handshake });
      result.sizeOnDisk = target?.sizeOnDisk();
      target?.cleanup();
      result.ok =
        result.transfer.badChunks === 0 &&
        result.transfer.bytes === sizeBytes &&
        (result.sizeOnDisk === undefined || result.sizeOnDisk === sizeBytes);
    }
  } catch (error) {
    result.ok = false;
    result.error = String(error);
    result.pair = result.pair ?? (await selectedPair(pc));
  }

  result.states = states;
  result.candidateJsonKeys = candidateJsonKeys;
  result.gathered = gathered;
  result.errors = errors;
  running = false;
  void pump;
  setTimeout(() => pc.close(), 500);
  return result;
}

/**
 * Does bufferedAmount / bufferedamountlow behave the way the web app's send loop assumes?
 * Bursts chunks without yielding, then watches the JS-visible bufferedAmount and the event.
 */
export async function runBackpressure() {
  const t0 = now();
  const say = (line: string) => void postJson('/log', { who: 'ios', line: `bp: ${line}` }).catch(() => {});
  say('start');
  const a = newConnection();
  const b = newConnection();
  const forward = (from: PC, to: PC) =>
    from.addEventListener('icecandidate', (event: { candidate?: object }) => {
      if (event.candidate) to.addIceCandidate(JSON.parse(JSON.stringify(event.candidate))).catch(() => {});
    });
  forward(a, b);
  forward(b, a);
  const connected = Promise.all([waitConnected(a, t0), waitConnected(b, t0)]);
  const received: Record<string, number> = {};
  b.addEventListener('datachannel', (event: { channel: Channel }) => {
    const ch = event.channel;
    received[ch.label] = 0;
    ch.onmessage = (m: { data: ArrayBuffer | string }) => {
      if (typeof m.data !== 'string') received[ch.label] += m.data.byteLength;
    };
  });
  const dummy = a.createDataChannel('test');
  await a.setLocalDescription();
  await b.setRemoteDescription(JSON.parse(JSON.stringify(a.localDescription)));
  await b.setLocalDescription();
  await a.setRemoteDescription(JSON.parse(JSON.stringify(b.localDescription)));
  say('waiting for connection');
  await connected;
  say('connected');
  dummy.close();

  const chunk = new Uint8Array(50 * 1024);
  const runs = [];
  for (const [label, threshold] of [['file:0', 0], ['file:1', 250 * 1024]] as const) {
    const ch = a.createDataChannel(label);
    ch.binaryType = 'arraybuffer';
    ch.bufferedAmountLowThreshold = threshold;
    say(`${label}: created, readyState=${ch.readyState}`);
    if (ch.readyState !== 'open') {
      await new Promise<void>((resolve) => {
        ch.onopen = () => resolve();
      });
    }
    say(`${label}: open`);
    let events = 0;
    let firstEventMs: number | null = null;
    const start = now();
    ch.onbufferedamountlow = () => {
      events++;
      if (firstEventMs === null) firstEventMs = Math.round(now() - start);
    };
    for (let i = 0; i < 100; i++) ch.send(chunk); // 5 MB burst, no yielding
    const immediate = ch.bufferedAmount;
    say(`${label}: burst sent, bufferedAmount=${immediate}`);
    const samples: [number, number][] = [];
    for (const wait of [0, 20, 100, 500, 2000]) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      samples.push([Math.round(now() - start), ch.bufferedAmount]);
    }
    runs.push({ label, threshold, immediateBufferedAmount: immediate, samples, events, firstEventMs, receivedBytes: received[label] });
    ch.close();
  }
  a.close();
  b.close();
  return { ok: true, runs };
}

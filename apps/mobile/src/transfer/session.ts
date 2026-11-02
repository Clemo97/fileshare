// One transfer = one WebRTC link between two paired devices, set up through the signaling
// table. The SENDER is the caller: it opens one data channel per file ("file:<index>", like the
// web app), makes the offer and sends the files one after another. The RECEIVER answers and
// accepts the channels as they arrive.
//
// react-native-webrtc is loaded inside openLink() so this file can be imported anywhere without
// pulling a native-only module into the release build's Node pre-render (HANDOFF G2).
import type { SupabaseClient } from '@supabase/supabase-js';

import type { FileMeta } from '@/features/sample-data';

import { openSink, openSource, type PickedFile } from './files';
import { getIceServers } from './ice';
import { receiveFile, sendFile, TransferError, type Channel } from './protocol';
import { clearOwnSignals, openInbox, sendSignal } from './signaling';

export type Hooks = {
  /** 'connecting' while the link is set up, 'transferring' once files are moving. */
  onPhase(phase: 'connecting' | 'transferring'): void;
  onProgress(index: number, bytes: number): void;
  /** `uri` is where a received file was saved. */
  onFileDone(index: number, uri?: string): void;
};

const CONNECT_TIMEOUT_MS = 30_000;
const CONNECT_FAILED =
  'Couldn’t establish a direct link between the devices. Public Wi-Fi and mobile data often block device-to-device connections; a relay server is needed for those networks.';

type PeerConnection = any;

type Link = Awaited<ReturnType<typeof openLink>>;

async function openLink(
  client: SupabaseClient,
  me: string,
  remote: string,
  role: 'caller' | 'callee',
) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { RTCPeerConnection } = require('react-native-webrtc');
  const pc: PeerConnection = new RTCPeerConnection({ iceServers: await getIceServers(client) });

  let fail: (error: Error) => void = () => {};
  /** Rejects if the signaling or the connection itself breaks. */
  const failed = new Promise<never>((_, reject) => {
    fail = reject;
  });
  failed.catch(() => {});

  pc.addEventListener('icecandidate', (event: { candidate?: object }) => {
    if (!event.candidate) return;
    void sendSignal(client, me, remote, JSON.parse(JSON.stringify(event.candidate))).catch(
      () => {},
    );
  });

  // Signals are handled strictly one at a time, in the order they arrived: a candidate that
  // follows the answer must not be tried before the answer has been applied.
  let remoteSet = false;
  const pending: object[] = [];
  const addCandidate = async (candidate: object) => {
    try {
      await pc.addIceCandidate(candidate);
    } catch {} // a stale or duplicate candidate is harmless
  };
  const flushCandidates = async () => {
    remoteSet = true;
    for (const candidate of pending.splice(0)) await addCandidate(candidate);
  };
  const handle = async (payload: Record<string, unknown>) => {
    try {
      if (payload.type === 'answer' && role === 'caller') {
        await pc.setRemoteDescription(payload);
        await flushCandidates();
      } else if (payload.type === 'offer' && role === 'callee') {
        await pc.setRemoteDescription(payload);
        await flushCandidates();
        await pc.setLocalDescription();
        await sendSignal(client, me, remote, JSON.parse(JSON.stringify(pc.localDescription)));
      } else if (typeof payload.candidate === 'string') {
        if (remoteSet) await addCandidate(payload);
        else pending.push(payload);
      }
    } catch {
      fail(new TransferError('Couldn’t set up the connection with the other device.'));
    }
  };
  let queue = Promise.resolve();
  const inbox = openInbox(client, me, remote, (payload) => {
    queue = queue.then(() => handle(payload));
  });

  const connected = (timeoutMs: number) =>
    Promise.race([
      new Promise<void>((resolve, reject) => {
        const clear = () => {
          clearTimeout(timer);
          pc.removeEventListener('connectionstatechange', check);
        };
        const check = () => {
          if (pc.connectionState === 'connected') {
            clear();
            resolve();
          } else if (pc.connectionState === 'failed') {
            clear();
            reject(new TransferError(CONNECT_FAILED));
          }
        };
        const timer = setTimeout(() => {
          clear();
          reject(new TransferError(CONNECT_FAILED));
        }, timeoutMs);
        pc.addEventListener('connectionstatechange', check);
        check();
      }),
      failed,
    ]);

  return {
    pc,
    failed,
    connected,
    async close() {
      inbox.close();
      try {
        pc.close();
      } catch {}
      await clearOwnSignals(client, me, remote).catch(() => {});
    },
  };
}

type Common = {
  client: SupabaseClient;
  me: string;
  remote: string;
  hooks: Hooks;
  signal: AbortSignal;
};

/** Sends `files` to `remote`, one after another. Resolves when every file is confirmed. */
export async function sendFiles({ client, me, remote, files, hooks, signal }: Common & {
  files: PickedFile[];
}) {
  const link = await openLink(client, me, remote, 'caller');
  try {
    // The channels must exist before the offer so that the offer describes them.
    const channels: Channel[] = files.map((_, index) => link.pc.createDataChannel(`file:${index}`));
    await link.pc.setLocalDescription();
    await sendSignal(client, me, remote, JSON.parse(JSON.stringify(link.pc.localDescription)));

    hooks.onPhase('connecting');
    await link.connected(CONNECT_TIMEOUT_MS);
    hooks.onPhase('transferring');

    for (let index = 0; index < files.length; index++) {
      if (signal.aborted) throw new TransferError('Cancelled.');
      const source = openSource(files[index]);
      try {
        await Promise.race([
          sendFile(channels[index], files[index], source.readChunk, {
            onProgress: (bytes) => hooks.onProgress(index, bytes),
            signal,
          }),
          link.failed,
        ]);
      } finally {
        source.close();
      }
      hooks.onFileDone(index);
    }
  } finally {
    await link.close();
  }
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/**
 * Starts listening for `files` from `remote`. `ready` resolves once this device is listening, and
 * the "accept" answer must only be sent after that. `done` resolves when every file is saved.
 */
export function receiveFiles({ client, me, remote, files, hooks, signal }: Common & {
  files: FileMeta[];
}) {
  let link: Link | undefined;
  const ready = openLink(client, me, remote, 'callee').then((opened) => {
    link = opened;
  });

  const done = (async () => {
    await ready;
    const opened = link!;
    const waiters = files.map(() => deferred());
    const saved: { target: ReturnType<typeof openSink>; complete: boolean }[] = [];
    let sawChannel = false;

    opened.pc.addEventListener('datachannel', (event: { channel: Channel }) => {
      const match = /^file:(\d+)$/.exec(event.channel.label);
      const index = match ? Number(match[1]) : -1;
      if (index < 0 || index >= files.length) return;
      if (!sawChannel) hooks.onPhase('transferring');
      sawChannel = true;

      const target = openSink(files[index].name);
      const entry = { target, complete: false };
      saved.push(entry);
      receiveFile(event.channel, target.sink, {
        onProgress: (bytes) => hooks.onProgress(index, bytes),
        signal,
      }).then(
        () => {
          target.sink.close();
          entry.complete = true;
          hooks.onFileDone(index, target.uri);
          waiters[index].resolve();
        },
        (error) => {
          target.discard();
          waiters[index].reject(error);
        },
      );
    });

    // If nobody connects at all, stop waiting.
    const noShow = new Promise<never>((_, reject) => {
      setTimeout(() => {
        if (!sawChannel) reject(new TransferError(CONNECT_FAILED));
      }, CONNECT_TIMEOUT_MS + 15_000);
    });
    noShow.catch(() => {});

    try {
      await Promise.race([Promise.all(waiters.map((w) => w.promise)), opened.failed, noShow]);
    } catch (error) {
      // Keep the files that arrived completely; throw away only the one that was cut short.
      for (const { target, complete } of saved) if (!complete) target.discard();
      throw error;
    } finally {
      await opened.close();
    }
  })();
  done.catch(() => {});

  return { ready, done };
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type PropsWithChildren,
} from 'react';
import { Alert } from 'react-native';

import { describeError, supabase } from '@/lib/supabase';
import { createTestFile, pickFiles, shareReceived, type PickedFile } from '@/transfer/files';
import { TransferError } from '@/transfer/protocol';
import {
  createRequest,
  deleteRequest,
  listenForRequests,
  parseRequestFiles,
  respond,
  waitForResponse,
  type RequestRow,
} from '@/transfer/requests';
import { receiveFiles, sendFiles } from '@/transfer/session';
import { clearOwnSignals } from '@/transfer/signaling';

import { useDemoStore } from './demo-store';
import type { FileMeta } from './sample-data';
import { useSession } from './session';

/** What the screens can do about file transfers. */
export type TransferApi = {
  /** False until the app is signed in. In demo mode it is always true. */
  available: boolean;
  /** Asks for files to send, then asks the other device and sends them. */
  send: (personId: string) => void;
  /** Accept or decline the request shown in the dialog. */
  accept: () => void;
  decline: () => void;
  /** Opens the share sheet for a received file. */
  save: (uri: string, mimeType: string) => void;
  /** Development only: sends generated files without the picker. */
  sendTest: (personId: string, sizesMB: number[]) => void;
};

const TransferContext = createContext<TransferApi | null>(null);

const describeTransferError = (error: unknown) =>
  error instanceof TransferError ? error.message : describeError(error);

async function keepAwake(on: boolean) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const KeepAwake = require('expo-keep-awake') as typeof import('expo-keep-awake');
    if (on) await KeepAwake.activateKeepAwakeAsync('transfer');
    else await KeepAwake.deactivateKeepAwake('transfer');
  } catch {} // staying awake is a nicety, never a reason to fail a transfer
}

/**
 * Real file transfers between paired devices when Supabase is configured; the offline preview's
 * simulation otherwise. Lives inside the session and the store: it reports what happens to the
 * store (progress, errors, incoming requests) and the cards and dialog read it from there.
 */
export function TransferProvider({ children }: PropsWithChildren) {
  const session = useSession();
  const store = useDemoStore();
  const { engine } = store;
  const client = supabase;
  const me = session.status === 'ready' ? session.userId : undefined;

  const stateRef = useRef(store.state);
  useEffect(() => {
    stateRef.current = store.state;
  }, [store.state]);

  /** Connections with a transfer running, so a second one is not started on top of it. */
  const busy = useRef(new Set<string>());
  const awake = useRef(0);
  const handledRequests = useRef(new Set<string>());

  const setAwake = useCallback(async (on: boolean) => {
    awake.current += on ? 1 : -1;
    if (on && awake.current === 1) await keepAwake(true);
    if (!on && awake.current === 0) await keepAwake(false);
  }, []);

  /** Reports progress at most ~5 times a second per file, not once per 50 KB chunk. */
  const throttledProgress = useCallback(
    (personId: string, sizes: number[]) => {
      const last = new Map<number, number>();
      return (index: number, bytes: number) => {
        const now = Date.now();
        if (bytes >= sizes[index] || now - (last.get(index) ?? 0) >= 200) {
          last.set(index, now);
          engine.progress(personId, index, bytes);
        }
      };
    },
    [engine],
  );

  const runSend = useCallback(
    async (personId: string, picked: PickedFile[]) => {
      if (!client || !me || busy.current.has(personId)) return;
      busy.current.add(personId);
      const abort = new AbortController();
      const metas: FileMeta[] = picked.map(({ name, size, mimeType }) => ({ name, size, mimeType }));
      engine.begin(personId, 'send', metas);
      engine.setStatus(personId, 'sending-request');
      await setAwake(true);

      let requestId: string | undefined;
      try {
        await clearOwnSignals(client, me, personId); // leftovers of an earlier attempt
        requestId = await createRequest(client, me, personId, metas);

        const answer = await waitForResponse(client, requestId, abort.signal);
        if (answer === 'timeout') throw new TransferError('They did not answer the request.');
        if (answer === 'declined') throw new TransferError('They declined the transfer.');

        await sendFiles({
          client,
          me,
          remote: personId,
          files: picked,
          signal: abort.signal,
          hooks: {
            onPhase: (phase) =>
              engine.setStatus(personId, phase === 'connecting' ? 'connecting' : 'connected'),
            onProgress: throttledProgress(personId, metas.map((m) => m.size)),
            onFileDone: (index) => engine.fileDone(personId, index),
          },
        });
        engine.setStatus(personId, 'connected');
      } catch (error) {
        abort.abort();
        engine.fail(personId, describeTransferError(error));
      } finally {
        if (requestId) await deleteRequest(client, requestId).catch(() => {});
        busy.current.delete(personId);
        await setAwake(false);
      }
    },
    [client, me, engine, setAwake, throttledProgress],
  );

  const send = useCallback(
    (personId: string) => {
      void (async () => {
        try {
          const picked = await pickFiles();
          if (picked) await runSend(personId, picked);
        } catch (error) {
          Alert.alert('Couldn’t choose files', describeError(error));
        }
      })();
    },
    [runSend],
  );

  const accept = useCallback(() => {
    const request = stateRef.current.request;
    if (!client || !me || !request?.requestId) return;
    const personId = request.connectionId;
    const requestId = request.requestId;
    engine.setRequest(undefined);
    if (busy.current.has(personId)) return;
    busy.current.add(personId);

    void (async () => {
      const abort = new AbortController();
      engine.begin(personId, 'receive', request.files);
      engine.setStatus(personId, 'connecting');
      await setAwake(true);
      try {
        const receiver = receiveFiles({
          client,
          me,
          remote: personId,
          files: request.files,
          signal: abort.signal,
          hooks: {
            onPhase: (phase) =>
              engine.setStatus(personId, phase === 'connecting' ? 'connecting' : 'connected'),
            onProgress: throttledProgress(personId, request.files.map((f) => f.size)),
            onFileDone: (index, uri) => engine.fileDone(personId, index, uri),
          },
        });
        // Only say yes once this device is listening, or the sender could start too early.
        await receiver.ready;
        await respond(client, requestId, true);
        await receiver.done;
        engine.setStatus(personId, 'connected');
      } catch (error) {
        abort.abort();
        engine.fail(personId, describeTransferError(error));
      } finally {
        busy.current.delete(personId);
        await setAwake(false);
      }
    })();
  }, [client, me, engine, setAwake, throttledProgress]);

  const decline = useCallback(() => {
    const request = stateRef.current.request;
    engine.setRequest(undefined);
    if (client && request?.requestId) void respond(client, request.requestId, false).catch(() => {});
  }, [client, engine]);

  // Incoming requests.
  useEffect(() => {
    if (!client || !me) return;
    return listenForRequests(client, me, (row: RequestRow) => {
      const files = parseRequestFiles(row.payload);
      if (!files || handledRequests.current.has(row.id)) return;
      if (stateRef.current.request || busy.current.has(row.from_user_id)) return;
      handledRequests.current.add(row.id);
      engine.setRequest({ connectionId: row.from_user_id, files, requestId: row.id });
    });
  }, [client, me, engine]);

  const save = useCallback((uri: string, mimeType: string) => {
    shareReceived(uri, mimeType).catch((error) =>
      Alert.alert('Couldn’t open the share sheet', describeError(error)),
    );
  }, []);

  const sendTest = useCallback(
    (personId: string, sizesMB: number[]) => {
      if (!__DEV__) return;
      const picked = sizesMB.map((mb, index) => createTestFile(mb, String.fromCharCode(97 + index)));
      void runSend(personId, picked);
    },
    [runSend],
  );

  const api = useMemo<TransferApi>(() => {
    if (session.status === 'demo') {
      return {
        available: true,
        send: store.sendFiles,
        accept: store.acceptRequest,
        decline: store.declineRequest,
        save: () => {},
        sendTest: () => {},
      };
    }
    return { available: session.status === 'ready', send, accept, decline, save, sendTest };
  }, [session.status, store.sendFiles, store.acceptRequest, store.declineRequest, send, accept, decline, save, sendTest]);

  return <TransferContext.Provider value={api}>{children}</TransferContext.Provider>;
}

export function useTransfer() {
  const api = useContext(TransferContext);
  if (!api) throw new Error('useTransfer must be used inside TransferProvider');
  return api;
}

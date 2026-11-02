// UI-preview state: a stand-in for the web app's connection machines. File transfers are
// still simulated with timers so the screens can be built and reviewed before WebRTC is
// wired in. The list of connections is real when Supabase is configured: connections-sync.tsx
// feeds it through syncConnections. Without Supabase everything here is sample data
// (see sample-data.ts).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type PropsWithChildren,
} from 'react';

import { FILES, PEOPLE, type FileMeta, type Person } from './sample-data';

export type Transfer = {
  direction: 'send' | 'receive';
  files: FileMeta[];
  /** Bytes transferred per file. */
  transferred: number[];
  /** Where each received file was saved (real transfers only). */
  uris?: (string | undefined)[];
};

export type Connection = {
  id: string;
  person: Person;
  status: 'idle' | 'sending-request' | 'connecting' | 'connected';
  transfer?: Transfer;
  /** Why the last real transfer failed or was refused. Cleared when a new one starts. */
  error?: string;
};

export type IncomingRequest = {
  connectionId: string;
  files: FileMeta[];
  /** The file_sharing_request row, for a real request. */
  requestId?: string;
};

type State = { connections: Connection[]; request?: IncomingRequest };

/** Ready-made states, reachable in development with e.g. mobile://home?demo=transferring */
export const SCENARIOS = ['empty', 'connected', 'transferring', 'request'] as const;
export type Scenario = (typeof SCENARIOS)[number];

const idle = (person: Person): Connection => ({ id: person.id, person, status: 'idle' });

function scenarioState(scenario: Scenario): State {
  const [photos, budget, recording] = FILES;

  switch (scenario) {
    case 'empty':
      return { connections: [] };
    case 'connected':
      return { connections: [idle(PEOPLE.roseSquirrel), idle(PEOPLE.blueRabbit)] };
    case 'transferring':
      return {
        connections: [
          {
            ...idle(PEOPLE.roseSquirrel),
            status: 'connected',
            transfer: {
              direction: 'send',
              files: [budget, photos],
              transferred: [budget.size, photos.size * 0.62],
            },
          },
          {
            ...idle(PEOPLE.blueRabbit),
            status: 'connected',
            transfer: {
              direction: 'receive',
              files: [recording],
              transferred: [recording.size * 0.28],
            },
          },
        ],
      };
    case 'request':
      return {
        connections: [idle(PEOPLE.roseSquirrel), idle(PEOPLE.blueRabbit)],
        request: { connectionId: PEOPLE.blueRabbit.id, files: [photos, budget] },
      };
  }
}

type Action =
  | { type: 'set'; state: State }
  | { type: 'sync'; people: Person[] }
  | { type: 'add'; person: Person }
  | { type: 'remove'; id: string }
  | { type: 'patch'; id: string; patch: Partial<Connection> }
  | { type: 'advance'; id: string }
  | { type: 'clearRequest' }
  // Used by the real transfer engine (transfer-provider.tsx)
  | { type: 'begin'; id: string; direction: Transfer['direction']; files: FileMeta[] }
  | { type: 'progress'; id: string; index: number; bytes: number }
  | { type: 'fileDone'; id: string; index: number; uri?: string }
  | { type: 'status'; id: string; status: Connection['status'] }
  | { type: 'fail'; id: string; error: string }
  | { type: 'request'; request?: IncomingRequest };

/** Applies `change` to one connection's transfer, if it has one. */
const withTransfer = (
  state: State,
  id: string,
  change: (transfer: Transfer) => Transfer,
): State => ({
  ...state,
  connections: state.connections.map((c) =>
    c.id === id && c.transfer ? { ...c, transfer: change(c.transfer) } : c,
  ),
});

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'set':
      return action.state;
    case 'sync': {
      // Keep the entry (and any transfer in progress) of everyone who is still connected.
      const current = new Map(state.connections.map((c) => [c.id, c]));
      return {
        ...state,
        connections: action.people.map((person) => current.get(person.id) ?? idle(person)),
      };
    }
    case 'add':
      return state.connections.some((c) => c.id === action.person.id)
        ? state
        : { ...state, connections: [...state.connections, idle(action.person)] };
    case 'remove':
      return { ...state, connections: state.connections.filter((c) => c.id !== action.id) };
    case 'patch':
      return {
        ...state,
        connections: state.connections.map((c) =>
          c.id === action.id ? { ...c, ...action.patch } : c,
        ),
      };
    case 'advance':
      return {
        ...state,
        connections: state.connections.map((c) => {
          if (c.id !== action.id || !c.transfer) return c;
          const { files, transferred } = c.transfer;
          const next = files.findIndex((file, i) => transferred[i] < file.size);
          if (next === -1) return c;
          const copy = [...transferred];
          copy[next] = Math.min(files[next].size, copy[next] + files[next].size / 20);
          return { ...c, transfer: { ...c.transfer, transferred: copy } };
        }),
      };
    case 'clearRequest':
      return { ...state, request: undefined };
    case 'begin':
      return {
        ...state,
        connections: state.connections.map((c) =>
          c.id === action.id
            ? {
                ...c,
                error: undefined,
                transfer: {
                  direction: action.direction,
                  files: action.files,
                  transferred: action.files.map(() => 0),
                  uris: action.files.map(() => undefined),
                },
              }
            : c,
        ),
      };
    case 'progress':
      return withTransfer(state, action.id, (transfer) => {
        const transferred = [...transfer.transferred];
        // Never move backwards: progress events can arrive late or out of order.
        transferred[action.index] = Math.max(transferred[action.index] ?? 0, action.bytes);
        return { ...transfer, transferred };
      });
    case 'fileDone':
      return withTransfer(state, action.id, (transfer) => {
        const transferred = [...transfer.transferred];
        transferred[action.index] = transfer.files[action.index]?.size ?? transferred[action.index];
        const uris = [...(transfer.uris ?? transfer.files.map(() => undefined))];
        uris[action.index] = action.uri;
        return { ...transfer, transferred, uris };
      });
    case 'status':
      return {
        ...state,
        connections: state.connections.map((c) =>
          c.id === action.id ? { ...c, status: action.status } : c,
        ),
      };
    case 'fail':
      return {
        ...state,
        connections: state.connections.map((c) =>
          c.id === action.id
            ? { ...c, status: 'idle', transfer: undefined, error: action.error }
            : c,
        ),
      };
    case 'request':
      return { ...state, request: action.request };
  }
}

type Store = {
  state: State;
  /** Replaces the list of connections with the people you are really connected to. */
  syncConnections: (people: Person[]) => void;
  addConnection: (person: Person) => void;
  removeConnection: (id: string) => void;
  sendFiles: (id: string) => void;
  clearTransfer: (id: string) => void;
  acceptRequest: () => void;
  declineRequest: () => void;
  loadScenario: (scenario: Scenario) => void;
  /** What the real transfer engine reports. The demo actions above do not use these. */
  engine: {
    begin: (id: string, direction: Transfer['direction'], files: FileMeta[]) => void;
    progress: (id: string, index: number, bytes: number) => void;
    fileDone: (id: string, index: number, uri?: string) => void;
    setStatus: (id: string, status: Connection['status']) => void;
    fail: (id: string, error: string) => void;
    setRequest: (request?: IncomingRequest) => void;
  };
};

const StoreContext = createContext<Store | null>(null);

export function DemoStoreProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(reducer, { connections: [] });
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const later = useCallback((ms: number, fn: () => void) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      fn();
    }, ms);
    timers.current.add(timer);
  }, []);

  // Simulates a transfer: 20 steps per file, one step every 150 ms.
  const runTransfer = useCallback(
    (id: string, direction: Transfer['direction'], files: FileMeta[]) => {
      dispatch({
        type: 'patch',
        id,
        patch: {
          status: 'connected',
          transfer: { direction, files, transferred: files.map(() => 0) },
        },
      });
      let steps = files.length * 20;
      const tick = () => {
        dispatch({ type: 'advance', id });
        if (--steps > 0) later(150, tick);
      };
      later(150, tick);
    },
    [later],
  );

  // Actions must keep a stable identity (screens call them from effects), so they read the
  // latest state through a ref instead of closing over it.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const actions = useMemo<Omit<Store, 'state'>>(
    () => ({
      syncConnections: (people) => dispatch({ type: 'sync', people }),
      addConnection: (person) => dispatch({ type: 'add', person }),
      removeConnection: (id) => dispatch({ type: 'remove', id }),
      clearTransfer: (id) =>
        dispatch({
          type: 'patch',
          id,
          patch: { status: 'idle', transfer: undefined, error: undefined },
        }),
      sendFiles: (id) => {
        dispatch({ type: 'patch', id, patch: { status: 'sending-request' } });
        later(900, () => {
          dispatch({ type: 'patch', id, patch: { status: 'connecting' } });
          later(900, () => runTransfer(id, 'send', FILES.slice(0, 2)));
        });
      },
      acceptRequest: () => {
        const request = stateRef.current.request;
        dispatch({ type: 'clearRequest' });
        if (!request) return;
        dispatch({ type: 'patch', id: request.connectionId, patch: { status: 'connecting' } });
        later(900, () => runTransfer(request.connectionId, 'receive', request.files));
      },
      declineRequest: () => dispatch({ type: 'clearRequest' }),
      loadScenario: (scenario) => dispatch({ type: 'set', state: scenarioState(scenario) }),
      engine: {
        begin: (id, direction, files) => dispatch({ type: 'begin', id, direction, files }),
        progress: (id, index, bytes) => dispatch({ type: 'progress', id, index, bytes }),
        fileDone: (id, index, uri) => dispatch({ type: 'fileDone', id, index, uri }),
        setStatus: (id, status) => dispatch({ type: 'status', id, status }),
        fail: (id, error) => dispatch({ type: 'fail', id, error }),
        setRequest: (request) => dispatch({ type: 'request', request }),
      },
    }),
    [later, runTransfer],
  );

  const store = useMemo<Store>(() => ({ state, ...actions }), [state, actions]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useDemoStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useDemoStore must be used inside DemoStoreProvider');
  return store;
}

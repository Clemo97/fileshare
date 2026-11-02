import { useEffect } from 'react';
import { AppState, Alert } from 'react-native';

import { describeError, supabase } from '@/lib/supabase';

import { useDemoStore } from './demo-store';
import { deleteConnection, fetchConnections } from './pairing';
import { useSession } from './session';

/**
 * Keeps the connections list in step with Supabase: loads it once signed in, reloads when
 * a connection is added or removed, and again whenever the app returns to the foreground
 * (realtime can miss changes while the app is suspended). Renders nothing.
 */
export function ConnectionsSync() {
  const session = useSession();
  const { syncConnections } = useDemoStore();
  const userId = session.status === 'ready' ? session.userId : undefined;

  useEffect(() => {
    const client = supabase;
    if (!client || !userId) return;

    let cancelled = false;
    const refresh = () => {
      fetchConnections(client, userId).then(
        (people) => {
          if (!cancelled) syncConnections(people);
        },
        (error) => console.warn('[connections] could not refresh:', describeError(error)),
      );
    };

    refresh();

    const channel = client
      .channel(`connections:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_connections' }, refresh)
      .subscribe();

    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });

    return () => {
      cancelled = true;
      client.removeChannel(channel);
      appState.remove();
    };
  }, [userId, syncConnections]);

  return null;
}

/** Actions on connections that go to Supabase when it is configured, else stay local. */
export function useConnectionActions() {
  const session = useSession();
  const { removeConnection } = useDemoStore();

  return {
    remove: async (otherUserId: string) => {
      if (supabase && session.status === 'ready') {
        try {
          await deleteConnection(supabase, session.userId, otherUserId);
        } catch (error) {
          Alert.alert('Couldn’t delete the connection', describeError(error));
          return;
        }
      }
      removeConnection(otherUserId);
    },
  };
}

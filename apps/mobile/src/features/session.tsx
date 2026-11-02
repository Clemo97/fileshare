import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { describeError, supabase } from '@/lib/supabase';

import { fetchProfile } from './profiles';
import { ME, type Person } from './sample-data';

/**
 * Who is using the app. `demo` means Supabase is not configured and everything is sample
 * data. Otherwise the app signs in anonymously, like the web app's auto-login.
 */
export type Session =
  | { status: 'demo'; me: Person }
  | { status: 'loading'; me: Person }
  | { status: 'ready'; me: Person; userId: string }
  | { status: 'error'; me: Person; message: string; retry: () => void };

type Result =
  | { status: 'loading' }
  | { status: 'ready'; me: Person; userId: string }
  | { status: 'error'; message: string };

async function signIn(client: SupabaseClient): Promise<{ me: Person; userId: string }> {
  // The second pass handles a stored session whose user no longer exists on the server
  // (for example after the project was reset): drop it and sign in as someone new.
  for (const startOver of [false, true]) {
    if (startOver) await client.auth.signOut();

    const { data } = await client.auth.getSession();
    let user = data.session?.user ?? null;

    if (!user) {
      const { data: anonymous, error } = await client.auth.signInAnonymously();
      if (error) throw error;
      user = anonymous.user;
    }
    if (!user) throw new Error('Signing in did not return a user.');

    const me = await fetchProfile(client, user.id);
    if (me) return { me, userId: user.id };
  }

  throw new Error('Couldn’t load your profile.');
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result>({ status: 'loading' });

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    let cancelled = false;
    signIn(client).then(
      (signedIn) => {
        if (!cancelled) setResult({ status: 'ready', ...signedIn });
      },
      (error) => {
        if (!cancelled) setResult({ status: 'error', message: describeError(error) });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setResult({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const session = useMemo<Session>(() => {
    if (!supabase) return { status: 'demo', me: ME };
    if (result.status === 'ready') return result;
    if (result.status === 'error') return { ...result, me: ME, retry };
    return { status: 'loading', me: ME };
  }, [result, retry]);

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

// EXPO_PUBLIC_ values are inlined into the bundle at build time, so they have to be read with
// exactly this syntax. Both are public by design: never put the service-role key here.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * The Supabase client, or null when the app is not configured. Without it the app runs as
 * the offline UI preview on sample data (see features/sample-data.ts). It is also null on web:
 * the server export evaluates this module on Node, and the app is native-only (WebRTC).
 */
export const supabase =
  Platform.OS !== 'web' && url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      })
    : null;

if (supabase) {
  // Supabase's React Native guidance: refresh the session only while the app is in the
  // foreground, and register this only once.
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** A message that is fit to show to the user. */
export function describeError(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);

  if (message.includes('too_many_attempts')) {
    return 'Too many wrong codes. Wait a few minutes and try again.';
  }
  if (/network|fetch|timed out|offline/i.test(message)) {
    return 'Couldn’t reach the server. Check your connection and try again.';
  }
  return message;
}

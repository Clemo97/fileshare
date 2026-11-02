// Which STUN and TURN servers the two devices use to find each other.
//
// STUN lets a device learn its public address; it is free and enough on many networks.
// TURN relays the traffic when a direct path is impossible, which is the case on networks
// that block device-to-device traffic (the owner's does, see HANDOFF section 6.2). A TURN
// server needs an account with a provider, so this is the place to plug it in:
//
//   1. Preferred: a Supabase Edge Function named `turn-credentials` that returns
//      { iceServers: [...] } with SHORT-LIVED credentials (it holds the provider's key, so
//      no secret ships in the app). It is called with the signed-in user's token.
//   2. For a quick test: EXPO_PUBLIC_ICE_SERVERS, a JSON array of ice servers. Anything in
//      EXPO_PUBLIC_* is readable inside the built app, so never use credentials you cannot
//      afford to leak, and replace this with (1) before sharing the app.
import type { SupabaseClient } from '@supabase/supabase-js';

export type IceServer = { urls: string | string[]; username?: string; credential?: string };

const STUN: IceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

// The function may not exist yet: remember that for a while instead of asking on every transfer.
let functionMissingUntil = 0;

function fromEnvironment(): IceServer[] {
  const raw = process.env.EXPO_PUBLIC_ICE_SERVERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as IceServer[]) : [];
  } catch {
    console.warn('[transfer] EXPO_PUBLIC_ICE_SERVERS is not valid JSON; ignoring it');
    return [];
  }
}

export async function getIceServers(client: SupabaseClient): Promise<IceServer[]> {
  const servers = [...STUN, ...fromEnvironment()];

  if (Date.now() >= functionMissingUntil) {
    try {
      const { data, error } = await client.functions.invoke('turn-credentials');
      if (error) throw error;
      if (Array.isArray(data?.iceServers)) servers.push(...(data.iceServers as IceServer[]));
    } catch {
      functionMissingUntil = Date.now() + 10 * 60_000;
    }
  }

  return servers;
}

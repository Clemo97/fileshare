// Pairing against Supabase: the same steps as the web app's server actions
// (modules/connections/create/actions.ts), as database functions a phone can call. See
// file-share-rtc/supabase/migrations/20261102120000_pairing-functions.sql.
import type { SupabaseClient } from '@supabase/supabase-js';

import { PROFILE_COLUMNS, toPerson, type ProfileRow } from './profiles';
import type { Person } from './sample-data';

/** Creates a 4-digit code that lasts 5 minutes. Replaces any code you already had. */
export async function createPairingCode(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.rpc('create_pairing_code');
  if (error) throw error;
  return (data as { code: string }).code;
}

/**
 * Redeems another device's code and connects the two. Returns that device's user id, or null
 * if the code is wrong, expired, already used or your own.
 */
export async function redeemPairingCode(client: SupabaseClient, code: string): Promise<string | null> {
  const { data, error } = await client.rpc('redeem_pairing_code', { p_code: code });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** True once another device has redeemed the code you created. */
export async function hasRedemption(client: SupabaseClient, code: string): Promise<boolean> {
  const { data, error } = await client
    .from('pairing_code_redemptions')
    .select('user_id')
    .eq('pairing_code', code)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

type ConnectionRow = {
  user_1_id: string;
  user_2_id: string;
  user_1: ProfileRow | null;
  user_2: ProfileRow | null;
};

/** The other end of each of your connections, oldest first. */
export async function fetchConnections(client: SupabaseClient, userId: string): Promise<Person[]> {
  const { data, error } = await client
    .from('user_connections')
    .select(
      `user_1_id, user_2_id,
       user_1:users!user_connections_user_1_id_fkey(${PROFILE_COLUMNS}),
       user_2:users!user_connections_user_2_id_fkey(${PROFILE_COLUMNS})`,
    )
    .or(`user_1_id.eq.${userId},user_2_id.eq.${userId}`)
    .order('created_at');

  if (error) throw error;

  return (data as unknown as ConnectionRow[]).map((row) =>
    row.user_1_id === userId
      ? toPerson(row.user_2, row.user_2_id)
      : toPerson(row.user_1, row.user_1_id),
  );
}

export async function deleteConnection(
  client: SupabaseClient,
  userId: string,
  otherUserId: string,
): Promise<void> {
  const { error } = await client
    .from('user_connections')
    .delete()
    .or(
      `and(user_1_id.eq.${userId},user_2_id.eq.${otherUserId}),` +
        `and(user_1_id.eq.${otherUserId},user_2_id.eq.${userId})`,
    );

  if (error) throw error;
}

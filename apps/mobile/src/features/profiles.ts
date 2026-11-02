import type { SupabaseClient } from '@supabase/supabase-js';

import { themes } from '@/theme/colors';

import type { Person } from './sample-data';

/** What to select for a user, joined with their colour and animal (the "Blue Rabbit" name). */
export const PROFILE_COLUMNS = 'id, colors(id, label), animals(label, emoji)';

export type ProfileRow = {
  id: string;
  colors: { id: string; label: string } | null;
  animals: { label: string; emoji: string } | null;
};

const isColorId = (id: string | undefined): id is Person['colorId'] =>
  id !== undefined && id !== 'default' && id in themes;

/** Maps a row to the shape the screens use. Missing parts fall back instead of failing. */
export function toPerson(row: ProfileRow | null, fallbackId: string): Person {
  return {
    id: row?.id ?? fallbackId,
    colorId: isColorId(row?.colors?.id) ? row.colors.id : 'blue',
    colorLabel: row?.colors?.label ?? 'Unknown',
    animalLabel: row?.animals?.label ?? 'Device',
    emoji: row?.animals?.emoji ?? '📱',
  };
}

/** The signed-in user's own profile, or null if the server has no row for them. */
export async function fetchProfile(client: SupabaseClient, userId: string): Promise<Person | null> {
  const { data, error } = await client
    .from('users')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data ? toPerson(data as unknown as ProfileRow, userId) : null;
}

// WebRTC signaling over the web app's `web_rtc_signals` table: offers, answers and ICE
// candidates are rows, and each device reads the rows the other one wrote. Row level security
// only lets two connected users write rows to each other.
//
// Realtime delivers rows quickly, but it can miss an event (a subscription that is not ready
// yet, a flaky network), so the inbox also polls. Rows are de-duplicated by id.
import type { SupabaseClient } from '@supabase/supabase-js';

export async function sendSignal(
  client: SupabaseClient,
  from: string,
  to: string,
  payload: object,
): Promise<void> {
  const { error } = await client
    .from('web_rtc_signals')
    .insert({ from_user_id: from, to_user_id: to, payload });
  if (error) throw error;
}

/** Deletes the signals this device wrote to `to`, so the next transfer starts clean. */
export async function clearOwnSignals(client: SupabaseClient, from: string, to: string) {
  await client.from('web_rtc_signals').delete().match({ from_user_id: from, to_user_id: to });
}

type SignalRow = { id: string; payload: unknown; to_user_id: string };

/** Calls `onSignal` for every signal `remote` sends to `me`, once each, oldest first. */
export function openInbox(
  client: SupabaseClient,
  me: string,
  remote: string,
  onSignal: (payload: Record<string, unknown>) => void,
) {
  const seen = new Set<string>();
  let closed = false;

  const deliver = (row: SignalRow) => {
    if (closed || seen.has(row.id) || row.to_user_id !== me) return;
    seen.add(row.id);
    if (row.payload && typeof row.payload === 'object') {
      onSignal(row.payload as Record<string, unknown>);
    }
  };

  const channel = client
    .channel(`signals:${me}:${remote}:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'web_rtc_signals',
        filter: `from_user_id=eq.${remote}`,
      },
      (payload) => deliver(payload.new as SignalRow),
    )
    .subscribe();

  const poll = async () => {
    const { data } = await client
      .from('web_rtc_signals')
      .select('id, payload, to_user_id')
      .eq('from_user_id', remote)
      .eq('to_user_id', me)
      .order('created_at');
    for (const row of (data ?? []) as SignalRow[]) deliver(row);
  };
  const timer = setInterval(() => void poll().catch(() => {}), 1500);
  void poll().catch(() => {});

  return {
    close() {
      closed = true;
      clearInterval(timer);
      void client.removeChannel(channel);
    },
  };
}

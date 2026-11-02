// The "may I send you these files?" step, over the web app's tables:
//   file_sharing_request           the sender writes {files: [{name, size, mimeType}]}
//   file_sharing_request_response  the receiver writes {accepted: true | false}
// Like the signaling inbox, both directions use Realtime plus polling so a missed event cannot
// leave a request unseen or an answer unnoticed.
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import type { FileMeta } from '@/features/sample-data';

export type RequestRow = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  payload: unknown;
  created_at: string;
};

/** Requests older than this are ignored: the sender has long given up. */
const REQUEST_LIFETIME_MS = 10 * 60_000;
export const ANSWER_TIMEOUT_MS = 2 * 60_000;

/** The file list in a request, or null if the row is not a well-formed request. */
export function parseRequestFiles(payload: unknown): FileMeta[] | null {
  const files = (payload as { files?: unknown } | null)?.files;
  if (!Array.isArray(files) || files.length === 0) return null;
  const parsed: FileMeta[] = [];
  for (const file of files) {
    if (
      !file ||
      typeof file.name !== 'string' ||
      typeof file.size !== 'number' ||
      !Number.isFinite(file.size) ||
      file.size < 0
    ) {
      return null;
    }
    parsed.push({
      name: file.name,
      size: file.size,
      mimeType: typeof file.mimeType === 'string' ? file.mimeType : '',
    });
  }
  return parsed;
}

export async function createRequest(
  client: SupabaseClient,
  me: string,
  to: string,
  files: FileMeta[],
): Promise<string> {
  const { data, error } = await client
    .from('file_sharing_request')
    .insert({ from_user_id: me, to_user_id: to, payload: { files } })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Removes the request (its answer goes with it). Only the sender is allowed to. */
export async function deleteRequest(client: SupabaseClient, requestId: string) {
  await client.from('file_sharing_request').delete().eq('id', requestId);
}

export async function respond(client: SupabaseClient, requestId: string, accepted: boolean) {
  const { error } = await client
    .from('file_sharing_request_response')
    .insert({ request_id: requestId, accepted });
  if (error) throw error;
}

/** Waits for the receiver's answer. 'timeout' also covers the sender cancelling. */
export function waitForResponse(
  client: SupabaseClient,
  requestId: string,
  signal: AbortSignal,
  timeoutMs = ANSWER_TIMEOUT_MS,
): Promise<'accepted' | 'declined' | 'timeout'> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (answer: 'accepted' | 'declined' | 'timeout') => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      void client.removeChannel(channel);
      resolve(answer);
    };

    const channel = client
      .channel(`answer:${requestId}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'file_sharing_request_response',
          filter: `request_id=eq.${requestId}`,
        },
        (payload) => settle((payload.new as { accepted: boolean }).accepted ? 'accepted' : 'declined'),
      )
      .subscribe();

    const poll = setInterval(async () => {
      const { data } = await client
        .from('file_sharing_request_response')
        .select('accepted')
        .eq('request_id', requestId)
        .maybeSingle();
      if (data) settle(data.accepted ? 'accepted' : 'declined');
    }, 2000);
    const timer = setTimeout(() => settle('timeout'), timeoutMs);
    signal.addEventListener('abort', () => settle('timeout'));
  });
}

/** Recent requests to `me` that nobody has answered yet. */
async function fetchPending(client: SupabaseClient, me: string): Promise<RequestRow[]> {
  const since = new Date(Date.now() - REQUEST_LIFETIME_MS).toISOString();
  const { data } = await client
    .from('file_sharing_request')
    .select('id, from_user_id, to_user_id, payload, created_at')
    .eq('to_user_id', me)
    .gte('created_at', since)
    .order('created_at');
  const rows = (data ?? []) as RequestRow[];
  if (rows.length === 0) return [];

  const { data: answered } = await client
    .from('file_sharing_request_response')
    .select('request_id')
    .in(
      'request_id',
      rows.map((row) => row.id),
    );
  const answeredIds = new Set((answered ?? []).map((row) => row.request_id as string));
  return rows.filter((row) => !answeredIds.has(row.id));
}

/**
 * Calls `onRequest` for each new request addressed to `me`: from Realtime, from a poll every few
 * seconds, and straight away when the app returns to the foreground. Returns a stop function.
 */
export function listenForRequests(
  client: SupabaseClient,
  me: string,
  onRequest: (row: RequestRow) => void,
) {
  const seen = new Set<string>();
  let stopped = false;
  const deliver = (row: RequestRow) => {
    if (stopped || seen.has(row.id)) return;
    seen.add(row.id);
    onRequest(row);
  };
  const check = () => void fetchPending(client, me).then((rows) => rows.forEach(deliver)).catch(() => {});

  const channel = client
    .channel(`requests:${me}:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'file_sharing_request',
        filter: `to_user_id=eq.${me}`,
      },
      (payload) => deliver(payload.new as RequestRow),
    )
    .subscribe();
  const timer = setInterval(check, 4000);
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') check();
  });
  check();

  return () => {
    stopped = true;
    clearInterval(timer);
    appState.remove();
    void client.removeChannel(channel);
  };
}

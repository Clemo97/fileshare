// Phase 1 spike (throwaway). Talks to spike/server.mjs on the dev machine.
// iOS simulator: localhost works directly. Android emulator: run
// `adb reverse tcp:8787 tcp:8787` so localhost works there too.
const BASE = 'http://localhost:8787';

export async function postJson(path: string, body: unknown) {
  const response = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

export async function getJson<T = unknown>(path: string): Promise<T> {
  const response = await fetch(BASE + path);
  return response.json();
}

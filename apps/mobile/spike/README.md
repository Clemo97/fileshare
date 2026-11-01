# Phase 1 spike harness (throwaway)

Used to check that `react-native-webrtc` can carry the web app's file-transfer protocol
(see `REACT_NATIVE_PLAN.md`, section 6.1 for the results). Not part of the product.

## What is here

| Piece | Where | Role |
|-------|-------|------|
| Test server | `spike/server.mjs` | Signaling mailbox (stands in for `web_rtc_signals`), job queue, result collector. No dependencies. |
| Browser peer | `spike/peer.html` | The "web app" side, served by the server at `/peer.html` |
| In-app jobs | `src/spike/*.ts` | `env`, `loopback`, `fileio`, `backpressure`, `interop` |

## Re-running it

```bash
node spike/server.mjs
```

```bash
EXPO_PUBLIC_SPIKE=1 npx expo start --port 8081
```

Android emulator only (so the app can reach the server and Metro as `localhost`):

```bash
adb reverse tcp:8081 tcp:8081 && adb reverse tcp:8787 tcp:8787
```

Queue a job for `ios` or `android`, then open the browser peer in the other role:

```bash
curl -X POST localhost:8787/enqueue -d '{"platform":"ios","job":{"kind":"interop","room":"r1","role":"caller","dir":"send","sizeMB":50,"chunkKB":50,"io":"file","flow":"ack","handshake":true}}'
```

`http://localhost:8787/peer.html?room=r1&role=callee&dir=recv&sizeMB=50&chunkKB=50&flow=ack&handshake=1`

Results are printed by the server and appended to `spike/results.jsonl` (git-ignored).

Job options: `io` (`memory` | `file` | `file-sync`), `flow` (`buffer` | `ack`), `window`,
`handshake`, `ice` (STUN shorthand), `iceServers` (full list, TURN with credentials),
`policy` (`relay` forces TURN).

## Gotchas hit while building it

- `CI=1 expo start/run` disables file watching: Metro keeps serving a stale bundle. Start Metro without `CI`.
- Restart the app after editing `src/spike/*`: the polling loop keeps the old code (Fast Refresh does not replace it).
- Do not boot the Android emulator while Gradle, Xcode or Spotlight indexing is busy.

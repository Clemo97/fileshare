# Data Loom → React Native (iOS + Android): Migration Plan

> **Status:** proposal only. Nothing has been installed or changed on your machine or in the code.
> **Written:** 2026-11-01. Versions and prices below were checked against official pages on this date (see [Sources](#12-sources)). Anything I could *not* confirm is marked **(unverified)**.

---

## 0. TL;DR

**Recommendation:** build the mobile app with **Expo + React Native + TypeScript**, keep the **Supabase backend and the web app as they are**, and **share the WebRTC / XState logic** between web and mobile. Rewrite only the UI and the few places that touch browser-only APIs.

Why this is a good fit for *this* app:

- It is already React + TypeScript, and the hard part (WebRTC signaling and the file-transfer protocol) lives in ~2,600 lines of **XState machines that have almost no DOM code in them**. That logic can move to mobile largely untouched.
- The UI is only ~1,900 lines and gets rewritten anyway.
- The backend (Supabase tables, RLS policies, Realtime) is platform-neutral. A phone and a browser can pair with each other.

Three things need real work, and I would tackle them **before** building any screens:

| # | Problem | Why it matters |
|---|---------|----------------|
| 1 | **WebRTC on mobile** needs a native library (`react-native-webrtc`). **Phase 1 verified it works** on React Native 0.88 (iOS simulator and Android emulator) and interoperates with a browser using the web app's protocol. It base64-encodes every binary chunk across the JS↔native bridge, which caps speed at roughly 10 MB/s per direction on a fast simulator (2–3 MB/s on the Android emulator). | Speed is acceptable but must be re-measured on real phones. The protocol needs three fixes, see [§6.1](#61-phase-1-results-2026-11-01). |
| 2 | **File I/O**: the web app uses `File`, `FileReader`, `showSaveFilePicker` and a service worker. None exist in React Native. | Needs a small abstraction (`FileSource` / `FileSink`) plus `expo-file-system`. |
| 3 | **Backend logic in Next.js server actions** (`modules/connections/create/actions.ts`) can't be called from a native app. | Move it to Supabase (SQL functions or Edge Functions). |

And one existing bug that gets worse on mobile (§2.1): **the app never configures STUN/TURN servers**, so two devices can only connect on the same network. Phones on cellular would never connect to a laptop on Wi-Fi.

---

## 1. What the app is today

### 1.1 Stack

Next.js 14 (App Router) · React 18 · Supabase (anonymous auth, Postgres + RLS, Realtime) · XState v5 · TanStack Query · Tailwind + shadcn/Radix UI · `react-dropzone` · `native-file-system-adapter` + `public/sw.js` for streaming saves · Vercel Analytics · Geist font.

### 1.2 How a transfer works (the protocol to preserve)

```
Pairing   A: createPairingCode() ──► DB row (4-digit code, 5 min)
          B: redeemPairingCode(code) ──► DB row ──► A hears it via Realtime
          A+B: signaling (offer / answer / ICE) via table `web_rtc_signals` + Realtime
          ──► user_connections row (A ↔ B)

Transfer  A: insert `file_sharing_request` {files:[{name,size,mimeType}]}
          B: sees it via Realtime ──► dialog ──► insert `..._response` {accepted}
          A+B: new RTCPeerConnection + signaling again
          A: one data channel per file, label "file:<index>"
             1st message = JSON {name,size,mimeType}, then 50 KB binary chunks,
             throttled by bufferedAmount / bufferedamountlow
          B: collects chunks, writes them to a file, closes channel when size reached
```

**Keep this wire protocol byte-for-byte.** If mobile and web speak the same protocol, an iPhone can send to a browser and vice versa for free.

### 1.3 What happens to each piece

| Area | Today (file) | Mobile fate |
|------|--------------|-------------|
| Database schema, RLS, Realtime | `supabase/migrations/*` | **Reuse unchanged** |
| Signaling over Realtime | `modules/connections/web-rtc-signals.ts` | **Reuse** (`supabase-js` works in RN) |
| Peer connect / caller / receiver machines | `connect-peer.ts`, `connect-caller-peer.ts`, `connect-receiver-peer.ts` | **Reuse**, small edits (import `RTCPeerConnection` from the RN lib, `NodeJS.Timeout` type) |
| Connection, pairing, incoming-request machines | `item/machine.ts`, `create/new-connection.ts`, `file-sharing-requests/*` | **Reuse**, replace `File` type with `FileSource` |
| Sending a file | `data-transfer/send-file.ts` (`FileReader`, `File.slice`) | **Adapt** → read chunks via `FileSource.readChunk()` |
| Receiving a file | `data-transfer/receive-file.ts` (`showSaveFilePicker`) + `public/sw.js` | **Rewrite the sink** → `FileSink` (web keeps the old one) |
| Pairing code create/redeem | `create/actions.ts` (`"use server"`, service-role key) | **Rewrite** as Supabase RPC / Edge Function |
| Auth | `@supabase/ssr` cookies, `middleware.ts`, server components, `/auto-login` | **Rewrite** as client-only `supabase-js` + `AsyncStorage` session |
| UI | `app/*`, `components/*`, `modules/**/*.tsx` | **Rewrite** (View/Text/Pressable) |
| Theming (8 colour themes) | `styles/colors.ts` (HSL tokens), Tailwind plugin | **Adapt**: reuse the token values, new mechanism |
| Misc | Vercel Analytics, Geist font, service worker, pino `logger.ts`, `react-dropzone` | **Drop / replace** |
| Data utils | `zod`, `date-fns`, `filesize`, `@tanstack/react-query`, `xstate`, `@xstate/react` | **Reuse as is** |

Rough size: ~2,600 lines of logic (≈85 % reusable after the seam in §5; ~400 lines need real adaptation) and ~1,900 lines of UI (rewrite).

---

## 2. Findings from reading the code (fix or plan around these)

### 2.1 No STUN/TURN configured: connections only work on the same network
`new RTCPeerConnection()` is called with no arguments in `modules/connections/item/machine.ts` (`createPeerConnection`) and `modules/connections/create/new-connection.ts` (`createPeer`). With no ICE servers, each side can only offer local network addresses. Web ↔ web on the same Wi-Fi works; **phone on cellular ↔ laptop on Wi-Fi will not**. Mobile makes this the common case.

**Fix (benefits web too):** add STUN + TURN. Cloudflare's STUN (`stun.cloudflare.com`) is free; Cloudflare Realtime TURN has a shared 1,000 GB/month free tier, then $0.05/GB (checked on its docs today; the pages were undated, so re-check before relying on it). Alternatives: Metered, Twilio, or self-hosted coturn. Fetch short-lived TURN credentials from a Supabase Edge Function so the secret is never in the app.

Practical consequence for development: the **Android emulator sits behind its own virtual NAT**, so it will not reliably connect to anything else without STUN/TURN. Do this early.

### 2.2 Server actions can't run on a phone
`createPairingCode` / `redeemPairingCode` use the Supabase **service-role key** on the server. A mobile app must never contain that key. Move the logic to either:
- Postgres functions (`security definer`, called with `supabase.rpc(...)`): simplest, no new infrastructure, **recommended**; or
- Supabase Edge Functions (needed anyway for TURN credentials).

### 2.3 Pairing codes are weak (security)
`CODE_LENGTH = 4` (`create/constants.ts`) → 10,000 possibilities, generated with `Math.random()`, valid 5 minutes, and **no attempt limiting**. Anonymous sign-in is open, so anyone can create throwaway accounts and brute-force codes. Since the logic is being moved anyway: use a CSPRNG (`gen_random_bytes` in Postgres), longer codes (or code + short secret), and limit attempts per user. Redeeming a code only creates a connection (file requests still need explicit approval), so impact is limited, but it should be fixed.

### 2.4 Receiving buffers without a limit
`receive-file.ts` appends every incoming chunk to `context.chunks` (`[...chunks, chunk]`, which also copies the array each time) and writes them one at a time. The sender only watches *its own* send buffer, not the receiver's disk speed. On a phone with slow storage and a big file, memory grows. Plan: write chunks straight to the `FileSink` with a bounded queue; optionally add a small app-level ack/window.

### 2.5 Browser-only APIs inside the "logic" code
`File`, `FileReader`, `file instanceof File` (`file-transfer-state.tsx`), `showSaveFilePicker`, `navigator.clipboard`, `alert()` (`auto-sign-in.tsx`), `NodeJS.Timeout`, pino. All are small and listed in §6 Phase 3.

### 2.6 Housekeeping (unrelated to mobile, but you'll trip on it)
- `data-loom/.next/**` (9 build-cache files) is committed; there is no root `.gitignore`.
- Both `bun.lockb` and `yarn.lock` exist in `file-share-rtc/`; the README says bun.
- `patches/xstate+5.9.1.patch` targets 5.9.1 but `package.json` asks for `^5.11.0`; check it still applies, and decide whether to carry it into shared code.
- Docker is not installed here, so `bunx supabase start` (local Supabase) can't run yet.

---

## 3. Approaches considered

| Option | Verdict |
|--------|---------|
| **A. Expo + React Native, share logic with web** | **Recommended.** Max reuse of what you already know and have; one language; both stores; official tooling. |
| B. Wrap the web app (Capacitor / WebView) | Fastest (days) but it stays a web app: WebView file saving, backgrounding and "feels native" are weaker. **Keep as the fallback** if the WebRTC spike (Phase 1) fails. |
| C. Fully native (Swift + Kotlin) | Two codebases, zero reuse. This is what Shopify chose; see below. Not sensible solo with an existing TS codebase. |
| D. React Native Web: replace Next.js too, one UI for all | Possible later, but means rewriting a working web app (Tailwind/shadcn/Radix) for no immediate gain. |
| E. Flutter / Kotlin Multiplatform | No reuse of the XState/TS logic. |

### About the two Shopify links

- **["Back to native"](https://shopify.engineering/back-to-native)** (Sept 10, 2026) is *not* a pro-React-Native article: Shopify announces it is rebuilding its apps in **Swift and Kotlin**, arguing that coding agents have made building two native apps cheap enough to remove the 2020 reason they picked RN. It also says RN "remains an excellent framework" and **does not recommend against RN for other teams**. Their reasons are specific to a huge company with many engineers. What applies to you: *keep business logic separate from UI and platform code so it can be tested quickly without simulators* (that's exactly the shared-core design below), and *dependency maintenance is a real ongoing cost*.
- **[FlashList](https://github.com/Shopify/flash-list)** is a fast replacement for `FlatList`. Two facts from the article/README: v2 is **New-Architecture-only**, and Shopify says it is **looking for a long-term steward** (they'll only fix critical compatibility issues meanwhile). Also: **Restyle is being archived** and React Native Skia is being forked. **You don't need FlashList here**: a user will have a handful of connections and a handful of files per transfer. Use the built-in `FlatList` (or even `ScrollView`). Avoid taking on dependencies you don't need.

---

## 4. Recommended stack

| Concern | Choice | Notes |
|---------|--------|-------|
| Framework | **Expo SDK 58** (React Native 0.88, New Architecture only) | Released 2026-10-15, two weeks old. **Fallback: SDK 57** if a library isn't ready. Node needs ≥ 22.13 / 24.3 / 26+; you have 26.13 ✅ |
| Run mode | **Development build** (`expo-dev-client`), **not Expo Go** | `react-native-webrtc` contains native code and isn't in Expo Go |
| Routing | **Expo Router** | File-based routes: a familiar mental model from Next's App Router |
| WebRTC | **`react-native-webrtc` 155.0.1** (WebRTC M155) + `@config-plugins/react-native-webrtc` | Data channels supported. **Verified in Phase 1** on RN 0.88.1 (Hermes, Bridgeless, Fabric) on iOS and Android. Forks to fall back on if that changes: `@livekit/react-native-webrtc`, `@stream-io/react-native-webrtc` |
| Files | `expo-file-system` (`File`, `FileHandle`) + `expo-document-picker` + `expo-sharing` | Chunked binary read/write via `FileHandle.readBytes()/writeBytes()` confirmed in the SDK 58 docs |
| Backend client | `@supabase/supabase-js` + `@react-native-async-storage/async-storage` | Flags: `detectSessionInUrl:false`, `persistSession:true`. Optional encrypted-session variant is in Supabase's guide |
| State/logic | XState v5, `@xstate/react`, TanStack Query, zod, date-fns, filesize | Unchanged |
| Styling | **Start with `StyleSheet` + a tiny theme file** (reuse HSL values from `styles/colors.ts`) | NativeWind (Tailwind in RN) is optional later. v5 needs Tailwind 4 and was still a *preview* per its March 2026 docs; check which version supports SDK 58 when you get there |
| Icons | `lucide-react-native` + `react-native-svg` **(unverified)** | Same icon names you use today |
| Lists | `FlatList` | See FlashList note above |
| Dialogs | `Alert.alert` for confirms, Expo Router modal routes for the connect flow | Replaces Radix Dialog / AlertDialog |
| Clipboard / keep-awake | `expo-clipboard`, `expo-keep-awake` | Keep screen on during transfers |
| Tests | Jest (`jest-expo`) for core machines; manual device matrix (§7) | |
| Build & release | **EAS Build / Submit** (cloud) or local `expo run:*` | You're on a Mac, so local iOS + Android builds both work |

---

## 5. Target architecture

```
fileshare/
├─ apps/
│  ├─ web/            ← today's file-share-rtc (Next.js), moved here
│  └─ mobile/         ← new Expo app
├─ packages/
│  └─ core/           ← platform-agnostic TS: XState machines, signaling,
│                       zod schemas, supabase types, platform interfaces
└─ supabase/          ← migrations + (new) SQL functions / edge functions
```

The shared code never imports a platform API directly. It receives platform pieces through XState `input`, the same pattern the code already uses for `supabase` and `currentUser`:

```ts
// packages/core/src/platform.ts
export interface FileSource {            // what we SEND
  name: string
  size: number
  mimeType: string
  readChunk(offset: number, length: number): Promise<Uint8Array>
}

export interface FileSink {              // where RECEIVED bytes go
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>                 // returns/records final location
  abort(): Promise<void>
}

export interface PlatformDeps {
  createPeerConnection(): RTCPeerConnection        // injects ICE servers too
  createFileSink(meta: { name: string; size: number; mimeType: string }): Promise<FileSink>
}
```

| | Web adapter | Mobile adapter |
|---|---|---|
| `FileSource` | wraps `File` + `file.slice().arrayBuffer()` | `new File(uri)` → `open(FileMode.ReadOnly)` → set `handle.offset`, `await handle.readBytes(n)` |
| `FileSink` | `showSaveFilePicker` writer (today's code) | write to `Paths.cache`, `handle.writeBytes()`; on close, offer share sheet / "Save to Files" |
| `RTCPeerConnection` | browser global | `import { RTCPeerConnection } from "react-native-webrtc"` |

### Mobile realities to design for

| Topic | What to know |
|-------|--------------|
| **Throughput** | `react-native-webrtc` base64-encodes each binary `send()` and base64-decodes each received chunk in JS (confirmed in `RTCDataChannel.ts`). Expect the JS thread, not the network, to be the limit. Mitigate: measure first; avoid per-chunk React state updates (throttle progress to ~4/s); avoid copying arrays per chunk; tune chunk size (50 KB today; `maxMessageSize` isn't exposed by the lib, so test before going bigger). |
| **Backgrounding** | iOS suspends apps, and Realtime websockets and WebRTC die with them. v1 rule: **transfers run while the app is open**; use `expo-keep-awake`; show a clear "keep the app open" hint. Android foreground service and iOS tricks are Phase 5 research. |
| **Incoming requests when app is closed** | Today they arrive over Realtime only. On mobile that needs **push notifications** (`expo-notifications` + a DB webhook / Edge Function). Out of scope for v1. |
| **Saving received files** | iOS has no shared Downloads folder: save into the app cache, then **share sheet / "Save to Files"**. Android: same flow first; a folder picker (Storage Access Framework) later. Photos/videos can go to the gallery via `expo-media-library` later. |
| **Auth persistence** | Anonymous identity lives in `AsyncStorage`. Wiping app data = new identity (same as clearing cookies on web). Use `AppState` to start/stop token auto-refresh on foreground/background. |
| **Dev networking** | Android emulator reaches your Mac as `10.0.2.2`, the iOS simulator as `localhost`, a real phone needs your LAN IP. **Use a hosted Supabase dev project** (free tier) to avoid all of this; local Supabase needs Docker, which isn't installed. |
| **Local-network permission** | **Found in Phase 0:** on Android 17 the app asks for `android.permission.ACCESS_LOCAL_NETWORK` (shown to the user as "Nearby devices") on first launch, and **denying it blocked the app from reaching the Metro dev server**. The same prompt will apply to *peer-to-peer connections on the same Wi-Fi*, which is the main use case here. iOS has an equivalent local-network prompt (`NSLocalNetworkUsageDescription`) **(unverified for react-native-webrtc)**. Phase 1 must test: what happens to WebRTC if the user denies it, and what the app should say. |

---

## 6. Phased plan

> Time estimates are rough guesses for someone learning RN part-time. Treat them as relative sizes, not promises.

### Phase 0: Toolchain (~½–1 day)
Goal: a blank Expo app runs on the iOS Simulator **and** an Android emulator. Details in [§8](#8-your-machine-what-exists-what-to-do).
**Done when:** `npx expo run:ios` and `npx expo run:android` both show the starter screen.

> **Status: ✅ done 2026-11-01.** A blank Expo SDK 58 app (`expo` 58.0.22, React Native 0.88.1, React 19.3.0, `expo-doctor` 20/20) lives in `apps/mobile` and runs on the iOS Simulator (iPhone 17) and the Android emulator (`Medium_Phone_API_37.0`). Notes from doing it are in [§8.1](#81-what-actually-happened-in-phase-0).

### Phase 1: De-risk spikes (~3–5 days)  **← most important phase**
Throwaway app in `apps/mobile`. Answer, in order:
1. **Does `react-native-webrtc` 155.0.1 build and run on SDK 58 / RN 0.88?** (`npx expo-doctor`, then a build.) If not: try a fork → try SDK 57 → fall back to Option B (Capacitor).
2. **Can a phone open a data channel to the existing web app?** Check: no-argument `setLocalDescription()` really works natively; ICE candidates and descriptions serialize to the same JSON the web app expects; `connectionState` events fire; `addIceCandidate` accepts web candidates.
3. **Throughput:** send a 200 MB file phone→browser and browser→phone; record MB/s, CPU, memory. Decide if it's acceptable.
4. **File I/O:** pick a file with `expo-document-picker`, read it in 50 KB chunks with `FileHandle`; write chunks to a file; open it with the share sheet. Test a >1 GB file for memory.
5. **Cross-network:** with STUN/TURN configured (do the Phase 2 TURN bit first or alongside), connect phone-on-cellular ↔ laptop-on-Wi-Fi.

**Done when:** a written one-page result (works / numbers / blockers) and a go/no-go.

> **Status: ✅ done 2026-11-01 (simulator/emulator only). Verdict: GO.** Results, numbers and the protocol changes this forces are in [§6.1](#61-phase-1-results-2026-11-01). Still untested because it needs hardware: real phones (speed, cellular), the iOS local-network prompt, backgrounding, and the document-picker UI.

### Phase 2: Backend prep (~2–3 days, ships to web too)
1. Add STUN/TURN to both `new RTCPeerConnection()` call sites via one `createPeerConnection()` helper; TURN credentials from an Edge Function.
2. Replace `createPairingCode` / `redeemPairingCode` with Postgres functions (CSPRNG, longer code, attempt limiting); update the web app to call `supabase.rpc`.
3. Create a **hosted Supabase dev project**; apply migrations; enable anonymous sign-ins.
4. Remove committed `data-loom/.next`, add a root `.gitignore`, pick one lockfile.

**Done when:** the existing web app works web↔web **across two different networks**, with no server actions left.

### Phase 3: Extract the shared core (~3–5 days)
1. Convert to a workspace (`apps/web`, `packages/core`; Expo supports bun/npm/pnpm/yarn workspaces and configures Metro automatically since SDK 52).
2. Introduce `FileSource`, `FileSink`, `PlatformDeps` (§5); thread them through `send-file.ts`, `receive-file.ts`, `machine.ts`, `new-connection.ts`. **Also apply the protocol fixes from Phase 1 (§6.1):** the receiver-ready handshake, the ack window, synchronous disk writes on the receiver, and no reliance on the `open` event or `bufferedAmount`.
3. Swap `NodeJS.Timeout` → `ReturnType<typeof setTimeout>`, replace pino with a tiny logger interface.
4. Write web adapters (wrapping today's behaviour). **The web app must behave identically**: that's your regression test.
5. Unit-test the machines in Node with fake peer connections.

**Done when:** web works exactly as before, now consuming `packages/core`.

### Phase 4: Mobile MVP (~1–2 weeks)
Feature parity, screen by screen:

| Web | Mobile |
|-----|--------|
| `/` landing | Skip the marketing page: splash → auto sign-in → home |
| `/auto-login` | Run `signInAnonymously()` once; session persisted |
| `/home` + Header | Home screen: avatar + "Blue Rabbit (You)", connections `FlatList`, empty state, "Connect device" button |
| `CreateConnectionDialog` | Modal route: "Generate code" / "Enter code"; code display with countdown + copy (`expo-clipboard`) |
| `Connection` card + "Send Files" | Card; button opens `expo-document-picker` (multi-select). Drag-and-drop disappears |
| `FileTransferRequestDialog` | `Alert.alert` or modal with Accept / Decline |
| `FileTransferState` progress bar | `View` with width %, throttled updates |
| `DeleteConnection` | `Alert.alert` (destructive) |
| Footer GitHub link | About / Settings |

Build order: auth → connections list → pairing → send → receive → save/share → error states.
**Done when:** iPhone-sim ↔ Android-emu ↔ web can pair and transfer files both ways.

> **Update (2026-11-02): pairing works against a real Supabase project.** A free-plan project (Frankfurt) exists with the five migrations applied and anonymous sign-ins on. The app signs in anonymously and pairs two devices through `create_pairing_code()` / `redeem_pairing_code()` (migration `20261102120000_pairing-functions.sql`, which also replaces §2.2's server actions and applies §2.3's CSPRNG and attempt limit; codes are still 4 digits). Redeeming creates the `user_connections` row itself, so both devices see the connection without WebRTC; the web app still creates it after its handshake and does not call these functions yet. Verified by 28 SQL tests in a throwaway Postgres, by a 33-check live test against the project (`supabase/tests/e2e-live-pairing.mjs`), and by driving the app's UI on two simulators: one generated a code, the other entered it, and both then listed each other. The iPad and the S23 run Supabase-enabled Release builds and have signed in, and have since been paired with each other. Setup is in the root README and `HANDOFF.md`. Sending and receiving files is now real in the app (`apps/mobile/src/transfer/`: picker, request and response rows, signaling rows, one data channel per file, protocol v2 from §6.1) and was checked between two simulators and, by the owner's report, between a physical iPad and a Galaxy S23 with public STUN only (no TURN configured; speed and network layout not recorded). There is still no TURN server, which networks that block direct links will need (see `HANDOFF.md` §3.6). The paragraph below describes the earlier UI-preview state.
>
> **Status (2026-11-02): UI preview only.** The screens above are built in `apps/mobile/src`: Welcome, Connections (empty, list, transferring), the connect-device sheet (idle, code, connecting, success, error) and the transfer-request dialog, themed with colours generated from the web app (`scripts/generate-theme.mjs`) and verified on the iPhone 17 simulator in light and dark mode (screenshots in the root README). They run on **sample data and simulated timers** (`src/features/sample-data.ts`, `demo-store.tsx`): there is no Supabase and no WebRTC behind them yet. Still to do in Phase 4: auth, real pairing, sending and receiving, saving files, and replacing the demo store with the shared core from Phase 3. In development builds, links like `mobile://home?demo=transferring` jump straight to a state. Not yet checked: the Android layout.

### Phase 5: Mobile-specific hardening (~1–2 weeks, pick what matters)
Backpressure/ack window on receive; keep-awake + clear progress UI; reconnect Realtime on foreground; QR-code pairing (`expo-camera`); "Share to Data Loom" from the OS share sheet; push notifications for incoming requests; Android foreground service for long transfers; accessibility pass; light/dark themes per user colour.

### Phase 6: Release (~2–4 days + store review waits)
EAS Build → TestFlight (iOS) and Play **internal testing** (Android). Needs an Apple Developer Program membership and a Google Play developer account (fees: **check current amounts**). Prepare a privacy policy and store listing. Note: Google Play currently requires targeting Android 16 (API 36) for new apps/updates; Expo's template should handle it, but verify. Also check Apple's rules on in-app account deletion given anonymous accounts **(unverified)**.

---

## 6.1 Phase 1 results (2026-11-01)

**Verdict: GO with Expo + React Native.** The riskiest assumption held: `react-native-webrtc` 155.0.1 runs on React Native 0.88.1 (Hermes, Bridgeless, Fabric: the new architecture only) on both platforms, and a phone app can exchange files with a real Chromium browser using the web app's exact connection protocol. The harness is in `apps/mobile/spike/` (see its README); it is throwaway.

> **Caveat on every number below:** they come from the iOS Simulator (running natively on an Apple-silicon Mac) and an Android emulator with software rendering. Phones will differ, usually slower. Cellular was not tested. Treat these as relative, and re-measure on real devices before promising speeds.

### What works

| Check | iOS Simulator | Android emulator |
|-------|---------------|------------------|
| App builds and runs with `react-native-webrtc` linked | ✅ (Xcode build ~minutes) | ✅ (Gradle 5 min 43 s warm, 12 min cold; debug APK is 301 MB: WebRTC native libs for 4 ABIs) |
| `new RTCPeerConnection()` with no arguments, `setLocalDescription()` with no arguments, `addEventListener`, `getStats()`, `connectionState` events | ✅ | ✅ |
| Descriptions and candidates as plain JSON; browser accepts the app's, app accepts the browser's | ✅ | ✅ |
| `FileHandle` chunked write, read, seek (`expo-file-system` 58) | ✅ 992 MB/s write, 1,184 MB/s read | ✅ 17 MB/s write, 23 MB/s read (virtual disk) |
| App → browser, 50–200 MB, 0 corrupt chunks | ✅ 11.1 MB/s | ✅ 2.4 MB/s (via TURN) |
| Browser → app, 100–200 MB, file on disk exactly the right size | ✅ 9.6 MB/s | ✅ 2.5 MB/s (via TURN, with the handshake) |
| STUN: server-reflexive candidates gathered | not tested | ✅ |
| TURN with username/credential, relay-only | not tested | ✅ connected in 278 ms |

Speed is bounded by the JS thread (base64 encode/decode of every chunk), not by the network: the sender never saw its buffer fill. Roughly 10 MB/s ≈ 80 Mbit/s per direction on the fast simulator.

### What broke, and the fix for each (these become Phase 3 requirements)

| # | Finding | Consequence in the web app's current code | Fix (tested in the spike) |
|---|---------|-------------------------------------------|---------------------------|
| 1 | **The first message can be lost on Android.** The receiver attached `onmessage` in time (`readyState=open`), yet the first message it saw was binary: the JSON metadata never arrived. | `receive-file.ts` waits for metadata and discards chunks until it gets it, so it would hang forever. | **Receiver-ready handshake:** receiver sends `{ready:true}` after attaching its handler; sender waits for it (3 s fallback for old clients) before sending metadata. Cost ~54 ms. Fixed it. |
| 2 | **`readyState` is already `open` the moment a channel is created on a connected peer, and no `open` event follows.** | `send-file.ts` starts only from `dataChannel.onopen`, so the sender would hang in its first state. | Check `readyState === 'open'` first, and use `onopen` only otherwise. |
| 3 | **`bufferedAmount` is unreliable.** It reads 0 right after a burst, then sticks at a stale 51,200 forever even after everything is delivered; `bufferedamountlow` fires on every change below the threshold (not on crossing) and never for threshold 0. Identical on iOS and Android. | The web app's throttling (`bufferedAmount <= threshold`) would never engage, so a fast sender could overrun a slow link. | **Ack window:** receiver sends `{ack:n}` every 16 chunks, sender keeps at most 64 chunks (3.2 MB) in flight. Verified `maxInFlight` = 64. |
| 4 | **The receiver buffers the whole file in memory.** iOS, 200 MB: queue grew to 4,043 chunks and memory peaked +372 MB above baseline (it stayed high afterwards). Android, 100 MB: queue 369 chunks, +50 MB. Cause: the saturated JS thread starves the completion callbacks of awaited disk writes. | Same shape as `receive-file.ts` (chunks array + sequential awaited writes) → out-of-memory on big files. | **Write synchronously in the message handler** (`FileHandle.writeBytesSync`) and ack after the write. iOS: **+24 MB** peak, queue 0, 9.8 MB/s (same speed). Android: +23 MB, queue 0, 2.5 MB/s. The ack window alone was *not* enough (+290 MB), because acking on arrival is not acking on write. |
| 5 | **No STUN/TURN = no connection** (confirms §2.1). Android emulator ↔ Chromium with no ICE servers: Chromium offers only an mDNS `.local` host candidate the emulator cannot resolve → failed after 15 s. With STUN: candidates gathered but both peers share one router and the connection still failed. | Same-network only, and often not even that. | **TURN fixes it:** relay-only via a local coturn with credentials connected in 278 ms. Use STUN for the common case and TURN as fallback, credentials from an Edge Function. |
| 6 | **Library JSON differences are harmless:** the app's candidates lack `usernameFragment`; the browser accepts them. | none | none |

Recommended protocol v2 (keeps the `file:<index>` channel naming and metadata message, so it stays recognisable): `ready` → metadata → chunks with an ack every 16 → receiver closes the channel when it has all bytes. Senders fall back to the old behaviour if no `ready` arrives within 3 s.

### Smaller things found

- `@config-plugins/react-native-webrtc` always writes iOS camera and microphone usage strings, and the merged Android manifest gains `CAMERA`, `RECORD_AUDIO`, `BLUETOOTH` and `MODIFY_AUDIO_SETTINGS`. A data-only app should not ask for these: block them (`android.blockedPermissions` in `app.json`) and reword or remove the iOS strings before release.
- `expo-dev-client` was skipped: the plain debug build works with Metro and is simpler to automate. Revisit in Phase 4.
- `expo-doctor` flags `react-native-webrtc` as "Untested on New Architecture" (React Native Directory metadata). That is stale: Phase 1 ran it on both platforms. It is excluded in `apps/mobile/package.json` (`expo.doctor.reactNativeDirectoryCheck.exclude`); drop the exclusion if the directory catches up.
- `CI=1 expo start/run` turns off file watching; Metro then serves a stale bundle (cost me a wrong "WebRTC missing" reading). Start Metro without `CI`.
- Android 17's local-network permission blocked even the dev-server connection when denied. Whether denying it also breaks same-Wi-Fi WebRTC on a real phone is **still untested** (it needs a real Android 17 device on a real LAN).
- Message sizes: 50 KB chunks worked in both directions with Chromium.

### Still to verify on real hardware (Phase 4 start)

1. Throughput and CPU/battery on a mid-range phone, on Wi-Fi and cellular (through TURN).
2. The iOS local-network prompt and what happens if it is denied; the Android 17 equivalent.
3. `expo-document-picker` / `File.pickFileAsync` UI flow with large files and cloud-backed files.
4. App backgrounding mid-transfer, and recovery.
5. Memory on a low-RAM phone with a multi-GB file.

---

## 7. Testing strategy

- **Logic:** `packages/core` machines are plain TS, so test them in Node with fake `RTCPeerConnection` / `FileSource` / `FileSink`. Fast, no simulator.
- **Interop matrix (manual):** web↔web (baseline), iOS↔web, Android↔web, iOS↔Android; same network **and** cellular↔Wi-Fi.
- **Scenarios:** 1 KB file, 200 MB, >1 GB; multiple files; decline; cancel mid-transfer; kill the app mid-transfer; airplane-mode toggle; code expired / wrong code.
- **Real devices** before release: simulators can't test cellular, cameras or true backgrounding. iOS real-device installs need an Apple ID (free provisioning works for personal testing but expires after 7 days **(from memory)**).

---

## 8. Your machine: what exists, what to do

Checked read-only today.

| Item | Found | Action |
|------|-------|--------|
| macOS / CPU | macOS 27.2, Apple silicon (arm64) | ✅ |
| Node / npm | v26.13.0 / 11.20.0 | ✅ (SDK 58 accepts Node 26+) |
| Homebrew, git, gh | present | ✅ |
| Xcode | 27.2, first-launch OK; iOS 27.2 simulators (iPhone 17 booted) | ✅ |
| Android Studio | installed, with SDK: platform `android-37.0`, build-tools `36.0.0`, emulator, platform-tools; AVD `Medium_Phone` (API 37, arm64) | ✅ mostly |
| `JAVA_HOME` / `java` on PATH | **none** (Android Studio bundles OpenJDK 25) | Install **Zulu 17**, as Expo's docs recommend |
| `ANDROID_HOME`, `adb`/`emulator` on PATH | **not set** | Add to `~/.zshrc` |
| Android SDK Platform 36 + Sources, Command-line Tools | **missing** (only platform 37 present; `cmdline-tools` absent) | Install via Android Studio → SDK Manager |
| CocoaPods | **missing** | `brew install cocoapods` (system Ruby is 2.6, too old to `gem install`) |
| bun | **missing** (README uses it) | Optional. npm works too; see decision 5 |
| Watchman | missing | Not needed for SDK 56+ per Expo docs |
| Docker | missing | Only needed for local Supabase; skip by using a hosted dev project |

Commands I would run (after your OK):

```bash
brew install --cask zulu@17
```

```bash
brew install cocoapods
```

Append to `~/.zshrc` (from Expo's setup guide):

```sh
export JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools
```

In Android Studio → **Settings → Languages & Frameworks → Android SDK**: tick *Android 16 (API 36)* + Sources, and under *SDK Tools* tick *Android SDK Command-line Tools (latest)*. Then:

```bash
yes | sdkmanager --licenses
```

Verify:

```bash
java -version && adb --version && pod --version && xcodebuild -version
```

Create the project (Expo's SDK 58 note: until the new Expo Go ships, `create-expo-app` defaults to SDK 57, so request SDK 58 explicitly):

```bash
npx create-expo-app@latest mobile --template default@sdk-58
```

Then, for the spike: `npx expo install expo-dev-client react-native-webrtc @config-plugins/react-native-webrtc`, add the plugin to `app.json`, `npx expo prebuild --clean`, `npx expo run:ios` / `npx expo run:android`, and `npx expo-doctor`.

### 8.1 What actually happened in Phase 0

Differences from the plan above, and things worth knowing:

| Topic | What happened |
|-------|---------------|
| **JDK** | Azul Zulu's installer is a `.pkg` that needs your admin password, so I installed Homebrew's **`openjdk@17`** instead (same JDK 17 line, no sudo). `JAVA_HOME` points at `/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home`. |
| **`~/.zshrc`** | A marked block (`# >>> react-native toolchain >>>`) was appended with `JAVA_HOME`, `ANDROID_HOME` and the `PATH` entries. Nothing else in the file was touched. (Side note: that file also contains a Supabase access token in plain text; keep it out of any repo or screenshot.) |
| **CocoaPods** | `brew install cocoapods` (1.17.0). **`pod` needs a UTF-8 locale:** without `LANG=en_US.UTF-8` it crashes with an `ASCII-8BIT` encoding error that hides the real failure. Your Terminal sets this itself; shells launched from other tools may not, so export it if you see that error. |
| **Android SDK** | I said Platform 36 and the command-line tools were missing and needed. **They weren't needed:** Gradle auto-installed NDK 27.1.12297006, CMake 3.22.1 and build-tools 37.0.0 and compiled against the Android 37 platform already present. `sdkmanager` is still absent; install "Command-line Tools" from Android Studio only if you want it. |
| **Project** | Created with `npx create-expo-app@latest apps/mobile --template default@sdk-58` (npm, 571 packages). `ios/` and `android/` are generated and git-ignored. Expo's default template includes Expo Router and demo screens; it hasn't been reset. |
| **First builds** | iOS: a few minutes. Android: **12 min 9 s** (cold Gradle + native C++). Later builds are much faster. Expect the same pattern when `react-native-webrtc` is added. |
| **Machine load** | The first builds create tens of thousands of files, and macOS Spotlight indexes them (load average hit ~90 on 8 cores). Don't boot the emulator while a native build or the indexer is busy: it hangs. |
| **Android emulator** | Your `Medium_Phone` AVD has **1 vCPU** (`hw.cpu.ncore=1`) and 2 GB RAM. With the host-GPU window the emulator hung or segfaulted on this machine (macOS 27.2, emulator 37.2.13). What works reliably: `emulator -avd Medium_Phone_API_37.0 -no-window -no-audio -no-snapshot -gpu swiftshader_indirect -cores 4 -memory 3072` (headless, software rendering; boots in ~12 s; take screenshots with `adb exec-out screencap -p`). To get a visible window, try Android Studio's Device Manager (cold boot) or raise the AVD's cores/RAM there. |
| **Permission** | On first launch Android 17 asked for the local-network ("Nearby devices") permission. I first tapped *Don't allow* (least permissive), which broke the connection to Metro ("Unable to load script"), then granted it to the dev build with `adb shell pm grant com.anonymous.mobile android.permission.ACCESS_LOCAL_NETWORK`. Revoke with `adb shell pm revoke ...` or by reinstalling. |
| **Still running** | Metro (dev server, port 8081) and the headless emulator are still running in the background from this session. |

---

## 9. Risks and mitigations

| Risk | Likelihood / impact | Mitigation |
|------|--------------------|------------|
| `react-native-webrtc` doesn't work on RN 0.88 (New-Arch-only) | Unknown / **blocker** | Phase 1 spike first; try forks; try SDK 57; fallback Capacitor |
| Bridge base64 caps throughput | Medium / hurts "any size" promise | Measure; throttle UI updates; tune chunk size; document realistic speeds |
| Devices can't connect across networks | **Certain today** / blocker for mobile | STUN + TURN in Phase 2 (cost is low at personal scale) |
| Transfers die when app is backgrounded | Certain / UX | v1: foreground-only, keep-awake, honest messaging; Android foreground service later |
| SDK 58 is 2 weeks old; ecosystem lag; NativeWind v5 still preview | Medium | Pin versions, use `expo-doctor`, SDK 57 fallback, plain `StyleSheet` first |
| Monorepo + bun adds learning overhead | Medium / slows a beginner | Do Phase 1 in a standalone folder; extract only in Phase 3 once you know what's shared; npm if bun misbehaves |
| Third-party libs get abandoned (see Shopify news) | Low–medium | Prefer Expo first-party modules; avoid optional deps |
| Store review / policy surprises | Low–medium | Privacy policy, test on TestFlight / internal track early |

---

## 10. Learning path (web dev → React Native)

### Cheat sheet

| Web | React Native |
|-----|--------------|
| `div`, `span`, `p`, `button` | `View`, `Text` (all text **must** be in `<Text>`), `Pressable` |
| `onClick` | `onPress` |
| CSS / Tailwind | `StyleSheet.create({...})` (flexbox, **column by default**, no cascade, no CSS units: numbers are density-independent pixels) |
| `<input>` | `TextInput` (`onChangeText`) |
| scroll is automatic | `ScrollView` / `FlatList` (nothing scrolls unless you ask) |
| `next/link`, App Router | Expo Router (`<Link>`, `router.push`, `app/` folder) |
| `localStorage`, cookies | `AsyncStorage` / `expo-secure-store` |
| `navigator.clipboard` | `expo-clipboard` |
| `window.alert/confirm` | `Alert.alert` |
| browser DevTools | React Native DevTools (press `j` in the Expo terminal), Metro logs |
| `npm run dev` + refresh | `npx expo start` + Fast Refresh (a native rebuild is only needed when you add a native module) |

### Glossary
- **Expo**: the toolchain/framework on top of React Native (CLI, modules, build service).
- **Development build**: your own app binary with your native libraries plus the dev tools; replaces Expo Go for apps like this one.
- **Prebuild / CNG**: Expo generates the `ios/` and `android/` folders from `app.json` + config plugins, so you rarely hand-edit native code.
- **Metro**: the JS bundler (like Vite/webpack).
- **Hermes**: the JS engine.
- **New Architecture**: React Native's rewritten internals; mandatory since RN 0.82 / Expo SDK 55. Libraries must support it.
- **EAS**: Expo's cloud build/submit service.

### Resources
Fetched and read while preparing this plan:
- Expo: [set up your environment](https://docs.expo.dev/get-started/set-up-your-environment/), [monorepos](https://docs.expo.dev/guides/monorepos/), [expo-file-system](https://docs.expo.dev/versions/latest/sdk/filesystem/), [expo-sharing](https://docs.expo.dev/versions/latest/sdk/sharing/), [SDK 58 changelog](https://expo.dev/changelog/sdk-58)
- Supabase: [Expo / React Native guide](https://supabase.com/docs/guides/getting-started/tutorials/with-expo-react-native)
- [react-native-webrtc README](https://github.com/react-native-webrtc/react-native-webrtc) and its [`RTCDataChannel.ts`](https://github.com/react-native-webrtc/react-native-webrtc/blob/master/src/RTCDataChannel.ts)
- Shopify: [Back to native](https://shopify.engineering/back-to-native), [FlashList](https://github.com/Shopify/flash-list)
- [NativeWind v5 migration guide](https://www.nativewind.dev/v5/guides/migrate-from-v4)

Not fetched (well-known, from memory; verify they still look current):
- [React Native docs](https://reactnative.dev/docs/getting-started): read "Core Components", "Layout with Flexbox", "FlatList"
- [Expo tutorial](https://docs.expo.dev/tutorial/introduction/) and [Expo Router docs](https://docs.expo.dev/router/introduction/)
- [React Native Directory](https://reactnative.directory): check a library's New-Architecture/Expo support and maintenance **before** adding it
- [XState docs](https://stately.ai/docs): you already use it; the "actors" and "input" pages matter most here

---

## 11. Open decisions for you (my defaults in bold)

1. **Keep the web app and share code via a monorepo**, or abandon web? (Default: keep + share.)
2. **Hosted Supabase dev project** vs. local Docker? (Default: hosted.)
3. **TURN provider**: **Cloudflare**, Metered, or self-hosted coturn?
4. **Real-device testing**: do you have an iPhone/Android phone, and are you willing to pay for Apple Developer Program / Google Play accounts when you reach Phase 6?
5. **Package manager**: **bun** (matches README) or npm (fewer unknowns while learning)?
6. **Scope**: feature parity only for v1 (**default**), or also QR-code pairing / share-sheet / push notifications?

---

## 12. Sources

- Shopify Engineering, [Back to native](https://shopify.engineering/back-to-native) (2026-09-10)
- [Shopify/flash-list](https://github.com/Shopify/flash-list) README
- [Expo changelog](https://expo.dev/changelog) and [SDK 58](https://expo.dev/changelog/sdk-58)
- Expo docs: [environment setup](https://docs.expo.dev/get-started/set-up-your-environment/), [monorepos](https://docs.expo.dev/guides/monorepos/), [file system](https://docs.expo.dev/versions/latest/sdk/filesystem/), [sharing](https://docs.expo.dev/versions/latest/sdk/sharing/)
- [react-native-webrtc](https://github.com/react-native-webrtc/react-native-webrtc) (README, `RTCDataChannel.ts`, `RTCPeerConnection.ts`; npm `latest` = 155.0.1)
- Supabase docs: [Expo React Native tutorial](https://supabase.com/docs/guides/getting-started/tutorials/with-expo-react-native)
- Cloudflare Realtime TURN [pricing](https://developers.cloudflare.com/realtime/turn/faq/) (undated pages)
- [NativeWind v5 migration guide](https://www.nativewind.dev/v5/guides/migrate-from-v4) (updated 2026-03-30)
- Secondary (lower confidence): web-search summaries on React Native 0.82 / Expo SDK 55 making the New Architecture mandatory, and Stream's fork docs.

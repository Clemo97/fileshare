This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

**Taking over this project? Read [`HANDOFF.md`](../../HANDOFF.md) at the repo root first.** It has the current status, what is uncommitted, how everything was built and why, a list of build traps with fixes, and what is verified versus unknown.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Xcode

Xcode's tools are available to external agents through its MCP server (`xcrun mcpbridge`, registered as the `xcode` MCP server). They only work while the project is open in Xcode, so ask the user to open `ios/mobile.xcworkspace` first. Xcode > Settings > Intelligence must have "Allow external agents to use Xcode tools" turned on.

- Open the workspace, never `mobile.xcodeproj` — the Pods only resolve through `mobile.xcworkspace`. The scheme and target are both `mobile`, the bundle ID is `com.anonymous.mobile`, and the minimum iOS version is 16.4.
- Use the Xcode tools to build (`BuildProject`, `GetBuildLog`), run (`RunProject`, `GetConsoleOutput`), debug (`InvokeDebuggerCommand`, `GetCrashIssueLogs`) and look things up (`DocumentationSearch`). A debug build loads JS from Metro, so keep `npx expo start` running.
- Do not use the Xcode tools that change the project or its files (`XcodeWrite`, `XcodeUpdate`, `XcodeRM`, `XcodeMV`, `XcodeMakeDir`, `AddEntitlement`, `AddInfoPlist`, `UpdateTargetBuildSetting`, `UpdateFileCompilerFlags`, `XcodeNewTarget`, `XcodeNewProject`). `ios/` is generated and gitignored, so those edits are lost on the next `npx expo prebuild`. Configure native behavior in `app.json` and config plugins, and edit app code under `src/` with the normal file tools.

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

# Releasing the iOS app on the App Store

Written 2026-11-02 for the owner and for any AI taking over (read `HANDOFF.md` first for the app itself). The app is free. This repository is public: nothing in this file or in the workflows may contain secrets or personal details (Apple team ID, email, device identifiers, project URL).

Facts marked **[verified]** were read from Apple's or Expo's own pages on 2026-11-02 (links at the end). Facts marked **[unverified]** come from memory or third-party pages and must be confirmed before relying on them.

## 1. Where things stand

| Item | State |
|---|---|
| Real pairing and file transfer | Works on the simulators and, by the owner's report, on the iPad and S23 (`HANDOFF.md` §2.1) |
| Paid Apple Developer Program membership | **Not done. Only the owner can do it** |
| Expo account and EAS project | **Done 2026-11-03**: logged in as `clementlumumba`, project `@clementlumumba/acornet` (`eas init`; the project ID is in `app.json`) |
| App Store Connect app record, TestFlight | **Created by the owner 2026-11-03** (the name was accepted). The owner reports a TestFlight invite by email. EAS shows only build 2 (`FINISHED`, made with the encryption key `false`), so that is the build in TestFlight: test-only. Tested on the iPad by the owner: works (owner's report, 2026-11-03). Build 3 (key `true`, commit `8a3f901`) uploaded but **failed App Store Connect's processing with error 90592** (see section 2, item 4). Build 4, with the key `false` and the same app code, is the one for App Review |
| App name | Working name **Acornet** (chosen 2026-11-02; `name` and `slug` in `apps/mobile/app.json`, and the welcome screen). **Accepted by App Store Connect** when the owner created the app record (owner's report, 2026-11-03). "Scurry" was rejected because an app of that name exists |
| Bundle ID | **`io.github.clemo97.acornet`** (chosen 2026-11-03; `ios.bundleIdentifier` and `android.package` in `app.json`). The generated `ios/` and `android/` folders and the apps now on the iPad and S23 still carry the old placeholder `com.anonymous.mobile` until they are regenerated and reinstalled. EAS builds read `app.json`, so they already use the new one |
| In-app account deletion | **Built, migration applied to the hosted project, tested live by script** (16 checks) **and through the UI on a simulator** (it became a new identity with no connections, and the paired simulator lost its card) |
| Privacy policy and support pages | **Published 2026-11-03** on GitHub Pages from `docs/` of the `react-native-migration` branch: policy `https://clemo97.github.io/fileshare/privacy.html`, support `https://clemo97.github.io/fileshare/support.html` (checked: both answer 200). **Pages is tied to that branch: when it is merged into `main`, change the Pages source to `main` and `/docs`, or the site disappears with the branch.** The policy's contact is the owner's email, published with their OK |
| Privacy policy link inside the app | **Built**, shows only when `EXPO_PUBLIC_PRIVACY_POLICY_URL` is set. **Set in EAS (production) on 2026-11-03**, together with the two Supabase variables; the release guard script accepted the values. It is not set in `.env.local`, so local builds still show no policy button |
| Apple account type, EU trader status | Owner's answers 2026-11-03: **Individual** paid account, **non-trader** (free hobby project). Apple's own wording decides whether non-trader is right; the owner confirms it in App Store Connect |
| Camera, microphone and local-network purpose strings | **Written** (see 4.3) |
| `eas.json`, EAS environment guard, GitHub workflows | **Written, never run** |
| App icon | **Drawn 2026-11-03**: an acorn with a network cap on teal. SVG sources in `apps/mobile/assets/icon-source/`; `icon.png` is 1024 px with no alpha channel; `ios.icon` points at it. Not yet seen on a device or in a build |
| Store text, review notes, age-rating and App Privacy answers | **Drafted 2026-11-03** in `store/` (limits checked against Apple's pages); the owner reviews and enters them. Still needed from the owner: a phone number for the App Review contact, keeping France out of the availability (the encryption key is `false` on that basis), the EU trader check |
| Screenshots | **iPhone: 6 captured** (1206 x 2622, no alpha, `store/screenshots/iphone/`, sample data from the app's demo scenarios). **iPad 13-inch: 6 captured** (2064 x 2752, no alpha, `store/screenshots/ipad/`; the simulator's resize handle painted out, `HANDOFF.md` G27) |
| App Review screen recording | **Not done**. Best recorded on the owner's real devices (iPad and S23) once the TestFlight build is installed |
| TURN relay | Not needed in the owner's phone test, still wanted for networks that block direct links (`HANDOFF.md` §3.6) |

## 2. Decisions only the owner can make

1. **Individual or Organization account.** Individual needs the owner's legal name and a verified address. Organization needs a legal entity that can contract with Apple, a D-U-N-S number, a work email on the organization's domain and a public website on that domain **[verified]**. Fee: 99 USD per year (local currency shown at enrollment) **[verified]**. Approval time is not stated by Apple **[verified]**.
2. **App name and bundle ID.** The bundle ID cannot change once the app exists in App Store Connect, and the name must be unique on the store. The working name is Acornet; confirm it (or pick another) when you reserve it in App Store Connect, and the bundle ID (`io.github.clemo97.acornet`, chosen 2026-11-03, reverse-domain style on the owner's GitHub handle) is final once the first build is uploaded. The name is set in `app.json` (`name`, `slug`) and in `src/app/index.tsx`; the Xcode project and scheme are renamed to match the next time `ios/` is regenerated from scratch (HANDOFF.md G26). Changing the bundle ID means editing `ios.bundleIdentifier` (and `android.package`) in `apps/mobile/app.json` and regenerating `ios/` and `android/`. Installs of the old ID are a different app: they lose their account and connections.
3. **Where the privacy policy lives** and **a contact email** for it and for the store's support URL. A public page in this repository or GitHub Pages is enough.
4. **Export compliance answer.** The app uses HTTPS and WebRTC's encryption (DTLS), which is "standard" encryption. App Store Connect asks about it for every build unless `ITSAppUsesNonExemptEncryption` is set in the app's Info.plist. **Decided 2026-11-03: the key is `false`** in `app.json` under `ios.infoPlist`, with **France left out of the availability**. A first attempt with `true` (build 3) failed App Store Connect's processing with error 90592, because Apple wanted a compliance code that only comes from approved documentation. Apple's own wording sets `NO` for forms exempt from documentation requirements, and for a standard algorithm outside iOS the only documentation is a French declaration. This is the owner's legal declaration; a US year-end self-classification report might still apply **[not determined]**. Details and sources: `store/privacy-and-age-rating.md`.
5. **EU trader status.** Apple removes apps without verified trader status from the EU store **[verified]**. Declare trader or non-trader in App Store Connect; a trader's contact details are shown publicly **[unverified]**.

## 3. Accounts and one-time setup (owner, with the assistant's help)

```bash
# 1. Apple Developer Program: enroll at developer.apple.com/programs/enroll (the owner only)
# 2. Expo account (free): expo.dev, then
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest init            # links the folder to an Expo project; commit what it adds to app.json

# 3. Production environment variables for cloud builds (.env.local is gitignored and not uploaded).
#    Without these the build stops on purpose (scripts/check-release-env.mjs).
#    The command is `env:set` in EAS CLI 27.3.0 (checked with `eas env --help` on 2026-11-03).
#    DONE 2026-11-03 for all three; `eas env:list production` shows them (it prints plaintext values).
npx eas-cli@latest env:set --environment production --visibility plaintext --non-interactive --name EXPO_PUBLIC_SUPABASE_URL --value <project url>
npx eas-cli@latest env:set --environment production --visibility plaintext --non-interactive --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <publishable key>
npx eas-cli@latest env:set --environment production --visibility plaintext --non-interactive --name EXPO_PUBLIC_PRIVACY_POLICY_URL --value <policy url>

# 4. First build, by hand. It signs in to Apple and creates the distribution certificate and profile.
npx eas-cli@latest build --platform ios --profile production

# 5. First submit, by hand. It stores an App Store Connect API key in EAS for later automatic submits.
npx eas-cli@latest submit --platform ios --latest
```

### 3.1 Connecting your Apple Developer account

Nothing here lets an AI (or any script) sign in with your Apple ID and password: you type those yourself, in your own terminal, where only Apple's and Expo's tools see them. Two ways to connect, and the plan uses both:

1. **Interactive sign-in, once, for signing.** `eas build` (step 4 above) asks for your Apple ID, password and two-factor code in the terminal. EAS then creates and stores the distribution certificate and provisioning profile for you. Check first at developer.apple.com/account that the membership is the **paid** Apple Developer Program and active (a free Apple ID cannot publish).
2. **An App Store Connect API key, for uploads and for automation.** In App Store Connect: Users and Access > Integrations > App Store Connect API > generate a key. Use the **App Manager** role (the usual choice for a release pipeline, which can upload builds and submit for review **[unverified: confirm the roles on Apple's page]**). Note the **Key ID** and the **Issuer ID**, and download the `.p8` private key: Apple lets you download it **once**. Keep it in a password manager, never in the repository or in chat. `eas submit` (step 5) asks for it and stores it in EAS; the same key works for `asc` (section 10).

To let Claude run API-key steps for you, use the pattern already used for the Supabase token: put the key in 1Password, authorize the specific task, and have the commands read it inline with `op read`, never printing it. Treat the key as account access: it can change store listings and submit builds.

Then add one GitHub repository secret, `EXPO_TOKEN` (an access token from expo.dev, Account settings). Never commit it.

Never put the Supabase **service-role or secret** key in EAS variables, the app or the repo. The publishable key and URL are public by design (they are readable inside every build); the guard script refuses a secret key.

## 4. What had to change in the app, and why

### 4.1 Account deletion (App Review Guideline 5.1.1(v))
Apps that support account creation must let people delete the account in the app, and Apple says that includes accounts the app creates automatically (guest accounts) **[verified]**. Deleting must remove the account record and associated data, and must not be only a "deactivate" **[verified]**.

- Database: `file-share-rtc/supabase/migrations/20261102140000_delete-my-account.sql` adds `delete_my_account()` (callable by signed-in users only). It deletes the caller's `public.users` row (which cascades to connections, pairing codes and attempts, requests, responses, signals) and their `auth.users` row. Six SQL tests cover it (`tests/account.test.mjs`).
- **Applied to the hosted project on 2026-11-02** through the Management API's SQL endpoint, and recorded in `supabase_migrations.schema_migrations` (`HANDOFF.md` §9.3, G18). `tests/e2e-live-account.mjs` ran against it: 16 of 16 checks passed and it leaves no users or rows behind.
- App: `session.deleteAccount()` calls it, drops the local session and signs in as someone new. UI: "Delete account" at the bottom of the home screen, a two-step dialog (`src/features/account-dialog.tsx`).

### 4.2 Privacy policy link (Guideline 5.1.1(i)) **[unverified: exact wording]**
The policy must be linked in App Store Connect **and** inside the app. The app shows "Privacy policy" at the bottom of the home screen when `EXPO_PUBLIC_PRIVACY_POLICY_URL` is set. The release guard refuses a build without it.

Use the inventory in section 5 to write the policy and the App Privacy answers.

### 4.3 Permission strings
`react-native-webrtc` links Apple's camera and microphone APIs, and its own documentation tells apps to add `NSCameraUsageDescription` and `NSMicrophoneUsageDescription`. App Store Connect has a habit of rejecting uploads that link those APIs without purpose strings **[unverified: from memory]**, so the strings are **kept but made honest** ("This app never uses the camera. The text is required because the networking library..."), through the plugin's `cameraPermission` and `microphonePermission` options in `app.json`. The app never asks for either permission. `NSLocalNetworkUsageDescription` was added too, because WebRTC may touch the local network and iOS shows a prompt with this text when it does. **Check on a fresh install whether the prompt appears** and that the wording reads well there. Android keeps the plugin's broader permission list (`HANDOFF.md` §11 item 8); that matters only when an Android release is planned.

### 4.4 Cloud builds do not see `.env.local`
That file is gitignored. A build on Expo's servers without the variables would succeed and silently become the offline demo (`HANDOFF.md` §11 item 11). `apps/mobile/scripts/check-release-env.mjs` runs after dependencies install on the EAS server (`eas-build-post-install` in `package.json`) and exits non-zero when a variable is missing or unsafe. Tested locally with missing, secret-key, service-role and non-https values. **That a failing hook fails the EAS build was not confirmed by Expo's page [unverified]**: watch the first real build's log.

## 5. Data inventory (for the privacy policy and the App Privacy answers)

Taken from the code and migrations, not from legal advice. Review it with the owner.

| Data | Where | Why | Kept |
|---|---|---|---|
| Anonymous account id (random UUID), refresh token | Supabase Auth; token also on the device | The app signs in anonymously | Until the user deletes the account |
| Display identity: a colour and an animal, assigned at random | `public.users` | Shown to the other device | Same |
| Connections: two user ids and a timestamp | `user_connections` | Who may send to whom | Until either side deletes it or the account |
| Pairing codes (4 digits, user id, time) and failed attempts (user id, time) | `pairing_codes`, `pairing_attempts` | Pairing and brute-force limit | Codes: 5 minutes of use, then freed when someone next creates one; attempts: until account deletion |
| Transfer requests: **file names, sizes and types** | `file_sharing_request` | The receiver's accept dialog | Deleted by the sender when the transfer ends; **no server-side cleanup if the app is killed first** |
| WebRTC signals: connection offers, answers and **candidates that contain the devices' IP addresses** (local and public) | `web_rtc_signals` | Setting up the direct link | Deleted by both sides when done; same cleanup gap |
| **File contents** | Never sent to Supabase | Go device to device, encrypted (DTLS). If a TURN relay is added it carries encrypted traffic | Saved on the receiver's device only |
| Device IP address | Public STUN servers (Cloudflare, Google) see it when the app asks for its public address; Supabase sees it in its request logs | Connectivity; hosting | Per those providers' policies |

No analytics, advertising or tracking SDKs are in `package.json` **[checked 2026-11-02 by reading the dependency list]**. Hosting: Supabase, Frankfurt. Likely App Privacy answers (verify in App Store Connect): collects "User ID" and possibly "Other user content" (file names) for app functionality, not linked to tracking, no data used for tracking.

**Known gap to fix before many users:** nothing deletes stale rows in `file_sharing_request` and `web_rtc_signals` left by a killed app. A scheduled cleanup (for example rows older than a day) would close it.

## 6. Path to the first release

1. Owner: enroll; choose name, bundle ID, account type; create the Expo account (section 2, 3).
2. Assistant: ~~put the chosen name and bundle ID into `app.json`~~ (done 2026-11-03); regenerate native folders, rebuild and re-test on both devices (not done; the devices will have to be re-paired because the new bundle ID installs as a separate app).
3. ~~Apply the delete-account migration to the hosted project~~ (done 2026-11-02). Also tested through the app's UI on a simulator on 2026-11-02.
4. ~~Write and host the privacy policy~~ (done 2026-11-03, section 1); ~~set `EXPO_PUBLIC_PRIVACY_POLICY_URL` in EAS~~ (done 2026-11-03).
5. Run the one-time setup (section 3). Install the first TestFlight build on the iPad and test pairing, transfer and deletion on it. TestFlight needs no App Review for internal testers **[unverified]**.
6. In App Store Connect: create the app record (name, bundle ID, SKU, language), set price **Free**, category (Utilities or Productivity), the age-rating questionnaire (Apple's new rating system **[verified]**), App Privacy answers, EU trader status, support URL, privacy policy URL, description, keywords, the app icon (done, see section 1), screenshots at the sizes App Store Connect asks for.
7. App Review notes, written for a reviewer who may own one device. Suggested text: "Two devices are needed to pair. On device A tap Connect Device > Generate Connection Code. On device B tap Connect Device and enter the code. Then tap Send Files on either device, choose a file and accept on the other. No account or sign-in is needed: the app creates an anonymous account on first launch and it can be deleted from the home screen (Delete account). A screen recording of the whole flow is attached." Attach that recording. **Reviewers who cannot test a feature reject apps for incompleteness (Guideline 2.1) [unverified]**.
8. Select the TestFlight build, **Submit for Review**, then release manually or automatically after approval.

## 7. CI/CD for later versions

```
pull request ──► Checks workflow (GitHub Actions, Linux, free on a public repo)
                   mobile: npm ci, tsc, expo lint, web export with fake env (the Node pre-render, G2)
                   sql:    PGlite tests for every migration
tag v1.2.0   ──► Release iOS workflow
                   same checks, tag must equal expo.version in app.json,
                   then: eas build --platform ios --profile production --auto-submit --no-wait
                   EAS signs the build, adds 1 to the build number, uploads to TestFlight
you          ──► test it in TestFlight, then press Submit for Review in App Store Connect
```

Files: `.github/workflows/checks.yml`, `.github/workflows/release-ios.yml`, `apps/mobile/eas.json`. Actions are pinned by commit (checkout 7.0.1, setup-node 7.1.0, expo-github-action 9.0.1 as of 2026-11-02); update the pins deliberately.

**Versioning [verified]:** `eas.json` uses `appVersionSource: "remote"` and `autoIncrement: true` on the `production` profile, so EAS keeps the build number (`CFBundleVersion`) and adds 1 on every build. The user-facing `version` is **not** auto-incremented: edit `version` in `app.json`, commit, then tag `v<version>`. Remote versioning is not supported together with `expo-updates` using the `nativeVersion` runtime policy (use `appVersion` if OTA updates are added).

**Releasing a version:** 1. update `version` in `app.json` and merge to the main branch. 2. `git tag v1.1.0 && git push origin v1.1.0`. 3. Follow the build and submit links the workflow prints (build page on expo.dev). 4. When it appears in TestFlight (Expo says processing takes 10 to 15 minutes **[verified]**), test it. 5. Submit for review in App Store Connect. The upload never goes to App Review by itself **[verified]**.

**Backend first.** Users keep old app versions for weeks, so a database migration must work with the previous app version too, and must be applied **before** the release that needs it. Migrations and Edge Functions are not deployed by CI yet: today the owner or the assistant applies them (`HANDOFF.md` §9.3). Automating that needs a Supabase access token and the database password as GitHub secrets; not set up.

**Over-the-air updates (optional, later).** EAS Update can ship JavaScript-only fixes without a new review. It needs `expo-updates` (a native module, so one more build) and a runtime-version policy. Apple's rules allow it only while the app's purpose does not change **[unverified]**. EAS Workflows can build only when the native code changed and otherwise publish an update.

**Why EAS and not Xcode Cloud or fastlane:** `ios/` is generated and gitignored (continuous native generation), so Xcode Cloud would need a post-clone script that runs `expo prebuild`; fastlane on a macOS runner needs certificates managed by hand. EAS Build already knows how to build this project and sign it.

**Rolling back:** an App Store release cannot be undone. Submit a fixed build; App Store Connect's phased release limits how many users get an update at once.

## 8. Costs

Apple 99 USD per year. Expo's free plan for builds (monthly quota **[unverified]**, check expo.dev pricing). Supabase: free today; free projects pause after a period of inactivity and anonymous sign-ins are limited to 30 per hour per IP (`HANDOFF.md` §9.1) **[pause rule unverified]**, so plan for the paid tier before a public launch. TURN: Cloudflare's free tier first, paid beyond it (`REACT_NATIVE_PLAN.md` §2.1).

## 9. To confirm before relying on it

Export-compliance answer; purpose-string behaviour in App Store Connect; that a failing `eas-build-post-install` stops a build; the exact privacy-policy and review-notes rules; TestFlight internal testing needing no review; EU trader details being public; Supabase pause and limits; EAS free-plan quota.

## 10. Optional: the `asc` command-line tool

[`rorkai/App-Store-Connect-CLI`](https://github.com/rorkai/App-Store-Connect-CLI) (`asc`) drives the App Store Connect API from the terminal. Read on GitHub on 2026-11-02, **not installed or tried**: MIT license, about 8,200 stars, 30 contributors, commits daily, release 6.3.0 (2026-10-31) with checksums, installable with Homebrew. Made by Rork (rork.com).

**Where it helps (after step 5):** `asc validate` checks a version before submission (missing fields, placeholder text, wording that App Review often rejects); `asc metadata apply` and `asc screenshots upload` keep the listing text and screenshots in files in the repo; `asc publish appstore --submit --confirm` submits for review and `asc status --until review-done` waits for the decision; `asc testflight feedback` and `crashes` read tester reports. **Where it does not replace EAS:** building and signing the React Native app stay with EAS Build; EAS Submit already uploads to TestFlight. It overlaps with EAS Metadata and fastlane's `deliver`.

**Cautions:** it holds your API key, so it is account access: install with Homebrew (not `curl | bash`), pin the version, and keep the key in the password manager. It sends pseudonymous usage telemetry by default; turn it off with `asc telemetry disable` or `DO_NOT_TRACK=1`. `asc install-skills` copies 25 third-party agent skills into the global skills folder; skills steer the assistant, so read them before installing. Creating the app record with `asc web apps create` uses Apple's private web endpoints and your Apple ID login (Apple can change them without notice): creating the record by hand in App Store Connect takes a few minutes and is the safer first step.

## Sources (read 2026-11-02)

- Apple, [Upcoming requirements](https://developer.apple.com/news/upcoming-requirements/): since 2026-04-28 builds need Xcode 26 or later with the iOS 26 SDK; deployment target iOS 13 or later from 2026-09-09; new age ratings; EU trader status.
- Apple, [Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- Apple, [Enroll in the Apple Developer Program](https://developer.apple.com/programs/enroll/)
- Expo, [Automate submissions](https://docs.expo.dev/build/automate-submissions/), [App versions](https://docs.expo.dev/build-reference/app-versions/), [Submit to the app stores](https://docs.expo.dev/deploy/submit-to-app-stores/), [eas.json reference](https://docs.expo.dev/eas/json/), [Environment variables](https://docs.expo.dev/eas/environment-variables/), [NPM hooks](https://docs.expo.dev/build-reference/npm-hooks/), [EAS Workflows](https://docs.expo.dev/eas/workflows/get-started/)

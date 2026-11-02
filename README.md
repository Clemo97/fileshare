# File Share RTC : Effortless, Secure File Sharing Across Devices <!-- omit in toc -->

File Share RTC  aims to provide a hassle-free and secure way to share files between devices. The platform leverages WebRTC technology, ensuring that your files are transferred directly and securely, with no intermediary server access.

- [Features](#features)
- [Mobile app (work in progress)](#mobile-app-work-in-progress)
- [Simple Steps to Start Sharing](#simple-steps-to-start-sharing)
- [Development](#development)
  - [Clone and run locally](#clone-and-run-locally)
  - [Generating db types](#generating-db-types)

## Features

- **No Account Setup Required**: Start sharing immediately with an automatically created anonymous session upon visiting our website.


- **End-to-End Encryption**: All files are encrypted from start to finish, ensuring your data remains private and secure.
- **No File Size Limit**: File Share RTC is engineered to manage files of any size, leveraging advanced chunk-based processing to facilitate the sharing of large files. While there is no hard limit on the file size you can transfer, the performance and efficiency depend on your device’s capabilities and network conditions. This robust system ensures smooth operation by adapting to various environments, though extremely large files may require more time and stable network connections to transfer successfully.

## Mobile app (work in progress)

An iOS and Android app is being built with [Expo](https://expo.dev) and React Native in [`apps/mobile`](apps/mobile). The screens are ported from the web app. **Pairing two devices uses Supabase** once the app is configured (below); without that it runs as a **UI preview on sample data**. **Transferring files** goes over a direct WebRTC link signalled through Supabase when the app is configured (checked between two simulators; phones on networks that block device-to-device traffic will need a TURN relay, which is not set up yet), and is simulated in the sample-data preview. The migration plan, and the results of the first technical spikes, are in [`file-share-rtc/REACT_NATIVE_PLAN.md`](file-share-rtc/REACT_NATIVE_PLAN.md).

### Connecting the mobile app to Supabase

1. Create a [Supabase](https://supabase.com) project and turn on anonymous sign-ins (Authentication > Sign In / Providers).
2. Apply the migrations in [`file-share-rtc/supabase/migrations`](file-share-rtc/supabase/migrations) to it. (Steps 1 to 3 can also be done in one go with [`file-share-rtc/supabase/tools/provision.py`](file-share-rtc/supabase/tools/provision.py), which creates the project, enables anonymous sign-ins, applies the migrations and writes `.env.local`; read its header first.) The newest one adds `create_pairing_code()` and `redeem_pairing_code()`, which replace the web app's server actions so a phone can pair without the service-role key. With the [Supabase CLI](https://supabase.com/docs/guides/cli):
   ```bash
   cd file-share-rtc
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
3. In `apps/mobile`, copy `.env.example` to `.env.local` and fill in the project URL and the anon (or publishable) key. These values are inlined when the app is bundled, so rebuild the app after changing them.

Without `.env.local` the app still runs, on sample data. Once it is set, each device signs in anonymously, and a code generated on one device can be entered on another to connect them.

Screenshots from the iPhone 17 simulator (iOS 27.2):

| Welcome | No connections yet | Connect a device | Connection code |
| :-: | :-: | :-: | :-: |
| <img src="apps/mobile/screenshots/welcome-light.png" alt="Welcome screen" width="160"> | <img src="apps/mobile/screenshots/connections-empty-light.png" alt="Empty connections screen" width="160"> | <img src="apps/mobile/screenshots/connect-device-light.png" alt="Set up a new connection sheet" width="160"> | <img src="apps/mobile/screenshots/connection-code-light.png" alt="Connection code with expiry countdown" width="160"> |

| Connections | Transferring files | Transfer request |
| :-: | :-: | :-: |
| <img src="apps/mobile/screenshots/connections-light.png" alt="Two connected devices" width="160"> | <img src="apps/mobile/screenshots/transferring-light.png" alt="Two transfers in progress" width="160"> | <img src="apps/mobile/screenshots/transfer-request-light.png" alt="Incoming file transfer request dialog" width="160"> |

Dark mode:

| Welcome | Transferring files | Connection code |
| :-: | :-: | :-: |
| <img src="apps/mobile/screenshots/welcome-dark.png" alt="Welcome screen in dark mode" width="160"> | <img src="apps/mobile/screenshots/transferring-dark.png" alt="Transfers in progress in dark mode" width="160"> | <img src="apps/mobile/screenshots/connection-code-dark.png" alt="Connection code in dark mode" width="160"> |

## Simple Steps to Start Sharing

These steps describe the web app.

1. **Visit the Website**: Click on the "Start Sharing Files" button to initiate an anonymous session.

2. **Connect Your Devices**: Hit the "Connect Device" button, then "Generate Connection Code".

3. **Establish Connection**: On another device, follow the same steps and enter the connection code from the first device to connect.
4. **Begin Transferring Files**: Drag and drop files or use the "Send File" button. Files will need to be accepted on the receiving device.
Note: Connection codes expire after 5 minutes. For a new code, simply restart the process on the initiating device.

## Development

### Clone and run locally

1. Clone the repository and install dependencies:
   ```bash
   bun install
   ```
2. Run Supabase:
   ```bash
   bunx supabase start
   ```
3. Create a `.env.local` based on the `.env.example` file. You can get the Supabase variables from the output of the previous command, or by running:
   ```bash
   bunx supabase status
   ```
4. Start the development server:
   ```bash
   bun dev
   ```

### Generating db types

This command will reset the local database and generate types for the Supabase client based on the new schema. If you only want to generate types without resetting the database, you can remove the first command.

```bash
bunx supabase db reset && bunx supabase gen types typescript --local > supabase/types.gen.ts
```

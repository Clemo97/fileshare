# App Store product page: draft text for Acornet

Paste these into App Store Connect (App Store tab, then App Information and the version page).
Limits are from Apple's "Platform version information" and "App information" pages, read 2026-11-03.
Character counts were checked by script. Everything here is a draft for the owner to edit.

## App information (shared by all versions)

| Field | Value | Limit |
|---|---|---|
| Name | `Acornet` | 2 to 30 characters (7). Apple tells you at once if it is taken. Backups: `Flingle`, `Nutflick` |
| Subtitle | `Send files device to device` | 30 characters (27) |
| Primary category | Utilities | |
| Secondary category | Productivity | |
| Privacy Policy URL | `https://clemo97.github.io/fileshare/privacy.html` | required |
| Content Rights | The app does not contain, show or access third-party content | |
| Age rating | See `privacy-and-age-rating.md` (expected 4+) | required |
| SKU | `acornet-ios-1` (any unique string; cannot be changed later) | |

## Version 1.0.0

**Promotional text** (170 characters allowed, 142 used; can be changed later without a new review):

```
Pair your devices once with a short code, then send files straight between them. No sign-up, no ads, and your files aren't stored on a server.
```

**Description** (4000 characters allowed; plain text, no HTML):

```
Acornet sends files straight from one of your devices to another.

Pair two devices once with a short code. After that, choose files and send them. The other device asks before anything arrives, so you stay in control.

HOW IT WORKS
• Open Acornet on both devices.
• On one, generate a connection code. On the other, enter it.
• Choose files and send. The receiving device accepts, and the files travel directly between the two devices.

WHY ACORNET
• Direct transfers. Files go from device to device over an encrypted connection and aren't stored on a server.
• No sign-up. No email address, phone number or password.
• No ads and no tracking.
• Send several files at once, with progress shown on both devices.
• Delete your account any time from the home screen. It removes everything the app keeps about you.

GOOD TO KNOW
• Keep Acornet open on both devices until the transfer finishes.
• Some networks, such as guest Wi-Fi, block direct connections between devices. If a transfer won't start, try another network.
• Acornet is a free personal project. Questions: see the support page.
```

**Keywords** (100 bytes allowed; each word more than two characters; do not repeat the app name):

```
transfer,send,share,files,peer to peer,p2p,wireless,direct,private,wifi,no cloud,device
```

**Support URL:** `https://clemo97.github.io/fileshare/support.html`
(Apple wants this page to lead to real contact information; it shows an email address. Apple's wording adds "legal address ... telephone number, as may be required by local law": the owner decides whether their country requires more.)

**Marketing URL (optional):** `https://clemo97.github.io/fileshare/`

**Copyright:** `2026 Clement Lumumba`

**Version number:** `1.0.0` (same as `version` in `apps/mobile/app.json`)

**What's New:** not available for the first version.

**Version release:** Manual is the safer first choice (you press release after approval); Automatic is fine too.

**Price:** Free. **Availability:** all countries and regions, except possibly France: see "Export compliance" in `privacy-and-age-rating.md`.

## Screenshots

Required (Apple's screenshot specifications, read 2026-11-03): at least one for "iPhone with Dynamic Island (medium display)" (1206 x 2622 px portrait is one accepted size) and, because the app runs on iPad, at least one for the iPad 13-inch display (2064 x 2752 px portrait). No alpha channel. Up to 10 per size; App Store Connect scales them down for other sizes.

Files: `store/screenshots/iphone/` and `store/screenshots/ipad/`, in the order to upload them. They show the real app screens with sample data (the app's built-in demo scenarios), not a live transfer.

## App Review information

See `review-notes.md`.

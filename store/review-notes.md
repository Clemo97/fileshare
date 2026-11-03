# App Review information: draft

Where: App Store Connect > your app > the version page > App Review Information.
Limits (Apple's "Platform version information" page, read 2026-11-03): notes up to 4000 bytes; contact name, email and phone number are required; the phone number needs the international format with a plus sign and country code.

| Field | Value |
|---|---|
| Contact name | Clement Lumumba |
| Contact email | the owner's email (the same address as on the support page) |
| Contact phone | **the owner must supply it**, international format (`+` country code, then number) |
| Sign-in required | No (leave the box unticked; there is no demo account) |
| Attachment | the screen recording of the whole flow (`store/review-video.mov`, not committed), if the field accepts it |

## Notes (paste this)

```
Acornet sends files directly between two devices, so the whole flow needs two devices. A short screen recording of the complete flow is attached.

No sign-in is needed. The app creates an anonymous account the first time it opens (no email address, phone number or password).

To pair two devices and send a file:
1. Open Acornet on two devices.
2. On device A tap "Connect Device", then "Generate Connection Code". A 4-digit code appears. It works once, for five minutes.
3. On device B tap "Connect Device", then "Already have a code from another device? Enter it here.", and type the code. Both devices now show each other.
4. On either device tap "Send Files" in the connection, choose one or more files and confirm. The other device shows a request: tap "Accept".
5. Progress shows on both devices. When it finishes, the receiving device offers "Save", which opens the share sheet.

Account deletion: scroll to the bottom of the home screen and tap "Delete account", then confirm. This deletes the anonymous account and everything stored for it on the server (pairings, codes, requests, connection messages). The app then starts again with a new anonymous account.

Privacy policy: linked at the bottom of the home screen (opens in Safari) and in App Store Connect.

Permissions, so nothing surprises you:
- Local network: iOS asks once because the app connects directly to the user's other device.
- Camera and microphone: the app never uses them and never asks for them. The usage descriptions exist only because the WebRTC library linked into the app is able to capture audio and video; the texts say so.

Where data goes: a Supabase project (Frankfurt) stores the anonymous account, the pairings and the small setup messages that let two devices find each other. File contents are never uploaded to it: they go from device to device over an encrypted WebRTC data channel.

The app has no ads, no analytics, no in-app purchases and no third-party sign-in.

Some networks block direct connections between devices (guest Wi-Fi, some cellular networks). If a transfer does not start, please try both devices on the same ordinary Wi-Fi network.
```

(About 2,100 bytes.)

## Recording the video

Record on real devices once the TestFlight build is installed on both. On each device use the built-in screen recording (iPad: Control Center; Android: the quick-settings screen recorder). One recording per device is enough; show: opening the app, "Generate Connection Code", the other device entering it, "Send Files" with the request and "Accept", progress, "Save", and finally "Delete account". Keep each clip under a minute or two. Whether the Attachment field takes a video file or only documents is **[unverified]**: if it does not, put a link to an unlisted video in the notes.

## Things this text assumes

- The button names match the app's source as of 2026-11-03: "Connect Device", "Generate Connection Code", "Already have a code from another device? Enter it here.", "Send Files", "Accept", "Save", "Delete account".
- Codes: five minutes, single use (`redeem_pairing_code` in the first pairing migration).
- A reviewer on one device can still see: the welcome screen, code generation, the privacy link and account deletion. The recording covers the rest. **Reviewers who cannot test a feature may reject for incompleteness (Guideline 2.1) [unverified]**; that is why the recording matters.

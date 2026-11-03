# Age rating and App Privacy answers: draft

Drafted 2026-11-03 from Apple's pages ("Age ratings values and definitions", "App privacy details", read the same day) and from the code and migrations in this repository. These are the owner's answers to give in App Store Connect; Apple computes the final rating, and you are responsible for the accuracy of what you declare.

## Age rating (App Information > Age Rating)

Apple's questionnaire has seven groups. Answers for Acornet:

| Group | Question | Answer | Why |
|---|---|---|---|
| In-App Controls | Parental controls, age assurance | None | Neither exists |
| Capabilities | Unrestricted web access | **No** | The only link is "Privacy policy", which opens in Safari outside the app (`Linking.openURL` in `src/app/home.tsx`). There is no embedded browser |
| Capabilities | User-generated content, social media | No | Nothing is published to other people |
| Capabilities | Messaging and chat | No | The app sends files between devices the user paired; it has no chat or messages. A judgement call: Apple defines it as "users can directly communicate with one another through features within the app". Apple's table lists messaging and chat under 4+, so either answer gives the same rating |
| Capabilities | Advertising | No | None |
| Mature Themes, Medical or Wellness, Sexuality or Nudity, Violence, Chance-Based Activities | every item | None | Not present |

**Expected rating: 4+.** What would raise it: Apple's table puts "unrestricted web access" at 16+, which is why that answer matters.

## App Privacy (App Privacy section)

Apple's rules, in short: "collect" means data leaves the device and you or your partners can access it for longer than it takes to service a request in real time; data collected from an app counts as linked to the user unless it is de-identified; data sent only to service a request and not kept does not need declaring.

**"Do you or your third-party partners collect data from this app?" Yes.** Declare exactly these three types:

| Apple data type | What it is here | Linked to the user | Used for tracking | Purpose |
|---|---|---|---|---|
| Identifiers > **User ID** | The anonymous account ID (Supabase Auth); every other record hangs off it. Kept until the account is deleted | Yes | No | App Functionality |
| User Content > **Other User Content** | File names, sizes and types in a transfer request, so the other device can ask "accept?". Removed when the transfer ends; if the app is killed first they can stay until the account is deleted (no cleanup job yet, see `RELEASE_PLAN.md` section 5) | Yes | No | App Functionality |
| Other Data > **Other Data Types** | Network (IP) addresses inside the connection-setup messages, stored while the link is set up (same retention caveat). Apple says to declare a stored IP address by how you use it; this is connectivity | Yes | No | App Functionality |

Everything else is **not collected**: contact info, health and fitness, financial info, location, sensitive info, contacts, photos or videos, audio, browsing and search history, purchases, usage data, diagnostics, device ID. File contents are never sent to a server. There is no analytics, advertising or crash-reporting library in `package.json` (checked 2026-11-02).

**Tracking: No.**

Other points:
- The random display name (a colour and an animal) is treated as a screen name, so it falls under **User ID** ("screen name, handle, account ID" in Apple's list); no row is needed for Name.
- Judgement call, not ticked: the server also stores which accounts are paired with each other. Apple's **Contacts** type reads "a list of contacts in the user's phone, address book, or social graph". The app never imports contacts, and a paired device is usually the owner's own, so the label would mislead; but if someone pairs with another person's device the pairing list is closer to a social graph. If the owner prefers to be cautious, tick Contacts (linked, not tracking, App Functionality).
- The optional-disclosure exceptions in Apple's list do not apply: this data is part of the app's main function.
- Cloudflare's and Google's STUN servers see a device's public address only while it connects, and the app keeps nothing from them. Under Apple's rule for data used only to service a request they need no declaration; the privacy policy names them anyway.
- Supabase hosts the records above (Frankfurt). It is a service provider, not an SDK that collects data for itself, so it adds no row.
- Privacy Choices URL is optional; leave it empty, or point it at the "Deleting your data" part of the privacy policy.
- The policy at `https://clemo97.github.io/fileshare/privacy.html` lists the same data. If you change one place, change the other.

## EU trader status

The owner's answer: **non-trader** (free hobby project). In App Store Connect this is under Business, "Manage European Union Digital Services Act trader requirements" (a page in Apple's help; its wording was not read here). Read Apple's definition of a trader before confirming; a trader's contact details are shown publicly in the EU.

## Export compliance (encryption)

**Decided 2026-11-03: `ITSAppUsesNonExemptEncryption` is `true` in `app.json`** (the owner agreed with the recommendation below). It applies to every build from build 3 on. Build 2 was made earlier with `false` (the owner had answered "yes, standard/exempt" at the EAS prompt): use it only for testing on the owner's own devices, never for App Review. Because the key is `true`, App Store Connect asks its export-compliance questions for each build (TestFlight shows the build as "Missing Compliance" until they are answered). Apple's table (page "Export compliance documentation for encryption", read 2026-11-03): encryption limited to what is in the operating system needs no documentation; an industry-standard algorithm that is not provided by the operating system needs a French encryption declaration if you distribute in France; proprietary encryption needs more. The app's WebRTC library carries its own DTLS encryption, which puts it in the middle row.

Recommendation (not legal advice), now followed for the key: answer Apple's questions in App Store Connect in their wording, and either untick France under availability or file the French declaration. Apple says the developer is responsible for claiming an exemption inaccurately.

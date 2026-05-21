# Play Store risk audit — Decentralized Agent SDK portfolio (2026-05-07)

> Source-cited risk assessment for all 12 apps currently in design or
> development, against Google Play Developer Policies as published on
> 2026-05-07. Severity scale: 🟢 low / 🟡 medium / 🔴 high / 🛑 blocked.
>
> Methodology: live policy pages fetched, exact policy text quoted
> where load-bearing, recent enforcement signals (2025-2026) cross-
> referenced via independent reports.
>
> Companion to [`AgentBrowser/functional-sketch-2026-05-07.md`](AgentBrowser/functional-sketch-2026-05-07.md)
> (the Agent Host risk is the highest-stakes item in the portfolio).

## Executive summary, safest → riskiest

1. **Folio** (🟢 low) — single-user pod sync; OIDC redirect is a normal pattern.
2. **Tasks v0** (🟢 low/medium) — closed-group UGC + foreground service, no hardware permissions.
3. **Notes app** (🟢 low/medium) — same as Tasks plus collaborative editing.
4. **Stoop** (🟡 medium) — UGC + camera + (coarse) location + FG service; manageable, moderation duties non-trivial.
5. **Neighborhood app** (🟡 medium/high) — Stoop's risks plus an explicit anonymity feature; collides with Deceptive Behavior + 2026 dev-verification tightening.
6. **Household app** (🟡 medium/high) — Telegram message filtering is in the danger zone of the Malware policy's spyware definition; on-device LLM adds AI-content disclosure duties.
7. **Proof-of-location** (🟡 medium/high) — BLE+NFC fine, but witness-network behavior + rotating QR may need careful framing to avoid Misrepresentation findings.
8. **Archive app** (🟡 medium/high) — inherits Import Bridge's Limited-Use obligations (data on-device). Lower risk than #7 because no API scopes itself.
9. **Private LLM** (🟡 medium/high) — model-weight delivery is the policy minefield; shipping in APK fine, downloading at runtime needs careful wording.
10. **Mesh-demo** (🔴 high) — unlikely to clear Spam / Minimum Functionality; can't market itself as more than a demo.
11. **Agent Host** (🛑 blocked-as-designed; recoverable as a true browser) — "loads JS from arbitrary URLs" is exactly the language Device and Network Abuse forbids.
12. **Import Bridge** (🛑 blocked for Play distribution at hobby budget) — Gmail/Drive restricted scopes require annual CASA Tier-2/3 security assessment, reported $5k-$75k/yr.

---

## App 1 — Stoop (neighborhood social/help)

**Verdict: 🟡 medium.**

### Policies that apply
- User Data + Personal & Sensitive User Data: https://support.google.com/googleplay/android-developer/answer/10144311
- Permissions and APIs that Access Sensitive Information: https://support.google.com/googleplay/android-developer/answer/16558241
- Foreground Service requirements: https://support.google.com/googleplay/android-developer/answer/13392821
- User Generated Content: https://support.google.com/googleplay/android-developer/answer/9876937
- Functionality, Content, and User Experience: https://support.google.com/googleplay/android-developer/answer/9898783

### Concerns
- **Foreground service.** The right type for relay-listening is `dataSync` but the enumerated use cases ("network backup/restore, upload/download, local import/export") don't perfectly describe a long-lived listener. Real risk this gets flagged unless framed as `dataSync` for incoming-message receipt, with a video demo and clear in-app description. Note Google's October-2026 round explicitly removed geofencing from the location-FGS approved list; expect similar narrowing for vague `dataSync` use.
- **Coarse location.** Foreground location is fine if user-initiated. Do not request `ACCESS_BACKGROUND_LOCATION` — the policy states "A developer may only declare one location-based feature that requires access to a location in the background" and requires permissions declaration form, video, prominent in-app disclosure with the literal word "location" plus "background"/"when the app is closed"/"always in use." Stay foreground-only.
- **Camera + photos.** Per Android-13+ sensitive-permissions policy: "may only request the READ_MEDIA_IMAGES and READ_MEDIA_VIDEO permissions if system pickers...are not sufficient." Use the photo picker; don't request broad media access.
- **UGC moderation.** Closed-group does not exempt you. Mandates: report content/users, block users, terms acceptance, "robust, effective, and ongoing UGC moderation." Direct quote: *"Apps featuring UGC that identify a specified set of users...must provide in-app functionality to report content and users"* and *"UGC features that enable 1:1 user interaction...must provide in-app functionality for blocking users."*
- **Data Safety form.** "All developers must complete a clear and accurate Data safety section for every app." Pod-on-user's-server architecture must still be disclosed under collection/sharing — the form distinguishes "collected" from "shared" and treats relay transit as data handling.

### Mitigations
- Use the system photo picker; drop READ_MEDIA_IMAGES if at all possible.
- Foreground location only, with in-app rationale.
- Implement report/block in v1, not later.
- Frame the foreground service as `dataSync` with a demo video. User-visible "Stoop is listening for new posts" notification; do not silence it.
- Complete Data Safety form acknowledging messages, images, optional location, and the relay as a "third party" even if self-hosted (the form's definition is broad).

### Distribution alternatives if rejected
- F-Droid (very welcoming), sideload via your own site — but the new 2026 sideload-verification regime means you still need to register as a verified developer with Google for any *certified-device* install.

---

## App 2 — Tasks v0

**Verdict: 🟢 low/medium.**

Same shape as Stoop minus camera + GPS. Foreground-service fit + UGC moderation duties identical. Lower hardware footprint and less public/social framing make this the safest of the social apps.

**Policies**: same User Data, FGS, UGC links as Stoop. Crew/skill metadata is "personal data" only if tied to identifiable users — disclose in Data Safety either way.

**Mitigations**: report/block features for the crew chat; explicit FGS justification.

---

## App 3 — Folio

**Verdict: 🟢 low.**

### Policies that apply
- Device and Network Abuse: https://support.google.com/googleplay/android-developer/answer/16559646
- User Data: as above
- Foreground Service requirements: as above (background sync would be `dataSync`)

### Concerns
- OIDC redirect to a custom URI scheme is a normal pattern, not regulated.
- Background sync via WorkManager preferred over a foreground service; if you do use FGS, declare `dataSync`.
- "Self-hosted pod" angle has no Play implications by itself; Folio is not subject to Google API Services User Data Policy because it doesn't talk to Google APIs.

### Mitigations
Ensure in-app OIDC consent screen makes clear the user is signing into *their* IdP, not Google; document the sync schedule.

---

## App 4 — Mesh-demo

**Verdict: 🔴 high — unlikely to ship as-is.**

### Policy
- Spam: https://support.google.com/googleplay/android-developer/answer/9899034
- Functionality, Content, and User Experience: https://support.google.com/googleplay/android-developer/answer/9898783

Direct quote: *"We do not allow apps that only have limited functionality and content"* and *"Apps that are static without app-specific functionalities."*

### Concerns
A "demo" of mesh networking with no end-user value is the textbook case the Spam/Minimum-Functionality policies target.

### Mitigation
Don't ship to Play. Distribute via GitHub Releases / F-Droid / your own site as a developer tool.

---

## App 5 — Notes app

**Verdict: 🟢 low/medium.**

Equivalent to Tasks for policy purposes; CRDT collaboration is UGC the moment two users share a doc, so the report/block requirement (https://support.google.com/googleplay/android-developer/answer/9876937) kicks in even for two-person sharing. Foreground sync = `dataSync` with declared use case.

---

## App 6 — Neighborhood app (with anonymity)

**Verdict: 🟡 medium/high — the anonymity feature is the load-bearing risk.**

### Policies that apply
- Deceptive Behavior: https://support.google.com/googleplay/android-developer/answer/16680223
- Impersonation: https://support.google.com/googleplay/android-developer/answer/9888374
- UGC: as above
- 2026 developer-verification regime — see cross-cutting findings.

### Concerns
- Deceptive Behavior is about *the developer* deceiving users (fake claims, impersonation), not about pseudonymous user accounts — so pseudonymity is allowed in principle. But Impersonation policy bars *users* from impersonating others within your app, and you must moderate it.
- 2026 developer-verification rules tighten *who* can publish, not *who* can use anonymously. Your "users post pseudonymously" feature is policy-compatible if combined with: (a) accept-to-reveal flow, (b) report mechanism for impersonators, (c) terms of service forbidding impersonation.
- Same FGS / location / UGC duties as Stoop.

### Mitigations
- Frame the feature as "pseudonymous handles" rather than "anonymous"
- Explicitly cover impersonation in your in-app TOS
- Provide reporting; require email or device-attestation behind the pseudonym so Google sees a moderation hook.

---

## App 7 — Import Bridge

**Verdict: 🛑 blocked for Play distribution at hobby budget. Architecturally feasible but financially gated.**

### Policies that apply
- Google API Services User Data Policy: https://developers.google.com/terms/api-services-user-data-policy
- Restricted scope verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- Workspace API user-data policy: https://developers.google.com/workspace/workspace-api-user-data-developer-policy
- Malware (potentially): https://support.google.com/googleplay/android-developer/answer/9888380

Limited Use clause (quoted): *"Limit your use of data to providing or improving user-facing features that are prominent in the requesting application's user interface."*

### Concerns
- **Restricted scopes.** Gmail (read) and Drive (full) are restricted. Quote: *"to keep access to any verified restricted scopes, apps must be reverified for compliance and complete a security assessment at least every 12 months after your assessor's Letter of Assessment (LOA) approval date."* CASA Tier-2/3 audits reported by independent sources at $5k-$75k/yr (gmass.co; medium.com/reversebits "$50K Email API Nightmare"). This applies regardless of Play — gated by Google Cloud OAuth verification, not Play. But shipping on Play without it triggers app suspension when the OAuth verification audit catches up.
- **Server question.** CASA framework triggered when "the app accesses or has the capability to access Google user data from or through a server." Pure on-device-only with no server can drop to lower tier (tier-2 self-attestation), but the "self-hosted relay" likely qualifies as a server in Google's analysis.
- **"User-initiated export" framing.** Google's Limited Use language explicitly prohibits use of restricted-scope data outside "user-facing features that are prominent." Storing into a user's pod is arguably-prominent, but reports indicate one-time / manual export use cases face real friction. Plan on a written use-case justification.
- **Microsoft Graph and Apple iCloud.** Not Play policies, but each has separate consent and data-handling rules. Apple's iCloud APIs are largely closed to non-Apple platforms — there is no public iCloud Drive API for Android; you'd be bound to user-uploaded export ZIPs.
- **WhatsApp / Telegram / Signal "exports."** Importing user-supplied export ZIPs is fine. Scraping APIs (especially WhatsApp, no public consumer API) violates each platform's TOS — third-party-IP problem more than Play, but Play's IP policy does not allow apps that "induce or encourage" infringement: https://support.google.com/googleplay/android-developer/answer/9888072.
- **Malware/spyware optics.** Malware policy specifically calls out apps that "monitor or spy" on user activity outside narrow exceptions. A bridge that pulls Gmail/Calendar continuously is not stalkerware (you are the user), but the *pattern* trips heuristics; expect manual review.

### Mitigations
- **Restrict to non-restricted scopes only** (Drive `drive.file` for app-created files only; Calendar with `calendar.events.readonly`; no Gmail). This is the only path that keeps you off CASA.
- For Gmail specifically: **don't.** Use Google Takeout ZIP import (user-initiated, on the user's device) — outside the Google API Services User Data Policy entirely.
- For WhatsApp / Signal / Telegram: import-from-export-file only. If using Telegram Bot API, document the token-management UX and rate limits (https://telegram.org/tos/bot-developers).
- Distribute the bridge as a **desktop tool** (or separate non-Play channel) and have the mobile Archive app only read locally-imported data.

### Distribution alternatives
F-Droid is realistic; bridge as a desktop CLI is even better.

---

## App 8 — Archive app

**Verdict: 🟡 medium/high.**

No new permissions, but inherits the data-sensitivity question. If Import Bridge is on the same device, Play reviewers will treat the two as a system. Disclose data origins in Data Safety; UGC duties don't apply (single-user).

Chief concern is sensitive-data display — Health Connect (https://support.google.com/googleplay/android-developer/answer/16679511) applies if any imported data is health-related, with required disclaimers.

---

## App 9 — Proof-of-location

**Verdict: 🟡 medium/high.**

### Policies that apply
- Permissions and APIs (BLE/NFC): https://support.google.com/googleplay/android-developer/answer/16558241
- Deceptive Behavior: https://support.google.com/googleplay/android-developer/answer/16680223 — quote: *"not possible to implement, such as insect repellent apps, even if it is represented as a prank, fake, joke, etc."* Real-time proof-of-location with crypto is implementable, but the *claim* must match what's actually proven.
- Misrepresentation: https://support.google.com/googleplay/android-developer/answer/9888689
- FGS for any background BLE listening: connectedDevice fits.

### Concerns
BLE scan permissions on Android 12+ require careful flagging; describe the cryptographic claim precisely (presence proof, *not* legal-grade location attestation). If marketed as legal evidence and isn't, that's Misrepresentation. NFC has no Play-specific issues.

### Mitigations
Precise marketing language; foreground-only scanning during user-initiated proof events; in-app disclosure of accuracy bounds.

---

## App 10 — Household (Telegram filter + on-device LLM)

**Verdict: 🟡 medium/high.**

### Policies that apply
- Malware (spyware/surveillance subsection): https://support.google.com/googleplay/android-developer/answer/9888380 — quote: *"Recording audio or recording calls"* and *"Stealing app data"* are spyware-class. By extension, reading other people's messages they sent into a bot is in the gray zone unless every member explicitly consents.
- AI-Generated Content: https://support.google.com/googleplay/android-developer/answer/13985936 — quote: *"Apps that generate content using AI must contain in-app user reporting or flagging features that allow users to report or flag offensive content."*
- UGC: as above (group chat + shared pod state).
- Telegram bot-developer TOS: https://telegram.org/tos/bot-developers — limits to data sharing with third parties.

### Concerns
- Filtering messages from a *Telegram bot* is fine — bot conversations are by definition between the user and the bot, and the user authorizes the bot. Filtering **a user's incoming personal Telegram DMs** via MTProto-userbot would violate Telegram's TOS and look like spyware to Play reviewers. Make sure the architecture is bot-only.
- The on-device LLM triggers AI-Generated Content disclosure: in-app report/flag UX required.
- Data Safety must list "messages from your Telegram bot" as collected data even if processed only locally.

### Mitigations
- Bot-API only (never MTProto)
- Explicit consent flow per group member when adding the bot
- AI report-content button in v1
- Document the LLM doesn't transmit messages off-device (and follow through).

---

## App 11 — Private LLM

**Verdict: 🟡 medium/high — depends entirely on weight delivery.**

### Policies that apply
- Device and Network Abuse: https://support.google.com/googleplay/android-developer/answer/16559646 — quote: *"An app distributed via Google Play may not modify, replace, or update itself using any method other than Google Play's update mechanism."* Quote: *"An app may not download executable code (such as dex, JAR, .so files) from a source other than Google Play."*
- AI-Generated Content: https://support.google.com/googleplay/android-developer/answer/13985936

### Concerns
- Model weights are not "executable code" (.dex/.jar/.so). Downloading GGUF/safetensors at runtime is *technically* permitted — they are data files consumed by an interpreter. **However**, if you ship custom inference kernels as `.so`, those *cannot* be downloaded post-install.
- Apps over 150 MB use Play Asset Delivery (allowed and intended for large model assets) — recommended channel; do this rather than third-party CDN.
- AI-Generated Content disclosure obligations (report/flag) apply to any app exposing the LLM as a generative surface.

### Mitigations
- Ship the inference engine in the APK (split ABI APKs / app bundle).
- Distribute model weights via **Play Asset Delivery** (on-demand asset packs, up to 1 GB / 2 GB / 4 GB tiers). This avoids the "download from a source other than Google Play" prohibition entirely — quote from policy: *"download executable code...from a source other than Google Play."*
- In-app report UX for any agent-callable surface that produces text.

---

## App 12 — Agent Host

**Verdict: 🛑 blocked as designed; recoverable.**

### Policies that apply
- Device and Network Abuse: https://support.google.com/googleplay/android-developer/answer/16559646
- Loading remote code clauses (cited in full):
  - *"An app distributed via Google Play may not modify, replace, or update itself using any method other than Google Play's update mechanism."*
  - *"An app may not download executable code (such as dex, JAR, .so files) from a source other than Google Play."*
  - The carve-out: *"this restriction does not apply to code that runs in a virtual machine or an interpreter where either provides indirect access to Android APIs (such as JavaScript in a webview or browser)."*
  - The interpreted-code clause: *"Apps or third-party code, like SDKs, with interpreted languages (JavaScript, Python, Lua, etc.) loaded at run time (for example, not packaged with the app) must not allow potential violations of Google Play policies."*
  - The WebView clause: *"Apps or third party code (for example, SDKs) containing a webview with added JavaScript Interface that loads untrusted web content (for example, http:// URL) or unverified URLs obtained from untrusted sources."*
- Distributing other apps: *"Apps that install other apps on a device without the user's prior consent"* are prohibited.

### Where Agent Host stands today
- "Loads JS from arbitrary URLs into per-app WebViews" hits the carve-out for *interpreted code in a WebView*, which would be **fine** — *if* there's no JavaScript Interface (`addJavascriptInterface`) bridging to Android APIs.
- The "capability-manifest-mediated permission model" almost certainly **is** a JS Interface bridging to camera, BLE, FS, etc. That puts you squarely inside the prohibited-WebView clause: a WebView with a JS Interface loading unverified URLs.
- The "modify/replace/update itself" clause has been read by enforcement to cover apps that meaningfully change behavior at runtime via remote bundles. Even if bundles are "JS not native code," reviewers can and do reject under the *interpreted-code-must-not-allow-policy-violations* clause. The agent-host pattern means you can't audit guest behavior at submission time, which is exactly what triggers reviewer concern.
- **Browser precedent** (Brave, Firefox, Tor, DuckDuckGo): all are general-purpose browsers, not "app loaders." They do not expose Android-API bridges to arbitrary pages. F-Droid client *is* an app installer but uses the standard `ACTION_INSTALL_PACKAGE` intent — Google Play Protect treats F-Droid as a "hostile downloader" on certified devices unless explicitly allowed. F-Droid is **not** distributed via Play; that's the precedent.
- Aptoide tried Play distribution; was removed. Aurora doesn't even attempt it.

### Mitigations to recover Play eligibility
- **Path A — true browser:** drop the JS-Interface bridge entirely. Guest apps run as web pages with only browser-grade APIs. Same bucket as Brave. **Loses the SDK's value proposition.**
- **Path B — bundled-only catalog:** every guest app ships *with* Agent Host as a packaged asset (or as separate Play-installed modules). No URL-loading. Eliminates remote-code concern but eliminates the in-app catalogue feature.
- **Path C — signed-bundle catalogue from your own server, no JS-Interface to native:** still hits "modify/update itself" if the bundles can change app behavior. Risky.
- **Path D — Play distribution off the table**; ship via your own developer-verified channel under the 2026 sideload regime, plus F-Droid. **Realistic path for Agent Host.**

### Recommendation
Assume blocked from Play; design distribution around the 2026 verified-developer sideload regime + F-Droid. If you want a Play-published companion, ship a thin browser-only "Agent Viewer" with no JS bridge.

---

## Cross-cutting findings

### 1. The foreground-service shape is consistent across the portfolio and is the most pervasive medium-risk issue
Stoop, Tasks, Notes, Neighborhood, Folio, Household, and Agent Host all need a foreground service to listen on the relay. The April-2026 narrowing (geofencing dropped) signals that Google is tightening FGS enumerated-use-cases. Plan for: (a) one canonical "RelayListenerService" of type `dataSync`, (b) a single Play Console declaration form covering all apps, (c) a video demo template you can re-shoot per app. Reference: https://support.google.com/googleplay/android-developer/answer/13392821.

### 2. UGC moderation duties bind every multi-user app
Every app where two or more users exchange content (Stoop, Tasks, Notes, Neighborhood, Household, even Folio if pods are shared) needs report-content, report-user, block-user, and a TOS the user accepts. Build this into the SDK once. Reference: https://support.google.com/googleplay/android-developer/answer/9876937.

### 3. The "decentralized + self-hosted" architecture does not exempt you from Data Safety disclosures
Reviewers and the Data Safety form treat any data leaving the device — including to a self-hosted relay or the user's own pod — as collection/sharing. The architecture is policy-irrelevant; the disclosure is mandatory. Build a single Data Safety template per app, treating "self-hosted relay" as a third-party processor.

### 4. The 2026 verified-developer regime affects sideload-channel apps too
Even apps you never planned to ship via Play (Mesh-demo, Agent Host, Import Bridge as desktop tool) require developer verification (D-U-N-S, package-name registration) for installation on certified Android devices from September 2026 in some regions. Budget for that registration; it does not require Play submission.

### 5. The Agent Host concept and Import Bridge concept are *both* outside Play in any realistic form, for different reasons
- **Agent Host:** device-and-network-abuse (remote-code-with-JS-Interface).
- **Import Bridge:** Google API CASA assessment cost.

Treating these as F-Droid / non-Play primary, with Play-published thin clients only, is the architecturally honest plan.

---

## Sources

- Play Developer Policy index: https://support.google.com/googleplay/android-developer/topic/9858052
- User Data: https://support.google.com/googleplay/android-developer/answer/10144311
- Permissions and APIs that Access Sensitive Information: https://support.google.com/googleplay/android-developer/answer/16558241
- Device and Network Abuse: https://support.google.com/googleplay/android-developer/answer/16559646
- Foreground service / full-screen intent: https://support.google.com/googleplay/android-developer/answer/13392821
- User Generated Content: https://support.google.com/googleplay/android-developer/answer/9876937
- Deceptive Behavior: https://support.google.com/googleplay/android-developer/answer/16680223
- Impersonation: https://support.google.com/googleplay/android-developer/answer/9888374
- Intellectual Property: https://support.google.com/googleplay/android-developer/answer/9888072
- Spam: https://support.google.com/googleplay/android-developer/answer/9899034
- Functionality / UX: https://support.google.com/googleplay/android-developer/answer/9898783
- AI-Generated Content: https://support.google.com/googleplay/android-developer/answer/13985936
- Malware: https://support.google.com/googleplay/android-developer/answer/9888380
- Mobile Unwanted Software: https://support.google.com/googleplay/android-developer/answer/9970222
- Health Content: https://support.google.com/googleplay/android-developer/answer/16679511
- Families: https://support.google.com/googleplay/android-developer/answer/9893335
- Google API Services User Data Policy: https://developers.google.com/terms/api-services-user-data-policy
- Restricted scope verification (CASA): https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- Workspace API user-data policy: https://developers.google.com/workspace/workspace-api-user-data-developer-policy
- Telegram bot-developer TOS: https://telegram.org/tos/bot-developers
- 2026 dev-verification news: https://www.theregister.com/2025/08/26/android_developer_verification_sideloading/, https://www.medianama.com/2026/03/223-google-android-sideloading-registered-app-stores/
- CASA cost reporting (independent): https://www.gmass.co/blog/google-oauth-verification-security-assessment/, https://medium.com/reversebits/the-50k-email-api-nightmare-why-your-simple-gmail-integration-just-became-a-compliance-hell-6071300b09b4

## Notes / caveats

- The AI-Generated Content policy fetched cleanly but did not include a separate transparency/disclosure clause; the dominant requirement is the in-app report-flag mechanism.
- Two policy pages returned summary text instead of full literal language (Restricted Content index, Age-Restricted Content). Where exact wording matters, read the pages live before submission.
- Costs for CASA come from third-party reporting; Google's own page does not state pricing. Get current quotes from a CASA-empanelled assessor before budgeting.

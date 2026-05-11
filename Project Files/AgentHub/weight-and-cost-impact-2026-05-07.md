# Weight & resource impact under the Hub design (2026-05-07)

> Concrete estimate of how much lighter (in disk space, memory,
> and battery) existing SDK apps become when adapted to bind to
> the Agent Hub instead of each bundling the SDK directly.
> Companion to [`./hub-functional-sketch-2026-05-07.md`](./hub-functional-sketch-2026-05-07.md).
>
> Numbers measured against the current `apps/folio-mobile` and
> `apps/stoop-mobile` debug builds (2026-05-07). See *Methodology*
> at the end for caveats.

## Glossary — terms used in this doc

- **Native guest** — an SDK app that ships as its own Android APK
  but uses the Hub instead of bundling the relay / pod-client /
  identity stack itself. Stoop V3 mobile is the reference example.
- **Web guest** — an SDK app that runs *as a web page in the user's
  browser* (any browser, any device — laptop, phone, borrowed
  computer). The web app pairs with the user's phone Hub by
  scanning a QR code (the same UX as **WhatsApp Web**). After
  pairing, the browser tab acts on the user's behalf with a
  capability token the Hub issued. **There is no install on the
  device the tab runs on** — just a browser tab. The phone Hub is
  the durable actor; the tab is an ephemeral peer.
- **Standalone** — an SDK app that doesn't use a Hub at all; bundles
  everything itself. Today's Stoop V2 is this. Always remains a
  fallback.
- **Hub-bound** — a guest (native or web) that has paired with the
  Hub and uses it.
- **APK** — Android Package; the binary file format for Android apps.
- **ABI** — Application Binary Interface; the CPU architecture an
  APK is compiled for. `arm64-v8a` is the dominant phone target
  today; `x86_64` etc. exist for emulators / older devices.
- **Single-ABI build** — an APK built only for one CPU architecture.
  Smaller download; Play Store assembles per-device automatically
  via Android App Bundles.
- **Resident memory** — the RAM an app is using while running, vs
  disk space (which is what the APK takes when not running).
- **Foreground service / FG-service** — a long-running background
  process on Android with a *visible persistent notification*
  attached. Required for things like "always-listen for incoming
  messages" or "scan BLE in the background." Each app that uses one
  shows its own notification; without one, the OS kills the
  background work within minutes.
- **Relay** — the SDK's transport-layer message broker (the
  `@canopy/relay` package). Each connected device maintains a
  long-lived socket to a relay server.
- **WebRTC** — peer-to-peer transport protocol used by the SDK for
  direct device-to-device data channels. Heavy native library
  (~11 MB compiled).
- **AIDL** — Android Interface Definition Language. The standard
  way for Android apps to call methods in another app's running
  service. Used as the local-IPC layer between native guests and
  the Hub.

## Measured baselines

Debug APKs in the current tree:

| App | Debug APK | Estimated release single-ABI |
|---|---|---|
| `apps/folio-mobile` | 169 MB | ~50-80 MB |
| `apps/stoop-mobile` | 144 MB | ~45-70 MB |

(Debug builds carry *every* CPU architecture and unminified code.
A release build for a single phone ABI with the standard Android
minifier is typically 30-40% of the debug size — that's the
artefact a user actually downloads from Play Store.)

### Native libraries by size (`arm64-v8a`, from folio-mobile)

| Library | Size | Status under the Hub |
|---|---|---|
| `libreactnative.so` (RN core) | 20 MB | **Stays per-guest** — every native app needs its own React Native runtime |
| `libexpo-modules-core.so` (Expo runtime) | 19.6 MB | **Stays per-guest** |
| `libjingle_peerconnection_so.so` (WebRTC) | 11.4 MB | **Lifts to Hub** — only the Hub talks to relay/peers |
| `libhermes.so` (JS engine) | 3.7 MB | **Stays per-guest** |
| `libc++_shared.so` (C++ runtime) | 1.3 MB | **Stays** (linked by RN) |
| `libjsi.so` (JS-native bridge) | 1.0 MB | **Stays** |
| BLE / secure-store / vault native modules | ~5-10 MB combined | **Mostly lift** (Hub holds BLE scan + vault) |

JS-side, the libraries that lift to the Hub: `@canopy/pod-client`
+ Inrupt Solid SDK + `@canopy/relay` + `@canopy/core` (Bootstrap
+ capability tokens) + `@canopy/oidc-session-rn` +
`@canopy/sync-engine-rn` ≈ ~3-5 MB of minified JavaScript.

## Estimated savings

### A. Native-guest APK size
- Per-guest reduction: **~10-15 MB per ABI**
  (~11 MB WebRTC + ~3 MB BLE native + ~3-5 MB JS deps).
- A typical guest goes from ~60 MB → ~45 MB release single-ABI.
- **Verdict: useful but evolutionary** — about a 20-25% reduction,
  not a step change.

### B. Native-guest resident memory (while running)
- Per-guest reduction: **~30-50 MB**
  (no per-app WebRTC connection state, no per-app relay reconnect
  machinery, no per-app pod-session cache, no per-app refresh-token
  rotation timer).
- For a user with 5 SDK apps installed, that's ~150-250 MB of
  duplicated state machinery deduplicated into the Hub.

### C. Battery — the underrated win
- Today's "always-listen-for-relay-messages" cost is **linear in the
  number of installed SDK apps**: N reconnect loops, N keepalives,
  N BLE scans, N push-notification tokens.
- With the Hub: **constant** (one of each, multiplexed).
- For a user with 5 SDK apps that's roughly **5× reduction** in
  the relay-listening battery drain — the dominant always-on cost
  in this stack.

### D. Foreground-service notifications
- Today: each Hub-aware app would show its own persistent
  notification ("Stoop is running", "Tasks is running", "Folio is
  running", ...).
- With the Hub: **one notification** ("Agent Hub — 3 apps active").
- This isn't just UX hygiene. Android 14+ has tightened
  foreground-service-type policies; at some point N persistent
  notifications stops being a UX problem and becomes "Google
  rejects your app submission" — see
  [`../play-store-risk-2026-05-07.md` § Cross-cutting #1](../play-store-risk-2026-05-07.md).

### E. Web guests — the dramatic case
A user opens `stoop.example.com` in their browser instead of
installing a Stoop APK:

| Metric | Native standalone (today) | Web guest (paired with Hub) |
|---|---|---|
| Disk space on the device | 50-70 MB APK | 0 MB |
| Resident memory while in use | ~150-250 MB own process | ~50-80 MB browser tab (shared with normal browsing) |
| Install friction | Play Store submission + user install + updates | Open a URL |
| Cross-device availability | Phone-only | Same URL works on phone + laptop + borrowed computer + kiosk |
| Update propagation | Per-device, gated by Play | Instant — refresh the tab |

**~3-4× lighter on the device, plus zero install friction, plus
instant cross-device availability.**

This is the strategic case for the Hub. Once the user has a phone
Hub, every SDK app is suddenly available wherever they have a
browser open — no Play Store submission per device, no per-device
install. The precedent is **WhatsApp turning into WhatsApp-on-every-laptop
after they shipped WhatsApp Web**: same code, same identity, every
screen the user has access to.

## Three honest reads on the design

### Most underrated benefit: the web-guest path, not the native one
Native bound guests trim ~10-15 MB and ~30-50 MB resident — useful
but evolutionary. The web-guest path is the **step change**: a
phone Hub turns the SDK from "an Android-app stack" into "a
multi-device service the user reaches from any screen." That's the
strategic move; the native-guest savings are a side effect.

### Most underrated risk: pairing UX has to be near-perfect
The web-guest path depends entirely on the QR-code pairing flow
being painless. WhatsApp Web set the bar — five seconds, "just
works." If the Hub's pairing is clunky (signature mismatches, NAT
traversal hiccups, vague error states, "what's a relay?" friction),
the web path is unusable and the design loses its biggest
distribution win. The pairing flow is the place that actually has
to be polished, not just correct.

### Most likely under-counted cost: long-term IPC contract maintenance
The Hub speaks AIDL to native guests on the same phone, and a
relay-tunnel protocol to web guests in browser tabs anywhere in
the user's device fleet. Both protocols are versioned independently
of each guest app's release cycle. Wire-compatibility (the rules
for "old guest talks to new Hub" / "new guest talks to old Hub")
becomes an ongoing maintenance cost.

The original Hub doc named this risk; it'll bite for real once a
third-party SDK app exists that wasn't built in-house — at that
point you can't fix wire-compat by re-releasing both ends together.

## Pros and cons in full

> The "Three honest reads" above are the editorial highlights — the
> single biggest upside, the single biggest risk, the single most
> under-counted cost. This section is the comprehensive trade-off
> list, grouped by category, with mitigations noted inline where
> they exist.

### Pros — distribution & reach

- **Hub is Play-Store-eligible.** Per the Play Store risk audit, the Hub-only design (without the WebView/manifest layer) is 🟢 low risk to publish on Google Play. No F-Droid-only constraint. *(The original unified-host sketch was 🛑 blocked.)*
- **Web guests need no Play submission, no per-device install.** Open a URL in any browser, any device. New distribution surface compared to today's Android-only stack.
- **Web guests work on iOS, Linux, Windows, ChromeOS, kiosks, library computers.** The phone-only Hub's reach extends to every screen the user has access to. iOS users without an Android phone fall back to standalone web apps (still functional); iOS users with an Android Hub in the household get a paired experience.
- **Update propagation is instant for web guests.** Refresh the tab; user has the new version. No app-store review queue.
- **Lower install count per user.** Users with 5 SDK apps: install one Hub instead of five separate Hub-aware native apps; the other four can be web tabs.

### Pros — cost & efficiency
*(Recap of section "Estimated savings" — see there for numbers.)*

- ~10-15 MB lighter native APKs (per ABI; ~20-25% trim).
- ~30-50 MB lighter resident memory per running native guest.
- ~5× reduction in always-on battery cost for a 5-app user (relay-listening goes from N → 1).
- N → 1 foreground-service notifications. UX hygiene + Android 14+ compliance.
- Single relay socket, single BLE scan, single mDNS scan for the whole ecosystem.

### Pros — coordination & UX

- **Cross-app intent routing.** Stoop tab on laptop emits `task.create` → routed through the Hub to native Tasks on phone. Cross-runtime, cross-device. Standalone apps can't do this.
- **Global persona switch.** One tap re-mints tokens for all bound guests; the user's whole online presence shifts together.
- **Unified audit timeline.** One place to see what every guest has been doing across the user's whole device fleet.
- **Identity continuity across devices.** Laptop tabs share the phone Hub's facets/personas via relay-tunnel — no separate logins per device.
- **Single identity-recovery flow for all SDK apps.** Back up the Hub, recover the Hub; all bound apps come back. Today's standalone apps each have their own recovery story.

### Pros — developer experience

- **New SDK apps get transport + identity + pod-credentials "for free."** New-app dev cost drops; the heavy plumbing lives in the Hub.
- **Web-guest iteration is faster than native.** Edit JS, refresh the tab. No Android rebuild + reinstall cycle. Useful for prototyping new ideas before deciding whether to also ship a native version.
- **Shared infrastructure → shared bug fixes.** A relay reconnect bug fixed in the Hub benefits every bound guest at once.
- **Consistent capability model across guests.** Users learn one permission UX; developers don't redesign it per app.

### Cons — trust & operational risks

- **Trust concentration.** The Hub holds pod credentials, capability tokens, and identity material for the whole device fleet. Compromise of the Hub = compromise of every bound guest. *Mitigation:* MFA on Hub unlock, pod-side encrypted backup, biometric gates on sensitive operations. Comparable in shape to the trust users already place in a single Google account; the risk surface is similar but the data ownership story is better (data lives on the user's pod, not Google's servers).
- **Single point of failure.** Hub crash = every bound guest is offline until the Hub auto-restarts. *Mitigation:* Android's service-restart semantics + each guest's fallback-to-standalone path. Real disruption window measured in seconds-to-minutes, not hours.
- **High-value target on the device.** A compromised Hub is more damaging than a compromised single app. *Mitigation:* open-source code review, reproducible builds, narrow native attack surface. Eliminates nothing.
- **Recovery flow is a hard design problem.** New phone, no Hub data — pod-side encrypted backup + pairing-key handoff + MFA. Security-sensitive; easy to design badly. **Open question.**
- **Audit-trail integrity if the Hub itself misbehaves.** The Hub writes its own audit log; a malicious Hub could lie. *Mitigation:* open-source review and reproducible builds. Not addressed by the design itself.

### Cons — implementation cost

- **IPC contract maintenance.** AIDL + relay-tunnel protocol, versioned independently of each guest app's release cycle. Wire-compatibility (old guest ↔ new Hub, new guest ↔ old Hub) is ongoing work for as long as third-party SDK apps exist.
- **Pairing UX must be near-perfect.** If QR-pairing is clunky, the web-guest path is unusable and the strategic distribution win evaporates. WhatsApp Web sets the bar; clearing it is non-trivial engineering.
- **Background-slice budget calibration is unknown.** Get it wrong and either guests can't do real work, or batteries drain. Empirical tuning required against real apps. **Open question.**
- **No iOS Hub.** iOS users only get web-guest experience (works) without a paired phone-Hub experience. iOS Network Extension framework would be the path but is impractical short of significant Apple-specific engineering.
- **Multi-Hub scenarios under-designed.** Two phones per user, family-sharing tablets, Android work profiles — open questions.

### Cons — UX & adoption frictions

- **Onboarding is more complex.** Today: install one app, sign into pod, use it. With Hub: install Hub, sign into pod, then install/pair guests. Three steps where there was one.
- **Adoption chicken-and-egg.** Web guests are great *if* the user has a Hub. New users opening a web app for the first time face a fork: "install the Hub for the full experience, or use standalone?" — extra friction. Standalone-as-floor mitigates but doesn't remove the fork.
- **Single-app users see no benefit.** A user with only one SDK app pays the Hub's overhead with none of the multi-app savings. The Hub is only worth it from ~2 apps onward.
- **The "we control your traffic" promise weakens for web guests.** The user's regular browser handles network-level filtering. Brave / Tor / Firefox + uBlock all do this well, but the Hub can't enforce it at the platform level. (The unified-host-with-WebView idea *could*; the Hub-only design dropped it. The Play Store audit forced this trade — see [`../play-store-risk-2026-05-07.md` § App 12](../play-store-risk-2026-05-07.md).)
- **Audit-timeline-as-home is a strong opinion.** Some users may just want app tiles, not an event feed. *Mitigation:* tab default in Settings, but the out-of-box UX is opinionated.

### Cons — architectural compromises

- **Native bound guests still pay the RN-runtime baseline (~40-50 MB unavoidable).** The "lighter apps" pitch is moderate (~20-25% APK trim), not dramatic. Could disappoint users who expect native installs to shrink to web-tab size — they don't.
- **Public host API implies a deprecation policy.** Once third-party SDK apps depend on the host API, breaking changes have ecosystem cost. Versioning + deprecation windows must be committed to early or retrofitted painfully later.
- **Web-guest backgrounding is severely limited.** Browser Service Workers can't run continuously; "wake on incoming message" for a web guest depends on the *Hub* receiving the message and routing it via push when the tab is closed. If the Hub is offline, web guests degrade to "works only while tab is open."
- **The Hub itself is open-source coordination infrastructure.** Like any platform, it requires sustained maintenance + a versioning + governance model. Builds an institutional cost the SDK didn't have before.

## Bottom line

The Hub is **less a battery-optimisation and more a
distribution-and-coordination mechanism that happens to also save
battery**. The numbers don't quite justify the build effort on
native-guest savings alone — those are evolutionary, not
transformative. They do justify it once the web-guest path is
counted, because that path unlocks new distribution channels rather
than just trimming existing ones.

For the existing apps specifically:

- **Stoop, Tasks, Folio as native bound guests**: ~20-25% APK
  trim, ~30-50 MB resident savings, shared identity + audit +
  intent routing — engineering wins.
- **Stoop, Tasks, Folio as additional *web builds* paired with
  the Hub**: brand-new distribution surface (laptop, friend's
  device, kiosk) with effectively zero per-device install cost —
  the strategic win.

The first is incremental polish. The second is the reason to
build the Hub.

## Methodology / caveats

- APK sizes measured from the current debug builds at
  `apps/folio-mobile/android/app/build/outputs/apk/debug/` and
  `apps/stoop-mobile/android/app/build/outputs/apk/debug/`.
  Release-build estimates extrapolated using typical RN/Expo
  debug→release ratios (30-40% of debug size); a release build
  has not been run to confirm.
- Native-library sizes pulled from
  `merged_native_libs/debug/.../arm64-v8a/`. Other ABIs (`x86`,
  `x86_64`, `armeabi-v7a`) have different sizes; `arm64-v8a` is
  the dominant target for modern phones.
- Battery and resident-memory estimates are educated
  extrapolations from typical RN-app behaviour, not measured.
  Actual numbers depend heavily on usage patterns (frequency of
  relay messages, BLE scan duty cycle, sync cadence, etc.).
- The "~5× battery reduction" figure assumes 5 SDK apps
  installed *and* simultaneously using their relay listener.
  Real users will have fewer apps and not all running
  concurrently; the absolute reduction is smaller, but the
  shape is the same (linear-in-N → constant).
- The web-guest figures assume the user already runs a browser
  for unrelated reasons, so the browser process's baseline cost
  is amortised across normal browsing. A user who only opens a
  browser to use SDK apps would see a different ratio.

## Sibling docs

- [`./hub-functional-sketch-2026-05-07.md`](./hub-functional-sketch-2026-05-07.md) — the live Hub design this analysis is based on
- [`./agent-hub-design-2026-05-05.md`](./agent-hub-design-2026-05-05.md) — Hub fundament (the broker design)
- [`../play-store-risk-2026-05-07.md`](../play-store-risk-2026-05-07.md) — portfolio Play Store risk audit
- [`../Substrates/L0-react-native.md`](../Substrates/L0-react-native.md) — RN platform layer that exposes hardware bindings to native guests

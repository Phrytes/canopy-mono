# Agent Hub — functional sketch (2026-05-07)

> Status: **rough functional sketch (V0)**. Direct successor to
> [`./agent-hub-design-2026-05-05.md`](./agent-hub-design-2026-05-05.md)
> (Hub fundament) and the now-superseded
> [`../AgentBrowser/functional-sketch-2026-05-07.md`](../AgentBrowser/functional-sketch-2026-05-07.md)
> (the unified Hub+Browser direction).
>
> **Pivot vs the unified sketch:** drop the in-app WebView sandbox
> + manifest-enforced browser layer entirely. The Hub is just the
> Hub. Web versions of agent-SDK apps run in the user's regular
> browser of choice (Brave / Firefox / Tor — the user picks the
> privacy posture). Solid pods + relay group-membership are the real
> trust authorities for data and messaging; the browser handles the
> rest at network level. Rationale + Play-Store consequences in
> [`../play-store-risk-2026-05-07.md`](../play-store-risk-2026-05-07.md)
> (Agent Host went from 🛑 blocked to 🟢 low risk under the Hub-only
> design).
>
> Carries forward from the unified sketch: audit-timeline-as-home,
> persona swipe, capability badges, intent registry, FG-service
> multiplexing, the `@host` API surface (rebranded as the binding
> protocol). Drops: WebView sandboxing, manifest-enforced traffic,
> open-web mode, in-app catalogue.

## What it is, in one paragraph

A single open-source Android app that owns the user's Solid-pod
login, identity facets, relay socket, BLE/mDNS scanners, and the
sole foreground-service notification slot. Native agent-SDK apps on
the same phone bind to it via local IPC ("lite-mode" guests).
Browser tabs anywhere in the user's device fleet — phone browser,
laptop browser, friend's borrowed laptop — pair with it via a
relay-tunnel handshake (QR-code, like WhatsApp Web) and become
ephemeral light clients. The Hub is the user's **identity wallet
and transport coordinator** for SDK apps; not a runtime, not a
sandbox, not a browser.

## Why no laptop hub?

The original Hub design speculated about desktop daemons. After
this round of dialogue: not needed.

- The phone Hub's reason-to-exist is **mobile resource constraints**
  — battery, persistent connection, BLE/mDNS scanners. Laptops don't
  have those constraints; tabs in a normal browser share a process
  fine.
- "Unified" should mean **unified identity and coordination across
  devices**, not **same software on every device**. The phone Hub
  achieves that over the relay alone — laptop tabs subscribe to the
  Hub's persona broadcasts, route intents through the Hub, and emit
  audit events the Hub aggregates. No install on laptop required.
- Users without a phone fall back to **fully standalone web apps**
  — Solid's natural state (OIDC to your IdP, talk to relay + pod
  directly). The Hub is opt-in convenience for users who have one.

The phone Hub becomes the canonical actor for the user; everything
else is either a peer on the network (laptop tab) or a co-resident
guest (native phone app). One Hub, one identity, many surfaces.

## Three runtime classes for guest apps

| Class | What | Lives where | Reaches Hub via |
|---|---|---|---|
| **Native** | Android APK that uses the SDK | Phone (Hub-bound) | Local IPC (AIDL / bound service) |
| **Web** | Solid-pod web app | Any browser, any device | Relay-tunnel after QR pairing |
| **Standalone** | Native or web app that doesn't know about the Hub | Anywhere | N/A — runs without Hub |

A single guest app can ship in multiple classes. **Stoop** today is
standalone; **Stoop V3 mobile** becomes a native Hub-bound APK plus
a web build that pairs as a web client. **Folio** likewise.

The "lite / standalone / hybrid" matrix from the original Hub doc
maps directly: hybrid = ship the SDK app standalone, prompt at first
run to bind to the Hub if one is detected (or to install the Hub if
not). Standalone always works as a floor.

## Home screen — three tabs

```
┌─────────────────────────────────────────┐
│ ◀ the author ▶                          ⚙   │  ← persona swipe
├─────────────────────────────────────────┤
│ [ Timeline ]  Apps   Settings           │  ← tab bar
├─────────────────────────────────────────┤
│ • 12:04  Stoop posted to neighbourhood  │
│ • 12:01  Tasks claimed chore for you    │
│ • 11:58  Folio synced to pod (3 files)  │
│ • 11:47  Laptop-Stoop tab paired        │  ← web tab joined
│ • 11:30  Notes opened (you)             │
│ • 11:12  Persona switched: the author-Work   │
│ ...                                     │
└─────────────────────────────────────────┘
```

- **Timeline** (default): live event feed from native guests + paired
  web tabs. Long-press → revoke or mute. Tap → detail pane.
- **Apps**: list of bound apps with capability badges (🟢🟡🔴 across
  pod / hardware / network). Tap a row → unbind, re-issue tokens,
  or open the app's pod-side data.
- **Settings**: persona manager, pod connection, paired devices,
  encrypted backup / restore, factory reset.

The persona swipe at the top is global. Switching personas:
1. Re-mints capability tokens for all bound native apps + paired web
   tabs under the new facet.
2. Disconnects + reconnects the relay socket as the new facet's
   pubkey.
3. Each guest receives a `personaChanged` event and can refresh.
4. Audit row written: "switched persona X → Y".

## The `@host` API surface (binding protocol)

This is the API every guest sees. **Same shape, two transports:**

- Native guest: `import host from '@canopy/host-client'` resolves
  to a thin wrapper around an AIDL / bound-service IPC.
- Web guest: `import host from '@canopy/host-client/web'` resolves
  to a wrapper around a relay-tunnel session (after pairing).

```ts
interface AgentHost {
  // Identity (read-only from guest)
  identity: {
    whoAmI(): Promise<WebID>;
    currentFacet(): Promise<FacetID>;
    currentPersona(): Promise<PersonaID>;
    onPersonaChange(handler): Subscription;
  };

  // Pod — scoped per binding
  pod: {
    read(path): Promise<Bytes>;
    write(path, bytes, opts?): Promise<Etag>;
    list(prefix): Promise<Path[]>;
    subscribe(path, handler): Subscription;
  };

  // Agent — the SDK surface, Hub-mediated
  agent: {
    send(to, msg, opts?): Promise<Receipt>;
    on(eventKind, handler): Subscription;
    registerSkill(name, handler): void;
    broadcastToGroup(groupId, msg): Promise<Receipt>;
  };

  // Intents — cross-app, cross-runtime
  intents: {
    register(intentName, handler): void;
    emit(intentName, payload, opts?): Promise<IntentResult>;
    discover(intentName): Promise<RegisteredApp[]>;
  };

  // Hardware — gated by the binding's permissions
  // (native only; web guests use browser APIs directly)
  hardware?: {
    camera, gps, ble, mdns, push, biometric, notification
  };

  // Storage — local, app-namespaced, optional pod sync
  storage: {
    get(key): Promise<Json>;
    set(key, value): Promise<void>;
    list(prefix?): Promise<Key[]>;
  };

  // Background-slice (native only — web guests can't background)
  bg?: {
    declare({wakeOn, handler}): Subscription;
  };

  // Audit — guests emit semantic events
  audit: {
    emit(kind, summary, opts?): Promise<void>;
  };
}
```

Differences from the unified-sketch surface:

- **No `host.network.fetch`.** Web guests use the browser's `fetch()`
  directly; the Hub doesn't gate it. (The Hub never had a way to
  enforce this for web guests anyway; pretending to was incoherent.)
- **`host.hardware` and `host.bg` are native-only.** Web guests use
  browser permissions for camera/GPS/notifications; can't background.
- **No manifest-enforced WebView sandbox.** The "manifest" lives now
  as the **binding request** the guest makes when first reaching the
  Hub.

## Binding flow — first time a guest meets the Hub

### Native guest (phone)

1. Guest app launches; tries to `bind(@host-client)`.
2. Hub's IPC service receives `BindingRequest { app-id, app-name,
   requested-permissions, app-signature }`.
3. Hub renders a permission card: *"Stoop wants to: read+write
   `mem://stoop/**` on your pod, send messages on your behalf,
   register the `task.create` intent, wake briefly on inbound
   `postRequest` messages. Allow?"*
4. User accepts → Hub mints a capability token sub-scoped to the
   request, stores the binding under the current persona.
5. Future calls from this app are authenticated by the token.
6. Audit row: "bound Stoop under the author-Personal facet."

### Web guest (any browser, any device)

1. User opens `https://stoop.example.com` in their browser.
2. Stoop web detects no host token in storage; offers two options:
   - "Pair with Agent Hub" (preferred for users who have it)
   - "Sign in with Solid pod" (full standalone)
3. On pair: Stoop web renders a QR code containing a one-shot
   pairing nonce + the relay address.
4. User scans with phone Hub. Hub renders the same permission card
   as above, plus *"This will let your `the author` persona's `Stoop` tab
   on `MacBook Air (Safari)` act on your behalf until you revoke
   it."*
5. User accepts → Hub mints a per-tab token, sends it back via the
   relay using the pairing nonce as routing key.
6. Web tab stores the token in `sessionStorage` (or `localStorage`
   if user opted "remember this device") and connects to the relay
   directly with it.
7. Audit row: "paired Stoop on MacBook Air (Safari)."

The whole flow is ~5 seconds and looks like WhatsApp Web's QR pair.
Note: pairing happens **through the relay**, not over LAN — works
across networks. The phone is the issuing authority; the laptop tab
is an authorised peer.

## Capability model — Hub-side, not WebView-side

What the Hub mediates (and the badges describe):

- **Pod operations**: Hub holds the pod's refresh token; signs and
  forwards `read`/`write`/`list` calls scoped to the binding's
  declared paths. A guest cannot reach the pod outside its scope —
  not because of a sandbox, but because the Hub refuses to sign it.
- **Relay messages**: Hub holds the relay's group-membership tokens;
  signs and forwards `agent.send` / `broadcast` / `registerSkill`
  scoped to the binding. Same refusal pattern.
- **Hardware (native guests)**: AIDL boundary. Camera/GPS/etc. only
  reachable via the Hub's bound service.
- **Audit emission**: every signed operation is logged.

What the Hub does **not** mediate:

- **Web guest's outbound HTTP.** The user's browser handles that.
  Brave/Firefox/Tor + uBlock are the right tool for that job.
- **Native guest's direct hardware access if it bypassed the Hub.**
  Native apps that opt into Hub-binding voluntarily route through
  the Hub; if a malicious native app links the SDK directly, the
  Hub can't see it. The user's defence is Play-Store-style review +
  open-source audit, not Hub-side enforcement at the syscall level.

This is a smaller security promise than the unified sketch made,
but a much more **honest** one. The Hub can credibly enforce
identity + agent-network ops; it never could credibly enforce
network-level outbound HTTP from a WebView, and pretending it
could was a bad design.

## Foreground-service multiplexing

Unchanged from the unified sketch — see
[`../AgentBrowser/unified-host-feedback-2026-05-07.md` § E](../AgentBrowser/unified-host-feedback-2026-05-07.md):

- Hub runs the only Android FG-service. One persistent notification.
- Native bound guests declare `bg.wakeOn` slices in their binding
  request; Hub's FG-service multiplexes wakes for all of them.
- Web guests cannot background (browser limitation); they can register
  for **delayed delivery** instead — Hub holds messages addressed to
  a paired tab while the tab is closed; tab gets them on next open.
  Native push (FCM/etc.) for "tab not open in 24h" can be added later
  if the model proves out.

Reference for the Android-side narrowing: the Play-Store risk audit
([`../play-store-risk-2026-05-07.md` § Cross-cutting #1](../play-store-risk-2026-05-07.md)).
The Hub's single canonical FGS of type `dataSync` covers the whole
ecosystem.

## Intent routing — cross-runtime by default

Stoop tab on laptop wants to spawn a chore in Tasks:

1. `host.intents.emit('task.create', {title, deadline})` from the
   web tab.
2. Tab's `@host-client` sends the intent through the relay tunnel
   to the phone Hub.
3. Hub looks up registered receivers for `task.create` across the
   user's whole fleet:
   - Native Tasks app on phone? Yes.
   - Tasks tab open in any paired browser? Maybe.
   - Third-party `LocalListMaker` registered? Maybe.
4. Hub renders a small notification (or in-tab modal): *"Send to
   Tasks (phone) / LocalListMaker (laptop tab) / Cancel — ☐
   default"*.
5. On confirm: Hub routes the intent to the chosen receiver. If the
   target is a not-currently-running native bound app, it gets
   loaded via its background slice with a one-shot capability slip.
6. Result returns through the same path. Both sides emit audit rows.

The user never thinks about which device handled the chore. The
Hub orchestrated it.

## Distribution & Play Store posture

Per [`../play-store-risk-2026-05-07.md`](../play-store-risk-2026-05-07.md):

- **Hub itself**: shippable on Play. It's now Tailscale-shaped — a
  service-app with a UI for managing identity + permissions + audit.
  No JS-Interface-loading-untrusted-URLs, no remote code execution.
  Foreground service of type `dataSync`, declared once. Risk verdict:
  🟢 low.
- **Native bound guest apps** (Stoop, Tasks, etc.): each ships
  separately on Play with its own risk envelope. The Hub-binding
  does not change their per-app risk profile in the audit.
- **Web guests**: shipped on the open web. No Play involvement.

Three normal distribution channels; no F-Droid-only constraint.
Open-source still matters (trust the Hub holding your credentials)
and probably wins F-Droid distribution alongside Play.

## V1 scope (concrete)

The smallest Hub that proves the model:

1. Android shell (Kotlin) — service + UI activity + bound-service
   IPC layer.
2. Pod-credential management (one Solid IdP login).
3. Single relay socket + BLE scanner + mDNS scanner + foreground
   service.
4. Single persona ("the author") with one identity facet. Multi-persona
   is V1.5.
5. Local IPC binding protocol (AIDL) implementing `host.identity`,
   `host.pod`, `host.agent`, `host.storage`, `host.audit`,
   `host.hardware.{notification, gps, camera}`, `host.bg`.
6. Permission-card UI + capability-token issuance.
7. Audit timeline as home (uses L1-L2 of the monitoring substrate
   in [`./monitoring-design-2026-05-07.md`](./monitoring-design-2026-05-07.md)).
8. **One real native bound guest**: Stoop V3 mobile, ported to
   `@canopy/host-client` instead of direct substrate imports.
9. **Web pairing flow** scaffolded but not required for V1 ship —
   the QR-pair + relay-tunnel can land in V1.5 once native binding
   is solid.

Out of V1: multi-persona, intent registry across runtimes, web
pairing, encrypted backup/restore, multi-IdP, BLE/mDNS for guests.
Each becomes its own follow-up phase.

## Demarcation: when does an app want a Hub binding?

Under the Hub-only model, the question changes shape. Apps don't
have to decide "host-mode vs standalone"; they decide **"does my
phone build know how to use a Hub when one is present?"**

| Pattern | Native phone | Web | Notes |
|---|---|---|---|
| **Hub-aware** | Detects Hub on first run; offers binding; falls back to standalone | Offers QR pair on first run; falls back to standalone-Solid | The default for all V1+ SDK apps |
| **Hub-unaware** | Embedded SDK; manages own pod creds + relay socket | Same | Today's Stoop V2; works fine, just doesn't share infrastructure with other apps |
| **Hub-required** | Refuses to launch without Hub | N/A | A bad pattern; avoid |

Recommendation: **all new SDK apps ship Hub-aware**. Existing apps
get an upgrade path (Stoop V3 mobile is the first; Tasks follows).

Apps that simply don't make sense to bind:
- **Mesh-demo**: developer tool, never user-facing.
- **Proof-of-location**: hard real-time hardware loops; uses BLE/NFC
  outside the Hub's mediation budget. Standalone is right for it.
- **Private LLM**: model-management UI + GPU; runs as a service that
  exposes intents (e.g. `llm.complete`) over the Hub; itself stays
  standalone. The intent-registry pattern means Hub-aware apps can
  call it without binding to it.

Folio (phone), Notes, Neighborhood, Archive, Household, Import-bridge:
all clean Hub-aware candidates.

## What changed vs the original Hub doc (2026-05-05)

For honest tracking:

| Original | Now |
|---|---|
| Desktop-daemon framing (launchd / systemd / Task Scheduler) | Phone-only; laptop tabs pair via relay tunnel; no laptop install |
| Three "shared agent" flavours (shared inbox / partitioned / composed) | Same model still applies but reframed under bindings; flavour 3 (composed personality / skills) becomes intent-registry routing |
| Lite vs Standalone vs Hybrid bundle-size matrix | Hybrid is the recommended default for Hub-aware SDK apps; bundle-size delta is small enough that Hub-aware-with-fallback beats lite-only |
| iOS impractical | Mitigated: iOS users use Safari for web guests, paired with someone's phone Hub. Native iOS Hub still impractical short of Network Extensions; not blocking. |
| RPC choice open | AIDL on Android for native; relay-tunnel-with-capability-token for web. Both ride existing infrastructure. |

## Open questions

- **Recovery / re-pair flow.** New phone, no Hub data. Encrypted
  pod-side backup of identity material + MFA on re-pair. Detailed
  design after V1 boots.
- **Web tab token lifetime + revocation propagation.** Tabs use
  short-lived tokens (1h?) auto-refreshed via the relay tunnel;
  Hub revoke = next-refresh fails. Granularity and TTL TBD.
- **Multi-Hub.** What if a user has two phones, both running the
  Hub? Today's answer: pick one as canonical; the other binds to
  it as a secondary peer (no second Hub-of-Hub). Open whether to
  formalise this or just live with the rule.
- **Background-slice budget calibration.** Empirical, tune with
  Stoop V3 in V1.
- **Intent-conflict resolution.** Default-receiver UI proposed
  above; richer policies (per-intent rules, time-of-day, fleet
  routing) deferred.
- **Native-binding extension model.** Does the Hub ship hardware
  bindings only with new versions, or via a plugin contract? Lean:
  ship-with-Hub for V1; revisit if a guest blocks on it.
- **Naming.** "Agent Hub" is the working name. Final pick open.

## Sibling docs

- [`./agent-hub-design-2026-05-05.md`](./agent-hub-design-2026-05-05.md) — Hub fundament (the broker design this builds on)
- [`./monitoring-design-2026-05-07.md`](./monitoring-design-2026-05-07.md) — audit / monitoring substrate (powers the timeline)
- [`../AgentBrowser/design-2026-05-07.md`](../AgentBrowser/design-2026-05-07.md) — original Browser seed (now superseded by this pivot)
- [`../AgentBrowser/unified-host-feedback-2026-05-07.md`](../AgentBrowser/unified-host-feedback-2026-05-07.md) — feedback dialogue that produced the unified sketch (still useful for the cross-app intent + persona arguments)
- [`../AgentBrowser/functional-sketch-2026-05-07.md`](../AgentBrowser/functional-sketch-2026-05-07.md) — superseded unified Hub+Browser sketch (preserved for historical trail; this Hub-only sketch is the live design)
- [`../play-store-risk-2026-05-07.md`](../play-store-risk-2026-05-07.md) — portfolio Play Store risk audit (Hub now 🟢 low under this design)
- [`../projects/README.md`](../projects/README.md) — project-wide Hub-compatibility rules
- [`../Substrates/L0-react-native.md`](../Substrates/L0-react-native.md) — RN platform layer that exposes the host's hardware bindings

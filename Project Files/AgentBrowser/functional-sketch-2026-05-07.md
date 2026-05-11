# Agent Host — functional sketch (2026-05-07)

> Status: **rough functional sketch (V0)**. Successor to
> [`./design-2026-05-07.md`](./design-2026-05-07.md) and
> [`../AgentHub/agent-hub-design-2026-05-05.md`](../AgentHub/agent-hub-design-2026-05-05.md);
> incorporates dialogue captured in
> [`./unified-host-feedback-2026-05-07.md`](./unified-host-feedback-2026-05-07.md).
>
> Not a coding plan. The point is to get the load-bearing shape on
> paper so the next round of design dialogue has something concrete
> to push against.

## Working name

"Agent Host" as the placeholder. Naming candidates: *Grond*, *Anchor*,
*Foothold*, *Humus* — all gesture at "the layer below the surface."
Final pick is open; the design doesn't depend on it.

## What it is, in one paragraph

A single open-source Android app that owns the user's pod login,
identity facets, relay connection, BLE/mDNS scanners, and persistent
notification slot. It loads agent-SDK guest apps as signed JS bundles
inside per-app sandboxes, exposes a stable host API to them, and
mediates every capability they request through a manifest-driven
permission model. The home screen is a live audit timeline of what
guests have been doing, plus an app launcher with capability badges
and a top-bar persona switcher.

The host is **one runtime among many**: web versions of the same
guest apps keep working in any browser; the host is the
phone-optimised runtime that adds shared infrastructure +
permission mediation. Multiple host implementations (lean, rich,
fork) can coexist because the contract is the manifest + the host
API surface, not the binary.

## Three architectural layers

| | Shell | Runtime | Guest |
|---|---|---|---|
| **What** | Native Android app | JS host API + sandbox | `.agentapp` bundle |
| **Owns** | Pod creds, relay socket, BLE/mDNS, FG-service notification, hardware permissions | Capability mediation, manifest enforcement, intent routing, audit emission | App-specific JS, UI, business logic |
| **Tech** | Kotlin + WebView (V1) → GeckoView (V2 if open-web) | JS bridge between WebView and shell | HTML + JS + manifest, signed |

## Home screen — three tabs

```
┌─────────────────────────────────────────┐
│ ◀ the author ▶                          ⚙   │  ← persona swipe
├─────────────────────────────────────────┤
│ [ Timeline ]  Apps   Settings           │  ← tab bar
├─────────────────────────────────────────┤
│ • 12:04  Stoop posted to neighbourhood │
│ • 12:01  Tasks claimed chore for you   │
│ • 11:58  Folio synced to pod (3 files) │
│ • 11:47  Stoop blocked external fetch  │  ← redacted/blocked
│          to api.suspicious.com         │
│ • 11:30  Notes opened (you)            │
│ ...                                     │
└─────────────────────────────────────────┘
```

- **Timeline** (default): live event feed from the audit substrate
  (L1-L2 from [`../AgentHub/monitoring-design-2026-05-07.md`](../AgentHub/monitoring-design-2026-05-07.md)).
  Tap a row → detail + revoke-this-capability shortcut. Long-press
  → mute this event-kind. Pinch → zoom out to per-app summaries.
- **Apps**: tile grid. Each tile shows name + capability badges
  (🟢🟡🔴 across pod / hardware / network). Tap → launch.
  Long-press → manifest viewer + revoke.
- **Settings**: persona manager, pod connection, host updates,
  export-encrypted-backup, factory-reset.

The persona swipe at the top is global: switching personas reloads
the timeline, the app list, and the agent's network presence.

## The `@host` API surface (strawman)

Inside a guest app:

```ts
import host from '@host';

// Identity — read-only from the guest's perspective
host.identity.whoAmI(): Promise<WebID>;
host.identity.currentFacet(): Promise<FacetID>;
host.identity.currentPersona(): Promise<PersonaID>;
host.identity.onPersonaChange(handler): Subscription;

// Pod — scoped to manifest.pod-paths
host.pod.read(path): Promise<Bytes>;
host.pod.write(path, bytes, opts?): Promise<Etag>;
host.pod.list(prefix): Promise<Path[]>;
host.pod.subscribe(path, handler): Subscription;

// Agent — the SDK surface, host-mediated
host.agent.send(to, msg, opts?): Promise<Receipt>;
host.agent.on(eventKind, handler): Subscription;
host.agent.registerSkill(name, handler): void;
host.agent.broadcastToGroup(groupId, msg): Promise<Receipt>;

// Intents — cross-app routing
host.intents.register(intentName, handler): void;
host.intents.emit(intentName, payload, opts?): Promise<IntentResult>;
host.intents.discover(intentName): Promise<RegisteredApp[]>;

// Network — gated by manifest.external-hosts
host.network.fetch(url, opts?): Promise<Response>;
//  ^ throws CapabilityError if host not in manifest

// Hardware — gated by manifest.hardware
host.hardware.camera.takePhoto(opts?): Promise<Blob>;
host.hardware.gps.getOnce(opts?): Promise<Coords>;
host.hardware.ble.scan(opts?): Subscription<Peer>;
host.hardware.mdns.advertise(service): Subscription;
host.hardware.notification.post(title, body, opts?): Promise<NotificationId>;
host.hardware.biometric.authenticate(reason): Promise<boolean>;

// Storage — local, app-namespaced, auto-sync to pod if configured
host.storage.get(key): Promise<Json>;
host.storage.set(key, value): Promise<void>;
host.storage.list(prefix?): Promise<Key[]>;

// UI — minimal helpers; guest renders most of its UI itself
host.ui.toast(text, opts?): Promise<void>;
host.ui.confirm(prompt): Promise<boolean>;
host.ui.openExternal(url): Promise<void>;

// Audit — guests can emit semantic events into the timeline
host.audit.emit(kind, summary, opts?): Promise<void>;

// Background-slice
host.bg.declare({wakeOn, handler}): Subscription;
//  ^ guest declares "wake me on inbound msg of kind X" — see FG model
```

Every method is **manifest-gated**. Methods not granted in the
manifest throw `CapabilityError` immediately. Methods granted at
install can be revoked at any time from the audit timeline; the
next call after revoke throws `RevokedError`.

## Manifest schema (`agent-app.json`)

```json
{
  "name": "Stoop",
  "id": "ag.stoop",
  "version": "2.0.0",
  "developer": {
    "webid": "https://anne.solidcommunity.net/profile/card#me",
    "signature": "ed25519:..."
  },
  "capabilities": {
    "pod-paths": ["mem://stoop/**"],
    "external-hosts": ["nominatim.openstreetmap.org"],
    "hardware": ["gps", "notification", "camera"],
    "skills": ["postRequest", "respondToItem", "..."],
    "intents-emit": ["task.create"],
    "intents-receive": ["stoop.compose-from-text"],
    "transports": ["relay", "ble"],
    "background": [
      { "wakeOn": "msg-kind:postRequest", "maxRunMs": 2000 },
      { "wakeOn": "cron:0 */6 * * *",     "maxRunMs": 5000 }
    ]
  },
  "min-host-api": "1.0.0"
}
```

The user sees this rendered as a **plain-language permission card**
at install time, not the JSON. Each capability has a one-line
explanation maintained by the host:

- "🟢 Stoop will read & write inside `stoop/` on your pod"
- "🟡 Stoop will contact one external service: nominatim (geocoding)"
- "🟢 Stoop wants GPS, notifications, camera"
- "🟡 Stoop can ask other apps to do things (1 intent: create a task)"
- "🟡 Stoop wants to wake briefly on incoming Stoop messages"

## Capability lifecycle

| Moment | Host behaviour |
|---|---|
| **Install** | Render permission card from manifest. User accepts → bundle stored, capabilities written to scoped capability token. |
| **Run** | Every host-API call checked against the token. Denied calls throw + emit a `cap-denied` audit event. |
| **Update** | New manifest fetched. Host computes diff vs installed manifest. **No diff** → silent update. **Diff** → "Stoop wants to add: GPS, 1 new external host. Continue?" prompt. User can refuse and pin to old version. |
| **Revoke** | User long-presses an audit row or app tile → "Revoke this capability". Token is amended; next call throws. App keeps running with reduced surface. |
| **Uninstall** | Token revoked entirely. App-namespaced local storage purged. Pod data left in place (user's data, user's choice). |

## Foreground-service model

The mechanism (Android background-execution constraints) is explained
in [`./unified-host-feedback-2026-05-07.md` § E](./unified-host-feedback-2026-05-07.md).
The contract:

- The **host** runs exactly one Android foreground service. One
  persistent notification: *"Agent host — 3 apps listening"*. Tap →
  list of active background-slices.
- Guest apps declare **background slices** in their manifest:
  - `wakeOn: "msg-kind:<kind>"` — relay-inbound message of this kind.
  - `wakeOn: "ble-peer:<service-uuid>"` — BLE peer with matching service advertises in range.
  - `wakeOn: "cron:<expression>"` — scheduled tick.
  - `wakeOn: "intent:<name>"` — another guest emits this intent.
- The host's FG-service runs the relay socket, BLE scan, mDNS scan,
  and cron scheduler. On a hit, it loads the guest's bundle (or
  routes into the already-loaded one), invokes the declared handler
  with `maxRunMs` budget, then releases.
- A guest's slice that overruns its budget is killed; repeated
  overruns disable the slice + alert the user ("Stoop is using too
  much battery in the background — pause its wake-ups?").

Net: one persistent notification, one socket, one BLE scanner for the
whole ecosystem. Guests can't bypass this — there is no other way to
get background time inside the host.

## Intent flow walkthrough — Stoop calling Tasks

1. Stoop user reads a "need a chore done" post → taps "Add to my
   tasks" button in Stoop UI.
2. Stoop calls `host.intents.emit('task.create', {title, deadline,
   sourcePost: postId})`.
3. Host looks up registered receivers for `task.create`. Finds Tasks
   (registered in its manifest). Could also find a third-party
   `LocalListMaker` if the user has installed it.
4. Host shows a small bottom-sheet: *"Send to: ● Tasks  ○ LocalListMaker
   [send] [cancel] ☐ default"*.
5. User confirms → host invokes the matching guest's intent handler
   with the payload + a one-shot capability slip
   ({source: 'ag.stoop', intent: 'task.create'}).
6. Tasks's handler creates the task, returns a result `{taskId,
   status: 'created'}`. Stoop receives it via the same channel and
   updates its UI ("Added to Tasks ✓").
7. Both sides emit audit events: Stoop logs "emitted task.create →
   Tasks", Tasks logs "received task.create from Stoop". User can
   see the trail and revoke the binding.

If user ticked "default", the next emit goes silently to Tasks
without the bottom-sheet. The default is revocable from Settings →
Intent routing.

## Open-web mode (V2)

The bigger framing your reply opened up: the host as a **real
browser** that *also* speaks the agent-SDK protocol.

Two modes for the same UI:

- **SDK page**: bundle has a manifest. Capability card on first run.
  Full host API available (subject to manifest). Trusted: render in
  the persona's identity, audit events flow.
- **Open page**: any URL. Zero capabilities. Renders, scripts run,
  cookies *disabled* by default. `@host` import is undefined. The
  open-web is sandboxed harder than a normal browser tab — closer to
  Brave's "private + ad-block + no-third-party" baseline.

Distribution shifts from F-Droid-only to "browser, with these
features." Play Store likely allows this (Brave / DuckDuckGo / Tor
on Android exist). Engine: GeckoView when V2 lands; WebView for V1's
SDK-only mode.

V1 ships SDK-only to keep scope tight. V2 swaps WebView for
GeckoView and adds an "Open URL…" tab.

## Demarcation: host-app vs standalone

### Clarification first — what the host imposes on a running guest

A common misconception (mine, in earlier wording): the host imposes
"chrome" on guest apps that compresses their UI. **It doesn't.** When
the user taps a tile and enters a guest, the guest renders in a
full-screen WebView. Internal tabs, bottom navigation, side drawers,
modal sheets — anything the guest's HTML/CSS/JS wants — are fine. The
host's chrome (timeline, tile grid, persona top-bar) only exists on
the home screen, not while a guest is running.

So **UI complexity is not a reason to go standalone**. An app with
six tabs + a complex editor + a settings tree is perfectly happy as a
host-mode guest. Just build the navigation inside the bundle.

### The actual demarcation criterion

Three load-bearing questions, in priority order:

1. **Does the app need hardware control or timing the host can't
   mediate?** Concrete examples:
   - Sub-millisecond BLE/NFC interleaving (proof-of-location's
     signed beacon protocol; a hardware token's challenge-response).
   - Direct USB device control.
   - Raw socket access, low-level networking the host doesn't expose.
   - Heavy GPU / ML inference where the host's bridged API
     introduces unacceptable latency or memory copies.
   - OS background work the host's FG-service contract can't
     express (e.g. continuous foreground audio recording during a
     phone call).

   If yes → **standalone**. The host's mediation budget is the
   constraint; you can't bypass it from inside.

2. **Does the app need OS-level integration the host doesn't
   project?** Concrete examples:
   - Registering as an Android share-sheet target (so other apps
     can "share to" your app).
   - Registering as a content provider for system-wide search /
     file-pickers / contacts / calendar.
   - Accessibility services or input methods.
   - Default-app status (default browser, default SMS, etc.).

   If yes-and-significant → **standalone**, OR host-mode + a thin
   companion APK whose only job is OS-integration glue (delegates
   to the host's running guest via intents). The companion-APK
   pattern is more work than it sounds; default to standalone if
   OS-integration is core.

3. **Does the app need its own update / release cadence,
   independent of the host?** Some apps need to ship daily (a
   feed-style app with rapidly-evolving content rules), or against
   their own SLAs (a developer's commercial product). Inside the
   host, every guest is implicitly tested against the host API
   version it targets; major host updates can force re-testing.

   If yes → **dual-publication**. Ship the app standalone *and* as
   a host bundle.

If none of the above apply → **host-app, default**. Adding internal
tabs / sub-navigation inside the bundle covers most "I want a richer
UI" cases.

### A fourth question that's actually about distribution, not
### architecture

**Will users discover and install this app without already having
the host?** If yes (consumer discovery, viral growth, "just install
this APK from F-Droid") → **dual-publication** is the right answer
regardless of (1)-(3). Same JS code, two artifacts: one
`.agentapp` bundle for host users, one thin standalone APK for
non-host users. The standalone APK bundles a minimal in-app host
runtime so it can run alone.

This is independent of the architectural fit; it's a market-reach
decision. Most agent-SDK apps will want this as long as the host's
install base is small.

### Decision flow

```
Does the app need hardware/timing the host can't mediate?
├── yes → STANDALONE (host can't run it well)
└── no
    │
    Does the app need OS-level integration (share-sheet, content
    provider, accessibility)?
    ├── significant   → STANDALONE (or host + companion APK)
    └── none / minor
        │
        Does the app need an independent release cadence?
        ├── yes → DUAL-PUBLICATION
        └── no
            │
            Need to reach users who don't have the host?
            ├── yes → DUAL-PUBLICATION
            └── no  → HOST-APP (default)
```

### Applied to the seven projects + existing apps

| App | Recommendation | Reason |
|---|---|---|
| Stoop (`apps/stoop`) | **Dual-publication** — host-mode primary, standalone APK for reach | Network/agent-heavy; cross-app intents to Tasks compound value; non-host users still need an entry point |
| Tasks (`apps/tasks-v0`) | **Dual-publication** | Same shape as Stoop; intents to/from Stoop are V1's flagship demo |
| Folio (`apps/folio`) | **Phone: dual-publication. Desktop: separate (out of host scope for V1).** | Phone-side Folio fits host cleanly; desktop Folio is its own runtime question (Electron/Tauri host deferred per the seed) |
| Notes app (`projects/01`) | **Host-app** | Pod-shaped editing, collaborative, no hardware loop. Internal tabs cover the editor / library / search |
| Neighborhood (`projects/02`) | **Host-app** | Closed-group + matchmaking; intents to Stoop are the main story |
| Import bridge (`projects/03`) | **Host-app** (revised) | Long-running OAuth + cron is fine inside the host's background-slice contract; `host.network.fetch` with declared external hosts handles the cloud APIs |
| Tasks (`projects/04`) | merges with `apps/tasks-v0` | — |
| Archive (`projects/05`) | **Host-app** | Read-side over pod; benefits from being callable via intents from other apps |
| Proof-of-location (`projects/06`) | **Standalone** | Hard real-time signed-beacon timing; host's mediation budget too tight (criterion 1) |
| Household (`projects/07`) | **Host-app** | LLM-as-agent + multi-member group; intents to Tasks compound; LLM inference itself delegates to Private LLM via intents (criterion-2-clean) |
| Private LLM (`projects/00`) | **Standalone**, exposes a service API the host can call | Model management UI + GPU access (criterion 1); registers an `llm.complete` intent receiver so host-mode apps reach it via the intent registry |

Note the revisions vs the prior table: Folio is dual-publication
(was "standalone-leaning" — wrong, that conflated phone-side with
desktop-side); Import bridge is host-app (was standalone — its
service-shape fits the background-slice contract just fine).

## V1 scope (concrete)

The **smallest host that proves the model**:

1. Android shell (Kotlin) with one WebView per guest, sandboxed.
2. JS bridge implementing `host.identity`, `host.pod`, `host.agent`,
   `host.storage`, `host.network`, basic `host.hardware`
   (notifications + camera + GPS + BLE).
3. Manifest parser + permission card UI.
4. Capability-token enforcement on every bridged call.
5. Single foreground service with relay socket, BLE scan, cron.
6. Background-slice contract for `msg-kind` and `cron` wake-ons.
7. Audit timeline as the home screen (L1-L2 monitoring substrate).
8. App tile grid with capability badges; one persona for V1
   (multi-persona is V1.5).
9. **One real guest**: Stoop V2, ported to host-mode by replacing
   its RN imports with `@host` imports. The host runs Stoop V2
   unmodified-in-business-logic.
10. Sideload-from-URL install flow (no catalog yet).

Out of V1: open-web mode, GeckoView, multi-persona, intent registry,
pod-side `.agentapp` catalogues, encrypted backup/restore. Each
becomes its own follow-up phase.

## Open questions parked

- **Recovery / re-pair flow.** Encrypted pod-side backup + MFA on
  re-pair. Detailed design after V1 boots.
- **Intent-conflict resolution.** Default-receiver UI proposed
  above; richer policies (per-intent rules, time-of-day) deferred.
- **Background-slice budget calibration.** What `maxRunMs` is too
  low to be useful, too high to be safe? Empirical, tune with Stoop
  in V1.
- **Native-binding extension model.** Are new hardware bindings
  shipped only with new host versions, or via a plugin contract?
  Locked: ship-with-host for V1 (simpler); revisit if a guest
  genuinely blocks on this.
- **Multi-device.** Laptop today: web versions of guest apps,
  separate. Laptop tomorrow: Electron/Tauri host (deferred).
  Cross-device intent routing: not for V1.
- **Pod-side app catalogue spec.** `solid://.../catalogue.json`
  format — left for the catalogue phase. V1 just sideloads.
- **Naming + branding.** Working name "Agent Host" placeholder.

## Sibling docs

- [`./design-2026-05-07.md`](./design-2026-05-07.md) — original Browser seed
- [`./unified-host-feedback-2026-05-07.md`](./unified-host-feedback-2026-05-07.md) — feedback dialogue this sketch incorporates
- [`../AgentHub/agent-hub-design-2026-05-05.md`](../AgentHub/agent-hub-design-2026-05-05.md) — Hub fundament (the broker side)
- [`../AgentHub/monitoring-design-2026-05-07.md`](../AgentHub/monitoring-design-2026-05-07.md) — audit / monitoring substrate (powers the timeline)
- [`../projects/README.md`](../projects/README.md) — project-wide Hub-compatibility rules + phone-app update
- [`../Substrates/L0-react-native.md`](../Substrates/L0-react-native.md) — the RN binding catalogue the host's hardware API leans on

# Folio V1 — Mobile functional design (2026-05-11)

> What the **mobile** version of Folio does for a user,
> post-standardisation. Describes the state after the Hub-free
> interim path ships (P0–P3 + non-Hub portion of P5 of the
> [standardisation plan](../standardisation-plan-restructured-2026-05-10.md)).
> Web companion: [`v1-web-functional-design-2026-05-11.md`](v1-web-functional-design-2026-05-11.md).
>
> V0 baseline is the current `apps/folio-mobile` release —
> Folio.C2, RN screens + auth + plain-TextInput editor on top
> of Folio.C1's pluggable RN engine adapters. V1 inherits that
> surface unless this doc overrides it.

## 1. Pitch

Folio on a phone is the same Solid-pod-backed notes app as
the desktop, with three things the phone unlocks: **quick
capture** (jot a note while walking, sync on connect),
**OIDC sign-in** to your pod (already working via
`@canopy/oidc-session-rn` — Folio is the canonical mobile
consumer of this substrate), and **share-a-note via OS
share-sheet** (paste a markdown excerpt into chat, send a
capability token to a contact). V1 keeps everything V0 did
and adopts the standardised substrates: the C1 pluggable
engine adapters move inside pseudo-pod V1 (P3); notes gain
canonical `note` type with cross-pod refs; the mobile agent
registers in the user's agent-registry resource.

Folio's mobile transition is the **lightest** of the three
apps' mobile transitions — it already uses `oidc-session-rn`,
already uses `sync-engine` via Folio.C1's pluggable engines,
already runs pod-attached. V1 is mostly substrate-side work
that doesn't change the user experience visibly.

## 2. Scope locks

These are decided 2026-05-11 and shape the rest of the doc:

1. **Architecture:** native Expo / React Native, parallel to
   `apps/tasks-mobile` and `apps/stoop-mobile`. Folio-mobile
   is the **pattern source** for the RN service-factory shape
   (other apps adopt Folio's `serviceFactory` pattern).
2. **Pod-attached is required.** Same scope lock as web V1:
   no no-pod mode. Mobile starts with sign-in (OIDC via
   `oidc-session-rn`) before any note browsing.
2a. **Offline-while-pod-attached is first-class (locked 2026-05-11).**
   Mobile is the canonical "offline happens often" case
   (commuting, basement, abroad, weak signal). The pseudo-pod's
   cache mode + write-through queue (pseudo-pod V1) keeps the
   editor functional: every note save writes to the local
   `expo-file-system`-backed pseudo-pod immediately, queues for
   pod upload, and drains on reconnect. The Quick-capture flow
   (§4c) was designed around this. See plan §II.6 graceful-
   degradation block. Upload-on-behalf is **open V2 work** — see
   plan §II.6 + substrates §4.4.6.
3. **Identity vault:** `KeychainVault` on iOS would be the
   path; on Android, the `@canopy/react-native` keychain
   wrapper. Same as Folio.C2 today.
4. **Sync inherits from pseudo-pod V1 (P3).** Folio-mobile is
   the **first consumer** of pseudo-pod V1's RN write-through
   queue. Existing `backgroundTasks.js` foundation auto-
   registers via the new substrate.
5. **`note` type + canonical YAML frontmatter** carries from
   the web V1 doc.
6. **Hub-discovery is a runtime check** (post-P4). When the
   Hub is installed, Folio-mobile registers as a bundle.
   Pre-Hub, Folio-mobile runs standalone with its own OIDC
   session.
7. **No iOS** (per main project lock).
8. **Markdown preview / syntax highlighting deferred** to
   V2 (current scope lock from V0).

## 2a. Composition (what we import from the web workspace)

Mobile is a **thin RN shell over the same app-level code as
the desktop daemon** — Folio's `SyncEngine` subclass, the
note-specific frontmatter parsing, the share-via-cap-token
flow, the PathMap, and the locales are imported unchanged
from `@canopy-app/folio`. This is the **platform-shell
exception** locked in
[`conventions/architectural-layering.md`](../conventions/architectural-layering.md#shared-ui-glue-helpers-between-platform-shells-locked-2026-05-10),
shared with Tasks + Stoop's mobile shells. Folio is the
**pattern source** for this exception — Folio.C1's
pluggable-engine + service-factory shape was the first
example.

What mobile imports from `@canopy-app/folio` (the desktop
app workspace, not a substrate):

- **SyncEngine subclass.** The Folio-specific subclass over
  `@canopy/sync-engine.SyncEngine` that adds markdown
  frontmatter parsing + link extraction + `embeds` field
  handling. Mobile uses the same subclass with RN-side
  engine adapters (FS / hash / watcher) from
  `apps/folio-mobile/src/adapters/` — the pluggable-engine
  pattern.
- **RN service factory.** The C1-era `serviceFactory` shape;
  Folio publishes it via `./rn/serviceFactory` for mobile to
  consume. Mobile's `ServiceContext` wraps this.
- **`note` type schema** + frontmatter contract (P2 onwards
  via `item-types`).
- **Share flow.** `share <note> --to <agent>` issuing a
  `PodCapabilityToken` — mobile's Share screen drives the
  same skill via the `useSkill` hook.
- **Locales** (when V1 ships them). `apps/folio/locales/
  {en,nl}.json` shared; mobile-only strings in
  `apps/folio-mobile/locales/{en,nl}.json`.

What mobile adds on top (the RN-specific layer):

- **Screens** — every RN screen in `apps/folio-mobile/src/
  screens/`. The screens compose the desktop's skills +
  helpers into React Native components.
- **RN engine adapters** for the Folio.C1 pluggable-engine
  pattern: `expo-file-system`-backed FS adapter, RN watcher
  adapter, hash helper.
- **Native modules** — `KeychainVault`,
  `FileSystemAdapter`, `AsyncStorageAdapter`, push bridge
  (when V1 ships push).
- **Mobile substrates** — `oidc-session-rn` (already in V0;
  Folio-mobile is the canonical consumer), `react-native/
  localisation`, `react-native/push` (V1).
- **Share-sheet integration** — Android intent handler for
  inbound paste / share-to-Folio.

The cross-app dep on `@canopy-app/folio` is **the only
mobile-specific cross-app import**; everything else is via
shared substrates in `packages/`. Mobile doesn't fork any
desktop-version code.

## 3. What's the same as desktop

Every capability from
[`v1-web-functional-design-2026-05-11.md`](v1-web-functional-design-2026-05-11.md) §3
ships on mobile too, with the same substrates underneath
(via the composition in §2a):

- Pod sign-in (via `oidc-session-rn`).
- Bidirectional sync (now via pseudo-pod V1).
- Pod write paths with `If-Match` / conflict detection.
- PathMap for local-FS ↔ pod-URI mapping.
- Capability-token share — accept inbound tokens, issue
  outbound tokens.
- Cross-pod refs in note frontmatter (`embeds: [{type,
  ref}, …]`).
- Agent registration in the agent-registry pod resource.

What's **not** the same:

- **Notes folder shape.** Mobile uses `expo-file-system`'s
  scoped storage (per Android's storage-access conventions);
  the abstract `folder` concept is implemented as an Expo
  document directory by default, with a user-pickable
  "Documents" folder for users who want to interoperate
  with another local app like Obsidian (`expo-document-
  picker`).
- **Editor.** V0's plain `TextInput` carries forward in V1;
  monospace + line wrapping. Markdown preview deferred.
- **CLI.** Mobile has no CLI; provisioning happens via
  on-screen wizards.

## 4. What's different on mobile

### 4a. OIDC sign-in is the gate

Folio-mobile boots into the sign-in screen by default
(when no session exists). `oidc-session-rn` handles the
flow via `expo-auth-session`. Success → fetches pod URI
from WebID profile → triggers initial pull from pod into
local scoped storage.

### 4b. Background sync (push-triggered + scheduled)

Today's V0 has the `backgroundTasks.js` foundation but
isn't auto-registered. V1 turns this on:

- **Push notification on remote update.** The pod
  notifies via web push when something changes (P3
  ships the envelope path); the OS wakes the app long
  enough to drain the pseudo-pod write queue.
- **Scheduled fallback.** `expo-task-manager` runs every
  X minutes when push is unavailable. Default X = 60
  minutes; user-configurable.

### 4c. Quick capture screen

V1 adds a "Quick capture" screen (FAB on the note list).
Tap → enter a note title + body. Saves to local; sync
queue drains in the background. No friction for the
"jot a thought" use case.

### 4d. Share-sheet integration

Android share-sheet receives plain text / URL / image →
opens Folio-mobile → "Save to a new note" with the
contents pre-filled. Useful for capturing snippets from
the browser, a chat, or a photo.

### 4e. Cross-pod ref rendering on mobile

A new note's "See also" section shows embed chips inline
above the body. Tap → opens the right app (deep-link or
Hub-mediated, depending on whether the Hub is installed
and registered).

### 4f. Hub-discovery (P4+)

When the Hub is installed, Folio-mobile registers as a
bundle on launch via AIDL. The Hub-Android takes over
transport ownership; one foreground-service notification
per device instead of Folio's own. Hub's unified inbox
shows Folio's notes alongside other apps' items.

### 4g. Per-device settings

Mobile has its own deviceId + per-device settings:

- `syncCadenceMinutes` — background sync frequency
  (default 60).
- `pushEnabled` — whether to subscribe to pod-side push
  on note changes (default true).

Shared settings (synced via the pod's settings resource):

- `notesFolderName` — friendly name for the user's note
  collection (default "Notes").
- `defaultLanguage` — for the locale resolver.

## 5. User journeys

### Journey 1 — First sign-in

1. Install Folio-mobile.
2. Welcome screen: "Sign in to your Solid pod."
3. Pick provider (Inrupt, self-hosted, …) → OIDC flow runs
   via `expo-auth-session`.
4. Success → pod URI fetched from WebID profile → first
   pull from pod into scoped local storage.
5. Note list loads.

### Journey 2 — Quick capture while walking

1. Tap FAB → "Quick capture."
2. Enter title + body.
3. Save → returns to note list with the new note pinned.
4. Sync queue drains in the background; pod updates within
   ~30s under good network.

### Journey 3 — Editing an existing note

1. Tap a note → editor opens with `TextInput`.
2. Edit body / frontmatter.
3. Auto-save on a debounced timer (5s after last keystroke);
   manual save button also present.
4. Pseudo-pod V1's write-through queue pushes to pod.

### Journey 4 — Conflict from another device

1. Anne edited the same note on laptop while mobile was
   offline.
2. Mobile reconnects; pseudo-pod's write-through detects
   `If-Match` failure on push.
3. Folio-mobile writes a conflict file
   (`note.md.conflict-...`) preserving mobile's edit; shows
   a "Conflict on note X — open?" banner.
4. Tap banner → opens the conflict file alongside the
   merged one; user resolves manually.

### Journey 5 — Receiving a shared note

1. Anne shares "Plant care guide" via Folio web → emits a
   `PodCapabilityToken`.
2. Anne pastes the token into a Stoop chat to Bob.
3. Bob's Folio-mobile gets a push notification ("Anne shared
   a note with you" — encoded in the push payload as the
   token).
4. Bob taps notification → Folio-mobile opens the import
   screen → "Accept into my pod?" → tap accept → note
   saved to `<bob-pod>/sharing/from-anne/plant-care.md` →
   shows in the note list.

### Journey 6 — Cross-pod ref to a Tasks task

1. From the note editor, tap "Add ref" → search → picks a
   Tasks task from her own Tasks crew.
2. Frontmatter `embeds` updates; the "See also" section
   renders the task chip.
3. Tap the chip → opens Tasks-mobile (if installed) at the
   task's detail screen.

### Journey 7 — Backup via mnemonic (rare path)

1. Anne loses her phone (and didn't have web-console
   recovery wired up).
2. New phone: install Folio-mobile → "Restore from
   mnemonic" → enter 12 / 24 words.
3. Mnemonic → vault rebuilt → fetches encrypted vault blob
   from pod's `/private/identity-vault` → OIDC continues
   from there.
4. First sync re-populates local scoped storage from the
   pod.

## 6. Screens

V1 ships these screens:

| Screen | V0 equivalent | Notes |
|---|---|---|
| Welcome / Sign-in | V0 sign-in | OIDC flow via `oidc-session-rn` |
| Restore (mnemonic) | V0 restore | 12 / 24-word input |
| Note list | V0 list | Filter / search / FAB-capture |
| Note editor | V0 editor | TextInput + frontmatter section + **"See also" embed chips** |
| **Quick capture** | new | Title + body inline; FAB on note list |
| **Import token** | new | Accept inbound `PodCapabilityToken` from share-sheet or paste |
| Share | V0 share | Issue a capability token + show as text + OS share-sheet integration |
| **Conflict resolver** | new | Side-by-side view of conflict + original |
| Settings | V0 settings | Sync cadence + push toggle + notes folder + locale + sign-out |
| Sync status | V0 sync | Manual trigger + last-sync timestamp + pending queue size |
| Profile | V0 profile | WebID + agent registration status + recovery phrase |
| About | V0 about | Version + identity ID |

Twelve screens — V0's set plus three new (Quick capture,
Import token, Conflict resolver). All other V0 screens
carry forward.

## 6a. Implementation status (refreshed 2026-05-14)

V0 ships today (Folio.C2 — Phase C deliverable). V1 work is
the standardisation transition + the three new screens.
Multiple substrate pieces shipped 2026-05-14; this table is
refreshed accordingly.

| Phase from plan | Mobile-specific work | Status (2026-05-14) |
|---|---|---|
| P0 | n/a | n/a |
| P1 | route through pseudo-pod V0 substrate (transparent); read storage-mapping from pod via pseudo-pod; cross-pod refs in note frontmatter | **substrate ready; app wiring pending** — pseudoPod V0 + pod-routing + notify-envelope shipped 2026-05-14. Folio-mobile still uses `sync-engine-rn` directly today |
| P2 | adopt `item-types` for `note` type | **substrate ready; app wiring pending** — Q-A shipped (`item-types` + canonical vocabulary). Folio note schema needs to land in `packages/item-types/src/note.js` |
| P3 | **first consumer of pseudo-pod V1** — Folio-mobile's C1 RN engine adapters become pseudo-pod V1 RN adapters; sync-engine retires into substrate | **deferred to V2** — Folio-mobile's existing C1 pluggable engines + `sync-engine-rn` keep working unchanged until substrate-side P3 absorption lands |
| 52.14 (Q-D) | Lamport `_v` on note writes via pseudoPod replication-ring | **substrate ready** — auto-applies once Folio-mobile writes via pseudoPod. `'stale-peer'` event would feed the new Conflict resolver screen |
| 52.15.5 | Multi-issuer pick on Sign-in screen via `<IssuerPicker>` from `@canopy/oidc-session-rn/picker` | **shipped 2026-05-15** — `apps/folio-mobile/src/screens/SignInScreen.js` drops in `<IssuerPicker value={issuer} onChange={setIssuer} />`. 79/79 Folio-mobile tests green at adoption commit |
| 52.16 | Sharing v2 — ACP/WAC grant on outbound share flow | **substrate ready** — `createClientSharing` from `@canopy/pod-client/sharing`. Mobile share screen can stay cap-token-only initially (cap-token via Stoop chat is the canonical flow); ACP grant is an additive future enhancement |
| 52.2.x | peer-fetch gates | **substrate ready** — when Folio-mobile exposes its own `fetch-resource` skill (e.g. for serving a note to a Tasks-mobile cross-ref), wire `capCheck` for inbound cap-token presence |
| P5 | adopt `agent-registry`; canonical app skeleton alignment | **substrate ready; app wiring pending** — agent-registry shipped 2026-05-14 (Phase 52.10). Mobile boot should `register({ kind: 'folio-mobile', deviceId, capabilities: ['fs-cache','push','background-sync'] })` once on first run |
| P4 (Hub) | `hub-discovery` + `hub-binding`; runtime-detect Hub | **deferred** (Hub track direction-only) |
| P6 (Hub) | register `note` renderer (compact: tag chip + title; full: editor + preview); Folio-mobile-as-bundle for the Hub | **deferred** (Hub track direction-only) |
| P7 (Hub) | bundle refactor (Folio last; smallest; confidence test) | **deferred** (Hub track direction-only) |

Plus new V1 screens — these are app-side UI work, independent
of substrate adoption:
- Quick capture
- Import token (share-sheet integration)
- Conflict resolver — should subscribe to pseudoPod's
  `'stale-peer'` event (52.14) to surface conflicts as a banner

**Folio-mobile V1 adoption — shipped 2026-05-15:**

- ✅ **Phase 52.15.5** — `<IssuerPicker>` adopted in
  `apps/folio-mobile/src/screens/SignInScreen.js`. Same drop-in
  pattern as Stoop-mobile.

**Deferred to Folio-mobile V2** (require sync-engine absorption /
pseudoPod adoption first):

- Phase 52.10 agent-registry on bundle bring-up
- Phase 52.14 `'stale-peer'` subscription + conflict-resolver
  screen
- Sync-engine-rn → pseudo-pod V1 absorption

**Independent V1 UI work** (not blocked by substrate adoption):

- Quick capture screen
- Import token + Android share-sheet handler

Cross-references:
- Substrate-side phase list:
  [`../Substrates/substrates-v2-coding-plan-2026-05-11.md`](../Substrates/substrates-v2-coding-plan-2026-05-11.md)
- Cross-app residuals + priority:
  [`../TODO-GENERAL.md`](../TODO-GENERAL.md) §"Standardisation residuals"
- Stoop-mobile's IssuerPicker adoption (reference example):
  `apps/stoop-mobile/src/screens/SignInScreen.js`

## 7. Locales

V0 is English-only. V1 adds locale support per the project
convention. `apps/folio-mobile/locales/{en,nl}.json` for
mobile-specific strings; `apps/folio/locales/{en,nl}.json`
for shared strings (when V1-web ships them).

The `{text, doc}` leaf shape + the doc-field-mandatory rule
applies.

## 8. Open questions

- **Quick capture's offline behaviour.** Save to scoped
  storage + queue for sync, or fail if no pod connection?
  Default: save locally, queue. Pin during P1.
- **Background sync battery cost** under pseudo-pod V1's
  write-through queue. Measure on real devices during P3.
- **Conflict resolver UX.** Side-by-side diff with the
  built-in `react-native-diff` lib, or render both files
  separately with a "pick one or merge in editor" flow?
  Pin during V1.
- **Share-sheet handler scope.** What MIME types does Folio-
  mobile accept? Plain text + Markdown + (eventually) image
  with caption? Pin during V1.
- **Notes folder backup format.** Plain markdown files in
  scoped storage (Android's app-specific dir), or
  user-pickable folder via `expo-document-picker`? Default:
  app-specific dir; document-picker is an advanced
  setting for users who want to interoperate.

## 9. Non-goals

- **iOS-specific code paths** (per main project lock).
- **No-pod mode** (Folio is inherently pod-sync; see web V1
  doc).
- **Markdown preview / syntax highlighting** (deferred to
  V2).
- **Multi-account support** (deferred; V0 lock).
- **Bundle refactor pre-P7.**
- **Hub-attachment on iOS.**
- **Real-time collaborative editing.**

## 10. Phases

Phasing is the standardisation plan's §III.A; Folio-mobile
work mirrors §IV.3 of the transition doc. Folio-mobile is
positioned as the first consumer of pseudo-pod V1 (P3) and
the last adopter of the bundle shape (P7).

## 11. References

- Standardisation plan:
  [`../standardisation-plan-restructured-2026-05-10.md`](../standardisation-plan-restructured-2026-05-10.md).
- Transition doc:
  [`../standardisation-transition-2026-05-11.md`](../standardisation-transition-2026-05-11.md).
- Core functional design:
  [`../SDK/core-v2-functional-design-2026-05-11.md`](../SDK/core-v2-functional-design-2026-05-11.md)
  — what `packages/core` provides; Folio-mobile consumes
  `PodCapabilityToken` directly + composes via
  `@canopy-app/folio` for the SyncEngine subclass.
- Substrates functional design:
  [`../Substrates/substrates-v2-functional-design-2026-05-11.md`](../Substrates/substrates-v2-functional-design-2026-05-11.md)
  — per-substrate behaviour. Mobile-specific consumption
  points: §5.7 oidc-session-rn (Folio-mobile is the
  canonical consumer); §4.1 pseudo-pod (Folio-mobile is the
  first RN consumer of V1's write-through queue); §4.3
  pod-routing; §4.5 item-types (canonical `note` type);
  §4.6 agent-registry; §5.3 sync-engine + sync-engine-rn
  absorption.
- Web companion:
  [`v1-web-functional-design-2026-05-11.md`](v1-web-functional-design-2026-05-11.md).
- V0 (current) implementation:
  [`apps/folio-mobile/`](../../apps/folio-mobile/).
- Folio web (V0.3 source):
  [`apps/folio/`](../../apps/folio/).
- Sync-engine substrate:
  [`packages/sync-engine/`](../../packages/sync-engine/).
- OIDC mobile substrate:
  [`packages/oidc-session-rn/`](../../packages/oidc-session-rn/).
- Tasks-mobile (sibling RN):
  [`apps/tasks-mobile/`](../../apps/tasks-mobile/).
- Stoop-mobile (sibling RN):
  [`apps/stoop-mobile/`](../../apps/stoop-mobile/).
- RN platform layer:
  [`packages/react-native/`](../../packages/react-native/).
- iOS-out-of-scope:
  [main `README.md`](../../README.md#platform-support--ios-deliberately-out-of-scope-locked-2026-05-08).
- Layering convention:
  [`../conventions/architectural-layering.md`](../conventions/architectural-layering.md).

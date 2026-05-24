# Mobile roadmap — 2026-05-24 revision

**Supersedes** tasks #127–#131 (M.1–M.5), filed pre-substrate and now
stale. Drafted after the #219 + #218 session AND an audit of
stoop-mobile / tasks-mobile / folio-mobile substrate use.

## Headlines (the things we got wrong before)

1. **Two mobile apps are production-grade** (`stoop-mobile` V3,
   832 tests; `tasks-mobile` V1, 128 tests). A third (`folio-mobile`)
   is functional. `canopy-chat-mobile` is the actual gap.
2. **`@canopy/local-store`** (M.4 equivalent) and
   **`core.Agent.addTransport`** (M.5 architecture) shipped 2026-05-08.
3. **canopy-chat is a composition shell, not a feature factory.**
   `apps/canopy-chat/src/web/realAgent.js:31–33` literally imports
   `createBrowserTasksAgent`, `createBrowserStoopAgent`,
   `createBrowserFolioAgent` and runs all three on a shared
   `InternalBus`. The "features" in canopy-chat are just routing +
   reply-shape adapters on top of the same substrate skills the mobile
   apps already call.
4. **Mobile already has P2P via mDNS + BLE + Relay BUT canopy-chat-
   mobile NEEDS NKN.** Audit confirmed the existing RN apps wire:
   - `stoop-mobile`: mDNS LAN discovery + BLE fallback
     (`react-native-ble-plx`) + RelayTransport WebSocket broker.
     See `apps/stoop-mobile/src/lib/agentBundle.js:428–547` —
     `buildMeshAgent` composes `InternalTransport` + `MdnsTransport` +
     `RelayTransport`. No `nkn-multiclient`.
   - `tasks-mobile` + `folio-mobile`: same stack via shared bundle.

   **User decision 2026-05-24:** NKN-on-RN is NECESSARY for
   canopy-chat-mobile, not optional. mDNS only works on LAN; BLE only
   on proximity; RelayTransport needs a centrally-operated relay.
   Canopy's whole pitch is relay-less internet-routed mesh — that's
   NKN. **#223 is therefore a hard blocker for #222 (not parked).**
5. **VOORSTEL-uniforme-representatie is the spine.** The way to build
   canopy-chat-mobile is `renderMobile(mergedManifest) → NavModel`,
   then an RN shell that consumes it. No hand-port of the web UI.
6. **Thin RN layer around shared structural code.** User principle
   2026-05-24: structural parts of canopy-chat (handlers, dispatcher,
   adapters, manifest composition, agent bootstrap, thread state
   machine) MUST be portable code shared web↔mobile. The RN-specific
   layer should only contain: native UI primitives (View/Text/FlatList
   vs div/span/ul), navigation glue (React Navigation), input
   modalities (camera, BLE perms, push). This is a refactor of
   apps/canopy-chat/src/web/ — most of it is already portable
   (handlers from #217 ARE pure factories), but it lives under `/web/`
   which falsely implies web-only. Pre-step #221.5 below.

## Status of #127–#131 (the M.1–M.5 plan)

| Old | Subject | State | Disposition |
|-----|---------|-------|-------------|
| #127 | Q18 patch UX | Likely shipped via tasks-mobile V1 + stoop-mobile V3 | Replaced by **#220 audit** |
| #128 | `@canopy/chat-nav` RN parallel | Mis-framed — chat-nav is a DM thread state machine, not navigation | Dropped |
| #129 | canopy-chat RN renderer port | Wrong abstraction — projector, not port | Replaced by **#221 + #222** |
| #130 | Storage substrate split | Shipped as `@canopy/local-store` | Closed |
| #131 | RN transport bootstrap | Architecture shipped (`addTransport` seam); mobile transport already in use via mDNS + BLE + Relay | Closed (NKN-on-RN moved to optional **#223**) |

## Revised slices

### #220 — Substrate-parity audit: web↔mobile feature matrix

The audit during this revision produced a partial matrix. Promote it
to a checked-in doc and verify each row hands-on. For every row marked
"UI not confirmed":

- Does the mobile screen exist?
- Does it call the same substrate skill as the web equivalent?
- If gap: file a per-gap follow-up.

**Known gaps from the audit:**

- `editTask` (just shipped in #219) — declared in `mockTasksManifest`
  for web, no confirmed `tasks-mobile` screen.
- The 7 sub-task skills (#219 slice-b) — declared for web, no
  confirmed mobile UI (most likely tasks-mobile needs a sub-task
  spawn affordance + approval/decline inbox cards).
- Slash-command surface (#199 auto-suggest) — web-only by design;
  mobile equivalent is screen-centric. NOT a gap, but worth a
  decision on whether canopy-chat-mobile reintroduces slash on
  mobile or stays screen-centric.

**Output:** `apps/canopy-chat/docs/web-mobile-feature-matrix-2026-05-24.md`
with every row green or a follow-up task filed.

**Estimate:** ~2h audit + ~1h to file follow-ups.

---

### #221 — `renderMobile(manifest) → NavModel` projector

Sister to the shipped `renderChat` projector. Lives in
`packages/app-manifest/src/renderers/mobile.js`. This is THE load-
bearing piece — once it ships, mobile UIs across all apps stop
drifting from web because there's one source.

**Sequence (per VOORSTEL slice B):**

1. **household** — smallest manifest, byte-equivalent to `renderChat`
   already proven.
2. **tasks-v0** — richest verb set; will pressure-test the projector's
   `appliesTo` + `pickerSource` handling.
3. **stoop** — adds `surfaces.page` slot semantics (windows/panels —
   see #180).
4. **folio** — file-embed + Q29 receiver-actions stress test.

**Output shape (NavModel sketch):**

```js
{
  screens: [{
    id, title,
    view: { kind: 'list'|'detail'|'form'|'page', source: <listOp> },
    ops: [{ id, label, gate: <appliesTo>, pickerSource? }],
  }],
  inboxBadges: [{ op, source }],
  fab: { opId?, picker? },
}
```

**Conventions:**

- Every `label` field MUST come from a manifest `t()` key — no
  hardcoded strings ([[no-hardcoded-strings]]).
- Manifest's `appliesTo.type/state` becomes screen-level row
  visibility (same semantics as web row buttons from #178/#184).
- Node-portable: lives in `packages/app-manifest/src/` (no
  `*-node.js` markers, no RN deps) ([[node-portability-convention]]).
- Existing mobile apps' screens should be **migration targets**, not
  blockers — `tasks-mobile`'s task screens become `renderMobile`
  output gradually, screen by screen, behind a feature flag per
  screen.

**Tests:** vitest unit tests against fixture manifests (household,
tasks-v0, stoop, folio). Acceptance: each fixture round-trips to a
NavModel that an RN consumer can render without app-specific code.

**Estimate:** projector core ~4h; ~4–6h per app × 4 apps = ~1.5–2
focused days.

---

### #222 — `canopy-chat-mobile` RN app (composition shell, not feature build)

New Expo app. **Key insight from this session's audit:** canopy-chat
on web is ~600 lines of routing + adapters that compose three real
agents. The mobile version is structurally the same:

```js
// apps/canopy-chat-mobile/src/agentBundle.js
import { createBrowserTasksAgent } from '@canopy-app/tasks-v0/browser';
import { createBrowserStoopAgent } from '@canopy-app/stoop/browser';
import { createBrowserFolioAgent } from '@canopy-app/folio/browser';
// (These factories are platform-neutral despite the "browser" name —
//  they just need an InternalBus + LocalStore + transport.  The same
//  three pillars stoop-mobile already wires.)
```

Then layer:

- **RN chat-shell** — message bubbles, typing indicator, attachment
  picker, thread sidebar. Consumes the SAME `mergedManifest` web
  consumes via `renderChat` for slash + auto-suggest (#199 patterns
  port directly).
- **Per-screen navigation** — for users who don't want chat-modal
  for everything, `renderMobile(mergedManifest)` (from #221) gives
  them a familiar tab/stack UI. Both shells coexist; user picks.
- **Composition order** matches web: tasks → stoop → folio → calendar
  → household. Same skill dispatcher + same reply-shape adapters
  (lift them platform-neutral first if they aren't already).

**Apply this session's lessons:**

1. **Handler factory pattern (#217):** every RN screen handler is
   `({callSkill, sendPeer, logger}) => async (...args) => {...}`.
   Pure factories, easy to unit test, dependency-injected.
2. **Lazy thunks for TDZ avoidance:** wrap call-site references in
   `const callSkillLazy = (...args) => callSkill(...args)` when the
   handler is created before `callSkill` exists. Vitest passes when
   handlers import in isolation; the RN bundle dies. Mitigate with
   a **bundle-boot smoke test** that loads the actual app entry.
3. **Locale sweep from day one (#213):** every user-facing string
   through `t()` against `apps/canopy-chat-mobile/locales/en.json`
   + `nl.json`. Set the lint rule on green-field; cheaper than
   retrofitting.
4. **Thread shape parity:** DM threads, group threads, buurt threads
   share the chat-shell `Thread` shape so cross-tab semantics work
   cross-device too.

**Out of scope (deliberately):**

- iOS — Android-first per existing app convention ([[stoop-mobile]]
  et al).
- Pod sign-in — reuse existing OIDC flow from tasks-mobile/
  stoop-mobile.

**Blocked on:** #221.

**Estimate:** ~2 days for the skeleton + composition; full feature
parity is its own multi-slice arc tracked via the journey list below.

---

### #223 — NKN-on-RN transport (NECESSARY, BLOCKS #222)

User correction 2026-05-24: NKN-on-RN is essential, not optional.
canopy-chat's whole pitch is relay-less internet-routed mesh —
mDNS/BLE/Relay don't deliver that. canopy-chat-mobile cannot ship
without NKN-on-RN.

**Scope:** `packages/react-native/transport/nkn.js` wraps
`nkn-multiclient` and plugs into `core.Agent.addTransport()`. Must
inherit the #215 / 2026-05-24 fix in
`packages/secure-agent/src/createSecureAgent.js:513–740` — the
bilateral HI handshake awaits `tx.sendHello()` before
`helloedPeers.add(addr)`. Same correctness gate.

**RN-specific work:** `nkn-multiclient` is browser/Node code; on RN
it needs WebSocket + fetch polyfills (RN ships WebSocket native;
fetch may need `react-native-fetch-api` or a manual binary-frame
shim depending on nkn-multiclient version). Verify on a real Android
device before declaring done.

**Test gating:** `RUN_NKN_TESTS=1` (same flake-management as
#216/#218). Real device gives the truth.

**Estimate:** ~1.5–2 days including the RN polyfill work.

**Blocks:** #222 (canopy-chat-mobile cannot demo NKN flows without
this).

---

### #224 — Cross-device parity tests (two-phase per user choice)

The `test-browser/multi-device-journeys.spec.js` fixmes from #218
(5 scenarios) become the spec for **the same scenarios** on web ↔
mobile.

**Phase A — Playwright on Expo web** (start here):

- Fast, CI-friendly, reuses `apps/canopy-chat/test-browser/helpers.js`
  patterns.
- Tests less of the native stack but proves cross-surface semantic
  parity.
- Run with `pnpm exec playwright test --project=expo-web`.

**Phase B — Detox finalization** (after Phase A informs the API):

- Real-device authenticity for native-only failures (BLE perms,
  background sync, push wake).
- Gate behind `RUN_DEVICE_TESTS=1`.
- Same scenarios; the fixme bodies in
  `multi-device-journeys.spec.js` ARE the spec.

**Estimate:** Phase A ~1 day per scenario; Phase B ~0.5 day per
scenario.

## Mobile-specific user journeys

These are NEW journeys that the mobile context unlocks beyond what
web canopy-chat does. They should drive both `renderMobile` design
and the canopy-chat-mobile composition.

**JM-1 — Compose across apps in one chat.**
> Anne is in a buurt thread on her phone. Frits posts "Anyone got a
> ladder?" (stoop). Anne taps `[Help with]` → spawns a DM with Frits;
> mid-conversation, she clicks `[Convert to task]` → spawns a
> tasks-v0 task for "Bring ladder Saturday" in her household crew,
> with an embed-card linking back to the stoop post.

*Tests:* cross-app skill chaining (stoop respondToItem → DM →
tasks-v0 addTask); embed-card cross-app; thread sidebar shows both
threads.

**JM-2 — Offline post, online sync.**
> Anne loses signal while drafting a stoop post. She finishes it,
> hits send; canopy-chat-mobile queues it. Five minutes later she's
> back on Wi-Fi; the post fans out via mesh + her phone shows the
> ack from a neighbor who saw it.

*Tests:* IndexedDB write-queue (already in `@canopy/local-store`);
catch-up backfill on reconnect (Slice 5).

**JM-3 — Push notification → thread on tap.**
> Frits is asleep; Anne sends a DM. Push notification fires
> ("Anne: help with the ladder?"). Frits taps it; canopy-chat-mobile
> opens directly to the DM thread, scrolled to the new message.

*Tests:* `MobilePushBridge` already in `packages/react-native/transport/`;
need deep-link route → thread + scroll.

**JM-4 — BLE-proximity introduction.**
> Anne and Frits meet in person at a buurt meet-up. Both have
> canopy-chat-mobile open; BLE discovery surfaces "1 nearby
> neighbor" — they tap-to-trust (same `setContactTrust` skill as
> A4 web). Now they can DM cross-internet via NKN OR Relay.

*Tests:* `BleTransport` (already in stoop-mobile); contact trust
upgrade from `bekend` → `vertrouwd`.

**JM-5 — Camera embed in a post.**
> Anne posts "ladder available — pic for spec compatibility" in
> the buurt. Taps the camera icon → captures photo → embedded as
> a Folio file ref (Q29 receiver actions). Neighbors who tap the
> embed-card can `[Save to my pod]`.

*Tests:* RN camera permission flow; folio shareFolder / saveToMyPod
skill chain; embed-card render on mobile.

**JM-6 — Voice-memo DM.**
> Anne records a 15-second voice memo in a DM with Frits about
> when to drop off the ladder. Frits gets a play-button bubble;
> taps to listen. Audio is stored in Anne's pod, shared with Frits
> via the same file-share substrate.

*Tests:* RN audio recording; encode + chunk for NKN/Relay; folio
shareFolder skill with audio mimetype.

**JM-7 — Sub-task spawn from a chat about a parent task.**
> Anne's crew is doing "Saturday garden cleanup" (parent task).
> Mid-thread in canopy-chat-mobile, Frits says "I'll need someone
> to bring extra bags". Anne taps `[Spawn sub-task]` on the parent's
> embed-card — sub-task spawned via #219 substrate, Frits gets an
> inbox notification.

*Tests:* #219 sub-task skills end-to-end on mobile; inbox badge
update; embed-card `[Spawn sub-task]` button from
`mockTasksManifest`.

**JM-8 — Cross-device handoff: post from mobile, accept from laptop.**
> Anne posts a stoop request from her phone. Frits sees it on his
> laptop in canopy-chat (web). He clicks `[Help with]` → DM spawns.
> Anne replies from her phone (same identity, two devices). DM
> stays in sync via NKN/Relay.

*Tests:* multi-device identity (same WebID, two NKN addresses);
DM thread sync; the #215 HI-race fix is the prerequisite.

**JM-9 — Calendar invite from a stoop thread.**
> Mid-DM about the ladder pickup, Anne taps `[Schedule]` → opens
> calendar invite picker → sends invite for Saturday 10am. Frits
> taps `[Accept]` on the embed-card; both calendars sync (P3c
> calendar substrate).

*Tests:* calendar invite skill + RSVP cross-peer; embed-card
calendar render on mobile.

**JM-10 — Holiday mode silences the right things.**
> Anne flips holiday mode on (settings or `/holiday-mode`).
> Canopy-chat-mobile suppresses push notifications + marks Anne's
> tasks-v0 skill availability as off. Frits's view shows Anne
> grayed-out in the contact list.

*Tests:* `setHolidayMode` skill on mobile; push token suppression;
cross-tab visibility downstream.

## Critical-path ordering

```
#220 (audit, ~3h) ─┐
                   │
                   ├──→ #221 (renderMobile, ~1.5-2d) ─┐
                   │                                  │
                   └──→ #221.5 (portable-core lift) ──┼──→ #222 (cc-mobile, ~2d)
                                                      │   │
                                                      │   └──→ #224A (Playwright/Expo web)
                                                      │        │
                   #223 (NKN-on-RN, ~1.5-2d) ─────────┘        └──→ #224B (Detox)
                                                       (blocks #222)
```

#220 first (cheap; surfaces real gaps). #221 + #221.5 + #223 can run
in parallel in worktrees ([[subagent-worktree-discipline]]) — they
have no shared file conflicts. #222 starts only once all three land.

### #221.5 — Portable-core lift (NEW per user principle 2026-05-24)

User principle: "There should be only an rn-layer around the same
manifests/projectors/adapters." Most of `apps/canopy-chat/src/web/`
is already portable — the `web/` directory name is misleading.

**Audit reveals:**

| File | DOM-coupled? | Disposition |
|------|--------------|-------------|
| `handlers/catchUp.js` | No (pure factory from #217) | Lift to `src/core/handlers/` as-is |
| `handlers/meshIntros.js` | No (pure factory from #217) | Lift to `src/core/handlers/` as-is |
| `mockManifests.js` | No | Lift to `src/core/manifests/` |
| `mockAgent.js` | No | Lift to `src/core/agent/mock.js` |
| `realAgent.js` | Partial (`window.` refs) | Split: agent composition portable; web-specific bits stay in `src/web/` |
| `localBuiltins.js` | Check | Likely portable |
| `podStorage.js` | Check | Likely portable (uses fetch + IndexedDB; abstract behind a port) |
| `domAdapter.js` | Yes (by name) | Stays `src/web/` |
| `domForm.js` | Yes | Stays `src/web/` |
| `threadSidebar.js` | Yes (DOM render) | Split: state-machine portable, render web-only |
| `pagePanel.js` | Yes | Stays `src/web/` |
| `logsPanel.js` | Yes | Stays `src/web/` |
| `podAuth.js` | Yes (location/redirect) | Stays `src/web/`; RN needs separate auth impl |
| `wizards/*` | Likely DOM | Split: state machines portable, render web-only |

**Target directory structure:**

```
apps/canopy-chat/
  src/
    core/             # portable (web + RN both consume)
      handlers/       # ← lift from src/web/handlers/
      manifests/      # ← lift mockManifests + composition
      agent/          # ← split from realAgent (the portable half)
      threads/        # ← lift thread state machine
      wizards/        # ← lift wizard state machines
    web/              # web-only (DOM, vanilla)
      domAdapter.js
      domForm.js
      threadSidebar-render.js   # render half
      pagePanel.js
      logsPanel.js
      podAuth.js
      wizards-render.js
    rn/               # NEW: RN-only (under #222)
      RNAdapter.jsx
      RNThreadSidebar.jsx
      …
  web/                # web entrypoint (unchanged)
    main.js
```

**Conventions:**

- The lift is **mechanical** — no behavior changes, just file moves
  + import-path updates.
- Each lifted file gets a unit test that imports it from the new
  location.
- The web app keeps working after each step (small commits, run
  vitest + the auto-suggest Playwright test between each lift).
- Node-portable check ([[node-portability-convention]]) — anything
  that lands in `src/core/` must not import DOM, `node:fs`, etc.

**Estimate:** ~1 day total (mechanical refactor; well-tested code).

**Blocks:** simplifies #222 substantially.

## Session-specific lessons baked in (don't re-learn the hard way)

- **HI race**: `secure-agent` now awaits `tx.sendHello()` before
  `helloedPeers.add(addr)`. Lift the same pattern to any RN
  transport wrapping `nkn-multiclient` if/when #223 happens.
- **Vitest blindspot**: unit tests pass when handlers import in
  isolation; bundle-load failures (TDZ, missing exports, polyfill
  drift) need a smoke test that loads the actual entry.
- **NKN flakiness in headless**: gate behind env var
  (`RUN_NKN_TESTS` / `RUN_DEVICE_TESTS`). Manual smoke pacing on
  real device is the truth.
- **Handler factory pattern**: `makeFoo({callSkill, sendPeer, logger})`
  returning pure functions. Lazy-thunk dependencies not yet
  initialised when the factory is invoked.
- **Manifest as source of truth**: any new RN screen MUST come from
  the manifest, never hand-written. If something feels like it
  needs a custom screen, file a manifest-extension PR first.
- **Composition over re-implementation**: canopy-chat-mobile reuses
  the three existing app browser-factories on a shared `InternalBus`
  — same pattern as web canopy-chat. Don't rewrite features that
  already exist as substrate skills.

## Open follow-ups (not in this slice's scope)

- **#218 fixmes**: deep DOM helpers for create-group / join-group /
  embed-picker / calendar wizards (still TODO for web cross-tab
  tests). Cross-device tests (#224) will need the same helpers.
- **Manifest cross-app convergence**: the household → tasks-v0 →
  stoop → folio sequence in #221 will surface API-shape
  disagreements in `appliesTo` / `pickerSource` / `surfaces.page`.
  Plan a sync slice between apps.
- **Stoop deployment model shift**: stoop today is per-member Node
  install; target is browser-side agent ([[stoop-deployment-model]]).
  Doesn't block this roadmap but the eventual mobile-Stoop story
  changes when stoop ships its browser-agent.
- **iOS**: explicitly out-of-scope per [[stoop-mobile]] convention;
  revisit when there's a TestFlight need.
- **Slash on mobile**: canopy-chat-mobile could reintroduce slash
  via a "/" FAB. Worth a slice-level decision; mobile users may
  prefer screens, power users may want slash. Defer until #222
  ships and we can measure.

---

Memory references:

- [[platform-parity]] — web ≡ mobile for EVERY app
- [[manifest-driven-surfaces-endgame]] — user-confirmed endgame
- [[node-portability-convention]] — core portable; Node-only marked
- [[no-hardcoded-strings]] — every user-facing string via t()
- [[canopy-chat-smoke-pending]] — manual smoke owed for #219/#218
- [[subagent-worktree-discipline]] — parallel slices in worktrees
- [[tasks-mobile-substrate-parity]] — M0–M4 historical (shipped 2026-05-18)
- [[stoop-deployment-model]] — Node install today, browser agent target
- [[stoop-mobile]] — V3 production, Android-first, iOS deferred

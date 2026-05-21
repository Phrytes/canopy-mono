# Deferred plans — periodic review log

> **Last reviewed: 2026-05-02** (initial draft from a working-tree
> scan of TODO-GENERAL.md, coding-plans/, and per-app sketches).

This file collects work that has been **explicitly deferred or
parked** across the project — items that aren't blocking but
shouldn't be forgotten.  It complements:

- [`./architecture.md`](./architecture.md) — active "Remaining work"
  todo, organised by substrate / app.
- [`../TODO-GENERAL.md`](../TODO-GENERAL.md) — full SDK-level TODO
  list with rationale.

**How to use this file**: scan it periodically.  For each item, ask:
- Is the **trigger to revisit** met?  (Most items have one.)
- Has anything in the codebase changed that resolves it?
- Should it be promoted into `architecture.md`'s active todo, or
  closed?

Update the **Last reviewed** date at the top after each pass.

---

## Bucket A — SDK / transport-level (off the substrate plan)

These are SDK-core / `@canopy/core`, `@canopy/relay`, and
`@canopy/react-native` concerns.  They don't block the substrate
plan and don't fit cleanly in `architecture.md`'s per-substrate or
per-app todo, so they live here.

### A.1 — BT-only messaging reliability (Android BLE)
- **Status**: Parked 2026-04-24.
- **What**: Two-phone BLE-only messaging is unreliable on Android.
  Multiple hypotheses tried this session (write timing, GATT char
  size, MTU negotiation, central/peripheral role) — none fixed.
- **Trigger to revisit**: When a use case actually demands BT-only
  (offline mesh in a no-WiFi setting), or when someone has time to
  bisect against the Android BLE stack.
- **Source**: [`../TODO-GENERAL.md`](../TODO-GENERAL.md) §"BT-only
  messaging reliability" (~line 239).

### A.2 — Slim-Agent refactor
- **Status**: Parked 2026-04-25.
- **What**: Ergonomic refactor of the agent constructor surface
  (smaller, more composable).  Not a bug fix.
- **Trigger to revisit**: When the agent constructor's option soup
  starts hurting day-to-day work, or before the brand-rename pass
  (cheaper to do alongside).
- **Source**: [`../TODO-GENERAL.md`](../TODO-GENERAL.md) §"Slim-Agent
  refactor" (~line 360).

### A.3 — Production-ready relay
- **Status**: Open.
- **What**: Take the relay from local-dev shape to actually-hostable.
  TLS termination, deployment recipe, restart-survival of the
  multi-recipient queue, observability, rate-limiting.
- **Trigger to revisit**: When Track-I distribution starts (the
  private/managed-server topology drives final shape) OR when a real
  user wants to host their own relay.
- **Source**: [`../TODO-GENERAL.md`](../TODO-GENERAL.md)
  §"Production-ready relay for online deployment" (~line 316).

### A.4 — A2A interop verification
- **Status**: Open.
- **What**: Verify our A2A layer (in `packages/core/src/a2a/`) talks
  to a real third-party A2A agent — Anthropic's reference impl or
  another vendor's.
- **Trigger to revisit**: Before any public release; before claims
  about A2A compatibility.
- **Source**: [`../TODO-GENERAL.md`](../TODO-GENERAL.md) §"A2A interop
  verification" (~line 388).

### A.5 — Custom STUN / TURN server discovery
- **Status**: Open.
- **What**: WebRTC DataChannels behind carrier-grade NAT (CGN) need
  TURN.  Hard-coded public STUN insufficient for some networks.
- **Trigger to revisit**: When two-phone tests start failing on
  cellular networks (CGN), or when Track-I distribution offers a
  managed-TURN add-on.
- **Source**: [`../TODO-GENERAL.md`](../TODO-GENERAL.md) §"Custom
  STUN / TURN server discovery" (~line 629).

### A.6 — Periodic capability / skill refresh between peers
- **Status**: Open.
- **What**: Skill catalogues go stale across long-running peer
  connections.  Need a refresh protocol — pull, push, or both.
- **Trigger to revisit**: When users complain about stale skill
  lists, or when a new app's UX depends on live skill availability.
- **Source**: [`../TODO-GENERAL.md`](../TODO-GENERAL.md) §"Periodic
  capability/skill refresh between peers" (~line 579).

### A.7 — Agent / transport-card consistency audit
- **Status**: Open.
- **What**: Verify AgentCard fields match what transports actually
  emit at runtime (e.g. claimed transports vs. actually-bound
  transports).
- **Trigger to revisit**: Before public-release housekeeping.  Cheap
  audit if done before the brand rename.
- **Source**: [`../TODO-GENERAL.md`](../TODO-GENERAL.md) §"Agent /
  transport card consistency audit" (~line 602).

### A.8 — Routing layer revision
- **Status**: Open design question.
- **What**: The current `transportFor(peerId)` plus `RoutingStrategy`
  layering may need rework as more transports + tunnels land.
- **Trigger to revisit**: When adding a new transport, or when
  hop-tunnel routing edge cases multiply.
- **Source**: [`../TODO-GENERAL.md`](../TODO-GENERAL.md) §"Routing
  layer revision" (~line 702).

### A.9 — Reconnection strategy research
- **Status**: Open.
- **What**: Cross-transport backoff + reconnect after drops.  Currently
  per-transport ad-hoc.
- **Trigger to revisit**: When mobile-to-mobile sessions on flaky
  networks need reliability beyond what's there now.
- **Source**: [`../TODO-GENERAL.md`](../TODO-GENERAL.md) §"Reconnection
  strategy research" (~line 665).

### A.10 — Security follow-ups (cluster)
- **Status**: Multiple open items.
- **What**: Blind relay-forward (content privacy from bridges),
  hop-aware task tunnel, onion routing (anonymity from bridges),
  verified relay origin.
- **Trigger to revisit**: Before any threat-model claim that the
  current SDK provides anonymity-from-relays.  None of these block
  V0; they block stronger privacy guarantees.
- **Source**: [`../TODO-GENERAL.md`](../TODO-GENERAL.md) §"Security
  TODOs" (~line 725 onwards).

---

## Bucket B — SDK polish (future work, low urgency)

Items where the V1 design intentionally chose a simpler default and
the richer behaviour was deferred until a real consumer demands it.

### B.1 — Battery-aware reachability tuning
- **Status**: Deferred 2026-04-29.
- **What**: Q-G.2 locked oracle TTL at 5 min default.  Future:
  charging → tighter TTL, battery-saver → wider, backgrounded → pause.
  Same idea for push polling, IdentitySync, BLE duty cycle, relay
  reconnection backoff.  Centralised "power policy" object.
- **Trigger to revisit**: Defer until real-device telemetry shows the
  cost is worth measuring.
- **Source**: [`../TODO-GENERAL.md`](../TODO-GENERAL.md)
  §"Battery-aware reachability tuning" (~line 115).

### B.2 — Per-filetype write-conflict policy
- **Status**: Deferred 2026-04-29.
- **What**: Q-A.4 default = `'reject'`.  Future: per-content-type
  policy map (CRDT for markdown, append for audit logs, reject for
  binary).
- **Trigger to revisit**: When a Track-H app actually has the
  multi-content-type write surface that needs this distinction.
- **Source**: [`../TODO-GENERAL.md`](../TODO-GENERAL.md) §"Per-filetype
  write-conflict policy" (~line 135).

### B.3 — D5 ↔ A5 CSS integration test
- **Status**: Deferred 2026-04-28.
- **What**: CSS-backed (Community Solid Server) integration test for
  the D5 ↔ A5 path.  Currently env-gated; not in CI.
- **Trigger to revisit**: When a CI environment can spin up CSS,
  or before a public release.
- **Source**: [`../TODO-GENERAL.md`](../TODO-GENERAL.md) §"D5 ↔ A5
  CSS integration test" (~line 149).

### B.4 — External-store adapters for `writeWithConvention`
- **Status**: Locked 2026-04-28.  V1 ships `NoneStore` only.
- **What**: Big content (>1 MB by default) needs an external store.
  V1 has no adapter; apps must supply their own.  Future: S3, Drive,
  iCloud (reuses Track F OAuth-in-Vault), IPFS / Hypercore, or a
  pod-resident "blob container" adapter.
- **Trigger to revisit**: When the first app needs big-content
  handling.  Most likely H7 archive (photos / videos) or H6 import
  bridge (big email attachments).
- **Source**: [`../TODO-GENERAL.md`](../TODO-GENERAL.md) §"External-store
  adapters for writeWithConvention" (~line 172).

### B.5 — Track-F bidirectional live-sync
- **Status**: F2 v1 is explicitly one-way (source → target).
- **What**: Live-sync currently flows in one direction (designed for
  migration, e.g. Google Docs → pod move).  Bidirectional is a v2
  design conversation when a real consumer demands it.
- **Trigger to revisit**: When H6 sync mode (or another consumer)
  needs upstream-side writes.
- **Source**: [`../coding-plans/track-F-oauth-livesync.md`](../coding-plans/track-F-oauth-livesync.md)
  Q-F.3 lock.

### B.6 — Multi-transport claims (Track-G)
- **Status**: Deferred — Design-v3 §11 future work.
- **What**: AgentCards can claim multi-transport availability; the
  reachability oracle can verify across multiple paths.  Not
  critical for V0.
- **Trigger to revisit**: When a use case actually demands cross-
  transport verified reachability claims.
- **Source**: [`../coding-plans/track-G-reachability.md`](../coding-plans/track-G-reachability.md)
  §137.

---

## Bucket C — Folio-specific deferred

App-level deferred items for H1 (Folio).  These are tracked in the
Folio sketch's "Open work" section too — listed here so they're
visible at the project level for periodic review.

### C.1 — Sharing-layer migration: capability-token → ACP/WAC
- **Status**: Parked when the auth/* Inrupt migration shipped.
- **What**: Folio's sharing UX still uses the SDK's
  `PodCapabilityToken` model.  Real Inrupt-pod deployment wants
  ACP / WAC-native sharing.  Existing code keeps working; ACP path
  isn't wired.
- **Trigger to revisit**: When a Folio user wants to actually share
  notes with another Solid pod owner via the standard ACP UI in
  Inrupt's Pod Browser.
- **Source**: [`../coding-plans/track-H-app-folio.md`](../coding-plans/track-H-app-folio.md)
  §801 + §849.

### C.2 — Folio tray on GNOME (ship blocker for Linux)
- **Status**: Open 2026-04-29.
- **What**: Folio v2.7 menubar icon (via systray2) is hidden by
  default on modern GNOME Shell.  Workaround:
  `gnome-shell-extension-appindicator`.
- **Trigger to revisit**: Pre-ship QA on Ubuntu GNOME (likely most
  common Linux desktop our users hit).
- **Recommended fix**: Document in `apps/folio/src/tray/CHOICE.md` +
  README, **plus** auto-detect GNOME at `folio serve` startup and
  surface a one-time notification.
- **Source**: [`../TODO-GENERAL.md`](../TODO-GENERAL.md) §"Folio tray
  — GNOME ship blocker" (~line 81).

### C.3 — Folio mobile background sync wiring
- **Status**: Skeleton exists, handler not wired.
- **What**: `apps/folio-mobile/src/rn/backgroundTasks.js` has the
  Expo-task-manager skeleton, but the background-fetch handler that
  fires `runOnce()` while the app is backgrounded isn't wired.
- **Trigger to revisit**: When users notice that pod changes don't
  arrive on the phone unless the app is foregrounded.
- **Source**: [`../coding-plans/track-H-folio-C1.md`](../coding-plans/track-H-folio-C1.md)
  §553.

### C.4 — Folio mobile on iOS
- **Status**: Deferred (no test hardware).
- **What**: Real-device validation only on Android (FP4) so far.
  iOS path needs an Apple Dev account + TestFlight/Xcode plumbing.
  RN code is meant to be cross-platform; untested.
- **Trigger to revisit**: When iOS test hardware becomes available
  or when an iOS user requests it.
- **Source**: [`../coding-plans/track-H-app-folio.md`](../coding-plans/track-H-app-folio.md)
  §1245.

### C.5 — CSS-backed integration tests for PodClient
- **Status**: Deferred (env-gated).
- **What**: `PodClient.css.test.js` exists but is gated behind an env
  var because CSS isn't installed in CI.
- **Trigger to revisit**: When CI gains a CSS spinup step (likely
  alongside Track-I distribution work) or before public release.
- **Source**: [`../coding-plans/track-A-pod-substrate.md`](../coding-plans/track-A-pod-substrate.md)
  §758.

---

## Bucket C+ — App-specific deferred (continued)

### C.6 — H2 V2 Phase 2: retire legacy HouseholdAgent + clean code organisation
- **Status**: Phase 1 shipped 2026-05-03 (additive coexistence —
  `HouseholdAgentFreeform` ships in `apps/household/src/` alongside
  the legacy `HouseholdAgent`; 416 tests passing).  Phase 2 deferred.
- **What**: Promote the V2 freeform design from "alongside legacy"
  to "the only path".  Seven ordered steps (per
  `apps/household/docs/EXPERIMENT-RESULTS.md` § "V2 Phase 2"):
  1. Move `scripts/lib/freetext-core.js` → `src/freeform/core.js`
     (clean up the cross-tier import the Phase 1 commit allowed).
  2. Add `cli.js serve --mode=freeform` (replaces "not implemented"
     scaffold).
  3. Wire scheduler into freeform agent — `addToList` /
     `removeFromList` emit state-update events for digests + nudges.
  4. Pod-backed store option (multi-device safety).  Currently only
     local-JSON-file persistence ships.
  5. localisation for user-facing strings (Dutch hard-coded today).  See
     also the multilingual extension path documented in
     `apps/household/docs/PROMPT-EXPERIMENTATION.md`.
  6. Deprecation warning on legacy `HouseholdAgent` constructor.
  7. Future: retire legacy code (delete `parsers/regexCommands.js`,
     `skills/classifyAndExtract.js`, fixed-type skills, `type` field
     from Store) + migrate ~50 type-bound tests.
- **Trigger to revisit**: (a) real-device TG feel test of
  `HouseholdAgentFreeform` confirms it's production-quality, AND
  (b) appetite for a focused refactor session.  No urgency before
  then — Phase 1 already unblocks production deployment of the
  freeform variant.
- **Estimated size**: 6–10 hours of focused work for steps 1–6;
  step 7 (legacy retirement) another 4–6.
- **Source**: [`apps/household/docs/EXPERIMENT-RESULTS.md`](../../apps/household/docs/EXPERIMENT-RESULTS.md)
  § "V2 Phase 2 — retire legacy".

---

## Bucket D — Substrate-side deferred design

### D.1 — Anonymity protocol design pass (Q-H5)
- **Status**: Parked since Phase A start.
- **What**: H5 (neighborhood) V0 ships non-anonymous.  V1+ wants
  anonymity-with-mutual-consent: anonymous skill-browse, two-sided
  identity-reveal handshake, spam/abuse policy that doesn't undermine
  anonymity.  New protocol layer above sealed-forward.  Not designed.
- **Trigger to revisit**: the author has explicitly noted "thoughts to
  share when unparked" — needs a design conversation, not code.
- **Source**: [`./apps/H5-neighborhood.md`](./apps/H5-neighborhood.md)
  §"Anonymity protocol", [`./use-cases.md`](./use-cases.md) §"NEW:
  anonymity-with-mutual-consent".

### D.2 — Q-H3 LLM choice (may be informally locked)
- **Status**: Documented as parked; may already be informally
  resolved.
- **What**: H2 V2 / H3 LLM choice was parked at "Llama 3.x via Ollama
  / Mistral / closed providers".  This conversation tested
  `qwen2.5:3b` and `qwen2.5:7b-instruct` against the household's
  smoke benchmark; user-side preference appears settled but no doc
  has been updated to "locked".
- **Trigger to revisit**: Confirm informal lock + update
  `track-H-design-sketches.md` Q-H3.1.  Easy housekeeping.
- **Source**: [`../coding-plans/track-H-design-sketches.md`](../coding-plans/track-H-design-sketches.md)
  §570.

---

## Reference

For active work, see [`./architecture.md`](./architecture.md)
§"Remaining work — consolidated todo".  For SDK-level details on
the items in buckets A + B, the source-of-truth is
[`../TODO-GENERAL.md`](../TODO-GENERAL.md) (line numbers are
approximate; sections are stable enough to grep).

When promoting an item from this file to `architecture.md`'s active
todo, leave a stub here with a `→ promoted YYYY-MM-DD` note rather
than deleting outright — the historical context (why something was
parked, what triggers revisit) is the value of keeping this log.

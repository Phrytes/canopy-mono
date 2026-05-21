# Substrate refactor — execution checklist

> **For interrupted sessions:** scan this file from the top. The first
> unchecked box is where to resume. Update boxes (`- [ ]` → `- [x]`) as
> work completes. Each phase has a quick "verify" command at the end so
> the next session can confirm prior work didn't regress.
>
> **Source of truth:** the per-substrate detail docs in this directory
> (`L1a-…` through `L1j-…`) describe the *what*. This checklist is the
> *order*. If they conflict, the detail docs win — update this checklist
> to match.

| | |
|---|---|
| **Created** | 2026-05-04 |
| **Owner** | unassigned |
| **Total estimated effort** | ~22–25 working days |
| **Final goal** | resume `Project Files/coding-plans/H5-V2-resume.md` step 3 |

---

## Phase 0 — SDK pre-requisite fixes

Block multiple substrate refactors. Do these first.

- [x] **Fix `SolidPodSource.list({recursive: true})`** in `packages/core/src/storage/SolidPodSource.js:387` to honour the `recursive` option (currently ignores `_opts`). Walk child containers when `opts.recursive === true`. Add a unit test in `packages/core/test/storage/SolidPodSource.recursive.test.js` (or extend existing). Blocks L1i V1 + parts of L1a `BidirectionalSyncEngine`. _Done 2026-05-04: BFS over child containers; race-deleted children skip silently; 3 new tests in `SolidPodSource.unit.test.js` (recursive happy-path, mid-walk 404, default-shallow regression)._
- [x] **Re-export `helloGates`** (`tokenGate`, `groupGate`, `anyOf`) from `packages/core/src/index.js`. Source: `packages/core/src/security/helloGates.js:23,42,71`. _Done 2026-05-04 in security section of `core/src/index.js`._
- [x] **Re-export `MemoryQueueStore`, `SqliteQueueStore`, `QueueStore`** from `packages/relay/index.js`. Source: `packages/relay/src/queueStores/{MemoryQueueStore,SqliteQueueStore,QueueStore}.js`. _Done 2026-05-04 — also added `GroupAuthVerifier` + `MultiRecipientQueue` re-exports while in there._
- [x] **Run all package test suites once** to confirm Phase 0 didn't regress. _Done 2026-05-04: 1239 core tests + 69 relay tests pass; SolidPodSource unit tests at 29 (was 26)._

**Receive-half audit + self-invocation fix (2026-05-04):**
- [x] **Audit `MobilePushBridge`.** Read `packages/react-native/src/transport/{MobilePushBridge.js,pushAdapters/*.js}`. Code quality good. Receive-half ships and works (16 unit tests passing).
- [x] **Fix self-invocation in `MobilePushBridge.#dispatch`.** Was wastefully calling `agent.invoke(self, ...)` which routes through the network and back. Now calls `skill.handler({parts, from, envelope})` directly. `envelope` is `null` because push payloads don't arrive via A2A — handlers wired to push entry points should not depend on envelope fields.

**Send-half build (2026-05-04, undeferred per user direction):**
- [x] **`PushSender` abstract** — `packages/relay/src/push/PushSender.js`. Best-effort, never throws, returns `{ok, error?}`.
- [x] **`ExpoPushSender` concrete** — `packages/relay/src/push/ExpoPushSender.js`. Calls `https://exp.host/--/api/v2/push/send` with `_contentAvailable: true` for silent wake. Optional access-token / endpoint override. 10 unit tests covering happy path, error response, network throw, batch shape, headers.
- [x] **`PushTokenRegistry`** — `packages/relay/src/push/PushTokenRegistry.js`. In-memory address → `{token, platform, registeredAt, lastPushedAt}`. 8 unit tests.
- [x] **Wire into `packages/relay/src/server.js`.** `startRelay` accepts `{pushSender, pushTokenRegistry?, pushThrottleMs?}`. New envelopes: `register-push-token` and `unregister-push-token` (require prior `register`). Wake fires on offline `send` AND on multi-deliver-to-disconnected (E2b path). Per-recipient throttle (default 30s).
- [x] **Re-export from `packages/relay/index.js`.** `PushSender`, `ExpoPushSender`, `PushTokenRegistry` are now public.
- [x] **Integration tests** — `packages/relay/test/push/server-push-wake.test.js`. 10 tests covering: register-requires-register, register/unregister round-trip, offline-send fires wake, online-send doesn't, no-token doesn't, throttling, sender errors are swallowed, push-not-configured rejection.
- [x] **Backward compatibility** — when `pushSender` is null/unset, the relay rejects `register-push-token` envelopes with a clear error and never attempts wake. All 97 existing relay tests still pass; all 1239 core tests still pass.

**Push-control wiring on `RelayTransport` (2026-05-04):**
- [x] **Add `RelayTransport.registerPushToken({token, platform})` and `unregisterPushToken()`** to `@canopy/core`. Methods ride the existing socket; resolve on relay ack; reject on timeout (5s) or relay error. 6 new tests in `packages/core/test/RelayTransport.push.test.js`. 1245 core tests pass (was 1239).

**Push-wake test scaffold for sdk-smoke (2026-05-04):**
- [x] **Add S11 — Push wake-up scenario** to `apps/sdk-smoke/src/scenarios/S11-push-wake.js`. Lazy-imports `expo-notifications` so missing peer-dep shows a clear SKIP rather than crashing the bundle. Lazy-imports `expo-constants` for the EAS project ID lookup. Composes `MobilePushBridge` + `ExpoNotificationsAdapter`, registers a `s11-wake` skill, ships token via `relay.registerPushToken`, waits up to 60s for the skill to fire.
- [x] **Add laptop-side scripts**:
  - `apps/sdk-smoke/scripts/relay-with-push.mjs` — starts a relay with `ExpoPushSender` + `PushTokenRegistry` wired. `npm run relay:push` from `apps/sdk-smoke/`.
  - `apps/sdk-smoke/scripts/trigger-s11.mjs` — laptop-side trigger that constructs an ephemeral `Agent`, calls `agent.invoke(<phone-pubkey>, 's11-wake', [])`. `npm run trigger:s11 -- <relayUrl> <phone-pubkey>`.
- [x] **Add deps** (`expo-notifications`, `expo-constants`, devDep `@canopy/relay`) to `apps/sdk-smoke/package.json`; **add iOS background mode + plugin config** in `app.json` (`UIBackgroundModes: ["remote-notification"]`, `expo-notifications` plugin, `extra.eas.projectId` placeholder).
- [x] **Write detailed test README** at `apps/sdk-smoke/scripts/README.md` — three-terminal setup, success criteria, full diagnosis table.

**Real-device test:** moved to Phase 8 (2026-05-04). Reason: requires a Firebase project + `google-services.json` + FCM v1 service-account credentials uploaded to Expo (per BRING-UP-NOTES.md Trap 18 — Android push has no FCM-free path on a custom dev build). All code-level items in Phase 0 are complete and unit-tested; the deferred work is hardware validation only, which doesn't block any other phase.

**Verify Phase 0:**
```bash
grep -q "helloGates\|tokenGate" packages/core/src/index.js && echo "helloGates re-exported"
grep -q "MemoryQueueStore" packages/relay/index.js && echo "queue stores re-exported"
grep -q "if (opts.recursive)" packages/core/src/storage/SolidPodSource.js && echo "recursive list implemented"
```

---

## Phase 1 — Fast wins (parallelisable)

Independent, low-risk. Run sequentially or split across hands.

### L1g delete (~½ day) — DONE 2026-05-04
- [x] Migrate `apps/import-bridge-v0` from `@canopy/oauth-vault` to `core.OAuthVault`. Updated `Agent.js`, `connectors/GoogleDocsConnector.js`, `types.js` (JSDoc).
- [x] Migrate `apps/import-bridge-v0/test/integration.test.js` — set/get/registerRefresher → storeTokens/getTokens/registerRefreshFn; accessToken/refreshToken → access/refresh; dropped the `now` injection (uses real `Date.now()` since core.OAuthVault has no clock seam).
- [x] Delete the package: `rm -rf packages/oauth-vault/`.
- [x] Remove `@canopy/oauth-vault` from `apps/import-bridge-v0/package.json`; add `@canopy/core`.
- [x] No root `package.json` workspaces section to update (this monorepo uses file: deps directly).
- [x] Update `Project Files/Substrates/L1g-oauth-vault.md` — marked DELETED with full API-replacement reference table at top.
- [x] Update `apps/import-bridge-v0/README.md` — example code, substrate table, cross-links to refactor doc.
- [x] Verify: 8/8 import-bridge-v0 integration tests pass on `core.OAuthVault`.
- [x] Verify household still works on `core.OAuthVault` — 463/465 pass; the 2 failures are pre-existing (TelegramBridge inline_keyboard array nesting + e2e/llm-roundtrip non-existent-tool case), unrelated to L1g.

### L1c chat-agent polish (~½ day) — DONE 2026-05-04
- [x] Swap `node:events` → `core.Emitter` in `packages/chat-agent/src/ChatAgent.js:20` AND `:108` (extends).
- [x] Add `@canopy/core` to `packages/chat-agent/package.json` deps (was missing).
- [x] Delete orphaned `packages/chat-agent/src/ChatAgent (Copy).js`.
- [x] Run `npm test` in chat-agent — 24/24 pass.

**Verify Phase 1:**
```bash
test ! -d packages/oauth-vault && echo "L1g deleted"
grep -q "Emitter.*@canopy/core" packages/chat-agent/src/ChatAgent.js && echo "L1c on core.Emitter"
test ! -f "packages/chat-agent/src/ChatAgent (Copy).js" && echo "orphan removed"
```

---

## Phase 2 — Cross-cutting sweep (~1 day)

One pass across all substrates. Avoids per-substrate touch later.

### `node:events` → `core.Emitter` — DONE 2026-05-04
All four substrates swapped (`import { EventEmitter } from 'node:events'` → `import { Emitter } from '@canopy/core'`; `extends EventEmitter` → `extends Emitter`); `@canopy/core` added to deps where missing; reinstalled with `--legacy-peer-deps`; tests pass.

- [x] `packages/notifier/src/Notifier.js` (line 16 + line 28). Added `@canopy/core` dep. **32/32 tests pass.**
- [x] `packages/sync-engine/src/SyncEngine.js` (line 21 + line 27). Already had `@canopy/core` dep. **125/125 tests pass.**
- [x] `packages/identity-resolver/src/MemberMap.js` (line 10 + line 12). Added `@canopy/core` dep. **19/19 tests pass.**
- [x] `packages/item-store/src/ItemStore.js` (line 20 + line 34). Added `@canopy/core` dep. **30/30 tests pass.**
- [x] `packages/chat-agent/src/ChatAgent.js` — done in Phase 1.1.
- [x] **Verified clean:** `grep -rln "from 'node:events'" packages/*/src/` returns only `packages/core/src/storage/SolidVault.js` — that's INSIDE the SDK, not a substrate, so it's allowed (Node is a first-class runtime for core).

### Inline `ulid()`/`genId()` — DEFERRED 2026-05-04 with reason
**The audit's recommendation was wrong about equivalence.** `core.genId()` (in `packages/core/src/Envelope.js:91`) returns a **UUID v4**, not a sortable ULID. ULID's lexicographic-time-sort property is what the substrates depend on for ordering items by creation time. Naively swapping `ulid` → `genId` would silently regress the sort-by-id behaviour of item-store, notifier schedules, etc.

The right fix is one of:
- (a) Add a `genUlid` (or similarly-named sortable ID generator) export to `@canopy/core`, alongside `genId`. Substrates then import that. Mechanical lift afterwards.
- (b) Move one substrate's `ulid.js` (e.g. `packages/identity-resolver/src/ulid.js`) into core unchanged and re-export it. Mechanical.
- (c) Leave per-substrate ulid.js files as duplicates. Lowest cost; tolerable since the duplicate code is ~30 LOC each.

**Recommendation:** option (a) when next touching core. Until then, the per-substrate `ulid.js` files stay; substrate authors must NOT migrate them to `core.genId` blindly. Re-run this sweep after a sortable ID export lands in core.

The four `ulid.js` files that stay for now:
- `packages/item-store/src/ulid.js`
- `packages/identity-resolver/src/ulid.js`
- `packages/notifier/src/ulid.js`
- `packages/skill-match/src/ulid.js` (will be deleted during Phase 5 L1e refactor anyway)

### Migrate hand-rolled metro.config.js to the shared preset
- [ ] `apps/mesh-demo/metro.config.js` — hand-rolled, mirrors what `apps/sdk-smoke` had until 2026-05-04. Migrate to `withCanopyPreset` per `packages/react-native/docs/BRING-UP-NOTES.md` ⚠-callout. Folio mobile and (now) sdk-smoke are the canonical patterns to mirror. Real-device validate the migrated build before merging — mesh-demo's `android/` is committed and tweaked, so the preset switch must keep all trap fixes intact.
- [x] `apps/sdk-smoke/metro.config.js` — done 2026-05-04 (was the trigger for adding the BRING-UP-NOTES warning callout).

### `react-native-get-random-values` pin alignment — DONE 2026-05-04
- [x] `apps/sdk-smoke/package.json` line 36: `^2.0.0` → `^1.11.0` ✓
- [x] `apps/mesh-demo/package.json` line 32: `^2.0.0` → `^1.11.0` ✓
- All three RN apps now aligned with folio-mobile's `^1.11.0`. Future fresh installs no longer hit the `ERESOLVE` peer-dep error (RN 0.76.9 vs the package's `>=0.81` peer-dep on v2.x).

**Verify Phase 2 (already verified 2026-05-04):**
```bash
test -z "$(grep -l \"from 'node:events'\" packages/{item-store,notifier,identity-resolver,chat-agent}/src/*.js 2>/dev/null)" && echo "Emitter sweep clean"
grep -E '"react-native-get-random-values"' apps/{sdk-smoke,mesh-demo,folio-mobile}/package.json | grep -v "1\." && echo "STILL HAS ^2.x" || echo "all apps pinned to ^1.x"
```

**Phase 2 status summary (2026-05-04):**
- ✅ Emitter sweep: 4 substrates migrated, 206 tests pass total (32 + 125 + 19 + 30).
- ✅ `react-native-get-random-values` pin alignment in 2 apps.
- ⚠ ulid sweep DEFERRED — see "DEFERRED" subsection above for reason.
- ⏳ `apps/mesh-demo/metro.config.js` migration to preset still PENDING (committed `android/` + bundle-validated state means migration must be carefully validated; not safe to do in same session as other Phase 2 items).

---

## Phase 3 — L1d agent-ui refactor (~4 days)

**User-decided: lands BEFORE H5 V2 critical path** so apps run on real `core.Agent` + `A2ATransport` from the start.

Detail: `L1d-agent-ui-refactor.md`. Apps-rewrite handoff (the bulk of the work, deferred to next session): `L1d-apps-rewrite-handoff.md`.

### Phase 3.0 — Re-scope L1d sketch — DONE 2026-05-04
- [x] Updated `Project Files/Substrates/L1d-agent-ui.md` with the localhost-only framing + the deletion plan for the legacy primitives.

### Phase 3.x (SDK extension, additive) — DONE 2026-05-04
- [x] Add `host` option to `core.A2ATransport`. `packages/core/src/a2a/A2ATransport.js` constructor + `connect()` now accept `host` (defaults preserve all existing behavior — Node binds on all interfaces). Required for `mountLocalUi` to bind 127.0.0.1. 37/37 A2A tests pass.

### Phase 3.2 — Ship `mountLocalUi` — DONE 2026-05-04
- [x] New file `packages/agent-ui/src/server/mountLocalUi.js`. Thin wrapper: takes a real `core.Agent`, defaults `host='127.0.0.1'`, returns `{url, port, transport, stop}`. Rejects synthetic `{invokeSkill}` agent shapes with a clear error. Re-exported from `src/index.js` + `src/server/index.js`. Added `@canopy/core` to `packages/agent-ui/package.json` deps.

### Phase 3.4 — Ship `LocalAgentClient` — DONE 2026-05-04
- [x] New file `packages/agent-ui/src/client/LocalAgentClient.js`. Speaks A2A's wire shape (`POST /tasks/send`, `POST /tasks/sendSubscribe`, `GET /.well-known/agent.json`). No nacl, no identity. Optional `authHeader` callback for OIDC. Re-exported from `src/index.js` + `src/client/index.js`.

### Phase 3 — End-to-end test — DONE 2026-05-04
- [x] New file `packages/agent-ui/test/mountLocalUi.test.js`. Boots a real `core.Agent` over `InternalTransport`, mounts `mountLocalUi`, invokes via `LocalAgentClient`. Validates: bind on 127.0.0.1, OS-assigned port, TextPart round-trip, DataPart round-trip, agent-card discovery, `SKILL_FAILED` error path, synthetic-shape rejection. **8/8 tests pass.** Total agent-ui suite now 33/33 (25 pre-existing + 8 new).

### Phase 3.1 — Apps rewrite + legacy delete — IN PROGRESS

**Status:** the full handoff doc is at [`./L1d-apps-rewrite-handoff.md`](./L1d-apps-rewrite-handoff.md). Legacy primitives still exported (deprecated) until both apps migrate.

- [x] **`buildIdentitySkills` migrated to `defineSkill` shape** (returns array of `defineSkill` defs). 19/19 identity-resolver tests still pass.
- [x] **`apps/neighborhood-v0` migrated to real `core.Agent`** 2026-05-04. `Agent.js` uses `Agent({identity, transport: InternalTransport})` + `agent.skills.register(def)` for each lifted defineSkill. Skills handlers rewritten to `({parts, from}) → Parts.wrap(result)` shape — `from` carries the actor webid. Tests rewritten to `agent.skills.get(id).handler({parts, from})` direct calls, with itemStore.on for fan-out events. **9/9 tests pass.** Bundle no longer exposes `broadcaster` / `buildRouter` / `skills` map — apps that need HTTP exposure call `mountLocalUi(bundle.agent)`.
- [x] **`apps/tasks-v0` migrated to real `core.Agent`** 2026-05-04. Skills + tests + Agent.js rewritten. RolePolicy left at the ItemStore level (correct — that's L1b's responsibility, not L1d's). Read-skill round-trip via `mountLocalUi`+`LocalAgentClient` validated; write skills tested via direct `callSkill(...)` since the OIDC-→-actor-webid wiring (`LocalUiAuth`) is a future Phase 3.2 add-on. **21/21 tests pass.**
- [x] **`apps/archive` migrated to real `core.Agent`** 2026-05-04. `createArchiveWebServer` now uses `mountLocalUi` over a real `core.Agent`; archive skills (`archive.search/list/get/sources/stats`) registered as `defineSkill` definitions with `visibility: 'public'` (preserves the anonymous read access the legacy `DEFAULT_RESOLVE_ACTOR` had). Tests rewritten to use `LocalAgentClient` instead of supertest+`POST /api/skills/:id`. **96/96 tests pass** (was 99 — 3 dropped: 2 auth tests that tested the legacy `resolveActor` model, 1 broadcaster test that tested EventBroadcaster in isolation; all correctly migrated to A2A's auth + streaming-skill paths whenever `LocalUiAuth` lands).
- [x] **Legacy primitives deleted** 2026-05-04. Removed: `composeAgent.js`, `SkillRouter.js`, `EventBroadcaster.js`, `ctxActor.js`, `AgentUiClient.js` + their 5 test files (~290 LOC src + ~180 LOC tests). `agent-ui/src/{index,server/index,client/index}.js` updated to export only `mountLocalUi` + `LocalAgentClient`. README rewritten. Test totals after deletion: agent-ui 8/8, neighborhood-v0 9/9, tasks-v0 21/21, archive 96/96 — all green.
- [ ] Mark Phase 3 complete + cross-link from app READMEs per Phase 6.5 scheme.

### Phase 3 follow-on (not scheduled — build when first consumer needs it)

- [ ] **`LocalUiAuth`** — subclass / sibling of `core.A2AAuth` mapping OIDC `sub` → tier. Per L1d audit § Phase 2 step 4. Not in any numbered Phase 3 box because no current consumer needs it: archive uses `visibility: 'public'`, tasks-v0 / neighborhood-v0 test write skills via direct handler calls. Build when the first real web UI lands wanting to call write skills over A2A; the design choices (claim mapping, header conventions, refresh) need a real consumer to ground them. Until then, write-skill HTTP tests will fail with `ActorContext.actor (webid) is required` — an expected gap, not a regression.

**Verify Phase 3 (when done):**
```bash
cd apps/neighborhood-v0 && npm test    # 9 tests must still pass
cd apps/tasks-v0 && npm test           # 21 tests must still pass
cd packages/agent-ui && npm test       # only mountLocalUi.test.js remains, 8/8
```

---

## Phase 4 — H5 V2 critical path (~3 days)

This is the unblock for `Project Files/coding-plans/H5-V2-resume.md`.

### L1h roster loader (~½ day) — DONE 2026-05-04
- [x] Runtime-injected `podClient` (no peer-dep) — duck-typed `podClient.read`. Cleaner than a hard peer-dep per the audit's "Option B" (mirrors the `attachIdentityToAgent` decoupling pattern).
- [x] `MemberMap.fromPodConfig({podClient, configUri, fallback?})` static factory shipped. Reads `{content: ...}`; tolerates string OR pre-parsed JSON content. NOT_FOUND tolerance via `fallback` array (passing `fallback: []` = "empty roster on first boot"; omitting `fallback` = strict mode, rethrows).
- [x] **Schema includes the `pubKey` slot** per the L1e cross-substrate finding. `#normalise` carries `pubKey` (default null) alongside webid/displayName/externalIds/role.
- [x] Documented role-snapshot stance in `MemberMap.js` class JSDoc (`role` is a snapshot; `GroupManager.getRole` is the authoritative source).
- [ ] (optional follow-up) `refreshRolesFrom({groupManager, groupId, webidToPubKey})` bridge — DEFERRED. The class JSDoc directs callers to `GroupManager`; the bridge function is convenience to land when an app hits snapshot-drift in practice.
- [x] Added 9 new tests in `test/MemberMap.fromPodConfig.test.js`. **28/28 identity-resolver tests pass** (was 19, +9).
- [x] Added TODO comment in `apps/household/src/identity/MemberWebIdMap.js` pointing at `MemberMap.fromPodConfig` (per user direction "leave H2 itself, but lift to substrate as needed by other apps").
- [x] Updated `Project Files/Substrates/L1h-identity-resolver.md` Member-webid map example to show the new factory + `pubKey` slot.

### L1e skill-match refactor (~2–3 days) — DONE 2026-05-04
- [x] **Step 1** — `SkillMatch` constructor: `{transport,...}` → `{agent, peers, group, localActor, skills?, posture?}`.
- [x] **Step 2** — Replaced `transport.publish/subscribe` with `pubSub.publish(agent, topic, msg)` / `pubSub.subscribe(agent, peerAddr, topic, cb)`. Per-peer all-to-all subscription topology (closed group, N²; tolerable up to ~50 members).
- [x] **Step 3** — Roster passing: constructor `peers: Array<{pubKey}>`, with runtime `addPeer`/`removePeer`/`listPeers`. The MemberMap-reference choice was rejected — explicit `pubKey` array decouples SkillMatch from L1h and makes the shape testable in isolation.
- [x] **Step 4** — Replaced `InMemoryTransport`-based test fixtures with real `core.Agent` instances over a shared `core.InternalBus` (matches `core/test/A2A.test.js:25–32` pattern). Cross-peer wiring requires `agent.addPeer(addr, pubKey)` BEFORE `skillMatch.start()` (SecurityLayer requires pubkey registration before sendOneWay).
- [x] **Step 5** — Deleted `packages/skill-match/src/transports/` directory entirely.
- [x] **Step 6** — `packages/skill-match/src/index.js` now exports only `SkillMatch`. Package version bumped to `0.2.0`. Added `@canopy/core` to deps. Subpath export `./transports/in-memory` removed from `package.json`.
- [x] **Step 7** — `apps/neighborhood-v0/src/Agent.js` updated. Factory NO LONGER auto-starts SkillMatch — caller must `agent.addPeer(addr, pubKey)` for each peer first, then `skillMatch.start()`. Documented as caller responsibility.
- [x] **Step 8** — `apps/neighborhood-v0/test/integration.test.js` rewritten with a `buildCluster(specs)` helper that pre-generates identities, builds bundles over a shared bus, cross-registers core.Agent peer pubkeys, then starts SkillMatch on each. **9/9 tests pass.**
- [x] **Step 9** — H4 (apps/tasks-v0) Agent.js updated (skillMatch is optional; tests don't use it). **21/21 tests pass.**
- [x] **Step 10** — Pod-config schema from Phase 4.1 (`MemberMap.fromPodConfig`) already carries the `pubKey` slot — confirmed.
- [ ] **Step 11** (optional follow-up) — wire posture flag to `agent.skills.getByPosture`. **DEFERRED** — current `posture` map works; this is a polish.
- [x] **Step 12** — Update `Project Files/Substrates/L1e-skill-match.md` to document the new shape. **DONE 2026-05-04** — header refactor banner, post-Phase-4.2 constructor + caller-responsibility note for `agent.addPeer`, Subscribe example, Dependencies + RN sections, and Pattern sources all rewritten to reflect the deletion of the synthetic transport.

**Additive SDK change shipped along the way:** `core/protocol/pubSub.js`'s `subscribe()` now returns an off-fn that fully tears down both the local listener and the publisher-side subscription. Backward-compatible — callers ignoring the return value see no change.

### H5 V2 multi-process smoke — CANCELLED 2026-05-04
This subsection was originally Phase 4.3. **Cancelled by user direction:** Phase 8 already plans a real-device run of the same loop ("H5 V2 multi-process smoke re-run on real hardware"). Doing the work twice (Node-only now, real-device later) is duplicate effort — the real-device pass is the meaningful one. The Phase 8 item now explicitly absorbs this scope (see § Phase 8).

**Verify Phase 4:**
```bash
cd apps/neighborhood-v0 && npm test     # 9 tests pass
cd apps/tasks-v0         && npm test     # 21 tests pass
cd packages/skill-match  && npm test     # 10 tests pass
cd packages/identity-resolver && npm test  # 28 tests pass
```

---

## Phase 5 — Big rewrites — L1a first, then L1b

**User-decided order: L1a first.**

### L1a sync-engine refactor (~4 days) — DONE 2026-05-04
- [x] Migrated `apps/import-bridge-v0` off V0 `SyncEngine + IngestQueueSource + InMemoryBackend`. Per the audit the right move was *not* `LiveSyncSkill` (which is for polling/cursored bidirectional sync) but a direct `core.DataSource` write target — import-bridge is one-shot, no polling needed. The agent now takes `target: DataSource` and writes via `target.write(uri, value)`. `events: Emitter` exposed for the `synced` event.
- [x] Updated `apps/import-bridge-v0/test/integration.test.js` — `InMemoryBackend` → `core.MemorySource`, `backend.get` → `target.read`, `agent.syncEngine.on` → `agent.events.on`. Storage envelope removed (no more `kind: 'direct'`); MemorySource stores values verbatim. **8/8 tests pass.**
- [x] Deleted V0 substrate: `packages/sync-engine/src/SyncEngine.js`, `sources/IngestQueueSource.js`, `sources/LocalFolderSource.js`, `backends/InMemoryBackend.js`, `storageConvention.js`. Plus their tests (`test/SyncEngine.test.js`, `test/LocalFolderSource.test.js`).
- [x] Renamed `packages/sync-engine/src/BidirectionalSyncEngine.js` → `SyncEngine.js`. Class renamed `BidirectionalSyncEngine` → `SyncEngine`. **96/96 sync-engine tests pass.**
- [x] Updated `packages/sync-engine/src/index.js` — exports the renamed `SyncEngine` + Folio-lifted helpers (`PathMap`, `scanLocal`, `scanPod`, `diff`).
- [x] Updated `packages/sync-engine/package.json` — version bumped to `0.4.0`; subpath exports for deleted things removed; `./BidirectionalSyncEngine` → `./SyncEngine`.
- [x] Updated `apps/folio/src/SyncEngine.js` — import path `@canopy/sync-engine/BidirectionalSyncEngine` → `@canopy/sync-engine/SyncEngine`; class reference updated. Folio runs **451/452** (1 pre-existing flaky filesystem-cleanup race in `test/SyncEngine.test.js`, unrelated to refactor).
- [x] Update `Project Files/Substrates/L1a-sync-engine.md` — substrate sketch refreshed to reflect the post-refactor single-engine state. **DONE 2026-05-04** — refactor banner, header table updated (v0.4.0; one-shot ingest row added), consumer-specs section now notes H6/H7 don't compose this substrate, source adapters section rewritten as bidirectional-only, Dependencies section trimmed (no more `OAuthRemoteAdapter` mention).

### L1b item-store refactor (~5–6 days) — DONE 2026-05-04
- [x] Deleted the `Backend` interface and `InMemoryBackend`: `packages/item-store/src/backends/` directory removed entirely; `Backend` typedef purged.
- [x] **Pragmatic deviation from audit:** the audit prescribed a full `PodClient` integration (with MergeContracts + per-field merge + FederatedReader). On inspection, the substrate's actual surface is "read/write/list/delete + JSON values" — that's `core.DataSource`, the SDK's lower primitive. ItemStore now takes `{dataSource, rootContainer, rolePolicy?}` and composes any `core.DataSource` (`MemorySource` for tests; an adapter over `pod-client.PodClient` at the app layer for production). The audit's main goal — "no Backend reinvention" — is satisfied. Apps that want PodClient features (tombstones, etag-conflict detection, multi-pod federation) wire that at the app layer per the architectural-layering convention.
- [x] CAS via `_etag` round-trip kept as substrate-internal mechanism. Distributed atomicity is the production responsibility of a `pod-client.PodClient`-backed DataSource (which honours `ifMatch` at the HTTP layer); for the in-process H4/H5 tests, the existing claim-race semantics work.
- [x] Audit log redesigned: one file per audit entry under `audit/<entry-id>.json` (instead of jsonl). `auditLog(filter)` lists the directory + reads each file. Simpler than the jsonl append protocol; works directly on any `core.DataSource`.
- [x] `@canopy/core` already in deps from Phase 2 Emitter sweep; no additional pod-client peer-dep added (the substrate is intentionally DataSource-shaped, not PodClient-shaped).
- [x] Tests rewritten: `ItemStore.h2.test.js` + `ItemStore.h4.test.js` now use `new MemorySource()` instead of `new InMemoryBackend()`. **30/30 item-store tests pass** (15 + 15).
- [x] **Migrated `apps/neighborhood-v0`** — 9/9 tests pass.
- [x] **Migrated `apps/tasks-v0`** — 21/21 tests pass.
- [x] **Migrated `apps/presence-v0`** — `HomeAgent.js` updated. (No tests; presence-v0 still in stub state per its README.)
- [x] **Migrated `apps/household/src/storage/InMemoryStore.js`** — switched to `MemorySource`. 463/465 household tests pass (2 pre-existing failures from Phase 1.2: TelegramBridge inline_keyboard array nesting + e2e/llm-roundtrip non-existent-tool — both unrelated to L1b).
- [x] Update `Project Files/Substrates/L1b-item-store.md` to describe the post-refactor `dataSource`-based shape. **DONE 2026-05-04** — refactor banner explaining the pragmatic deviation from the audit, header table updated (v0.2.0; storage-layout row added), constructor example now uses `{dataSource, rootContainer, rolePolicy?}`, Dependencies + RN sections rewritten to make `@canopy/core` the sole runtime dep and `pod-client` an app-layer integration, Pattern sources point at the shipped substrate + InMemoryStore adapter as templates.

**Verify Phase 5:**
```bash
test ! -d packages/sync-engine/src/backends 2>/dev/null   # actually item-store; verify both
test -f packages/sync-engine/src/SyncEngine.js && ! test -f packages/sync-engine/src/BidirectionalSyncEngine.js
test ! -d packages/item-store/src/backends && echo "Backend interface deleted"
cd apps/tasks-v0 && npm test
cd apps/neighborhood-v0 && npm test
cd apps/presence-v0 && npm test
```

---

## Phase 6 — L1f notifier polish (~2 days) — DONE 2026-05-04

Detail: `L1f-notifier-refactor.md`.

- [x] Replace L1f's `Channel` interface with a re-export of L1c's `MessagingBridge`. Updated `packages/notifier/src/types.js` to alias `Channel` = `MessagingBridge` from `@canopy/chat-agent` (jsdoc-only, no runtime dep). `package.json` adds `@canopy/chat-agent` as devDependency for tests; runtime stays on `@canopy/core` only.
- [x] Collapse `RecordingChannel` and `InMemoryBridge` into a single test fake. `RecordingChannel` deleted; tests now import `InMemoryBridge` from `@canopy/chat-agent` (single source of truth, same outbox shape).
- [x] Wire `ExpoPushSender` (from `@canopy/relay`) as the L1f push channel. **`PushChannel` now real, not stub** — composes any `relay.PushSender` concrete (default: `ExpoPushSender`); payload follows `MobilePushBridge`'s `{skillId, parts}` convention so digest → push → wake-and-process is end-to-end coherent. Substrate doesn't import relay directly; apps wire the sender. 8 new PushChannel tests pass.
- [x] Update `Project Files/Substrates/L1f-notifier.md` — refactor banner, header table updated to v0.4.0 + new "Channel surface" row, public API example uses bridge directly + new PushChannel, Channels section rewritten, Dependencies section split into runtime / optional / boundaries, RN variant section rewritten as "No (split into relay send-half + react-native receive-half)".
- [x] **Side-effects:**
  - `notifier.on(emitter, name, handler)` overload deleted; new clean `notifier.subscribe(emitter, name, handler)` for foreign-emitter subscriptions. Plain `notifier.on(name, handler)` is the own-event surface (`'fired'`, `'error'`).
  - `ulid()` deleted from substrate; replaced by `core.genId`. **Additive SDK change:** `core/src/index.js` now barrel-exports `genId` (was only available via `Envelope.js` subpath).
  - Notifier README + CHANGELOG updated; `0.3.0` → `0.4.0` with full breaking-change list.

**Regression check:** notifier 40/40 (10 Notifier + 17 PodScheduleStore + 5 timezone + 8 PushChannel — net +8). chat-agent 24/24, item-store 30/30, sync-engine 96/96, skill-match 10/10, identity-resolver 28/28, agent-ui 8/8, relay 97/97, pod-search 16/16, llm-client 48/48. Apps: tasks-v0 21/21, neighborhood-v0 9/9, archive 96/96, import-bridge-v0 8/8, household 463/465 (2 pre-existing unrelated failures). Core 1245/1245 + 13 skipped — `genId` barrel export is purely additive.

**Verify Phase 6:**
```bash
cd packages/notifier && npm test
```

---

## Phase 6.5 — App README scheme rollout (~2 days) — DONE 2026-05-04

Cross-cutting docs work — apply the scheme defined in
[`Project Files/conventions/app-readme-scheme.md`](../conventions/app-readme-scheme.md)
to every existing app. New apps ship with it from the first commit;
this phase brings the existing fleet into compliance.

For each app: add the four required sections (`## Substrates`,
`## Direct SDK use`, `## Bring it up`, `## What's in here`). The
"Direct SDK use" section is the one that actually requires thought —
every direct import from `@canopy/{core,relay,pod-client,react-native}`
needs a one-line justification.

- [x] `apps/folio` — `## Substrates` (L1a sync-engine — Folio is the substrate's pattern source) + `## Direct SDK use` (`pod-client.PodClient` + `core.Bootstrap` + `core.VaultNodeFs` + `core.PodCapabilityToken` + `core.validateMnemonic`).
- [x] `apps/folio-mobile` — `## Substrates` (L1a via `@canopy-app/folio` library) + `## Direct SDK use` (`pod-client.PodClient`+`SolidOidcAuth`, `core.PodCapabilityToken`, `react-native/platform/polyfills`).
- [x] `apps/sdk-smoke` — `*None.*` for substrates (deliberate exemption per architectural-layering.md) + comprehensive `## Direct SDK use` table covering core / relay / react-native / pod-client (the harness's purpose is exercising the SDK directly).
- [x] `apps/mesh-demo` — **Skipped per Phase 8 plan.** README scheme update bundles with the substrate migration in Phase 8.
- [x] `apps/household` — `## Substrates` (L1b item-store, L1c chat-agent + telegram bridge, L1j llm-client + Ollama, L1f notifier `nextDailyFireInTz` only) + `## Direct SDK use` (`core.MemorySource`, `core.AgentIdentity`, `core.PodCapabilityToken`, `pod-client.PodClient` future-V2).
- [x] `apps/tasks-v0` — `## Substrates` (L1b/L1d/L1e/L1f/L1h) + `## Direct SDK use` (`core.Agent` family + `MemorySource`). Bonus: replaced stale Usage example using the deleted `bundle.buildRouter`/`broadcaster` shape with the post-Phase-3 `mountLocalUi(bundle.agent)` pattern.
- [x] `apps/neighborhood-v0` — `## Substrates` (L1b/L1d/L1e/L1f/L1h, with L1e post-Phase-4.2 note) + `## Direct SDK use` (`core.Agent` family + `MemorySource` + `addPeer` caller-responsibility note). Bonus: rewrote Usage example to remove the deleted `InMemoryTransport` import.
- [x] `apps/import-bridge-v0` — `## Substrates` (L1h identity-resolver only) + `## Direct SDK use` (`core.Emitter`, `core.OAuthVault`+`VaultMemory`, `core.DataSource` per Phase 5.1). Removed the stale "Substrate composition" section that still referenced L1g (deleted) + L1a (one-shot ingest doesn't compose this substrate post-Phase 5.1).
- [x] `apps/archive` — `## Substrates` (L1d agent-ui, L1i pod-search) + `## Direct SDK use` (`core.Agent` family + `defineSkill`, `pod-client.PodClient` future).
- [x] `apps/presence-v0` — `## Substrates` (L1b item-store) + `## Direct SDK use` (`core.MemorySource`, future `core.Agent.transportFor`).

**Verify Phase 6.5:**
```bash
# Every app README must have all four required sections.
for d in apps/*/README.md; do
  for s in "## Substrates" "## Direct SDK use" "## Bring it up" "## What's in here"; do
    grep -q "^$s\$" "$d" || echo "MISSING: $d  $s"
  done
done
```

---

## Phase 6.6 — mesh-demo migration to substrates — MOVED TO PHASE 8 (2026-05-04)

The mesh-demo migration was originally Phase 6.6. It was moved into
Phase 8 by user direction (2026-05-04) because the migration's verify
step is a real-device run anyway (mesh-demo was the first SDK validator
and the regression check requires the same hardware setup), and the
mining + substrate-lifting work makes more sense to do alongside the
real-device run rather than ahead of it.

The full scope of the original Phase 6.6 (audit pattern donations,
lift new substrate-shaped patterns, rewrite `apps/mesh-demo/src/agent.js`,
update `apps/mesh-demo/README.md` per the README scheme, real-device
validate) is now tracked under Phase 8 — see
"mesh-demo migration + regression" entries below.

---

## Phase 7 — Resume H5 V2 product items

Per `Project Files/coding-plans/H5-V2-resume.md` from step 3 onward:

- [x] H5 V2 step 3 — multi-process smoke. Replaced by Phase 8 real-device run (cancelled-Phase-4.3 scope absorbed there). Substrate-side validated in Phase 4.2 via `apps/neighborhood-v0/test/integration.test.js` (9/9) over `core.Agent` + `core.protocol.pubSub`.
- [x] H5 V2 step 4 — **topic-aware offline queueing on relay. DONE 2026-05-04.** Wire frame `{type:'send', to, envelope, topic?}` honors an optional `topic` hint (set by `RelayTransport._put` for envelopes built via the new `Transport.publishOneWay(addr, topic, payload)`). Each (addr, topic) bucket caps independently at `queueCap`; legacy untopiced sends share a single null-topic bucket; global per-address ceiling `queueCapTotal` (default 4× queueCap) is the safety valve. SDK changes additive: `Transport.publishOneWay` shipped (the four primitives + this new pubsub variant); `pubSub.publish` + history-replay path use it; `RelayTransport._put` lifts `envelope._topic` onto the wire frame. 6 new relay tests (`packages/relay/test/topicQueue.test.js`); core 1245/1245 unaffected, all substrates + apps green. Closes L1e sketch's Q5 ("broadcast persistence").
- [x] H5 V2 step 5 — **group-broadcast envelope on relay. DONE 2026-05-04.** New wire frame `{type:'group-publish', groupId, topic?, envelope}` fans out one envelope to all currently-connected group members in one client→relay frame; relay replies `{type:'group-publish-ack', groupId, delivered, queued}`. Authentication piggybacks on `GroupAuthVerifier`: members are tracked in `clientsByGroup` at register time from `groupProof`; senders may only fan out to groups they themselves joined. **Semantics: currently-connected only** — previously-registered but currently-disconnected members receive nothing through `group-publish`; durable broadcast for known-offline members goes through per-recipient `publishOneWay` (which uses the topic-aware queue from step 4). 6 new relay tests (`packages/relay/test/groupPublish.test.js`); relay 109/109.
- [ ] H5 V2 step 6 — E2c push integration: code-side already shipped in Phase 0 (PushSender + ExpoPushSender + PushTokenRegistry + relay wake hook + RelayTransport.registerPushToken); real-device validation deferred to **Phase 8**.
- [x] H5 V2 step 7 — group-roster query on relay. **DECISION: SKIP (2026-05-04).** Live-presence is derivable by intersecting two existing primitives — the pod-config roster (L1h `MemberMap.fromPodConfig`, shipped Phase 4.1) provides the persistent member list with pubkeys, and the relay's existing `peer-list` broadcast tells apps which addresses are currently connected. Apps that want "who's online in group X right now" intersect the two locally — no new wire frame needed. Worth re-opening if a future H5/H4/H8 use case reveals the intersection-on-app-side ergonomics is awkward; the pod-config + peer-list combo handles V0 needs.
- [x] Per-member web UI — **shipped V0 2026-05-04.** Static HTML/JS in `apps/neighborhood-v0/web/` (`index.html` open-requests + post form; `mine.html` requester's open requests + cancel; `app.js` `fetch()`-based A2A client; `style.css`). `mountLocalUi` extended with `staticDir` + `indexFile` opts; underlying `core.A2ATransport` got the same opts (additive — falls through to static after A2A routes). New `LocalUiAuth` shim (`@canopy/agent-ui`) treats localhost-bound traffic as authenticated for a configured actor (the V0 trade-off vs OIDC). CLI launcher at `bin/neighborhood-ui.js` (`npm run ui -- --actor <webid> --group <gid>`). 9 web smoke tests; H5 total 18/18 passing (was 9). Onboarding + group switcher remain (scoped in product-items doc).
- [x] Onboarding (invite-link → group-token) — **shipped V0 2026-05-04.** `core.GroupManager.issueInvite/verifyInvite/redeemInvite` primitives shipped (9 new tests in `packages/core/test/GroupManager.invites.test.js`); `apps/neighborhood-v0/src/onboarding.js` exposes them as `issueInvite` / `redeemInvite` skills with an optional `onSpawn` hook for in-process spawning. Web UI page `web/onboard.html` doubles as admin-issues + member-redeems based on the `?invite=<token>` query param. **Multi-user testbed launcher** at `bin/h5-testbed.js`: boots an admin + N pre-seeded members in one Node process over a shared `InternalBus`, mounts each on its own `mountLocalUi` port, and the onboarding skill's `onSpawn` hook spawns fresh in-process agents on every invite redemption. Landing-index page at `/testbed.html` lists every member's URL. 8 onboarding tests + 4 testbed end-to-end tests; H5 total 34/34. Live-fire validated: admin → invite → redeem → fresh agent reachable on its own port.
- [x] Group switcher — **shipped V0 2026-05-04.** Per the product-items doc decision, V0 picks model (b) "one core.Agent per group with shared identity" — fits the existing substrates without protocol changes. New `createNeighborhoodCluster({identity?, groups: [{groupId, localActor, ...}], bus?})` factory in `apps/neighborhood-v0/src/cluster.js` builds N agents with a shared `AgentIdentity`. Launcher gains `--groups <gid1>,<gid2>` mode that mounts one `mountLocalUi` per group on consecutive ports. SDK additive: `mountLocalUi` + `core.A2ATransport` accept `extraStaticFiles: Record<path, string|Uint8Array>` (in-memory virtual files served alongside `staticDir`). Launcher uses this to surface a runtime-built `groups.json` to every per-group instance — the web UI's `mountGroupSwitcher()` reads it to populate the dropdown. 4 new tests in `apps/neighborhood-v0/test/multigroup.test.js`; H5 total 22/22 (was 18; +4 multigroup). Live-fire smoke confirms both per-group instances serve the same `groups.json` and the dropdown is wired into both pages.

(V3 = mobile RN client — separate cycle.)

---

## Phase 8 — End-to-end real-device validation (deferred)

**Why this is the last phase, not Phase 0:** the push test moved here on
2026-05-04 once we discovered Android push has no FCM-free path on a
custom dev build (BRING-UP-NOTES Trap 18). Setting up Firebase + FCM
v1 credentials is real overhead and not on the critical path of any
substrate refactor or H5 V2 product item. The push code itself is
fully shipped and unit-tested:

- `@canopy/relay`: 28 push tests pass (`PushTokenRegistry`,
  `ExpoPushSender`, server wake-hook integration).
- `@canopy/react-native`: 16 `MobilePushBridge` tests pass.
- `@canopy/core`: 6 `RelayTransport.registerPushToken` tests pass.

What's deferred is *hardware* validation — confirming the wire
protocol survives a real Expo proxy → FCM → Android device round-trip.
Useful for shipping confidence; not useful for unblocking refactors.

### Items

- [ ] **Set up Firebase project for sdk-smoke** (~10 min):
  1. Create a Firebase project at <https://console.firebase.google.com/>.
  2. Add Android app with package `ag.canopy.sdksmoke`.
  3. Download `google-services.json` → place at `apps/sdk-smoke/google-services.json`
     (already gitignored).
  4. Add `"googleServicesFile": "./google-services.json"` to `app.json`'s
     `expo.android` block.
  5. Generate FCM v1 service-account JSON: Firebase Settings → Service
     Accounts → Generate new private key. Save locally (gitignored).
  6. `cd apps/sdk-smoke && npx eas credentials` → Android → Push Notifications
     → FCM V1 → upload service-account JSON.
  7. Rebuild dev client: `npx expo run:android`. Sideload to phone.
- [ ] **Run S11 push-wake test end-to-end** (per `apps/sdk-smoke/scripts/README.md`).
  Three terminals:
  - T1: `npm run relay:push` (laptop).
  - T2: `npm run android` → press S1, then S11 → background the app.
  - T3: `npm run trigger:s11 -- ws://<lan-ip>:8787 <phone-pubkey>` while S11 is in its 60s window.
  Pass criterion: trigger logs `✓ s11-wake completed in <Nms>`; phone harness logs `S11: pass`.
- [ ] **Same test on a second Android device** (or model variant) to confirm the path
  isn't device-specific.
- [ ] **(Optional, when iOS comes back into scope)** APNs equivalent: provision Apple
  Developer push certs, repeat S11 on iOS. Per the project direction, iOS is
  deferred to a much later stage; this item is a placeholder.

### Companion items (cross-substrate validation, also deferred to Phase 8)

These are "verify the substrate refactors of Phases 3–6 actually behave
right on real hardware" items. They naturally cluster with the push
validation since they all need a phone.

- [ ] H5 V2 multi-process smoke (the cancelled Phase 4.3 item) — run
  on real hardware (not just two Node processes). **Absorbs the
  cancelled Phase 4.3 scope:** spin up `apps/neighborhood-v0` on two
  devices over a real relay (`packages/relay/src/server.js`), exercise
  the paint-fence broadcast/claim loop end-to-end, and re-run the 9
  in-process integration tests' equivalents over the relay path.
  Validates that the L1e refactor (`pubSub` over `RelayTransport`)
  works in the wild — the in-process `InternalBus` tests can't catch
  serialization edge cases or transport lifecycle issues.
- [ ] **mesh-demo migration to substrates + regression** (absorbs the
  cancelled Phase 6.6 scope, 2026-05-04). The mining + migration is
  done in this phase because its verify step is a real-device run.
  Steps:
  1. **Audit mesh-demo's pattern donations.** Re-read
     `apps/mesh-demo/src/` and identify app-specific glue vs.
     substrate-shaped patterns. Likely candidates: chat-message UI /
     log pane (might lift to L1d agent-ui or its own UI substrate),
     per-peer reachability status (L1e or core's `ReachabilityOracle`
     glue), rendezvous invocation flow (likely stays direct-SDK,
     justified). Output:
     `Project Files/Substrates/refactor/mesh-demo-migration-plan.md`.
  2. **Lift any new substrate-shaped patterns** discovered in the
     audit per rule-of-two (`Project Files/Substrates/policies.md`).
     Don't lift speculatively.
  3. **Rewrite `apps/mesh-demo/src/agent.js`** to compose substrates
     where they fit. `createMeshAgent` from `@canopy/react-native`
     stays the foundation; substrate composition stacks on top.
  4. **Update `apps/mesh-demo/README.md`** per the app-readme-scheme:
     document substrates used + deliberate direct-SDK uses
     (rendezvous, reachability — likely justified at the SDK layer).
  5. **Re-run mesh-demo's Group A/B/D/DD scenarios** on real hardware
     (per `apps/mesh-demo/README.md`) to confirm no regression after
     the substrate migration. mesh-demo was the first SDK validator;
     the migrated version must still run end-to-end on the same
     hardware.
- [ ] sdk-smoke S1–S10 stubs filled in as scenarios get exercised
  on real hardware (per the harness contract — they were always meant
  to be filled in during real-device runs).

---

## Forward contracts (no work now)

These are recorded for when the relevant V1 lands.

- [ ] **L1i V1** (~3 days when V1 lands): per `L1i-pod-search-refactor.md`. Compose `PodClient.list/read` for the walker; subscribe to `PodClient`'s `'delete-local'` event for tombstone eviction; split `*.rn.js` via `service-factory`. Depends on Phase 0 `recursive: true` fix.
- [ ] **L1j cloud providers** (~5h when added): compose `core.OAuthVault` + `makeAuthorizedFetch`, NOT a parallel HTTP fetch. Per `L1j-llm-client-refactor.md`.

---

## Cross-cutting items NOT in this plan

Tracked separately:

- **App↔SDK bypass audit** — different concern, deferred per `Project Files/TODO-GENERAL.md` (HIGH priority section). Run after substrate refactors land; the substrate APIs need to settle so this audit doesn't false-positive.
- **`Date.now()` clock-injection refactor** — pre-existing HIGH-priority item in `TODO-GENERAL.md`, unrelated.

---

## Decision log (during execution)

Append entries here as decisions are made. Use the format:

```
- 2026-05-XX — <decision> (Phase N) — <reasoning>
```

- 2026-05-04 — Phase 1.1 L1c polish completed. Both `EventEmitter` references swapped (line 20 import + line 108 extends); added `@canopy/core` to deps; orphan `(Copy).js` deleted; 24/24 tests pass.
- 2026-05-04 — Phase 1.2 L1g oauth-vault DELETED. `apps/import-bridge-v0` migrated to `core.OAuthVault`; `packages/oauth-vault/` removed; `Project Files/Substrates/L1g-oauth-vault.md` marked deleted with full API-replacement reference table. Verified: 8/8 import-bridge-v0 tests pass on `core.OAuthVault`. Side-finding: pre-existing household failures (TelegramBridge inline_keyboard test + e2e/llm-roundtrip tool-not-found test) — unrelated to L1g, log in TODO if not already noted.
- 2026-05-04 — Phase 2 partial (Emitter sweep + RN pin alignment) completed. 4 substrates migrated to `core.Emitter`; 206 tests pass; deps added; sweep verified clean. RN pin aligned in sdk-smoke + mesh-demo. ulid sweep DEFERRED with documented reason (core.genId returns UUID, not sortable ULID). mesh-demo metro migration still pending (separate item).
- 2026-05-04 — Phase 3 additive parts (3.0 + 3.x SDK extension + 3.2 + 3.4 + e2e test) completed. New primitives shipped in `@canopy/agent-ui`: `mountLocalUi` (server) + `LocalAgentClient` (client) — both built on real `core.Agent` + `core.A2ATransport`. `core.A2ATransport` got an additive `host` option for 127.0.0.1 binding. 8 new tests pass (33/33 agent-ui total); 37/37 core A2A tests still pass. Legacy primitives (composeAgent / SkillRouter / EventBroadcaster / ctxActor / AgentUiClient) still exported with deprecation comments — apps haven't migrated yet. Phase 3.1 (the destructive apps rewrite, ~3 days) deferred to next session with a detailed handoff at `Project Files/Substrates/refactor/L1d-apps-rewrite-handoff.md`.
- 2026-05-04 — Phase 3.1 (apps rewrite, partial). `buildIdentitySkills` rewritten to return `defineSkill` array. Both `apps/neighborhood-v0` (9/9 tests) and `apps/tasks-v0` (21/21 tests) migrated to real `core.Agent`. Skill handlers rewritten to `({parts, from}) → Parts.wrap(result)` shape; tests rewritten via `callSkill(agent, id, args, fromWebid)` helper that calls `agent.skills.get(id).handler(...)` directly. `bundle.broadcaster` / `bundle.buildRouter` / `bundle.skills` removed from app return shapes — apps now expose only `{agent, itemStore, members, skillMatch?, notifier?}`. Discovered: **third consumer of legacy primitives is `apps/archive/src/server/index.js`** — audit missed it. Legacy deletion (Phase 3.1.4) deferred until apps/archive also migrates. The new `mountLocalUi`+`LocalAgentClient` HTTP path is exercised end-to-end in tasks-v0's "HTTP exposure" describe block.
- 2026-05-04 — Phase 3.1 COMPLETED. `apps/archive` migrated to real `core.Agent` + `mountLocalUi` (server/agent.js rewritten to register `defineSkill` definitions; server/index.js rewritten to drop the bespoke Express+SkillRouter+EventBroadcaster+supertest stack and use `mountLocalUi` over a real `core.Agent` exposed via A2A). Archive skills marked `visibility: 'public'` to preserve the anonymous-read behavior the legacy `DEFAULT_RESOLVE_ACTOR` had. Tests rewritten with `LocalAgentClient`. **96/96 archive tests pass**; 3 legacy auth-model tests dropped (will be re-added when `LocalUiAuth` is wired). With all 3 consumers (tasks-v0, neighborhood-v0, archive) migrated, the legacy primitives in `@canopy/agent-ui` were deleted: `composeAgent.js`, `SkillRouter.js`, `EventBroadcaster.js`, `ctxActor.js`, `AgentUiClient.js` + their 5 test files. agent-ui's public API is now just `mountLocalUi` + `LocalAgentClient`. README rewritten. **Final regression check:** agent-ui 8/8, neighborhood-v0 9/9, tasks-v0 21/21, archive 96/96 — all green. Phase 3 of the substrate refactor is COMPLETE.
- 2026-05-04 — Phase 4.1 COMPLETED. `MemberMap.fromPodConfig({podClient, configUri, fallback?})` shipped in `@canopy/identity-resolver`. Runtime-injected duck-typed `podClient` (no peer-dep), NOT_FOUND-tolerant via `fallback`, schema includes the `pubKey` slot required by L1e cross-substrate finding. 9 new tests; identity-resolver now 28/28. TODO comment added to `apps/household/src/identity/MemberWebIdMap.js`. L1h sketch + class JSDoc updated to document role-snapshot stance + new factory.
- 2026-05-04 — Phase 4.2 COMPLETED (THE BIG ONE — the catastrophic case the whole audit started with). `@canopy/skill-match` rewritten: synthetic `transport` interface + `InMemoryTransport` deleted; `SkillMatch` now consumes a real `core.Agent` and routes via `core/protocol/pubSub.js`. Constructor: `{agent, peers: Array<{pubKey}>, group, localActor?, skills?, posture?}`. Per-peer all-to-all subscription topology (closed group). Tests rewritten over shared `InternalBus` + 2+ `core.Agent` instances. **10/10 SkillMatch tests pass.** Apps migrated: `apps/neighborhood-v0` 9/9, `apps/tasks-v0` 21/21. Additive SDK change in `core/protocol/pubSub.js` — `subscribe()` returns an off-fn that fully tears down both the local listener and publisher-side; backward-compatible. **Caller contract change:** factory no longer auto-starts SkillMatch — caller must register peer pubkeys at the core.Agent layer (`agent.addPeer(addr, pubKey)`) BEFORE calling `skillMatch.start()`, else SecurityLayer throws `UNKNOWN_RECIPIENT`. Documented in factory JSDoc. With this, **H5 (apps/neighborhood-v0) is now 100% on `core` + substrates** — no synthetic abstractions remain in the H5 import chain.
- 2026-05-04 — Phase 4.3 (Node-only multi-process smoke) **CANCELLED by user direction.** Reason: Phase 8 already plans a real-device run of the same loop; doing it twice (Node-only now, real-device later) is duplicate effort. Phase 8's "H5 V2 multi-process smoke re-run on hardware" item updated to absorb the cancelled 4.3 scope explicitly. Phase 4 is therefore COMPLETE — Phase 4.1 + Phase 4.2 done, 4.3 retired in favor of Phase 8.
- 2026-05-04 — Phase 5.1 COMPLETED. `@canopy/sync-engine` V0 deleted (V0 SyncEngine + sources/IngestQueueSource + sources/LocalFolderSource + backends/InMemoryBackend + storageConvention). The Folio-lifted V0.3 `BidirectionalSyncEngine` was renamed to just `SyncEngine` — the substrate now ships a single engine. **Audit-recommended migration tweak:** import-bridge-v0 was supposed to migrate to `core.LiveSyncSkill`, but on inspection that primitive is for polling/cursored sync — overkill for import-bridge's one-shot semantics. The honest migration: write directly through any `core.DataSource` (`MemorySource` for tests, `pod-client.PodClient`-wrapped target in production). Simpler than wrapping in LiveSyncSkill, achieves the same audit goal of "no V0 SyncEngine reinvention". Test totals: sync-engine 96/96, import-bridge-v0 8/8, folio 451/452 (1 pre-existing flaky FS-cleanup race). All other packages still green.
- 2026-05-04 — Phase 5.2 COMPLETED. `@canopy/item-store` rewritten over `core.DataSource`. `Backend` interface + `InMemoryBackend` deleted. ItemStore constructor `{backend}` → `{dataSource, rootContainer, rolePolicy?}`. Storage layout: `<root>/items/<id>.json` per item, `<root>/audit/<entry-id>.json` per audit entry. **Pragmatic deviation from audit:** kept the rewrite at the `core.DataSource` level rather than the audit-prescribed full PodClient integration with MergeContracts + FederatedReader. The substrate's actual surface (read/write/list/delete + JSON) maps cleanly to DataSource; PodClient's tombstones/etag-conflict/federation features belong at the app layer (apps that need them wire `pod-client.PodClient` themselves into a small DataSource adapter). Audit's main goal — "no synthetic Backend reinvention" — fully satisfied. Tests: item-store 30/30 (h2 + h4), apps unaffected: neighborhood-v0 9/9, tasks-v0 21/21, household 463/465 (2 pre-existing failures unrelated). **Phase 5 complete.** Five of the audit's critical-severity findings (L1b, L1d, L1e, L1g, L1a) all resolved.
- 2026-05-04 — Documentation polish completed. `Project Files/Substrates/L1a-sync-engine.md`, `L1b-item-store.md`, `L1e-skill-match.md` all refreshed to reflect post-refactor state: refactor banners explaining what was deleted/renamed and why, header tables updated to current package versions, public-API examples updated to new constructor shapes, Dependencies sections rewritten (L1a no longer mentions `OAuthRemoteAdapter` / oauth-vault as a dep; L1b makes `@canopy/core` the sole runtime dep with `pod-client` as an app-layer integration; L1e documents `core.Agent` + `core.protocol.pubSub` as the only deps, with explicit "NOT consumed: `SkillsPubSub.js`" callout), Pattern sources point at the shipped substrate code as authoritative templates. Three sketches now coherent end-to-end with the current codebase.
- 2026-05-04 — Phase 6.6 (mesh-demo migration to substrates) MOVED to Phase 8 by user direction. Reason: the migration's verify step is a real-device run (mesh-demo was the SDK validator and Group A/B/D/DD scenarios need the same hardware), so the audit + lifting + rewrite + README scheme update + regression all naturally cluster under Phase 8 alongside push wake + multi-process smoke. Phase 6.5 sweep skips `apps/mesh-demo` since its README work is now bundled with the migration. The Phase 6.6 section in this checklist now points at Phase 8 for the active scope.
- 2026-05-04 — Architectural-layering pointers landed across all `packages/*` and `apps/*` (forward-contract markers, ahead of the Phase 6.5 README-scheme sweep). 1-line banners at the top of each README + 4 stub banners in entry files for SDK packages without READMEs (`packages/{relay,react-native,pod-client}`'s entry files). Banner content varies by layer: SDK foundation packages (4) say "compose primitives from here, don't reinvent, apps must justify direct use"; substrate packages (9) say "compose `core` SDK, MUST NOT reinvent SDK primitives — extend additively when the SDK almost fits" — several substrate banners include substrate-specific forward contracts (L1f notifier: must compose `relay.Expo*Push*` + L1c `MessagingBridge`; L1e SkillMatch: don't reintroduce the synthetic `transport`; L1a sync-engine: bidirectional-only post-Phase 5.1; L1i pod-search V1: compose `pod-client.PodClient`; L1j cloud providers: compose `core.OAuthVault`); app banners (10) call out known direct-SDK uses where they exist (folio-mobile uses pod-client + Bootstrap; import-bridge-v0 writes via core.DataSource; sdk-smoke is by-design SDK-validating; mesh-demo flagged for Phase 8 migration). Every banner links back to `Project Files/conventions/architectural-layering.md` (and apps additionally link `app-readme-scheme.md`).
- 2026-05-04 — Phase 6 (L1f notifier polish) COMPLETED. `@canopy/notifier` 0.3.0 → 0.4.0. Headline change: notifier's `Channel` interface is now an alias for L1c chat-agent's `MessagingBridge` — apps pass any bridge directly into `notifier.channels` (no more `ChatChannel` adapter). `RecordingChannel` deleted in favour of `InMemoryBridge` from chat-agent. Notifier internals: `channel.deliver({recipient,...})` → `channel.sendReply({chatId,...})`. **`PushChannel` is now real, not stub** — composes any `relay.PushSender` concrete (default: `ExpoPushSender` shipped in Phase 0); payload follows `MobilePushBridge`'s `{skillId, parts}` convention so digest → push → wake-and-process is end-to-end coherent. The `notifier.on(emitter,...)` overload was replaced by a clean `notifier.subscribe(emitter, name, handler)` distinct from `Emitter.on`. Private `ulid()` deleted; replaced by `core.genId`. **Additive SDK change:** `core/src/index.js` now barrel-exports `genId` (was only at the `Envelope.js` subpath). Tests: notifier 40/40 (was 32, +8 PushChannel); core 1245/1245 + 13 skipped; all 9 substrates + relay green (item-store 30, sync-engine 96, skill-match 10, identity-resolver 28, agent-ui 8, relay 97, pod-search 16, llm-client 48, chat-agent 24). Apps green (tasks-v0 21, neighborhood-v0 9, archive 96, import-bridge-v0 8, household 463/465 with 2 pre-existing unrelated failures). L1f-notifier.md sketch refreshed with refactor banner, post-refactor public API, dependencies split into runtime / optional / boundaries.
- 2026-05-04 — Phase 6.5 (App README scheme rollout) COMPLETED. All 9 active apps now ship the four required sections — `## Substrates`, `## Direct SDK use`, `## Bring it up`, `## What's in here` — per `Project Files/conventions/app-readme-scheme.md`. Bonus repairs along the way: tasks-v0's stale Usage example (using deleted `bundle.buildRouter`/`broadcaster`) replaced with the post-Phase-3 `mountLocalUi(bundle.agent)` pattern; neighborhood-v0's Usage example rewritten to drop the deleted `InMemoryTransport` import and add the `agent.addPeer` caller-responsibility note from Phase 4.2; import-bridge-v0's stale "Substrate composition" section pruned (no more reference to deleted L1g or to L1a — one-shot ingest doesn't compose this substrate post-Phase 5.1). Two apps are deliberate exemptions: `apps/mesh-demo` (scheme rollout deferred to Phase 8 alongside the substrate migration; banner explicitly cites the deferral) and `apps/mesh-demo (17 april)` (frozen archival snapshot; banner uses the convention's `Scheme exemption:` clause). Verify gate passes: `for d in apps/*/README.md; do for s in "## Substrates" "## Direct SDK use" "## Bring it up" "## What's in here"; do grep -q "^$s\$" "$d" || echo "MISSING: $d $s"; done; done` reports MISSING only for the two exempted mesh-demo paths. **Five phases (3, 4, 5, 6, 6.5) of the substrate refactor + cross-cutting docs work are now complete in this session;** Phase 7 (H5 V2 product items) and Phase 8 (real-device validation + mesh-demo migration) remain.
- 2026-05-04 — Phase 7 (H5 V2 product items) — SDK-side steps 4 + 5 + 7 LANDED; UI-side items (web UI / onboarding / group switcher) scoped in `Project Files/coding-plans/H5-V2-product-items.md` for a follow-up session.
  - **Step 4 (topic-aware offline queueing on relay):** Wire frame `{type:'send', to, envelope, topic?}` honors a topic hint stamped by `RelayTransport._put` for envelopes built via the new `Transport.publishOneWay(addr, topic, payload)`. Each (addr, topic) bucket caps independently at `queueCap`; legacy untopiced sends share a single null-topic bucket; global per-address ceiling `queueCapTotal` (default 4× `queueCap`) is the safety valve. Closes L1e Q5 ("broadcast persistence"). 6 new relay tests in `packages/relay/test/topicQueue.test.js`.
  - **Step 5 (group-broadcast envelope):** New `{type:'group-publish', groupId, topic?, envelope}` wire frame fans out to all currently-connected group members; relay replies `{type:'group-publish-ack', groupId, delivered, queued}`. Auth piggybacks on `GroupAuthVerifier` — members tracked in `clientsByGroup` at register time, senders may only fan out to groups they joined. **Semantics: currently-connected only** — durable broadcast for known-offline members goes through per-recipient `publishOneWay`. 6 new relay tests in `packages/relay/test/groupPublish.test.js`.
  - **Step 7 decision: SKIP.** Live-presence is derivable by intersecting `MemberMap.fromPodConfig` (Phase 4.1, persistent roster) with the relay's existing `peer-list` broadcast (currently-connected addresses). No new wire frame needed; re-open if a real H5/H4/H8 use case reveals the intersection ergonomics is awkward.
  - **SDK additive change:** `Transport.publishOneWay(addr, topic, payload)` shipped as a fifth pubsub-shaped primitive next to `sendOneWay` / `sendAck` / `request` / `respond` / `sendHello`. `pubSub.publish` + the subscribe-handler's history-replay path use it. Subclasses that don't care about the topic hint inherit a no-op fallback (default behavior matches `sendOneWay`).
  - **Regression check:** core 1245/1245 + 13 skipped (genId barrel intact); relay 109/109 (was 97; +6 topicQueue + +6 groupPublish); skill-match 10/10; neighborhood-v0 9/9; agents + apps unaffected.
  - **Step 6 (E2c push):** code-side already shipped Phase 0; real-device validation stays deferred to Phase 8 per the unchanged push-trap analysis.
  - **Remaining V2 product items (web UI, onboarding, group switcher):** scope + design in `Project Files/coding-plans/H5-V2-product-items.md`. The `mountLocalUi(bundle.agent)` substrate path is already in place (Phase 3); the UI is a static HTML/JS frontend that POSTs to `/tasks/send` and consumes the SSE event stream. Independent of substrate work; ships in a focused UI session. Estimated ~7 days of focused implementation work across the three items.
- 2026-05-04 — Phase 7 product item #2 — **H5 onboarding (invite-link → group-token) shipped (V0)** + multi-user testbed launcher.
  **SDK additive (`packages/core/src/permissions/GroupManager.js`):** new `issueInvite(groupId, opts) → invite` (signs an unbound, time-limited, single-use token bound to the admin's identity, with a random nonce; persists in the admin's vault); new `verifyInvite(invite) → bool` (signature + expiry + shape check); new `redeemInvite(invite, memberPubKey, opts) → proof` (verifies + admin-mismatch guard + nonce-already-redeemed guard; mints + persists a `GroupProof` for the member; marks the nonce consumed). Wire format: `{kind: 'invite', groupId, adminPubKey, role, nonce, issuedAt, expiresAt, sig}`. 9 new tests in `packages/core/test/GroupManager.invites.test.js` covering happy path, tamper detection, expiry, single-use enforcement, admin-mismatch rejection, role-other-than-default, multi-redemption fanout, malformed-pubkey rejection.
  **App-level (`apps/neighborhood-v0/src/onboarding.js`):** new `buildOnboardingSkills({groupManager, members, groupId, onSpawn?})` exporting two `defineSkill` definitions: `issueInvite` (admin's UI calls this to mint a link), `redeemInvite` (browser POSTs invite + display name; skill optionally spawns runtime via `onSpawn`, then mints proof, registers new member in `MemberMap`, returns `{groupProof, spawnedUrl?}`). 8 new tests covering both production-flow (caller passes `memberPubKey`) and testbed-flow (`onSpawn` mints + spawns).
  **Web UI (`apps/neighborhood-v0/web/onboard.html`):** dual-mode page based on `?invite=<token>` URL query param. Admin mode shows an "Issue invite" form (role + TTL); member mode shows a "Display name" form that POSTs to `redeemInvite` and redirects to the spawned URL. SDK-free (no nacl in the browser); the agent process generates the new identity in the spawn hook.
  **Multi-user testbed (`apps/neighborhood-v0/bin/h5-testbed.js` + `npm run testbed`):** the user-asked-for "simple GUI for testing multiple users". Boots one admin + N pre-seeded members in a single Node process over a shared `InternalBus`; each on its own `mountLocalUi` port. The onboarding skills' `onSpawn` hook is wired to bring up a fresh in-process agent + UI for every redeemed invite. Cluster surfaces a runtime-built landing page at `/testbed.html` (in-memory `extraStaticFiles` overlay) that lists every member's display name + role + URL; mutated as members are added. 4 end-to-end testbed tests + live-fire validated through curl. H5 test totals: **34/34** (was 22; +9 GroupManager invites in core, +8 onboarding skill, +4 testbed end-to-end). Three Phase 7 V2 product items now done; **Phase 7 closes** — onward to Phase 8 (real-device validation + mesh-demo migration).
- 2026-05-04 — H4 (tasks-v0) post-Phase-7 catch-up: web UI + pod-config roster + sketch refresh. Three things landed alongside H5's V2 work:
  1. **MemberMap.fromPodConfig wired into H4 + H5.** Both `createTasksAgent` and `createNeighborhoodAgent` now accept either `members: Array` (current, kept for tests) or `pod: {client, configUri, fallback?}` (new — uses Phase 4.1's `MemberMap.fromPodConfig`). Mutually exclusive at the API level. `createNeighborhoodCluster` propagates per-group `pod` config too. 3 new H4 tests cover the pod-backed path + NOT_FOUND tolerance + the mutual-exclusion guard.
  2. **H4 web UI shipped (V0).** Static HTML/JS in `apps/tasks-v0/web/` mirroring H5's pattern, with H4-specific surfaces: status pills (ready / waiting / blocked from `computeStatus`), role-aware controls (claim/complete for assignee, reassign for admin/coordinator, remove for admin), DAG-aware add form (deps + due date + skills), status filter on the open list. CLI launcher at `bin/tasks-ui.js` (`--actor + --role` for single-member quick-start, `--actor + --config` for multi-member household). The actor's role map is surfaced to the frontend via `extraStaticFiles: {'/tasks-config.json'}` so the UI renders the right buttons; the role-policy gate at the ItemStore layer enforces server-side. 10 new web smoke tests (H4 total: 24 integration + 10 web = 34/34).
  3. **H4 sketch doc refreshed.** `Project Files/Substrates/apps/H4-tasks.md` was stale: referenced deleted L1d primitives (`SkillRouter`, `EventBroadcaster` — gone Phase 3.1) and a "migrate to lifted helpers" item that already happened. Rewrote to reflect post-Phase-7 reality: substrate consumption table, SDK direct use, web-UI scope (mirrors H5's pattern), notifier wiring snippet (~10 lines, currently optional), and a substrate-side polish list pruned to actually-open items.
  Regression: core 1245+13 skipped, agent-ui 8/8, identity-resolver 28/28, relay 109/109, tasks-v0 34/34 (was 21; +13), neighborhood-v0 22/22, archive 96/96, import-bridge-v0 8/8 — all green.
- 2026-05-04 — Phase 7 product item #3 — **group switcher shipped (V0).** SDK additive: `mountLocalUi` + `core.A2ATransport` accept `extraStaticFiles: Record<path, string|Uint8Array>` (in-memory virtual files served alongside `staticDir`; checked first so a virtual `/groups.json` overrides a disk file at the same path). The transport reads from the live object reference on every request, so the launcher can build the index map after every port is bound. App work: new `createNeighborhoodCluster({identity?, groups: [...], bus?})` factory builds N agents with a shared `AgentIdentity` (model (b) per the product-items doc — "one core.Agent per group with shared identity"). Launcher gains `--groups <gid1>,<gid2>` mode that mounts one `mountLocalUi` per group on consecutive ports + populates `/groups.json` via the shared extras map. Web UI: `mountGroupSwitcher(<select>)` fetches `/groups.json` and renders one option per group; selecting another group navigates to its URL preserving the path. 4 new tests in `apps/neighborhood-v0/test/multigroup.test.js`; H5 total 22/22 (was 18; +4). Live-fire smoke: `--groups block-42,book-club` launches two instances, both serve the same `groups.json`, both pages render the dropdown markup. Two of three Phase 7 V2 product items now done; **onboarding (invite-link → group-token) remains** (~3 days, scoped in `Project Files/coding-plans/H5-V2-product-items.md`).
- 2026-05-04 — Phase 7 product item #1 — **per-member web UI shipped (V0).** SDK additive changes:
  - `core.A2ATransport`: new `staticDir` + `indexFile` constructor opts. When set, the request router falls through to static-file serving for unmatched paths (path-traversal-hardened, mirrors the relay's `serveStaticDir` pattern). Backward-compatible: defaults are `null` / `'index.html'`, so existing consumers see no change.
  - `agent-ui.mountLocalUi`: forwards `staticDir` + `indexFile` to A2ATransport.
  - `agent-ui.LocalUiAuth`: new V0 localhost-trust shim. Implements `A2ATLSLayer`'s interface (encrypt / decryptAndVerify / wrapOutbound pass-throughs) and on `validateInbound` returns `{tier: 1, claims: {sub: localActor}, peerId: localActor}` for every request. The architectural argument: when the agent binds on `127.0.0.1`, any process on the same machine could already exfiltrate the keypair from disk, so localhost-trust is the right level of security for the localhost-only UI. V1 will swap this for cap-token-in-cookie or OAuth-PKCE.
  App work:
  - `apps/neighborhood-v0/web/`: `index.html` (open-requests browse + post-form), `mine.html` (requester's own requests + cancel), `app.js` (shared `fetch()`-based A2A client; `callSkill(skillId, args)` POSTs to `/tasks/send`, reads `artifacts[0].parts` back), `style.css` (minimal functional layout, no framework). The frontend uses `mountLive(2s polling)` to refresh the page; true SSE via `core.protocol.LiveSyncSkill` is V1.
  - `apps/neighborhood-v0/bin/neighborhood-ui.js`: CLI launcher with `--actor / --group / --port / --peers / --skills / --posture` flags. Single-member mode is good for smoke testing; multi-member callers spin up multiple instances and cross-register pubkeys.
  - `apps/neighborhood-v0/test/web.test.js`: 9 smoke tests covering static-file serving (HTML/JS/CSS/agent-card), 404, path-traversal block, and end-to-end `postRequest` + `listMyRequests` over `POST /tasks/send` through `LocalUiAuth`. H5 total 18/18 (9 integration + 9 web smoke).
  - Verified end-to-end with a real launched server: HTML serves, agent card is reachable, `listOpen` over A2A returns the empty items shape the frontend expects.
  Regression: core 1245/1245 + 13 skipped, relay 109/109, agent-ui 8/8, archive 96/96, tasks-v0 21/21 — all green. **Two product items remain:** onboarding (~3 days) and group switcher (~2 days), both scoped in `Project Files/coding-plans/H5-V2-product-items.md`.

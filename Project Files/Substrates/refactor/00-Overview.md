# Substrate-vs-SDK refactor — overview & execution plan

| | |
|---|---|
| **Audited** | 2026-05-04 |
| **Audit trigger** | User identified that L1e (skill-match) reinvented an abstraction `@canopy/core` already provides (a `transport` interface duplicating `core.Agent`). Asked: "Is the same problem present in the other substrates?" |
| **Scope** | 10 substrates × 4 SDK packages (`core`, `relay`, `pod-client`, `react-native`) + light pass on `apps/folio-mobile` and `apps/household` |
| **Output** | This index + 11 detail docs in this directory + `SDK-surface-map.md` reference |

> **Headline:** the pattern is real and project-wide. **Four substrates are critical or high-severity** (L1b, L1d, L1e, L1g, L1a), needing significant rewrite or deletion. **Three are clean** (L1c, L1i, L1j). **Two are mechanical** (L1h, L1f). One package (L1g oauth-vault) should be deleted entirely. Total estimated effort: **~22–25 working days** plus cross-cutting cleanups. The user's instinct was right — substrates were being built parallel to the SDK rather than on top of it.

---

## Severity matrix

| Substrate | Pkg | Severity | Headline | Estimated effort | Detail doc |
|---|---|---|---|---|---|
| **L1b item-store** | `item-store` | 🔴 critical | Zero `@canopy/*` deps; only ships `InMemoryBackend`; the promised `PodBackend` was never written. Worse than L1e — there was never even a real production partner. | 5–6 days | [`L1b-item-store-refactor.md`](L1b-item-store-refactor.md) |
| **L1d agent-ui** | `agent-ui` | 🔴 high (one critical sub-finding) | `composeAgent` + `SkillRouter` build a synthetic `{invokeSkill}` agent shape that bypasses `core.A2ATransport` + `A2AAuth` + `taskExchange`. Consumers silently forfeit group filtering, tier visibility, capability tokens, streaming. | ~4 days | [`L1d-agent-ui-refactor.md`](L1d-agent-ui-refactor.md) |
| **L1e skill-match** | `skill-match` | 🔴 critical | Already known. `transport` abstraction duplicates `core.Agent`. Surgical rewrite over `pubSub.js` + `LocalTransport`. | 2–3 days | [`L1e-skill-match-refactor.md`](L1e-skill-match-refactor.md) |
| **L1g oauth-vault** | `oauth-vault` | 🔴 critical | Near-complete fork of `core.OAuthVault`. In-memory `Map`, no underlying `Vault`, contradicts its own RN-Keychain sketch. Two consumer apps use *different* vaults already. | ~½ day (DELETE) | [`L1g-oauth-vault-refactor.md`](L1g-oauth-vault-refactor.md) |
| **L1a sync-engine** | `sync-engine` | 🟠 high | Two substrates wearing one package: V0 `SyncEngine` reinvents `core.DataSource`; V0.3 `BidirectionalSyncEngine` correctly composes `PodClient`. Delete the V0 tier. | ~4 days | [`L1a-sync-engine-refactor.md`](L1a-sync-engine-refactor.md) |
| **L1h identity-resolver** | `identity-resolver` | 🟡 medium | Not redundant with `GroupManager.listMembersByRole` (different keys, different jobs). Mechanical issues: zero `@canopy/*` deps, `node:events` not `core.Emitter`, role drift from `GroupManager`. | ~½ day | [`L1h-identity-resolver-refactor.md`](L1h-identity-resolver-refactor.md) |
| **L1f notifier** | `notifier` | 🟡 medium | `Channel` interface is a structural rename of L1c's `MessagingBridge`. `RecordingChannel` and `InMemoryBridge` are the same fake twice. `PodScheduleStore` composes `pod-client` correctly. | ~2 days | [`L1f-notifier-refactor.md`](L1f-notifier-refactor.md) |
| **L1c chat-agent** | `chat-agent` | 🟢 low | Materially clean. Correctly consumes `llm-client` (L1j); correctly avoids reinventing `core.Agent`; tool-catalog correctly separate from `defineSkill`. Just polish (`Emitter`, orphaned `(Copy).js` file). | ~½ day | [`L1c-chat-agent-refactor.md`](L1c-chat-agent-refactor.md) |
| **L1i pod-search** | `pod-search` | 🟢 low (V0) + medium forward | V0 is a 228-line in-memory keyword index, no SDK touch yet. V1 must compose `PodClient.list/read` + `TombstoneStore` + RN service-factory — forward contract documented. | 0 days now; ~3 days at V1 | [`L1i-pod-search-refactor.md`](L1i-pod-search-refactor.md) |
| **L1j llm-client** | `llm-client` | 🟢 low + medium forward | Cleanest. 71-line `LlmClient`, no SDK reinvention. Cloud providers when added must compose `core.OAuthVault` + `makeAuthorizedFetch` (NOT the duplicate L1g substrate). | 0 days now; ~5h forward | [`L1j-llm-client-refactor.md`](L1j-llm-client-refactor.md) |

**Apps baseline:** Folio mobile is the **gold-standard SDK-composition baseline** in the monorepo. Household is the **canonical pattern donor** for multi-member machinery the substrates haven't yet built (`MemberWebIdMap`, `HybridPodOrchestrator`, `Scheduler`/`NudgeTimer`/`DailyDigest`). Detail: [`apps-baseline.md`](apps-baseline.md).

---

## Cross-cutting findings

These touch most or all substrates and should be done as one sweep, not per-substrate:

### 1. `node:events` vs `core.Emitter` (RN-broken)
The SDK surface map flags `core.Emitter` as the correct event base. Multiple substrates extend `node:events` instead, which breaks under React Native's Hermes runtime.
- **L1b** (`item-store/src/ItemStore.js`)
- **L1f** (`notifier/src/Notifier.js`)
- **L1h** (`identity-resolver/src/MemberMap.js:10`)
- **L1c** (`chat-agent/src/ChatAgent.js:20`)
- Likely others — verify during the sweep.

**Fix:** ~1h per substrate, swap `import { EventEmitter } from 'node:events'` → `import { Emitter } from '@canopy/core'`. Add `@canopy/core` to `package.json` deps if missing. **Sweep target: 1 day total.**

### 2. Inline `ulid()` / `genId()` duplication
Substrates ship their own copies of small ID-generation helpers when `core.genId` exists.
- **L1b** has its own `ulid.js`.
- **L1f** has its own `ulid()` inlined.
- **L1h** has its own `ulid.js`.
- **L1e** has its own `ulid.js`.
- Possibly more.

**Fix:** delete each, import `genId` from `@canopy/core`. ~1h total.

### 3. Missing `@canopy/*` dependencies in `package.json`
Several substrates declare zero SDK dependencies (which is the structural sign of SDK-bypass):
- **L1b** `package.json:14-17` — zero deps.
- **L1h** `package.json` — zero deps.
- Verify the others during the sweep.

**Fix:** add the deps as the refactors land — not a separate task.

### 4. `Channel` (L1f) ≡ `MessagingBridge` (L1c) — choose one
The same interface ships under two names. Pick one (lean: keep `MessagingBridge` in L1c since L1c is cleaner and the upstream pattern source). L1f imports it from L1c. `RecordingChannel` and `InMemoryBridge` collapse into one fixture in `@canopy/core/test-utils` (or wherever core wants to put test fakes).

### 5. SDK gaps surfaced (not substrate work, but blocks substrate work)
- **`SolidPodSource.list({recursive})` ignores `_opts`** (`packages/core/src/storage/SolidPodSource.js:387`). `PodClient.list({recursive: true})` is documented but currently flattens. Blocks L1i V1 and likely affects L1a's bidirectional engine.
- **`MobilePushBridge` real-device verification** — flagged across multiple audits. Needed for L1f push channel, H5 V2 step 6.
- **Re-exports missing from `core/src/index.js`:** `helloGates` (`tokenGate`/`groupGate`/`anyOf`), relay's concrete `MemoryQueueStore`/`SqliteQueueStore`. Substrates currently can't consume the public API.

---

## Cross-substrate dependencies (refactor order constraints)

```
L1g delete  ─────────────────────► (independent — fast win)
L1c polish  ─────────────────────► (independent — fast win)

L1h fromPodConfig (with pubKey slot) ──┐
                                       ├──► L1e refactor ──┐
core.Emitter sweep ────────────────────┘                   │
                                                           ├──► H5 V2 multi-process smoke
core.A2ATransport (already shipped) ──► L1d refactor ──────┘                       

L1b rewrite ──┬──► household migration
              ├──► tasks-v0 migration  
              ├──► neighborhood-v0 migration
              └──► presence-v0 migration

L1a V0 delete ──► import-bridge-v0 migration to core.LiveSyncSkill

L1f Channel align ──► (consumes L1c MessagingBridge)

(SDK fix needed first) core SolidPodSource.list ──► L1i V1 (later)

(SDK fix needed first) MobilePushBridge verify ──► L1f push channel
                                                 ──► H5 V2 step 6
```

Critical chain for H5 V2: **L1h → L1e → (optionally L1d) → H5 V2 step 3**.

---

## Proposed execution order

### Phase 0 — SDK pre-requisite fixes (~1 day)
Block multiple substrate refactors. Do these first.

1. Fix `SolidPodSource.list({recursive: true})` to honour the option (`packages/core/src/storage/SolidPodSource.js:387`).
2. Re-export `helloGates`, `MemoryQueueStore`, `SqliteQueueStore` from `core/src/index.js` and `relay/src/index.js`.
3. Decide on `MobilePushBridge` verification — schedule a real-device test (separate effort, can run in parallel with substrate work).

### Phase 1 — Fast wins (~1 day)
Independent, low-risk. Do these in any order or in parallel.

1. **L1g delete** — remove the `oauth-vault` package; migrate `apps/import-bridge-v0` to `core.OAuthVault`. ~½ day.
2. **L1c polish** — `Emitter` swap, delete orphaned `ChatAgent (Copy).js`. ~½ day.

### Phase 2 — Cross-cutting sweep (~1 day)
Do once, across all substrates that need it. Avoids per-substrate touch later.

1. `node:events` → `core.Emitter` everywhere. Add `@canopy/core` deps where missing.
2. Inline `ulid()`/`genId()` → `import { genId } from '@canopy/core'`.

### Phase 3 — H5 V2 critical path (~3–4 days)
This unblocks `H5-V2-resume.md`. Order within Phase 3 is fixed.

1. **L1h** — add `MemberMap.fromPodConfig({ podClient, groupId })`, schema includes `pubKey` per L1e cross-substrate finding. Mechanical lifts (zero `@canopy/*` deps fix, role-drift bridge). ~½ day.
2. **L1e** — surgical rewrite per `L1e-skill-match-refactor.md`. Apps (`apps/neighborhood-v0`, eventually `apps/tasks-v0`) move to the new constructor shape. ~2–3 days.

### Phase 4 — L1d agent-ui (decision required) (~4 days)
**Open question for the user:** L1d's refactor breaks every app currently using `composeAgent`/`SkillRouter`. Options:

- **(a) Land L1d before H5 V2 multi-process smoke.** Apps end up on the real `core.Agent` + `A2ATransport` from the start. Slower path to H5 V2 visible progress (~4 extra days before the smoke), but cleaner end state — no second migration later.
- **(b) Land L1d after H5 V2 ships.** H5 V2 ships on the synthetic-shape, then L1d refactor migrates everything in a sweep. Faster H5 V2 but two app-side migrations (today's L1e refactor + later L1d refactor) — twice the churn for `apps/neighborhood-v0`.

**Lean: (a).** The H5 V2 plan already calls for an `Agent({transport: RelayTransport})` construction in step 1; doing L1d first means that real Agent runs the skill router too, so step 1 + L1d land coherently. Also: today's `composeAgent` lift (just done) effectively wasted half a day if we're keeping it — better to convert that work into the proper A2A wrapper now while it's fresh. **Confirm before scheduling.**

### Phase 5 — Big rewrites (~9–10 days)
Order by consumer count.

1. **L1b** — rewrite `ItemStore` over `PodClient` + `MergeContracts` + `FederatedReader`. Migrate consumers: `apps/household`, `apps/tasks-v0`, `apps/presence-v0`, `apps/neighborhood-v0`. ~5–6 days. **Mine `apps/household/src/pods/HybridPodOrchestrator.js` as the pattern source per the apps baseline.**
2. **L1a** — delete V0 `SyncEngine`/`IngestQueueSource`/`LocalFolderSource`/`InMemoryBackend`; rename `BidirectionalSyncEngine` → `SyncEngine`; migrate `apps/import-bridge-v0` to `core.LiveSyncSkill`. ~4 days.

### Phase 6 — Polish + alignment (~2 days)
1. **L1f** — align `Channel` ≡ `MessagingBridge`; promote `core.Emitter` swap; wire `MobilePushBridge` once Phase 0 #3 completes. ~2 days.

### Phase 7 — H5 V2 product items
Resume `Project Files/coding-plans/H5-V2-resume.md` from step 3 onward (multi-process smoke, topic-aware queue on relay, group-broadcast envelope, E2c, group-roster query, then web UI / onboarding / group switcher).

### Forward contracts (no work now, but locked in their detail docs)
- **L1i V1** (~3 days when V1 lands): compose `PodClient.list/read` + subscribe to `'delete-local'` events for tombstones; split `*.rn.js`.
- **L1j cloud providers** (~5h when added): compose `core.OAuthVault` + `makeAuthorizedFetch`.

---

## Total effort estimate

| Phase | Days | What's blocked until done |
|---|---|---|
| 0 — SDK fixes | 1 | L1i V1, L1f push wake |
| 1 — Fast wins | 1 | nothing (parallelisable) |
| 2 — Cross-cutting sweep | 1 | nothing (parallelisable) |
| 3 — H5 V2 critical path | 3–4 | H5 V2 multi-process smoke |
| 4 — L1d agent-ui | 4 | All app skill-routing |
| 5 — Big rewrites (L1b, L1a) | 9–10 | apps that depend on item-store |
| 6 — Polish (L1f) | 2 | — |
| **Total before resuming H5 V2 product items** | **~21–23 days** | |
| 7 — H5 V2 resume | (per H5-V2-resume.md) | |

Phase ordering allows some parallelism — Phase 1 + Phase 2 run alongside Phase 3 if multiple hands available. Single-developer serial path: ~22 days.

---

## What I'm asking before scheduling

1. **Phase 4 L1d order — (a) or (b)?** See decision in Phase 4 above. My lean: (a).
2. **Phase 5 big-rewrite priority — L1b first or L1a first?** L1b touches more apps (4 vs 1) but L1a is simpler (delete-and-rename). My lean: L1b first because every app blocked on it carries technical debt every day until it lands.
3. **Should L1g deletion happen before or after the others?** It's independent and ~½ day, but it removes a package that `apps/import-bridge-v0` currently depends on. My lean: do it in Phase 1 — clean break, lower mental overhead.
4. **Cross-cutting Phase 2 sweep — separate sweep or fold into each substrate's refactor?** I have it as a separate sweep because it's faster (one PR) and avoids the "did we remember to swap Emitter" failure mode per substrate. Confirm.

---

## What was learned (decision log)

- The audit confirmed the user's hypothesis. Five of ten substrates have material SDK-bypass; one (L1g) is a near-complete duplicate.
- The L1d finding is the most uncomfortable one because the lifts done earlier today (`composeAgent`, `ctxActor`) sit on top of L1d's broken foundation. They aren't *wrong* given L1d's current shape — they correctly factored duplicated app-glue out of the apps — but they're built around the wrong shape and will need to be redone (or deleted) when L1d migrates to `A2ATransport`.
- The audit also produced a positive finding: **Folio mobile** is a clean SDK-composition baseline. Substrates that don't know what "right" looks like should imitate Folio's pattern — `serviceBuilder.js:32-49` + `OidcSessionRN.getAuthenticatedFetch():212-243` are the canonical examples.
- **Household** is a pattern donor: `MemberWebIdMap`, `HybridPodOrchestrator`, `Scheduler`/`NudgeTimer`/`DailyDigest`, and the `routingTable` are working code that the substrates should mine when they need those features.
- The user's instinct that "a lot of code is built double" is now quantified: roughly **half of all substrate code that's not a thin façade is duplicating something the SDK already provides**.

# SDK test implementation plan

| | |
|---|---|
| **Status** | in-progress |
| **Started** | 2026-04-28 (T.1 spawned) |
| **Last updated** | 2026-04-28 (T.1 in-progress) |
| **Owner** | unassigned |
| **Blocked on** | nothing — strategy locked, ready to build |

**Goal:** turn the testing tiers and 18 priority scenarios from
[`./sdk-test-strategy.md`](./sdk-test-strategy.md) into concrete task
specs that implementation agents can execute.  This is the plan for
**building the new "scenario-based integration" tier**.

**Refs:**
- [`./sdk-test-strategy.md`](./sdk-test-strategy.md) — the strategy this
  plan implements.
- [`./track-H-demo-meshlab.md`](./track-H-demo-meshlab.md) — Mesh Lab,
  the visualizer that becomes Phase 5 (T.7).
- [`./AGENT-RULES.md`](./AGENT-RULES.md) — agent rules every spawned
  agent must follow.

---

## Track-level open questions

Inherited from the strategy (and already leaned).  Confirm-or-override
before T.1 spawns.

| #        | Question                                                                                                               | Lean                                                                                             | Lock target |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------- |
| Q-Test.1 | `test/scenarios/` location: top-level (repo-root) vs `packages/integration-tests/` workspace package                   | put it in the packages folder right away                                                         | Before T.1  |
| Q-Test.2 | Run as part of `npm test` (default) vs `npm run test:scenarios` (opt-in)                                               | Both — root `npm test` includes scenarios; `npm run test:scenarios` is the fast-path dev command | Before T.1  |
| Q-Test.3 | Simulate clock-skew between agents (each agent has its own offset from `Date.now()`)?                                  | **Locked: v1 scope.** T.1 ships `MockClock` + best-effort `Lab.injectClockSkew`; full per-agent SDK-side wiring requires a clock-injection refactor across ~100 `Date.now()` call sites — tracked as 🔴 HIGH PRIORITY in `TODO-GENERAL.md`.  Real clock-skew scenarios wait on that refactor.                                                                | Before T.6  |
| Q-Test.4 | `pod: 'real:css'` opt-in (env var) vs default-when-CSS-running                                                         | Opt-in via env (matches existing `CSS_URL` pattern)                                              | Before T.1  |
| Q-Test.5 | A2A external-interop scenario: Node `eventsource` polyfill (dev-dep on test-scenarios workspace) vs skip on older Node | `eventsource` polyfill in test-scenarios devDeps; doesn't pollute SDK package deps               | Before T.6  |
| Q-Test.6 | Granularity within T.2–T.5: ONE agent per area (5 scenarios per agent) vs ONE agent per scenario                       | please explain this one                                                                          | Before T.2  |
| Q-Test.7 | Mesh Lab (T.7): build now or defer until apps demand it                                                                | Defer — scenario suite has full correctness coverage; visualizer is dev-experience polish        | Before T.7  |

---

## Internal parallelism

```
T.1 — Harness skeleton (independent, blocks everything)
     │
     ├──> T.2 — Routing scenarios       (5 scenarios)
     ├──> T.3 — Identity scenarios      (5 scenarios)
     ├──> T.4 — Protocol scenarios      (4 scenarios)
     └──> T.5 — Governance/pod scenarios (4 scenarios)

T.6 — v2 / optional scenarios (opt-in; spawn when a real consumer hits the gap)
T.7 — Mesh Lab visualizer (deferred; built on top of the same scenario modules)
```

- **T.1 is the bottleneck.**  Until the harness API is stable, no
  scenarios can be written.
- **T.2–T.5 are mutually independent.**  All four consume the same
  harness API; their files are in disjoint subdirs.  Can run as four
  parallel agents.
- **T.6 + T.7 are optional / deferred.**

A team of 1: T.1 → T.2 → T.3 → T.4 → T.5 (~1 week wall-clock).
A team of 4 (after T.1): T.1 (~1 day) then T.2/T.3/T.4/T.5 in parallel (~2 days each) ≈ 3-day total.

---

## Hand-off triggers

| When this completes | These tracks unblock |
|---|---|
| **T.1** | T.2–T.5 can spawn.  Harness API is stable. |
| **T.2** | Routing regressions caught in CI. |
| **T.3** | Identity regressions caught in CI; recovery flows verified before any user trusts them. |
| **T.4** | Protocol-level regressions caught (streaming/cancel/conflict events). |
| **T.5** | Governance regressions caught (role transitions, capability revocation). |
| **All v1 (T.1–T.5)** | SDK has a regression-test backbone covering every cross-component flow.  Track-H app work proceeds with confidence. |

---

## Tasks

### T.1 — Harness skeleton

| | |
|---|---|
| **Status** | in-progress |
| **Tag** | [NEW] |
| **Notes** | Bottleneck.  Must land before T.2–T.5 can start.  Single agent. |

**Files:**

```
create:
  test/scenarios/                                   # new top-level test workspace
  test/scenarios/package.json                       # name: "@canopy/test-scenarios"
                                                    # file: refs to all SDK packages
  test/scenarios/_harness/
    Lab.js                                          # the orchestrator class
    ToggleableTransport.js                          # transport wrapper for chaos toggles
    MockPod.js                                      # in-memory pod backend conforming to PodClient shape
    fixtures.js                                     # canned identities, mnemonics, group keys for scenarios
    index.js                                        # barrel
  test/scenarios/_harness.test.js                   # smoke test: Lab boots, 3 agents ping each other, teardown
  test/scenarios/README.md                          # how to write a scenario, harness API reference

modify:
  package.json (root)                               # add `test:scenarios` script + extend root `test`
```

**Sequence:**

- [ ] 1. Lock Q-Test.1 (top-level) + Q-Test.2 (default + opt-in) + Q-Test.4 (CSS opt-in via env).
- [ ] 2. Set up the `test/scenarios/` workspace.  `package.json` declares `file:` deps on `@canopy/core`, `@canopy/pod-client`, `@canopy/relay`, plus `vitest` devDep.  `npm install --prefix test/scenarios`.
- [ ] 3. Implement `Lab.boot({ agents, transports, relay, pod, topology })`.  Constructs N `Agent` instances over `InternalTransport` (single shared `InternalBus`); each gets fresh `AgentIdentity` + `VaultMemory`; identities pre-populated for predictable test fixtures.
- [ ] 4. Implement `ToggleableTransport` — wraps a real transport instance; per-instance `enabled: boolean`; when disabled, every method throws `TRANSPORT_DISABLED`.  This is the chaos primitive.
- [ ] 5. Implement `MockPod` — in-memory pod backend.  Implements the same shape as Track A's `PodClient` consumes (`read`, `list`, `write`, `delete`, `exists`).  Stores resources in a `Map`.  Optional knobs: simulated latency, write-conflict injection.
- [ ] 6. Implement `Lab` helper methods:
  - `partitionMesh(groups)` — sets ToggleableTransport.enabled = false for cross-group edges.
  - `healPartition()` — re-enables all.
  - `dropTransport(agentName, transportName)` / `addTransport(...)` — swap a single transport.
  - `injectLatency(a, b, ms)` — adds a per-edge timeout wrapper.
  - `killAgent(name)` / `restartAgent(name)` / `respawnFromMnemonic(name, mnemonic)` — lifecycle helpers.
  - `routeFor(a, b)` → `{ tier, transport, via? }` (delegates to `agent.reachabilityFor`).
  - `assertRoute(a, b, expected)` — vitest assertion sugar.
  - `invoke(a, b, skill, parts)` — sugar over `agent.invoke`.
  - `invokeStream(a, b, skill, parts)` — sugar; returns a stream handle with `.cancel()`.
  - `podWrite(name, uri, content)` / `podRead(name, uri)` — sugar over `PodClient`.
  - `advanceTime(ms)` — exposes `vi.useFakeTimers` for interval-based scenarios.
  - `assertNoLeak(viaName, secretBytes)` — asserts the named bridge agent's transport log doesn't contain the secret.
  - `assertManifestIntact(name)` — calls `IdentityPodStore.verifyManifest` for that agent.
  - `assertSyncConverged(names, path)` — both/all named agents have the same content at `path`.
- [ ] 7. Implement `Lab.teardown()` — clears all timers, closes all agents, drops all bus state, releases tmp-dir handles.  Idempotent.
- [ ] 8. Add `Lab.agent(name)` escape hatch → returns the underlying `Agent` instance for custom needs.
- [ ] 9. Smoke test in `_harness.test.js`: boot 3 agents; assert they can ping each other; teardown; verify no leaked timers.
- [ ] 10. Write `test/scenarios/README.md` — short reference covering how to write a scenario file, the Lab API, and the harness invariants (no real network, no real pod by default, deterministic).

**DoD:**
- [ ] `Lab.boot` constructs 3 agents over InternalTransport in <500ms.
- [ ] All listed helper methods present + JSDoc'd; smoke-tested.
- [ ] `_harness.test.js` smoke test passes; teardown leaves no timers.
- [ ] `npm run test:scenarios` runs from repo root and passes.
- [ ] `npm test` (root) includes `test:scenarios` in the aggregate.
- [ ] No new top-level deps in `@canopy/*` packages (test workspace is its own thing).

**Notes (team scratchpad):**

```
(empty)
```

---

### T.2 — Routing scenarios

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Depends on T.1.  Five scenarios; one agent. |

**Files:**

```
create:
  test/scenarios/routing/
    fall-through.scenario.test.js
    hop-sealed.scenario.test.js
    oracle-preselection.scenario.test.js
    transport-flap.scenario.test.js
    mesh-partition-heal.scenario.test.js
```

**Scenarios** (each is one test file; full spec in [`./sdk-test-strategy.md`](./sdk-test-strategy.md) §Priority scenarios):

- [ ] 1. `fall-through.scenario.test.js` — Alice→Bob succeeds via direct, then via relay after rendezvous drops, then via hop-Carol after relay drops.  Each transition completes <500ms.
- [ ] 2. `hop-sealed.scenario.test.js` — Bob's payload arrives intact via Carol-bridge with sealed forward; Carol's relay-receive log contains no plaintext fragment.
- [ ] 3. `oracle-preselection.scenario.test.js` — once oracle gossip converges, hop routing picks the right bridge on first attempt (no probe-retry).  Without oracle wired, probe-retry fires first.
- [ ] 4. `transport-flap.scenario.test.js` — 10 cycles of drop/add a transport in 1 second don't thrash routing.
- [ ] 5. `mesh-partition-heal.scenario.test.js` — partition Alice from Bob (both still see Carol); heal; gossip converges within 3 oracle intervals.

**DoD:**
- [ ] All 5 scenarios green; total wall-clock <15s.
- [ ] Each scenario file is self-contained — no shared mutable state across scenarios.
- [ ] Scenarios fail informatively: when a route assertion fails, the error message includes `expected={...}, got={...}, edge-states={...}`.

---

### T.3 — Identity scenarios

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Depends on T.1.  Five scenarios; one agent. |

**Files:**

```
create:
  test/scenarios/identity/
    bip39-recovery.scenario.test.js
    cloud-backup-recovery.scenario.test.js
    cross-device-sync.scenario.test.js
    key-rotation-mid-call.scenario.test.js
    concurrent-manifest-write.scenario.test.js
```

**Scenarios:**

- [ ] 1. `bip39-recovery.scenario.test.js` — kill alice-phone; spawn alice-phone-2 with same BIP-39; identity restores from pod within one IdentitySync interval; device list has phone-2 paired and phone-1 retired.
- [ ] 2. `cloud-backup-recovery.scenario.test.js` — same as (1) but recovery via `CloudBackup.restore` (cloud passphrase, no BIP-39 paper).
- [ ] 3. `cross-device-sync.scenario.test.js` — Alice has laptop + phone; add a contact on laptop; phone sees the same contact within one IdentitySync interval.
- [ ] 4. `key-rotation-mid-call.scenario.test.js` — Alice rotates root key while Bob has an active multi-turn session; current session continues using old key, next session uses new; auth-log records both events.
- [ ] 5. `concurrent-manifest-write.scenario.test.js` — two devices write the IdentityPodStore simultaneously; per Q-B.3 lock LWW + retry both succeed; final manifest contentHash consistent.

**DoD:**
- [ ] All 5 scenarios green; total wall-clock <15s (uses fake timers for interval polling).
- [ ] Recovery scenarios verify the auth-log records the recovery event (`pod-migrated` per identity-pod-schema).
- [ ] Concurrent-write scenario actually exercises the retry path (mock pod injects one ConflictError on the manifest write).

---

### T.4 — Protocol scenarios

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Depends on T.1.  Four scenarios; one agent. |

**Files:**

```
create:
  test/scenarios/protocol/
    streaming-cancel.scenario.test.js
    input-required-multi-turn.scenario.test.js
    multi-recipient-relay-restart.scenario.test.js
    conflict-event-listener.scenario.test.js
```

**Scenarios:**

- [ ] 1. `streaming-cancel.scenario.test.js` — Alice invokes Bob's `count-to-100` streaming skill; after 10 chunks Alice cancels; Bob's stream stops within 200ms; subsequent chunks not delivered.
- [ ] 2. `input-required-multi-turn.scenario.test.js` — Alice invokes Bob's `prompt-then-respond` skill over A2A; Bob returns input-required; Alice supplies input; Bob completes.  Cancel-mid-prompt variant included.
- [ ] 3. `multi-recipient-relay-restart.scenario.test.js` — Alice broadcasts to 5 peers via E2b; mid-flight, the relay restarts; per Q-E.3 lock the SQLite queue resumes; partial responses returned to Alice with `partial: true`.
- [ ] 4. `conflict-event-listener.scenario.test.js` — Alice writes /notes/X with auto-If-Match; Bob writes the same URI with `force: true`; Alice's `'conflict'` listener fires; listener calls `event.resolveWith(merged)`; final pod content is the merged version.

**DoD:**
- [ ] All 4 scenarios green; total wall-clock <15s.
- [ ] Streaming scenario verifies cancellation propagated to Bob's handler (Bob's side observes the abort signal).
- [ ] Multi-recipient relay-restart uses the `MockPod` + an actual in-process relay restarted via `lab.restartRelay()` (new Lab method that may need surfacing during T.4).

---

### T.5 — Governance / pod scenarios

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Depends on T.1.  Four scenarios; one agent. |

**Files:**

```
create:
  test/scenarios/governance/
    role-demote-mid-call.scenario.test.js
    revoke-with-active-token.scenario.test.js
  test/scenarios/pod/
    conflict-policy-reject.scenario.test.js
    export-import-roundtrip.scenario.test.js
```

**Scenarios:**

- [ ] 1. `governance/role-demote-mid-call.scenario.test.js` — Bob is `coordinator` in `g1`; Bob invokes a `requiredRole: 'coordinator'` skill on Carol; mid-invoke admin calls `setRole(bob, 'observer')`; in-flight call completes (proof was valid at invoke-time); next call rejected with `INSUFFICIENT_ROLE`.
- [ ] 2. `governance/revoke-with-active-token.scenario.test.js` — Alice issued a capability token to Bob; Alice revokes it; Bob's next invocation fails with `CapabilityError`; auth-log shows revocation event.
- [ ] 3. `pod/conflict-policy-reject.scenario.test.js` — default `conflictPolicy: 'reject'` (per Q-A.4 lock); concurrent write throws `ConflictError`; no silent overwrite.
- [ ] 4. `pod/export-import-roundtrip.scenario.test.js` — C3 PodExporter exports a populated pod; PodImporter writes to a fresh empty pod; resulting envelopes byte-identical; manifest contentHash matches.

**DoD:**
- [ ] All 4 scenarios green; total wall-clock <10s.
- [ ] Governance scenarios verify auth-log entries (proof of audit trail).
- [ ] Export-import scenario verifies byte-equality (deterministic export from B2).

---

### T.6 — v2 / optional scenarios (deferred)

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Spawn only when a real consumer hits the gap, OR when an SDK component sees ≥3 bugs in CI that v1 scenarios didn't catch. |

**Scenarios** (full spec in [`./sdk-test-strategy.md`](./sdk-test-strategy.md) §Optional v2 scenarios):

- [ ] `routing/nkn-only-path` — two peers with NO shared relay; communicate via NKN only.
- [ ] `routing/peer-graph-pruning` — knownPeers cleaned up after TTL expiry.
- [ ] `identity/migration-then-recovery` — B5 migrates a vault to pod; a different device recovers; verify migrated data shows up.
- [ ] `protocol/a2a-external-interop` — external A2A client (vanilla `node:fetch`) calls our agent; verifies discovery, task-send, task-subscribe, cancel, JWT auth, input-required.  Q-Test.5 dep on `eventsource` polyfill if Node <22.
- [ ] `pod/append-retry-exhaustion` — append-on-conflict exhausts retry budget; correct error code.
- [ ] `pod/federated-read-partial-failure` — D5 FederatedReader with 2 of 3 pods unreachable; partial-success-with-flag returns merged + failure list.

**DoD (when a v2 scenario lands):**
- [ ] Scenario green.
- [ ] No regression on v1 scenarios.

---

### T.7 — Mesh Lab visualizer (deferred)

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW, deferred] |
| **Notes** | Build only after Folio H1 ships AND there's developer demand for a visual debugger.  Not on the critical path for SDK correctness. |

Full spec in [`./track-H-demo-meshlab.md`](./track-H-demo-meshlab.md).
The visualizer reuses the SAME scenario modules T.2–T.5 produce — same
scenarios, two drivers (vitest assertions + UI animation).  Adding T.7
later requires no changes to existing scenarios.

---

## Cross-task design notes

### 1. Scenario file shape

Every scenario file follows the same template so reading any one
teaches you how to read the rest:

```js
/**
 * Scenario: <area>/<name>
 *
 * Story: one paragraph explaining what real-world bug this catches.
 *
 * Lab setup: who's in the mesh, what transports.
 * Action: what the test does.
 * Assertion: what proves the SDK works.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Lab } from '../_harness/index.js';

describe('routing/fall-through', () => {
  let lab;
  beforeEach(async () => {
    lab = await Lab.boot({
      agents: ['alice', 'bob', 'carol'],
      ...
    });
  });
  afterEach(() => lab.teardown());

  it('falls through direct → relay → hop as transports drop', async () => {
    // setup
    await lab.assertRoute('alice', 'bob', { tier: 'direct' });

    // action 1: drop direct
    lab.dropTransport('alice', 'rendezvous');
    await lab.assertRoute('alice', 'bob', { tier: 'mesh' });

    // action 2: drop relay
    lab.dropTransport('alice', 'relay');
    await lab.assertRoute('alice', 'bob', { tier: 'hop', via: 'carol' });

    // round-trip a real call to prove it actually works
    const response = await lab.invoke('alice', 'bob', 'echo', ['hello']);
    expect(response).toEqual(['hello']);
  });
});
```

### 2. No flaky tests

The harness runs in fake-time mode by default (vi.useFakeTimers).
Real `setTimeout` calls inside the SDK get virtualized.  `lab.advanceTime(ms)`
pushes the clock forward.  This eliminates timing flakes.

For the few scenarios that genuinely need wall-clock (e.g. testing
30ms heartbeat behavior), opt out of fake timers explicitly:
`Lab.boot({ ..., realTime: true })`.

### 3. Mock vs real pod

Default: `MockPod` (in-memory).  Fast, deterministic, no infra.  Every
v1 scenario uses this.

Opt-in: `Lab.boot({ ..., pod: 'real:css' })` switches to a real CSS
pod via env var `CSS_URL`.  Used for full-fidelity verification when
the developer wants to confirm a scenario also works against a real
LDP server.  Same scenario file; just a different `pod` opt.

### 4. Scenarios are AUTHORITATIVE, not redundant

Each scenario tests **a cross-component flow that no unit test
catches**.  If during writing T.2–T.5 you find a scenario covered by
existing unit tests, drop it from the list and document why in the
scratchpad.  We're not aiming for max scenarios — we're aiming for
the smallest set that catches the regressions unit tests can't.

---

## Build sequence

| Day | Task | Wave |
|---|---|---|
| 1 | T.1 — Harness | Single agent |
| 2-3 | T.2 + T.3 + T.4 + T.5 in parallel (4 agents) | After T.1 lands |
| (later) | T.6 — v2 scenarios as needed | Opt-in, on real-consumer demand |
| (later) | T.7 — Mesh Lab visualizer | Opt-in, on developer demand |

**Concrete ETA for v1 (T.1–T.5):** 3 working days with 4 parallel agents
in the second wave; ~1 week with one developer linear.

---

## Pre-kickoff checklist

Before T.1 spawns, confirm-or-override:

| # | Decision | Lean | Action |
|---|---|---|---|
| 1 | Q-Test.1 — `test/scenarios/` location | top-level | Confirm |
| 2 | Q-Test.2 — `test:scenarios` script + included in root `npm test` | both | Confirm |
| 3 | Q-Test.4 — `pod: 'real:css'` opt-in via env | yes | Confirm |
| 4 | Q-Test.6 — One agent per area for T.2–T.5 (5 scenarios per agent) | yes | Confirm |
| 5 | Test workspace as `@canopy/test-scenarios` (npm-named workspace, not just a tests dir) | yes | Confirm |
| 6 | Fake-timers default; `realTime: true` opt-out for the few timing-sensitive tests | yes | Confirm |
| 7 | T.7 (Mesh Lab) deferred until apps ask for it | yes | Confirm |
| 8 | First implementation step: spawn agent for T.1 | yes | Confirm to start |

Once confirmed, the cascade is:

1. Spawn agent for T.1.
2. When T.1 lands + smoke test green, spawn T.2 + T.3 + T.4 + T.5 in parallel.
3. When all four land, the v1 scenario suite is shippable; pause for
   evaluation.  T.6 + T.7 deferred.

---

## Pointers

- [`./sdk-test-strategy.md`](./sdk-test-strategy.md) — strategy this
  plan implements.
- [`./track-H-demo-meshlab.md`](./track-H-demo-meshlab.md) — Mesh Lab
  visualizer (T.7).
- [`./track-H-app-folio.md`](./track-H-app-folio.md) — Folio H1 plan;
  Folio benefits from these scenarios catching cross-pod-edit
  regressions.
- [`./AGENT-RULES.md`](./AGENT-RULES.md) — common rules for spawned
  agents.

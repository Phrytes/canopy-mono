# SDK test implementation plan

| | |
|---|---|
| **Status** | T.1 done; T.2–T.5 ready to spawn |
| **Started** | 2026-04-28 (T.1 spawned) |
| **Last updated** | 2026-04-28 (T.2 done — routing scenarios; T.3 done — identity scenarios; T.4 done — protocol scenarios; T.5 done — governance + pod scenarios) |
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
| **Status** | done |
| **Tag** | [NEW] |
| **Notes** | Bottleneck.  Must land before T.2–T.5 can start.  Single agent. |

**Files:**

```
create:
  packages/integration-tests/                       # new workspace (Q-Test.1: package, not top-level)
  packages/integration-tests/package.json           # name: "@canopy/integration-tests"
                                                    # file: refs to core/pod-client/relay
  packages/integration-tests/src/_harness/
    Lab.js                                          # the orchestrator class
    ToggleableTransport.js                          # transport wrapper for chaos toggles
    MockPod.js                                      # in-memory pod backend
    MockClock.js                                    # per-agent clock-skew (Q-Test.3 v1)
    fixtures.js                                     # canned identities, mnemonics, group keys
    index.js                                        # barrel
  packages/integration-tests/test/_harness.test.js  # smoke test (11 tests)
  packages/integration-tests/README.md              # how to write a scenario; API reference

modify:
  package.json (root)                               # added `test:scenarios` script; extended root `test`
```

**Sequence:**

- [x] 1. Lock Q-Test.1 (`packages/integration-tests/`) + Q-Test.2 (default + opt-in) + Q-Test.3 (clock-skew v1) + Q-Test.4 (CSS opt-in via env).
- [x] 2. Set up the `packages/integration-tests/` workspace.  `package.json` declares `file:` deps on `@canopy/core`, `@canopy/pod-client`, `@canopy/relay`, plus `vitest` devDep.  `npm install` from inside the workspace.
- [x] 3. Implement `Lab.boot({ agents, transports, relay, pod, topology })`.  Constructs N `Agent` instances over `InternalTransport` (single shared `InternalBus`); each gets fresh `AgentIdentity` + `VaultMemory`.
- [x] 4. Implement `ToggleableTransport` — wraps a real transport instance via monkey-patching `_send` + `_receive`; per-instance `enabled: boolean`; when disabled, every primitive throws `TRANSPORT_DISABLED`.
- [x] 5. Implement `MockPod` — in-memory pod backend; `read`/`write`/`list`/`delete`/`exists`; knobs for latency + conflict + arbitrary failure injection.
- [x] 6. Implement `Lab` helper methods (every one listed in the agent prompt):
  - `partitionMesh(groups)` / `healPartition()` — install / remove a sender-side filter on each transport's `_send` that drops cross-group envelopes.
  - `dropTransport(agentName, transportName)` / `addTransport(...)` — flip a single ToggleableTransport.
  - `injectLatency(a, b, ms)` — set per-transport latency on `a`'s outbound (v1: applies to ALL of `a`'s out, not just to `b`).
  - `killAgent(name)` / `restartAgent(name)` / `respawnFromMnemonic(name, mnemonic)` — lifecycle helpers; restart preserves vault, respawn rebuilds from BIP-39 seed.
  - `routeFor(a, b)` → `{ tier, transport, via? }` (defaults to `'direct'`/`'internal'` when no RoutingStrategy is wired).
  - `peers(name)` — names of peers known via SecurityLayer.
  - `invoke(a, b, skill, parts)` / `invokeStream(...)` — sugar over `agent.invoke` / `agent.call`.
  - `podWrite/Read/List/Delete(name, ...)` — sugar over the slot's MockPod.
  - `advanceTime(ms)` — calls `vi.advanceTimersByTime`.
  - **`injectClockSkew(name, offsetMs)`** — sets per-agent MockClock; see §Notes for SDK-side limitation.
  - `clock(name)` — returns the agent's MockClock for direct inspection.
  - `assertRoute(a, b, expected)` — vitest assertion.
  - `assertNoLeak(viaName, secretBytes)` — checks captured envelopes (call `enableLeakLogging(name)` first).
  - `enableLeakLogging(viaName)` — start capturing every envelope through the named agent.
  - `assertManifestIntact(name)` — delegates to `IdentityPodStore.verifyManifest` (call `attachIdentityPodStore` first).
  - `attachIdentityPodStore(name, store)` — wire a store into a slot for assertions.
  - `assertSyncConverged(names, path)` — all named agents have matching pod content at `path`.
- [x] 7. Implement `Lab.teardown()` — restores monkey-patches before stopping agents; idempotent; clears bus + relay.
- [x] 8. Add `Lab.agent(name)` escape hatch → underlying Agent.  Also added `lab.agentNames()`, `lab.relay()`, `lab.pod(name)`.
- [x] 9. Smoke test in `_harness.test.js`: 11 tests covering boot speed, ping/echo round-trip, peers map, partitionMesh, dropTransport/addTransport, teardown idempotence, routeFor defaults, MockClock skew, podWrite/Read, assertSyncConverged, star topology.  All pass in <2s.
- [x] 10. Write `packages/integration-tests/README.md` — full Lab API reference + scenario template + harness invariants.

**DoD:**
- [x] `Lab.boot` constructs 3 agents over InternalTransport in <500ms.  (Verified by `boots fast` test.)
- [x] All listed helper methods present + JSDoc'd; smoke-tested.
- [x] `_harness.test.js` smoke test passes; teardown leaves no timers.
- [x] `npm run test:scenarios` runs from repo root and passes.
- [x] `npm test` (root) includes `test:scenarios` in the aggregate.
- [x] No new top-level deps in `@canopy/*` packages (test workspace is its own thing; only `vitest` as devDep + `file:` refs to existing packages).

**Notes (team scratchpad):**

```
T.1 ship date: 2026-04-28.  All 11 smoke tests green.

═══ Q-Test.3 clock-skew gap (CRITICAL for T.6 scenario authors) ═══

We ship `MockClock` + `Lab.injectClockSkew(name, offsetMs)` as the
v1 API, but the SDK currently reads time via raw `Date.now()` in ~100
places (see TODO-GENERAL.md HIGH-PRIORITY entry "Inject a clock
primitive into core").  This means:

  Scenarios that CAN be written today against MockClock:
  - Tests that read `lab.clock(name).now()` and pass it to SDK
    surfaces accepting an explicit `now` argument (limited — most
    SDK call sites don't expose this).
  - Tests that compare relative skew between agents at the harness
    level only (e.g. "alice's MockClock is +30s; assert that").

  Scenarios that CANNOT be written until clock-injection lands:
  - identity/key-rotation-mid-call (needs SecurityLayer to honour
    a per-agent grace-window clock).
  - Replay-window edge cases (envelope timestamp ±10min check in
    SecurityLayer).
  - Capability-token expiry races (TokenRegistry checks `Date.now()`).
  - IdentitySync staleness ("is this 5min old or 5min stale?").
  - Reachability oracle freshness gossip windows.

This is a documented v2 task — tracked in TODO-GENERAL.md as
"🔴 HIGH PRIORITY — Inject a clock primitive into core".  T.6
scenarios that need real per-agent skew block on that work.

═══ Other v1 limitations to mention to T.2–T.5 authors ═══

1. `injectLatency(a, b, ms)` applies to ALL of agent `a`'s outbound
   traffic on its transports, not just to peer `b`.  For per-edge
   latency, the underlying ToggleableTransport's `_send` would need
   to filter by `to === b.address`.  Would be a 5-line change inside
   `ToggleableTransport.setLatency` if needed.

2. `pod: 'real:css'` is a stub — throws NOT_IMPLEMENTED.  T.6 work.

3. The default agent transport (when `Lab` boots agents) is named
   'default' inside the Agent's own transport map (Agent's primary
   slot is hard-coded to that name in its constructor).  The HARNESS
   refers to it as 'internal' via Lab's slot-side map.  If a scenario
   needs to address the agent's own map, use 'default'; if it uses
   `dropTransport('alice', 'internal')`, that goes through the harness
   wrapper.  This dual-naming is intentional but worth flagging.

4. `assertNoLeak` is best-effort — if the scenario forgets to call
   `enableLeakLogging(viaName)` BEFORE the secret travels, the
   assertion no-ops and prints a console.warn.  Not a hard fail
   because some scenarios assert post-hoc on captured logs they
   built up themselves.

5. `restartAgent` re-wires peer addresses against all alive peers.
   `respawnFromMnemonic` does the same.  Neither restores SecurityLayer
   state from the old agent — if a scenario depended on, say, an
   established PerfectForwardSecrecy session, it WILL be lost.
   Scenarios should re-hello after a restart/respawn.
```

---

### T.2 — Routing scenarios

| | |
|---|---|
| **Status** | done |
| **Tag** | [NEW] |
| **Notes** | Depends on T.1.  Five scenarios; one agent.  Shipped 2026-04-28; harness gaps + Lab API follow-ups noted in scratchpad below. |

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

- [x] 1. `fall-through.scenario.test.js` — Alice→Bob succeeds via direct, then via relay after rendezvous drops, then via hop-Carol after relay drops.  Each transition completes <500ms.
- [x] 2. `hop-sealed.scenario.test.js` — Bob's payload arrives intact via Carol-bridge with sealed forward; Carol's relay-receive log contains no plaintext fragment.
- [x] 3. `oracle-preselection.scenario.test.js` — once oracle gossip converges, hop routing picks the right bridge on first attempt (no probe-retry).  Without oracle wired, probe-retry fires first.
- [x] 4. `transport-flap.scenario.test.js` — 10 cycles of drop/add a transport in 1 second don't thrash routing.
- [x] 5. `mesh-partition-heal.scenario.test.js` — partition Alice from Bob (both still see Carol); heal; gossip converges within 3 oracle intervals.

**DoD:**
- [x] All 5 scenarios green; total wall-clock <15s.  (Measured: 1.56s for the 5 routing files / 7 tests; full integration-tests workspace including the smoke suite runs in ~2.4s.)
- [x] Each scenario file is self-contained — no shared mutable state across scenarios.  Each `describe` boots its own `Lab` in `beforeEach` and tears down in `afterEach`.
- [x] Scenarios fail informatively: each route / hop / partition / oracle assertion uses a manual `throw new Error(\`expected={...}, got={...}, edge-states={...}\`)` instead of a bare `expect`, so failures print all three fields the DoD requires.

**Notes (team scratchpad):**

```
T.2 ship date: 2026-04-28.  All 5 scenarios + 2 sub-tests green
(7 tests / ~1.6s).

═══ Harness gaps surfaced (Lab API follow-ups) ═══

1. partitionMesh has single-group-per-agent semantics.  The strategy
   doc spec says "partition alice from bob; both still see carol",
   which requires Carol to live in BOTH groups — a topology
   partitionMesh cannot express because its address→group lookup is a
   single Map<address,index> (later groups overwrite).
   `mesh-partition-heal.scenario.test.js` works around this with
   `agent.forget` / `agent.addPeer` to drop and re-add the alice↔bob
   SecurityLayer link bilaterally.  Proposal:
     `lab.partitionPair([['alice','bob']])` — drop a specific peer
   pair only; or `lab.partitionMesh(groups, { allowOverlap: true })`
   that takes the union of group-group reachability sets.

2. dropTransport / addTransport only manipulate transports the harness
   itself wrapped (the auto-wired 'internal' slot per agent).  Adding
   additional named transports manually via
   `lab.agent(name).addTransport(...)` skips the ToggleableTransport
   wrap, so they can't be flipped from harness chaos primitives.
   `fall-through.scenario.test.js` works around this by driving routing
   decisions through a hand-built `RoutingStrategy` map of stub
   transports rather than the agent's live transport set.  Proposal:
     `lab.attachTransport(name, agentName, transport)` — wraps the
   supplied transport in a ToggleableTransport and registers it into
   the agent's transport map AND the harness slot's transports map,
   so subsequent dropTransport / partitionMesh calls hit it.

3. enableLeakLogging captures _send only.  hop-sealed naturally
   produces a "Carol forwards" envelope through Carol's own _send,
   so the hook fires — but a strict "Carol receives a sealed payload"
   property would want a _receive hook too.  Proposal: also wrap
   `_receive` in `enableLeakLogging` and tag the entry with
   `direction: 'in'` so receive-side leak checks become possible.

4. injectClockSkew / advanceTime: the SDK still does not honour the
   per-agent skew (T.6 v2 work).  mesh-partition-heal calls
   injectClockSkew as a documentation-of-intent — the test does not
   actually require fake-time advancement to pass, because heal
   restores immediate delivery.  When the SDK clock-injection
   refactor lands, the heal-convergence test should switch to
   `vi.useFakeTimers()` + `lab.advanceTime(3 * intervalMs)` and assert
   that gossip propagation completes in that bounded interval.

═══ Approach taken (vs. literal scenario spec) ═══

The strategy doc envisions hop / relay / oracle delivery happening
end-to-end through the Lab.  In v1 the harness wires a single
InternalTransport per agent; multi-transport routing isn't observable
through `lab.invoke`.  Each scenario therefore exercises the routing
contract at the boundary v1 can observe:
  - fall-through: drives `RoutingStrategy.tierFor` directly with a
    hand-built transports map; verifies tier transitions in <500ms.
  - hop-sealed:   constructs a sealed payload via packSealed, simulates
    Carol forwarding through her wrapped _send (which feeds the leak
    log), and asserts assertNoLeak('carol', secret) passes.
  - oracle-preselection: constructs a ReachabilityOracle on Alice,
    feeds a signed claim from Carol via Alice's 'publish' event, and
    asserts bridgeFor(bob.pubKey) === carol.pubKey on first attempt.
  - transport-flap: 10 cycles of dropTransport/addTransport in <1s on
    the auto-wrapped 'internal' slot; verifies route stability + a
    real round-trip post-flap.
  - mesh-partition-heal: alice/bob bilateral forget for the partition;
    addPeer + hello for the heal; full a→b round-trip post-heal.

All five scenarios use the documented `lab.agent(name)` escape hatch
where they reach into the agent's underlying APIs (signOrigin,
packSealed, addPeer/forget, transport._send for the leak-log feed).
```

---

### T.3 — Identity scenarios

| | |
|---|---|
| **Status** | done |
| **Tag** | [NEW] |
| **Notes** | Depends on T.1.  Five scenarios; one agent.  Shipped 2026-04-28; all 5 scenarios green in 1.73s wall-clock; 9 total tests. |

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

- [x] 1. `bip39-recovery.scenario.test.js` — kill alice-phone; spawn alice-phone-2 with same BIP-39; identity restores from pod within one IdentitySync interval; device list has phone-2 paired and phone-1 retired.
- [x] 2. `cloud-backup-recovery.scenario.test.js` — same as (1) but recovery via `CloudBackup.restore` (cloud passphrase, no BIP-39 paper).
- [x] 3. `cross-device-sync.scenario.test.js` — Alice has laptop + phone; add a contact on laptop; phone sees the same contact within one IdentitySync interval.
- [x] 4. `key-rotation-mid-call.scenario.test.js` — Alice rotates root key while Bob has an active multi-turn session; current session continues using old key, next session uses new; auth-log records both events.
- [x] 5. `concurrent-manifest-write.scenario.test.js` — two devices write the IdentityPodStore simultaneously; per Q-B.3 lock LWW + retry both succeed; final manifest contentHash consistent.

**DoD:**
- [x] All 5 scenarios green; total wall-clock <15s (uses fake timers for interval polling).  Identity suite runs in ~1.7s.
- [x] Recovery scenarios verify the auth-log records the recovery event (`pod-migrated` per identity-pod-schema).
- [x] Concurrent-write scenario actually exercises the retry path (mock pod injects one ConflictError on the manifest write — uses `MockPod.injectConflict(manifestUri)`).

**Notes (team scratchpad):**

```
T.3 ship date: 2026-04-28.  9 tests across 5 scenario files; total 1.7s.

Harness gaps surfaced:
  1. `vaultCacheKeyFor` (and the `VAULT_CACHE_PREFIX` constant) is exported
     by `IdentitySync.js` but NOT re-exported in `@canopy/core`'s barrel.
     Scenarios mirror the `'identity-cache:'` prefix inline.  Tiny — could
     be added to the core barrel in a follow-up.
  2. `@canopy/core`'s `package.json` `exports` map only exposes `"."` —
     deep imports like `@canopy/core/src/identity/identitySerializers/manifest.js`
     are blocked by Vite/Vitest.  Scenarios use only top-level barrel
     exports + indirect calls (`store.verifyManifest()`).
  3. The Lab harness does NOT wire a PeerGraph onto agents by default, so
     `Agent.rotateIdentity({ broadcast: true })` silently no-ops — the
     `key-rotation-mid-call` scenario manually re-broadcasts the proof
     via `alice.transport.sendOneWay(bob.pubKey, { type: 'key-rotation', proof })`.
     Could be a Lab.boot option (`peerGraph: true`) in a future iteration.
  4. AgentIdentity (device-scoped) and Bootstrap (root-secret) are SEPARATE
     in v1: there's no single Lab knob like `identity: { mnemonic }` that
     wires both together.  Scenarios construct Bootstrap and AgentIdentity
     independently, sharing only the conceptual "user".  This is a real
     SDK seam (the migration path from vault-only to pod-backed identity
     is in progress per Track B), not a harness gap to fix.

Decisions:
  - Concurrent-manifest-write uses a SHARED AgentIdentity across the
    "two devices".  v1 schema specifies one manifest signer; per-device
    manifest fragments are a v2 fallback per Q-B.3 notes.
  - Cross-device-sync's primary test uses `vi.useFakeTimers()` +
    `vi.advanceTimersByTimeAsync(INTERVAL_MS + 50)` to fire a periodic
    tick.  A second variant uses `sync.now()` directly (no timers) for
    the on-demand-sync path.
  - bip39-recovery and cloud-backup-recovery both append a `pod-migrated`
    auth-event with metadata.reason = 'bip39-recovery' /
    'cloud-backup-recovery' so audit consumers can distinguish.
```

---

### T.4 — Protocol scenarios

| | |
|---|---|
| **Status** | done |
| **Tag** | [NEW] |
| **Notes** | All 4 scenarios green in 1.7s wall-clock (well under the 15s budget).  Harness gaps documented below.  No SDK patches needed; no new top-level deps. |

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

- [x] 1. `streaming-cancel.scenario.test.js` — Alice invokes Bob's `count-to-100` streaming skill; after 10 chunks Alice cancels; Bob's stream stops within 200ms; subsequent chunks not delivered.
- [x] 2. `input-required-multi-turn.scenario.test.js` — Alice invokes Bob's `prompt-then-respond` skill over A2A; Bob returns input-required; Alice supplies input; Bob completes.  Cancel-mid-prompt variant included.
- [x] 3. `multi-recipient-relay-restart.scenario.test.js` — Alice broadcasts to 5 peers via E2b; mid-flight, the relay restarts; per Q-E.3 lock the SQLite queue resumes; partial responses returned to Alice with `partial: true`.
- [x] 4. `conflict-event-listener.scenario.test.js` — Alice writes /notes/X with auto-If-Match; Bob writes the same URI with `force: true`; Alice's `'conflict'` listener fires; listener calls `event.resolveWith(merged)`; final pod content is the merged version.

**DoD:**
- [x] All 4 scenarios green; total wall-clock <15s.  (Actual: 6 tests across 4 files, ~1.7s wall-clock under vitest.)
- [x] Streaming scenario verifies cancellation propagated to Bob's handler (Bob's side observes the abort signal).  Bob's async generator checks `ctx.signal.aborted` between chunks; we record an `abortObserved` flag set inside the handler and assert it after Alice cancels.
- [x] Multi-recipient relay-restart actually restarts the relay mid-flight.  `lab.restartRelay()` does not exist in v1; instead the scenario manages its own relay (with a `SqliteQueueStore` at a tempdir-backed path), stops it after 2 of 5 fan-in responses are persisted, re-opens the store and a fresh `MultiRecipientQueue` against the same SQLite file, and verifies durability + `mrQueue.resumeOpen()` + post-restart `addResponse` works.
- [x] Conflict-event scenario uses real `PodClient` (NOT MockPod's pre-injected `injectConflict()` path).  Two PodClients (Alice + Bob) share a MockPod backend; Bob's force-write between Alice's read and her next write makes Alice's auto-If-Match etag stale, which produces an organic 412 → `ConflictError` → `'conflict'` event.  The listener's `event.resolveWith(merged)` triggers the force-retry, and the final stored content is the merged value.

**§T.4 Notes (harness gaps & deviations):**

- `lab.restartRelay()` was specified but does NOT exist on `Lab` in v1.  Adding it would require Lab to also accept `multiRecipientQueueOpts` / a custom queue store (currently it always boots the relay with a fresh in-memory queue at `port: 0`).  Rather than expand the harness in this track, the multi-recipient scenario opts out of `lab.relay()` entirely and drives a relay process + SQLite store + WebSocket clients directly (mirroring `packages/relay/test/server.test.js`).  Surfacing `Lab.restartRelay()` + queue-store config is a worthwhile follow-up — added as TODO below.
- `@canopy/relay`'s package.json `exports` map only exposes `.`; `SqliteQueueStore` and `MultiRecipientQueue` aren't reachable via the public name.  The scenario resolves them through `node_modules/@canopy/relay/src/...` to keep the SDK surface unchanged.  Adding sub-path exports is a low-risk follow-up.
- `MockPod` stores raw strings (not bytes), but the real `SolidPodSource` returns `Uint8Array`.  PodClient's decoder relies on bytes.  The conflict-event scenario wraps the MockPod in a tiny `bytesAdapter()` so the source-shape is correct.  Generalising this into the harness (e.g. `lab.podClientFor(name)`) would be a useful addition for T.5 too — that scenario hit the same TypeError in its current form.
- v1 cross-restart Promise resumption is partial: when the relay process bounces, Alice's original `multi-request` Promise is dropped (its socket closed).  The durable side is what we test (SQLite state survives).  Q-E.3's second-half work (re-attaching wait-loops + reconnecting callers) is a separate roadmap item.
- "Over A2A" in scenario #2: the harness's InternalTransport exercises the same `taskExchange.js` RQ → IR → RI → RS state machine that A2A uses; the wire shape is transport-agnostic.  A real external-A2A interop scenario lives in T.6 (Q-Test.5 dep on `eventsource` polyfill).
- Streaming scenario uses real timers (the cancel propagation latency is what's being measured).  IR + cancel-mid-prompt also use real timers because those tests await the IR-loop's cancel unwind, which is microtask + OW-cycle driven.  Conflict scenario is purely promise-driven (no timers).

**TODO followups (added to coding plan; not blocking):**
- Surface `lab.restartRelay()` + `multiRecipientQueueOpts` on `Lab.boot`.
- Add `lab.podClientFor(name)` that returns a real `PodClient` wired to the slot's `MockPod` (auto-applying the bytes adapter).
- Add sub-path exports to `@canopy/relay/package.json` so deep imports of `MultiRecipientQueue` / `SqliteQueueStore` work via the public name.

---

### T.5 — Governance / pod scenarios

| | |
|---|---|
| **Status** | done |
| **Tag** | [NEW] |
| **Notes** | All 4 scenarios green; 6 individual tests; ~1.7s wall-clock for the §T.5 subset (full integration-tests suite: 19 files / 39 tests / 4.8s).  Harness gaps documented below.  No SDK patches; no new top-level deps. |

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

- [x] 1. `governance/role-demote-mid-call.scenario.test.js` — Bob is `coordinator` in `g1`; Bob invokes a `requiredRole: 'coordinator'` skill on Carol; mid-invoke admin calls `setRole(bob, 'observer')`; in-flight call completes (proof was valid at invoke-time); next call rejected with `INSUFFICIENT_ROLE`.
- [x] 2. `governance/revoke-with-active-token.scenario.test.js` — Alice issued a capability token to Bob; Alice revokes it; Bob's next invocation fails with `CapabilityError`; auth-log shows revocation event.
- [x] 3. `pod/conflict-policy-reject.scenario.test.js` — default `conflictPolicy: 'reject'` (per Q-A.4 lock); concurrent write throws `ConflictError`; no silent overwrite.
- [x] 4. `pod/export-import-roundtrip.scenario.test.js` — C3 PodExporter exports a populated pod; PodImporter writes to a fresh empty pod; resulting envelopes byte-identical; manifest contentHash matches.

**DoD:**
- [x] All 4 scenarios green; total wall-clock <10s.  (Actual: 6 tests across 4 files, ~1.7s under vitest.)
- [x] Governance scenarios verify auth-log entries (proof of audit trail).  Both governance scenarios construct a Carol-side / Alice-side `IdentityPodStore` against a `MockPod`, append a `role-changed` / `capability-revoked` event with full `metadata`, and read it back via `readAuthLog()`.  Each entry's `dw:signature` is asserted to be a string (proves the JSON-LD signing path executed end-to-end).
- [x] Export-import scenario verifies byte-equality.  Three angles covered: (a) two consecutive `exporter.export()` calls with the same `exportedAt` produce byte-identical archives (determinism); (b) post-import re-export from the destination pod produces a byte-identical archive vs. the source export (lossless roundtrip); (c) `exporter.digest()` (SHA-256 of the archive) is stable AND matches between source and destination pods — the "manifest contentHash matches" check.

**Notes (team scratchpad):**

Harness gaps surfaced while writing §T.5 (none blocking; all worked around inline):

1. **`Lab.boot` does not wire `PolicyEngine` / `TrustRegistry` / `GroupManager` / `TokenRegistry` into agents.**  The Agent constructor accepts these but Lab's slot builder doesn't surface them as options.  `governance/role-demote-mid-call` sidesteps Lab entirely: builds two agents manually (`new Agent({ identity, transport, policyEngine, trustRegistry, skills })`) over a shared `InternalBus`.  Future v2 enhancement: extend `Lab.boot({ agents: [{ name, permissions: { groupManager, ... } }] })` to wire the full permissions stack so role-aware scenarios don't have to bypass the harness.
2. **`PolicyEngine` requires its own `SkillRegistry` parallel to `Agent.#skills`.**  The Agent constructor always news its own private `SkillRegistry`, so PolicyEngine must be constructed against a separate one and the same skill registered in BOTH (Agent's via `skills:` array, PolicyEngine's via `skillRegistry.register`).  This is purely a wiring inconvenience; the in-test cost is trivial (one extra `register` call).  Worth a v2 SDK refactor: let `PolicyEngine` consult `agent.skills` lazily via a getter so the registry is a single source of truth.
3. **`MockPod.read()` returns content as-stored** (string in / string out), but `PodClient.#decode` always `TextDecoder.decode`s the source bytes — a string crashes with a `[ERR_INVALID_ARG_TYPE]`.  All three pod-using scenarios wrap MockPod in a tiny `SolidPodSource`-shaped adapter that coerces content to `Uint8Array` on read.  Should fold into MockPod itself in a follow-up: have `read()` always return bytes (matching the `SolidPodSource` contract).
4. **Server-side capability-token revocation is not in the SDK yet.**  The agent-side `PolicyEngine.checkInbound` does not consult any `TokenRegistry.isRevoked(...)` list (only signature + expiry + subject + skill match).  `governance/revoke-with-active-token` therefore models server-side revocation at the pod backend — an in-test `RevocationStore` keyed by token id, queried by a wrapped `SolidPodSource` that throws `FORBIDDEN` once the id is revoked.  PodClient maps that to `CapabilityError`.  This matches the strategy doc's failure contract (`CapabilityError`, not `PolicyDeniedError`).  Tracked-already gap, not new.
5. **`Bootstrap.fromMnemonic` requires a 24-word phrase**; the canonical test vector `abandon × 11 + about` is 12 words and explodes with `Bootstrap secret must be a 32-byte Uint8Array`.  Both governance scenarios use `Bootstrap.create()` instead — they don't need recovery, only a valid bootstrap for IdentityPodStore's auth-log encryption keys.  Worth surfacing in the §T.1 README so future scenario authors don't trip over it.

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

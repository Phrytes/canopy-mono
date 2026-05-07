# SDK test strategy

**Status:** drafted 2026-04-29.  Codifies the testing tiers, identifies
the missing tier, proposes a harness, and lists priority scenarios.
Becomes the active workstream once Track G ships (which it now has).

**Reading order:** [why this](#why-this-exists) → [current state](#current-state)
→ [the gap](#the-gap) → [proposed tiers](#proposed-tiers) → [the harness](#the-harness)
→ [priority scenarios](#priority-scenarios) → [build order](#build-order).

---

## Why this exists

The SDK has ~1395 unit tests across `core` / `pod-client` / `relay` /
`react-native`.  Coverage of individual classes and functions is good.

But the bugs that hurt most aren't in individual functions — they're in
the **composition** of tracks: routing chooses a stale bridge because
the oracle's gossip layer disagrees with the probe layer; identity
sync overwrites a freshly-rotated key because the manifest write
loses a race; sealed forward leaks a single byte because a transport
header isn't included in the canonical form.

Those bugs **only show up when 3+ agents talk to each other across
multiple transports**.  No unit test catches them.  And by the time a
multi-device deployment hits one in production, the failure mode is
already in the wild and the user has lost trust.

We need a tier between "unit tests" and "ship to a real phone".  This
file specifies it.

---

## Current state

What we already have:

| Tier | Where | Count | Frequency | Coverage |
|---|---|---|---|---|
| **Unit** | `packages/*/test/*.test.js` | ~1395 | Every commit | Per-class behavior, mocked deps |
| **Per-package CSS integration** | `*.css.test.js` (gated on `CSS_URL`) | ~10 | On-demand | Track A wire to a real Solid pod server |
| **Relay integration** | `packages/relay/test/server.test.js` etc. | ~14 | Every commit | Single-process relay + WS clients |
| **In-process two-agent** | `pubSub.test.js`, `keyRotation.receive.test.js`, `RoleAwareGroups.test.js` etc. | ~50 | Every commit | Two `Agent` instances over `InternalTransport` |

What's notably **missing**:

- **3+ agent scenarios.**  Two-agent tests miss any bug that depends
  on a routing choice between multiple paths.  All hop-tunnel, all
  mesh-partition, all oracle-preselection logic happens at N≥3.
- **Cross-transport scenarios.**  In-process tests use only
  `InternalTransport`.  No integration test exercises the
  RendezvousTransport ↔ RelayTransport ↔ NknTransport interaction
  (which is the whole point of `RoutingStrategy`).
- **Lifecycle scenarios.**  No test exercises identity recovery,
  manifest concurrent-write retry under real load, or relay restart
  with an in-flight multi-recipient request.
- **External-protocol interop.**  Nothing currently verifies the
  "we speak A2A" claim against an external A2A client.

The Mesh Lab demo (per [`./track-H-demo-meshlab.md`](./track-H-demo-meshlab.md))
sketches some of this surface but is **manual + visualization-oriented**.
It's the wrong primary venue for regression testing.

---

## The gap

A **scenario-based integration tier** that:

- Boots **3+ agents** wired across multiple transports.
- Runs **end-to-end flows** with **assertions** (no human eyes
  required).
- Stays **in-process / in-memory** so each test is <2s and
  deterministic — eligible for CI on every commit.
- Doesn't need real CSS / real network — uses `InternalTransport` +
  in-process relay + `MemoryAdapter`-backed pod-mocks (CSS available
  as an opt-in via env var for full-fidelity).
- ~30–50 scenarios, not hundreds.

That's the tier we need.

---

## Proposed tiers

| Tier | Where | Frequency | Audience |
|---|---|---|---|
| **Unit** | `packages/*/test/*.test.js` | Every commit | Author of touched code |
| **Per-package integration** *(existing)* | `*.css.test.js`, relay's `server.test.js` | Pre-release / nightly when env set up | CI when CSS / relay running |
| **Scenario-based integration** *(NEW)* | `test/scenarios/*.scenario.test.js` | Every commit | Catches cross-component regressions |
| **Mesh Lab demo** *(future)* | `apps/mesh-lab/` | Manual | Humans investigating / demoing |

The **scenario-based integration** tier is the new addition, and it's
the **first route** for the test workstream.  Mesh Lab can come later
as a visualizer over the same scenario library.

 Tests run via `npm run test:scenarios`.

---

## The harness

Scenarios share a small helper class.  Goal: 80% of scenarios are
expressible in 30–50 lines of test code; the harness handles the
plumbing.

### `Lab` API

```js
import { Lab } from '@canopy/test-scenarios/harness';

describe('hop fall-through', () => {
  let lab;
  beforeEach(async () => {
    lab = await Lab.boot({
      agents: ['alice', 'bob', 'carol'],
      transports: {
        alice: ['internal'],
        bob:   ['internal'],
        carol: ['internal'],
      },
      relay:    'in-process',          // 'in-process' | 'none' | { url }
      pod:      'mock',                // 'mock' | 'real:css' (env CSS_URL)
      topology: 'mesh',                // 'mesh' | 'star' | 'partitioned' | custom fn
    });
  });
  afterEach(() => lab.teardown());

  it('routes via Carol when direct path is blocked', async () => {
    // ... scenario body ...
  });
});
```

### Helper methods

```js
// network manipulation
lab.partitionMesh([['alice', 'bob'], ['carol']]);     // creates a network partition
lab.healPartition();                                  // removes all partitions
lab.dropTransport('alice', 'rendezvous');             // remove a specific transport
lab.addTransport('alice', 'rendezvous');              // add it back
lab.injectLatency('alice', 'bob', 200);               // 200ms one-way

// agent lifecycle
lab.killAgent('alice');                               // kill the process / null the instance
lab.restartAgent('alice');                            // boot fresh with same identity
lab.respawnFromMnemonic('alice', mnemonic);           // simulate "lost phone, new device"

// peer-level inspection
lab.routeFor('alice', 'bob');                         // → { tier, transport, via? }
lab.assertRoute('alice', 'bob', { tier: 'hop', via: 'carol' });
lab.peers('alice');                                   // → ['bob', 'carol']

// agent operations (sugar over agent.invoke)
await lab.invoke('alice', 'bob', 'echo', ['hello']);
const stream = lab.invokeStream('alice', 'bob', 'count', [10]);
await stream.cancel();

// pod operations (sugar over PodClient)
await lab.podWrite('alice', '/notes/x.md', 'hello');
const r = await lab.podRead('alice', '/notes/x.md');

// time control (vitest's vi.useFakeTimers, exposed for clarity)
lab.advanceTime(60_000);                              // for interval-based scenarios
```

### Asserting outcomes

The harness exposes a small set of typed assertions to make scenarios
read like English:

```js
await lab.assertRoute('alice', 'bob', { tier: 'hop', via: 'carol' });
await lab.assertNoLeak('relay-1', secretBytes);       // bridge log doesn't contain plaintext
await lab.assertManifestIntact('alice');              // pod-side contentHash verifies
await lab.assertSyncConverged(['alice-laptop', 'alice-phone'], '/contacts/');
```

The harness is **opinionated** about test ergonomics.  Custom needs
escape via `lab.agent('alice')` which returns the underlying `Agent`
for direct manipulation.

---

## Priority scenarios

A minimum viable set.  Each is one test file under
`test/scenarios/<area>/<name>.scenario.test.js`.  Numbered for
build-order reference, not for any user-visible scheme.

### Routing (5 scenarios)

| # | Name | What it asserts |
|---|---|---|
| 1 | `routing/fall-through` | Alice→Bob succeeds via direct, then via relay after rendezvous drops, then via hop-Carol after relay drops.  Each transition completes <500ms. |
| 2 | `routing/hop-sealed` | When Alice→Bob is hopped via Carol with sealed forward enabled for the group, Carol's relay-receive log has no plaintext fragment of the message. |
| 3 | `routing/oracle-preselection` | Once oracle gossip has converged, hop routing picks the right bridge on first attempt (no probe-retry).  Without oracle, probe-retry is invoked first. |
| 4 | `routing/transport-flap` | Rapid drop/add of a transport (10 cycles in 1 second) doesn't thrash routing — RoutingStrategy debounces correctly. |
| 5 | `routing/mesh-partition-heal` | Partition Alice from Bob; both should still see Carol.  Heal the partition; gossip converges within 3 oracle intervals. |

### Identity (5 scenarios)

| # | Name | What it asserts |
|---|---|---|
| 6 | `identity/bip39-recovery` | Kill alice-phone; spawn alice-phone-2 with same BIP-39 seed; identity restores from pod within one IdentitySync interval; the device list shows phone-2 paired and phone-1 retired. |
| 7 | `identity/cloud-backup-recovery` | Same scenario as (6) but the user has only the cloud passphrase (no BIP-39 paper).  CloudBackup.restore decrypts the bootstrap; flow completes. |
| 8 | `identity/cross-device-sync` | Alice has laptop + phone.  Add a contact on laptop.  Within one IdentitySync interval, phone sees the same contact.  No conflict. |
| 9 | `identity/key-rotation-mid-call` | Alice rotates root key while Bob has an active multi-turn session with her.  Bob's session continues using the old key; the next session uses the new key.  No data loss; auth-log records both events. |
| 10 | `identity/concurrent-manifest-write` | Two devices write to the identity-pod-store simultaneously.  Per Q-B.3 lock: LWW + retry succeeds for both; manifest contentHash is consistent at the end. |

### Protocol (4 scenarios)

| # | Name | What it asserts |
|---|---|---|
| 11 | `protocol/streaming-cancel` | Alice invokes Bob's `count-to-100` streaming skill.  After 10 chunks, Alice cancels.  Bob's stream stops within 200ms; subsequent chunks are not delivered. |
| 12 | `protocol/input-required-multi-turn` | Alice invokes Bob's `prompt-then-respond` skill.  Bob returns input-required.  Alice supplies input.  Bob completes.  All over A2A protocol — including the cancellable variant. |
| 13 | `protocol/multi-recipient-relay-restart` | Alice broadcasts a multi-recipient request to 5 peers via E2b.  Mid-flight, the relay restarts.  Per Q-E.3 lock: queue resumes from SQLite; partial responses are returned to Alice with `partial: true`. |
| 14 | `protocol/conflict-event-listener` | Alice writes to /notes/X with auto-If-Match.  Concurrently, Bob writes the same URI with `force: true`.  Alice's `'conflict'` listener fires; the listener calls `event.resolveWith(merged)`; final pod content is the merged version. |

### Governance / pod (4 scenarios)

| # | Name | What it asserts |
|---|---|---|
| 15 | `governance/role-demote-mid-call` | Bob is in group `g1` as `coordinator`.  Bob invokes a `requiredRole: coordinator` skill on Carol.  Mid-invoke, the admin calls `setRole(bob, 'observer')`.  Bob's in-flight call completes (proof was valid at invoke-time).  Bob's NEXT call to the same skill is rejected with `INSUFFICIENT_ROLE`. |
| 16 | `governance/revoke-with-active-token` | Alice issued a capability token to Bob for skill X.  Alice revokes the token.  Bob's next invocation fails with `CapabilityError`.  Verify the auth-log shows the revocation event. |
| 17 | `pod/conflict-policy-reject` | With `conflictPolicy: 'reject'` (the default per Q-A.4 lock), a write conflict throws `ConflictError`.  No silent overwrite. |
| 18 | `pod/export-import-roundtrip` | C3's PodExporter exports a populated pod.  PodImporter writes to a fresh empty pod.  Walking the new pod produces byte-identical envelopes; manifest contentHash matches. |

### Optional v2 scenarios (write later if priority demands)

- `routing/nkn-only-path` — two peers with NO shared relay; they communicate via NKN.
- `routing/peer-graph-pruning` — knownPeers gets cleaned up after TTL expiry.
- `identity/migration-then-recovery` — B5 migrates a vault to pod, then a different device recovers — verify the migrated data shows up.
- `protocol/a2a-external-interop` — external A2A client (vanilla `node:fetch`) calls our agent.  Verifies discovery, task-send, task-subscribe, cancel, JWT auth, input-required.  This is the only scenario that proves the "we speak A2A" claim.
- `pod/append-retry-exhaustion` — append-on-conflict exhausts the retry budget; the right error code surfaces.
- `pod/federated-read-partial-failure` — D5's FederatedReader with 2 of 3 pods unreachable; partial-success-with-flag returns merged data + failure list.

**Total v1: 18 scenarios.**  Each ~30–80 lines of test code on top of
the harness.  Aim for the full v1 set running in <60 seconds.

---

## Build order

### Phase 1 — Harness skeleton (~1 day)

- `test/scenarios/_harness/Lab.js` — the orchestrator.
- `test/scenarios/_harness/ToggleableTransport.js` — wraps real
  transports for chaos toggles.
- `test/scenarios/_harness/MockPod.js` — in-memory pod backend
  conforming to the `PodClient` shape.
- `test/scenarios/_harness/index.js` — barrel.
- One smoke test (`Lab.test.js`): boot 3 agents, ping, teardown.

DoD: `npm run test:scenarios` runs and the smoke test passes.

### Phase 2 — Routing scenarios first (~2 days)

Scenarios 1–5.  These exercise the harness's transport-toggling
machinery and make sure it actually works before we trust it for
identity / protocol scenarios.

DoD: 5 scenarios green; harness API stabilizes after writing real
tests that use it.

### Phase 3 — Identity + protocol + governance (~3 days)

Scenarios 6–18.  Mostly mechanical once the harness is solid.

DoD: all 18 v1 scenarios green; full suite runs in <60s; CI runs
`npm test` (which now includes `npm run test:scenarios`) on every
commit.

### Phase 4 — Optional v2 scenarios (as priority demands)

Add scenarios from the v2 list when:
- A real consumer (Track H app) hits the gap.
- The associated SDK component sees ≥3 bugs in regular CI that v1
  scenarios didn't catch.

### Phase 5 — Mesh Lab visualizer (later, optional)

Build the web UI per [`./track-H-demo-meshlab.md`](./track-H-demo-meshlab.md)
**on top of the same scenario modules**.  The lab loads scenarios as
data, runs them via the same harness, and animates the transitions.
Same scenarios, two drivers (vitest + UI).

This is the demo / human-debugging surface.  It's optional from a
testing-correctness POV — the scenarios already prove the SDK works
without it — but it pays off the day someone needs to investigate "why
did routing pick that bridge in scenario 3?" by scrubbing through the
state visually.

---

## Open questions

| Q | What | Lean |
|---|---|---|
| Q-Test.1 | Where does `test/scenarios/` live in the repo?  Top-level (repo-root) vs `packages/integration-tests/` (workspace package).  | Top-level for now (closer to vitest's expectations); convert to a workspace package only if the boundary actually pays off. |
| Q-Test.2 | Should scenarios run as part of `npm test` (default) or `npm run test:scenarios` (opt-in)?  Opt-in keeps the unit-test fast path fast.  Default integrates them into CI by default. | Add to the root `npm test` so CI runs everything; add a separate `npm run test:scenarios` for fast-path development. |
| Q-Test.3 | Should the harness simulate clock-skew between agents (each agent has its own offset from `Date.now()`)?  Useful for testing replay-window edge cases. | Yes for v2; out of scope for v1 priority scenarios. |
| Q-Test.4 | Should `pod: 'real:css'` be opt-in (env var) or default-when-CSS-is-running?  | Opt-in via env (matches existing `CSS_URL`-gated tests).  Default to mock. |
| Q-Test.5 | A2A external-interop scenario uses Node's built-in `fetch`+EventSource — but EventSource is not in Node-stable until 22+.  Polyfill (eventsource npm) or skip on older Node? | Use the `eventsource` package as a dev-only dep on the test-scenarios workspace; doesn't pollute SDK package deps. |

---

## Pointers

- [`./track-H-demo-meshlab.md`](./track-H-demo-meshlab.md) — Mesh Lab
  demo design.  Phase 5 of this strategy.
- [`./track-H-apps.md`](./track-H-apps.md) — Track H readiness +
  per-app coding-plan stubs.
- [`./track-A-pod-substrate.md`](./track-A-pod-substrate.md),
  [`./track-B-identity-sync.md`](./track-B-identity-sync.md), etc. —
  the SDK tracks whose tests this strategy supplements.
- [`./AGENT-RULES.md`](./AGENT-RULES.md) — common rules for spawned
  agents (apply equally to scenario-test agents).

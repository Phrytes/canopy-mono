# Track G — Reachability cleanup

| | |
|---|---|
| **Status** | not-started |
| **Started** | — |
| **Last updated** | 2026-04-28 (G1 done, G2 done, G3 done) |
| **Owner** | unassigned |
| **Blocked on** | nothing — fully independent. |

**Goal:** small refactor + documentation pass over the
already-implemented routing layer.  Surface oracle bridge
selection (designed but not shipped); promote NKN + hop as
first-class options in the README; add an explicit three-tier
classifier on top of `RoutingStrategy`.

This track is the smallest of the rollout.  Could be done by
one dev in a quiet week.

**Refs:**
- [`../Design-v3/topology-implementation.md` §Track G](../Design-v3/topology-implementation.md#track-g--reachability-cleanup)
- [`../Design-v3/oracle-bridge-selection.md`](../Design-v3/oracle-bridge-selection.md) — what G1 implements
- [`../Design-v3/topology.md` §Reachability infrastructure](../Design-v3/topology.md#internet-scale-infrastructure)

---

## Track-level open questions

| # | Question | Answer (when known) |
|---|---|---|
| Q-G.1 | Oracle gossip frequency: per-connect / interval / change-driven? | **Locked 2026-04-29: change-driven + 60-second interval safety net.**  Re-broadcast immediately when reachability state changes (transport added/lost) AND a 60s heartbeat for liveness.  Both intervals configurable via constructor opts. |
| Q-G.2 | Oracle TTL default: 5 min / 15 min / 1 hour? | **Locked 2026-04-29: 5-minute TTL default, configurable via `ttlMs` opt.**  Future v2 work: tune TTL based on power state (charging → tighter TTL for freshness; battery-saver → wider TTL to save power) and other live signals.  Logged in `TODO-GENERAL.md § Battery-aware reachability tuning`. |

---

## Internal parallelism

```
G1 ── (independent)
G2 ── (independent)
G3 ── (independent)
```

All three independent.  Single dev: any order; G2 fastest;
G3 + G1 medium-effort.

---

## Hand-off triggers

| When this completes | These tracks unblock |
|---|---|
| **G1** | Hop routing skips probe-retry → faster connection times for hop-tunneled peers |
| **G2** | Newcomers find NKN + hop documented as first-class transports |
| **G3** | Apps can introspect "which tier am I reaching this peer through?" for UX (e.g. show `🛰️` for relay, `🔁` for hop) |

---

## Tasks

### G1 — Surface oracle bridge selection

| | |
|---|---|
| **Status** | done |
| **Tag** | [WIRE-UP] |
| **Notes** | Implements the existing design at `Design-v3/oracle-bridge-selection.md`.  Today: probe-retry. |

**Files:**

```
create:
  packages/core/src/routing/ReachabilityOracle.js
  packages/core/test/routing/ReachabilityOracle.test.js

modify:
  packages/core/src/routing/hopBridges.js                 # consult oracle before probing
  packages/core/src/protocol/pubSub.js                    # gossip oracle entries (optional)
```

**Sequence:**

- [x] 1. Lock Q-G.1 + Q-G.2.
- [x] 2. Read `Design-v3/oracle-bridge-selection.md` carefully.
  Implement what it specifies.
- [x] 3. Signed reachability oracle entries (already partially
  exists in `security/reachabilityClaim.js` — confirm + reuse).
- [x] 4. Gossip via existing pubSub.  TTL-based caching.
- [x] 5. `hopBridges.js` consults oracle first; falls back to
  probe-retry if oracle is silent.
- [x] 6. Tests: oracle-driven path picks the right bridge;
  oracle-stale falls back to probe; conflicting oracle entries
  resolved by signature freshness.

**DoD:**
- Oracle implementation matches the design doc.
- Hop routing prefers oracle when available.
- Tests cover happy path + stale-oracle + signature mismatch.

**Notes (team scratchpad):**

```
2026-04-28 (G1 wave-C):
- Substrate audit: most of the oracle was already wired in pull form.
  - signReachabilityClaim / verifyReachabilityClaim — security/reachabilityClaim.js
  - registerReachablePeersSkill — skills/reachablePeers.js
  - GossipProtocol.#pullReachabilityClaim — populates PeerGraph.knownPeers
  - hopBridges.buildBridgeList — already prepended PeerGraph oracle peers
  G1 added the missing PUSH side: a ReachabilityOracle class that signs
  + publishes the agent's own claim and verifies/stores incoming claims
  from peers.
- New module: packages/core/src/routing/ReachabilityOracle.js
  - Q-G.1: change-driven via 'transport-added' / 'transport-removed'
    events on the agent, plus a 60s heartbeat safety net (intervalMs
    default). Both knobs (changeDriven, intervalMs) configurable via
    constructor. notifyTransportChange() is exposed for callers whose
    agent doesn't emit the events. NB: Agent doesn't currently emit
    transport-added/removed; addTransport/removeTransport could be
    extended in a future task to emit those — out of scope for G1
    additive wiring.
  - Q-G.2: 5-min TTL default (ttlMs option). Entries evict lazily on
    bridgeFor() / size / knownIssuers() and aggressively in #onPublish
    when the body.t is shorter than ttlMs (we min() the two).
  - Verifies via existing verifyReachabilityClaim — replay guard via a
    per-issuer lastSeenSeq Map; rejection emits 'claim-rejected' for
    telemetry, mirroring GossipProtocol's 'reachability-claim-rejected'.
  - Pubsub topic constant: 'reachability:oracle' (also exported as
    REACHABILITY_ORACLE_TOPIC).
- hopBridges.buildBridgeList: additive prepend of the push-side oracle
  pick (agent.reachabilityOracle?.bridgeFor(target)). When no oracle is
  wired the function behaves exactly as before — preserving every
  existing invokeWithHop test.
- index.js: re-exports ReachabilityOracle + REACHABILITY_ORACLE_TOPIC.
- bridgeFor() returns { bridge, transport: null, latencyEstimate: null }
  — the existing claim format only carries pubkeys, not transport names,
  so transport/latency hints are nullable placeholders for future
  multi-transport claims (deferred — see Design-v3 §11 future work).
- Tests: 21 new in test/routing/ReachabilityOracle.test.js, all green.
  - Constructor validation, immediate-on-start broadcast, 30ms-interval
    heartbeat, change-driven re-broadcast (+changeDriven=false negative),
    notifyTransportChange(), stop halts heartbeat, idempotent start/stop,
    direct-peer snapshot filtering, bridgeFor null-when-empty, lex-order
    determinism, TTL eviction, signature tamper rejection, replay guard,
    unrelated-topic ignore, malformed payload ignore, hopBridges
    integration both with-oracle and without-oracle.
- Full focused regression: 7 oracle/hop test files = 101 passing.
- Full core suite: 1235/1249 passing (pre-existing flake in
  test/integration/mesh-scenario.test.js phase 10b — also fails on
  baseline pre-G1; passes deterministically when run in isolation;
  test already wraps with retry: 2). Not a G1 regression.
- Only files in scope: index.js (additive re-exports), hopBridges.js
  (additive prepend with safe fallback). Did NOT touch protocol/pubSub.js
  — the existing surface (agent.publish, 'publish' event) was sufficient.
```

---

### G2 — README updates surfacing NKN + hop as first-class options

| | |
|---|---|
| **Status** | done |
| **Tag** | [WIRE-UP] |
| **Notes** | Documentation pass.  Smallest task. |

**Files:**

```
modify:
  README.md                                               # main repo README
  packages/core/README.md                                 # if exists; create if not
  apps/mesh-demo/README.md                                # already touches transports — extend
```

**Sequence:**

- [x] 1. README sections: "Reachability — three layered mechanisms"
  documenting direct / centralized relay / NKN / hop.
- [x] 2. Per-transport quick start: how to enable each.
- [x] 3. Update mesh-demo README to mention NKN as an option for
  rendezvous-less reachability.
- [x] 4. No code changes (unless docstrings need touch-up).

**DoD:**
- READMEs reflect the actual reachability landscape.
- No misleading claims (e.g. don't say something is "experimental"
  if it's been shipped for months).

**Notes (team scratchpad):**

```
2026-04-28 (G2 wave-B1):
- Repo had no root README.md — created one (~165 lines) with the
  "Reachability — three layered mechanisms" section + per-transport
  quick-start.  Mirrors the canonical framing in
  Design-v3/topology.md §Reachability infrastructure.
- packages/core/README.md did not exist — created (~95 lines) with
  Layers + Transports table + entry-point pointers.
- apps/mesh-demo/README.md: appended an "NKN — rendezvous-less
  reachability" subsection after the rendezvous block.  Did NOT
  rewrite existing transport docs.
- Verified all method/option names against source: enableRendezvous
  takes signalingTransport (not "relay"); NknTransport takes identity;
  enableTunnelForward({ policy }), enableSealedForwardFor(groupId),
  agent.invokeWithHop(peer, skill, parts, { group }) all match.
- No "experimental" labels applied; relay public-deployment + auth
  noted as roadmap (matches reality).
- Verify: rg "experimental" README.md packages/core/README.md
  apps/mesh-demo/README.md → only present where contextually accurate.
```

---

### G3 — Reachability picker — explicit three-tier model

| | |
|---|---|
| **Status** | done |
| **Tag** | [EXTENDS] `RoutingStrategy.js` |
| **Notes** | Small refactor.  Existing `RoutingStrategy` already does priority + latency scoring; just needs an explicit tier classification surfaced. |

**Files:**

```
modify:
  packages/core/src/routing/RoutingStrategy.js            # add tier classification

create:
  packages/core/src/routing/ReachabilityTier.js           # constants + helpers
  packages/core/test/routing/ReachabilityTier.test.js
```

**Sequence:**

- [x] 1. Define three tiers: `direct` (WebRTC / BLE / mDNS / local /
  internal), `mesh` (relay / NKN), `hop` (peer-as-relay / sealed-tunnel).
- [x] 2. Map each existing transport to a tier.
- [x] 3. Expose `agent.reachabilityFor(peerId)` returning
  `{ transport, tier, latencyEstimate? }`.
- [x] 4. Tests: tier classification stable across transports;
  reachabilityFor returns expected tier per scenario.

**DoD:**
- Apps can introspect tier per peer.
- `RoutingStrategy` continues to work — just a new accessor.
- Tests green.

**Notes (team scratchpad):**

```
2026-04-28 (G3 wave-B1):
- New module: packages/core/src/routing/ReachabilityTier.js
  Exports: TIERS (direct/mesh/hop), tierForTransport(),
  tierForRouteVia(), compareTiers(), default-export bundle.
- Tier mapping covers both PascalCase class names (LocalTransport,
  RelayTransport, ...) AND lowercase RoutingStrategy names (local,
  relay, ...). The lowercase support is what made the smoke tests
  work with the { name: 'relay' } stub style used elsewhere in
  test/RoutingStrategy.test.js — this avoided duplicating a class
  fixture across the two test files.
- Hop is *not* a transport class; it's a routing decision via
  routing/hopTunnel.js + routing/invokeWithHop.js. So
  RoutingStrategy.tierFor(peerId, { via: { kind: 'hop', through } })
  overrides the transport tier with 'hop' while still resolving the
  underlying transport so the caller has it for actual sending.
- Unknown transports default to 'mesh' (conservative — apps still
  see "reachable via something indirect").
- agent.reachabilityFor(peerId, opts) added in Agent.js; returns
  null when no RoutingStrategy is wired or when no transport is
  selectable for the peer.
- index.js: re-exports ReachabilityTier (default) plus named
  helpers (REACHABILITY_TIERS, tierForTransport, tierForRouteVia,
  compareTiers).
- Tests: 25 new in test/routing/ReachabilityTier.test.js, all
  green; existing RoutingStrategy.test.js (10 tests) still green;
  full npm run test:core: 70 files, 779 tests, 3 skipped, 0 fail.
- Additive only — no behaviour change to selectTransport(),
  transportFor(), routeFor().
```

---

## Cross-track dependencies

None.  Track G is self-contained.

---

## Cross-references

- `packages/core/src/routing/RoutingStrategy.js` — existing transport selector.
- `packages/core/src/security/reachabilityClaim.js` — partial substrate for G1.
- `Design-v3/oracle-bridge-selection.md` — G1's spec.

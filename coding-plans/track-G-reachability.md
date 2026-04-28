# Track G — Reachability cleanup

| | |
|---|---|
| **Status** | not-started |
| **Started** | — |
| **Last updated** | 2026-04-28 (G2 in-progress, G3 in-progress) |
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
| Q-G.1 | Oracle gossip frequency: per-connect / interval / change-driven? | TBD before G1 — leaning change-driven + interval safety net |
| Q-G.2 | Oracle TTL default: 5 min / 15 min / 1 hour? | TBD before G1 — leaning 15 min |

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
| **Status** | not-started |
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

- [ ] 1. Lock Q-G.1 + Q-G.2.
- [ ] 2. Read `Design-v3/oracle-bridge-selection.md` carefully.
  Implement what it specifies.
- [ ] 3. Signed reachability oracle entries (already partially
  exists in `security/reachabilityClaim.js` — confirm + reuse).
- [ ] 4. Gossip via existing pubSub.  TTL-based caching.
- [ ] 5. `hopBridges.js` consults oracle first; falls back to
  probe-retry if oracle is silent.
- [ ] 6. Tests: oracle-driven path picks the right bridge;
  oracle-stale falls back to probe; conflicting oracle entries
  resolved by signature freshness.

**DoD:**
- Oracle implementation matches the design doc.
- Hop routing prefers oracle when available.
- Tests cover happy path + stale-oracle + signature mismatch.

**Notes (team scratchpad):**

```
(empty)
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
| **Status** | in-progress |
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

- [ ] 1. Define three tiers: `direct` (WebRTC / BLE / mDNS / local /
  internal), `mesh` (relay / NKN), `hop` (peer-as-relay / sealed-tunnel).
- [ ] 2. Map each existing transport to a tier.
- [ ] 3. Expose `agent.reachabilityFor(peerId)` returning
  `{ transport, tier, latencyEstimate? }`.
- [ ] 4. Tests: tier classification stable across transports;
  reachabilityFor returns expected tier per scenario.

**DoD:**
- Apps can introspect tier per peer.
- `RoutingStrategy` continues to work — just a new accessor.
- Tests green.

**Notes (team scratchpad):**

```
(empty)
```

---

## Cross-track dependencies

None.  Track G is self-contained.

---

## Cross-references

- `packages/core/src/routing/RoutingStrategy.js` — existing transport selector.
- `packages/core/src/security/reachabilityClaim.js` — partial substrate for G1.
- `Design-v3/oracle-bridge-selection.md` — G1's spec.

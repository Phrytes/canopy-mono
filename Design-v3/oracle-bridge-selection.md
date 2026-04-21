# Oracle bridge-selection — design

**Status:** proposal. Input for Group T in `EXTRACTION-PLAN.md` / `CODING-PLAN.md`.
**Supersedes:** nothing (ships alongside today's probe-retry in `invokeWithHop`).

---

## 1. Problem

Today `invokeWithHop` picks a bridge with **probe-retry**:

```
for each direct peer (starting with record.via):
  call relay-forward on that peer
  if it replies 'target-unreachable' → try next
  if it replies success             → done
```

Two costs:
- **Latency.** A miss wastes one round-trip per candidate until we hit the right bridge, every time we send — there's no memory.
- **Load.** Every wrong bridge attempt traverses the relay WS and the bridge's inbound queue.

The oracle model replaces "probe-every-time" with "look up a cached, signed claim of reachability", so the *first* bridge we try is always the right one — when the cache is fresh.

Probe-retry stays as a fallback for cold-start, stale cache, and adversarial claims.

---

## 2. The claim

Every agent periodically publishes a **signed reachability claim** listing
the peers it can reach *directly* (hops:0, reachable).

Claim body (canonical JSON, Ed25519-signed):

```json
{
  "v":  1,
  "i":  "<issuer-pubkey-b64>",
  "p":  ["<peer1-b64>", "<peer2-b64>", ...],   // sorted lexicographically
  "ia": 1716450000000,    // issuedAt  — ms since epoch
  "ea": 1716450300000     // expiresAt — ms since epoch
}
```

Full claim (what's sent on the wire):

```json
{
  "body": { ...as above... },
  "sig":  "<base64url Ed25519 signature over canonicalize(body)>"
}
```

**Canonicalisation** reuses `core/Envelope.js::canonicalize` — alphabetically sorted keys, no whitespace. `p` is already sorted so the serialisation is deterministic regardless of Map/Set traversal order.

**Version byte** (`v: 1`): lets the protocol evolve. Receivers MUST reject unknown versions.

**Limits** (receiver-enforced):
- `|p| ≤ MAX_PEERS` (default 1024) — prevents list-flooding DoS.
- `ea - ia ≤ MAX_TTL_MS` (default 10 min) — bounds the staleness window.
- Payload byte size ≤ `MAX_CLAIM_BYTES` (default 256 KB).

---

## 3. Exposure — `reachable-peers` skill

A new SDK skill that returns the current claim:

```
Request:  ()
Response: [DataPart({ body, sig })]
```

- Visibility: `'authenticated'` by default — same bar as `peer-list`.
- Caching: the producing agent re-signs only when its direct-peer set changes
  or when the previous claim's `expiresAt - now < REFRESH_BUFFER_MS`
  (default 60 s). Intermediate calls return the cached claim.
- Idempotent and cheap: constant-time for callers; re-sign is ~sub-ms.

`peer-list` (unsigned, UI-facing) stays unchanged. The two skills coexist:

| Skill            | Signed | TTL'd | Used by                                   |
|------------------|:------:|:-----:|-------------------------------------------|
| `peer-list`      |   ❌   |   ❌  | UI displays, app-level gossip             |
| `reachable-peers`|   ✅   |   ✅  | Routing (oracle bridge selection)         |

---

## 4. Storage — `PeerGraph`

The `knownPeers` field on a peer record is already in the shape but has never
been populated. Oracle fills it and adds bookkeeping for freshness:

```js
{
  // existing fields...
  knownPeers:     string[],   // pubKeys this peer declared they can reach
  knownPeersTs:   number,     // ea (expiresAt) of the last accepted claim
  knownPeersSig?: string,     // optional — persisted for re-broadcast/debug
}
```

`PeerGraph.upsert` merges arrays without duplicates (already does this), and
the new fields follow the spread-merge precedence — fresh claims win.

---

## 5. Refresh + gossip

### Producer side
Agent re-signs its claim when:
1. A `peer` event fires (new direct peer hello'd).
2. A `peer-disconnected` event fires (direct peer dropped).
3. The cached claim is within `REFRESH_BUFFER_MS` of `expiresAt`.

### Consumer side
Two fetch paths, both in `GossipProtocol.runRound`:

- **Periodic.** Each gossip tick, after the existing `peer-list` pull, also
  fetch `reachable-peers` from the same peer. If verification passes and
  the claim is newer than what we have, upsert `knownPeers` / `knownPeersTs`.
- **On-demand.** `invokeWithHop` may request a fresh claim from a specific
  peer when its cached entry is expired (optional optimisation; skip if the
  round-trip is pointless — probe-retry will handle it anyway).

### Verification checks (in order, fail fast)
1. `claim.body.v === 1`
2. `|claim.body.p| ≤ MAX_PEERS` and byte-size ≤ `MAX_CLAIM_BYTES`
3. `claim.body.ia ≤ now ≤ claim.body.ea` (with ±`CLOCK_SKEW_MS` grace, default 60 s)
4. `claim.body.ea - claim.body.ia ≤ MAX_TTL_MS`
5. `claim.body.i === <issuer pubKey we expect>` (prevents reflection)
6. Ed25519 signature verifies against `claim.body.i`'s key

Any failure → emit a `reachability-claim-rejected` event (telemetry) and
**do not** update the graph.

---

## 6. Routing — `invokeWithHop` upgrade

Current flow:

```
direct attempt
  └── if fails: bridges = [record.via, ...allOtherReachableDirect]
       for each bridge: call relay-forward; first success wins
```

New flow (additive — probe-retry is still there):

```
direct attempt
  └── if fails:
       a) gather bridge candidates that explicitly claim the target
          (direct peers whose knownPeers includes target AND knownPeersTs > now)
       b) then record.via (if not already in a))
       c) then remaining reachable direct peers (probe-retry fallback)

       for each bridge in the concatenated list: call relay-forward; first success wins
```

**Why still fall through to probe-retry:**
- Cold start (no oracle data yet).
- Oracle data expired between ping rounds.
- Malicious claim — a peer lied; probe-retry still succeeds via an honest bridge.

Test assertion in Group Y phase-9 (new): after a successful oracle round,
the *first* `relay-forward` target is the oracle-picked bridge. No wasted
attempts.

---

## 7. Failure modes & threats

| Threat                       | Mitigation                                                      |
|------------------------------|-----------------------------------------------------------------|
| Replay of old claim          | Strict `ea > now` check; sig covers `ia` + `ea`                 |
| Forgery (fake issuer)        | Ed25519 sig verified against `i` (caller-known pubkey)          |
| Claim flood (DoS)            | `MAX_PEERS`, `MAX_CLAIM_BYTES`, producer-side cache             |
| False reachability claim     | Receiver still calls `relay-forward`; bad claim → `target-unreachable` response → probe-retry picks a real bridge |
| Clock skew                   | ±60 s grace on `ia`/`ea`; log + reject if out of bounds         |
| Stale oracle after churn     | Short TTL (5 min default) + `peer-disconnected`-triggered re-sign |
| Signature-verification DoS   | Claims only accepted from hello'd peers (SecurityLayer.getPeerKey) |

---

## 8. API summary

Everything opt-in. No existing API breaks.

```js
// Producer side
agent.enableReachabilityOracle({
  ttlMs           = 5 * 60_000,
  refreshBufferMs = 60_000,
});

// Consumer side (implicit — handled by GossipProtocol when available;
//                or explicit via new function for tests)
import { fetchReachabilityClaim, verifyReachabilityClaim }
  from '@canopy/core';
```

Signed-claim helpers live in `core/security/reachabilityClaim.js`:

```js
signReachabilityClaim(identity, peers, { ttlMs }) → { body, sig }
verifyReachabilityClaim(claim, { expectedIssuer, now }) → { ok, reason? }
```

Skill lives in `core/skills/reachablePeers.js`:

```js
registerReachablePeersSkill(agent, { ttlMs, refreshBufferMs });
// Called internally by agent.enableReachabilityOracle().
```

---

## 9. What this design deliberately does *not* cover

- **Multi-hop oracle routing.** Only direct-peer claims; 2-hop via
  knownPeers-of-knownPeers is future work (and is probably where a
  link-state or DHT-style approach makes more sense than per-peer claims).
- **Revocation.** Expiry via `ea` is the only revocation mechanism in v1.
  Explicit "forget this peer" would need a signed revocation message —
  deferred.
- **Push.** Consumers pull via gossip. Push (publish when the set changes)
  may land later; pull is sufficient for 5-min TTLs on ~15 s gossip.

---

## 10. Open issues to resolve before Phase-T implementation starts

1. **`MAX_PEERS` default.** 1024 keeps the payload under ~50 KB at 48-byte
   keys. Acceptable? Or do we want a lower cap (say 256) to be defensive?
2. **Clock source.** `Date.now()` everywhere. Good enough on phones +
   laptops? Or do we want a monotonic source for `ia`?
3. **Persistence.** Do we cache verified claims across app restarts, or
   re-pull on every cold start? Caching saves startup latency on flaky
   networks but needs thought about how to invalidate on key-rotation.
4. **Interaction with capability tokens.** Could reachability-claim
   verification piggy-back on the same `CapabilityToken` canonicalisation?
   (Probably not — tokens are per-skill, claims are per-agent — but worth
   checking before both codepaths ossify.)

These are **input to Group T's first sub-phase** (design doc approval). The
coding plan must either resolve them or make the defaults above explicit
before T1 implementation starts.

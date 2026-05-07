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
  "t":  300000,          // ttlMs — validity window starting from receipt
  "s":  1716450000000    // monotonic sequence from the issuer — replay guard
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

**Receiver-anchored TTL** (T1b decision): the signed body contains a *relative* `t` (ttlMs) rather than absolute timestamps. The recipient stamps the claim with its *own local* `receivedAt` on arrival and treats the claim as valid while `now - receivedAt < t`. No wall-clock is ever compared between issuer and receiver, so clock skew is structurally irrelevant.

**Replay detection** via `s` (sequence). Each issuer advances `s` strictly monotonically — implementation: `s = max(Date.now(), lastSignedSeq + 1)`, persisted in the vault so NTP adjustments or clock jumps don't revert it. Receivers remember the **last accepted `s` per issuer** (one number in RAM) and reject any claim where `s <= lastSeenSeq`.

**Limits** (receiver-enforced):
- `|p| ≤ MAX_PEERS` (default **256**) — prevents list-flooding DoS. Override via `enableReachabilityOracle({ maxPeers })` or the `oracle.maxPeers` field in the agent definition file.
- `t ≤ MAX_TTL_MS` (default 10 min) — bounds the staleness window; oversize rejected.
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
3. `claim.body.t > 0` and `claim.body.t ≤ MAX_TTL_MS`
4. `claim.body.s > lastSeenSeq[claim.body.i]` (replay guard; accept any first sighting)
5. `claim.body.i === <issuer pubKey we expect>` (prevents reflection)
6. Ed25519 signature verifies against `claim.body.i`'s key

On success: record `receivedAt = now_local` alongside the claim.  Cache invalidates when `now_local - receivedAt ≥ t`.  No wall-clock is ever compared between the issuer and the receiver.

Any failure → emit a `reachability-claim-rejected` event (telemetry) and
**do not** update the graph. Previously-accepted claim (if any) keeps its freshness window; it isn't invalidated by a bad follow-up.

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
| Replay of old claim          | Monotonic `s`; receiver keeps `lastSeenSeq` per issuer and rejects `s ≤ lastSeenSeq` |
| Replay extending validity    | `t` (ttlMs) is anchored to **receiver's** `receivedAt`, so a re-delivered replay can't outlive the receiver's original window plus one more `t` at worst — and the `s` guard usually catches it first |
| Forgery (fake issuer)        | Ed25519 sig verified against `i` (caller-known pubkey)          |
| Claim flood (DoS)            | `MAX_PEERS`, `MAX_CLAIM_BYTES`, producer-side cache             |
| False reachability claim     | Receiver still calls `relay-forward`; bad claim → `target-unreachable` response → probe-retry picks a real bridge |
| Clock skew across devices    | **Not applicable** — no wall-clock comparison between issuer and receiver (§2 receiver-anchored TTL) |
| Issuer clock jumps backwards | `s` computed as `max(Date.now(), lastSignedSeq + 1)` persisted in vault — never reverts |
| Stale oracle after churn     | Short TTL (5 min default) + `peer-disconnected`-triggered re-sign |
| Signature-verification DoS   | Claims only accepted from hello'd peers (SecurityLayer.getPeerKey) |

---

## 8. API summary

Everything opt-in. No existing API breaks.

```js
// Producer side — all knobs optional, each falls through to the
// agent-definition-file value (AgentConfig 'oracle.*') and finally a
// built-in default. Code argument wins over config wins over default.
agent.enableReachabilityOracle({
  ttlMs            = 5 * 60_000,   // validity window, receiver-anchored
  refreshBeforeMs  = 60_000,       // re-sign when cached claim has <= this much left
  maxPeers         = 256,          // hard cap on |p| in our own claim
});

// Consumer side (implicit — handled by GossipProtocol when available;
//                or explicit via helpers for tests)
import { fetchReachabilityClaim, verifyReachabilityClaim }
  from '@canopy/core';
```

**Agent-definition-file overrides** (recognised by `AgentConfig` so a YAML/JSON
definition can tune oracle behaviour without code changes):

```yaml
oracle:
  ttlMs:           300000
  refreshBeforeMs:  60000
  maxPeers:           256
  # consumer-side caps (used when verifying claims from peers):
  maxTtlMs:        600000       # reject claims with t > maxTtlMs
  maxBytes:        262144       # reject claim payloads > maxBytes
```

Signed-claim helpers live in `core/security/reachabilityClaim.js`:

```js
signReachabilityClaim(identity, peers, { ttlMs, seqStore }) → { body, sig }
//   seqStore:  { read(): Promise<number>, write(n): Promise<void> }
//   Defaults to an in-memory value bootstrapped with Date.now().
//   For persistence across restarts, pass a vault-backed store.

verifyReachabilityClaim(claim, {
  expectedIssuer,
  lastSeenSeq,          // number | undefined
  maxPeers, maxTtlMs, maxBytes,
}) → { ok: true, newLastSeq } | { ok: false, reason: string }
```

Skill lives in `core/skills/reachablePeers.js`:

```js
registerReachablePeersSkill(agent, { ttlMs, refreshBeforeMs, maxPeers });
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

## 10. T1 decisions (resolved)

These were the four open issues blocking Group T implementation. Decided
2026-04-21; frozen here so T2 can proceed.

### T1-a · `MAX_PEERS` default = 256, overridable

Small default keeps phone-class agents defensive against oversize or
adversarial claims. Well-connected relays / servers who legitimately
need more opt in two ways:

- **Code** — `agent.enableReachabilityOracle({ maxPeers: 1024 })`
- **Agent definition file** — `oracle.maxPeers: 1024` in the YAML/JSON
  loaded by `AgentConfig`

Resolution order inside `enableReachabilityOracle`: explicit code arg → `agent.config.get('oracle.maxPeers')` → built-in default 256.

### T1-b · No wall-clock comparison between issuer and receiver

Dropped `issuedAt` / `expiresAt` from the signed body. Replaced with a
pair that sidesteps clock skew entirely:

- `t` — ttl in milliseconds. Receiver anchors against its *own*
  `receivedAt` when the claim arrives; the claim is valid while
  `now_local - receivedAt < t`.
- `s` — monotonic sequence. Issuer advances `s` strictly using
  `max(Date.now(), lastSignedSeq + 1)` persisted in the vault (so NTP
  corrections or clock jumps can't revert it). Receivers remember
  `lastSeenSeq` per issuer and reject `s ≤ lastSeenSeq` as a replay.

No `CLOCK_SKEW_MS` parameter — it's structurally irrelevant now.

### T1-c · Volatile cache only, but producer refreshes before expiry

**No cross-restart persistence.** Verified claims live in RAM. On cold
start, the first gossip round (≤ 15 s) re-populates the cache. Saves
us an AsyncStorage integration + key-rotation invalidation story we
don't need yet.

The *producer* side does refresh its own cached claim proactively,
so gossip doesn't return an about-to-expire claim that a consumer
would then immediately discard. Controlled by:

- **Code** — `enableReachabilityOracle({ refreshBeforeMs: 60_000 })`
- **Agent definition file** — `oracle.refreshBeforeMs: 60000`

When `now - claim.signedAt ≥ (ttlMs - refreshBeforeMs)`, the next
request re-signs. Default 60 s; override per app.

### T1-d · Share `canonicalize()` with `CapabilityToken`, nothing else

Both modules depend on one primitive for signing: deterministic
JSON serialisation with sorted keys. That already exists as
`core/Envelope.js::canonicalize`. `reachabilityClaim.js` and
`CapabilityToken.js` both import it directly; they don't share a
higher-level "signed body" helper because their body shapes and
verification rules are unrelated. Any shared abstraction beyond
canonicalisation would be speculative.

---

## 11. Future work (deferred)

- **Cross-restart persistence** — revisit if cold-start latency becomes
  a measurable issue.
- **Multi-hop oracle routing** — knownPeers-of-knownPeers graph walks;
  probably needs a link-state / DHT approach rather than more per-peer
  claims.
- **Explicit revocation** — signed revocation messages for
  "forget-this-claim" events. Useful for key rotation. Expiry is
  sufficient for v1.
- **Push updates** — publish a fresh claim on every peer-set change
  instead of waiting for the next gossip pull. Probably paired with
  a rate limit.

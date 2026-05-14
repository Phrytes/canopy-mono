# Conflict resolution across the substrate stack (2026-05-14)

> **Origin.** Raised by the user as a sub-question during Stoop's
> Q-B (groupMirror retirement) — see `open-questions-2026-05-12.md`
> §Q-D:
>
> > "When information comes that is different from what is
> > available in the pod, how do you know which option is the most
> > up-to-date? Because that will define whether you need to update
> > yourself or not (or even tell the other party that their info is
> > outdated)."
>
> **Status.** Design note only. **Implementation deferred** per the
> user's explicit choice. This doc surveys what each substrate does
> today, names the semantic categories of "freshness", maps the
> gaps, and proposes a unified policy when one fits — flagging where
> a single policy can't.

## Why this matters

Every distributed-data system has to answer "whose copy wins when
two copies disagree?" The substrate stack has **partial answers in
different places** but no unified policy. As more apps adopt
canonical types + replication-ring fan-out, the gaps surface as
real bugs — silently overwritten state, stale UI rendering, no
signal to the user that "their info is out of date."

## The three semantic categories

Honest taxonomy of the freshness situations the stack faces:

### 1. Single-author, single-pod resource

One agent ever writes; the pod is canonical. Examples:
`<pod>/private/storage-mapping`, the user's `agent-registry`, a
personal note in `<pod>/private/notes/x.md`.

Conflict can still happen (same user on two devices, race), but
it's bounded: the pod tells you when your write is stale via the
`If-Match` etag header. The pod's current etag is the truth.

**Current state:** ✅ Well-handled.
- `@canopy/pod-client.write` honours `ifMatch` and surfaces
  `ConflictError` on 412.
- `@canopy/agent-registry`'s `withCAS` does etag-CAS retry with
  bounded backoff + `PERSISTENT_CONFLICT` after exhausting retries.
- `@canopy/pseudo-pod` V1 cache mode write-through queue retries
  on transient errors (no 412 handling yet — see open issue below).

### 2. Multi-author, single-pod resource

Multiple agents write to the same pod resource (e.g. a shared
group-rules doc that admins co-edit). Still etag-based, but the
"loser" can't just retry — their changes are based on stale
content. Caller-side conflict resolution required.

**Current state:** ⚠️ Partial.
- `@canopy/pod-client.write` emits a `'conflict'` event the caller
  can listen for; supplies local + remote snapshots; caller can
  `resolveWith(merged)` or `cancelWrite()`. Documented; works.
- No app currently consumes the event — desktop Folio uses
  `conflictPolicy: 'reject'` (the V0 default per Q-A.4 lock).
- `@canopy/agent-registry` has the same etag-CAS surface but no
  merge callback hook for multi-writer scenarios. Acceptable
  because the registry is single-author per agent.

### 3. No-pod / replication-ring resource

No canonical source. N peers all hold local copies of the same
logical resource. Conflict = "Anne posted a buurt request, Bob
edited it on his copy via groupMirror's append, the two diverge."

This is the **hard case** and the one Q-D is really about.

**Current state:** ⛔ Last-write-wins everywhere.
- `@canopy/notify-envelope` receivers call
  `pseudoPod.writeFromPeer(uri, payload, etag)` which clobbers the
  local copy unconditionally. No conflict-detection.
- `@canopy/pseudo-pod` replication-ring mode publishes every
  write as a full-payload envelope; receivers overwrite. No
  version-vector.
- Stoop's existing `groupMirror` is also LWW.

LWW works in practice for the buurt-board case because resources
are short-lived and rarely co-edited. But it gives no signal when
divergence happens — no "this peer's data is older than yours"
event the UI could surface.

## Cross-source disagreement (the "cache vs pod" case)

A separate axis: the same agent has *two views* of the same
resource — its local pseudo-pod cache and the real pod. The
versions can drift if a write-through queue is pending, or if
another device wrote to the pod since this device last read.

**Current state:** Partial.
- Pseudo-pod V1 cache mode: write-through queue handles "you wrote
  locally first, pod gets it later" — cache and pod converge.
- Read miss-through: `read()` falls back to `podFetcher(uri)` on
  local miss, caches the result, returns. No staleness check on
  cached entries — once cached, the local copy is trusted until
  evicted.
- No background refresh / TTL. If the pod has a newer version, the
  local cache won't notice until someone writes (412 conflict) or
  the cache entry is explicitly invalidated.

## Where the gap is

For Q-D specifically:

1. **No version-vector on replication-ring writes.** Receivers can't
   tell "is this older than what I have?" without comparing
   `updatedAt` timestamps, which are clock-skew-prone across
   independent devices.
2. **No "tell the sender they're stale" signal.** If Bob's peer
   sends Anne a copy of an item Anne already has a newer version
   of, Anne silently keeps her newer copy and Bob never knows. He
   continues to render his stale version.
3. **No cache-vs-pod freshness check on read.** If the user signs
   in on a new device, their pseudo-pod cache is empty → reads go
   to the pod → freshness fine. But on an existing device where
   another device updated the pod, the local cache silently serves
   stale data until a write happens.

## Proposed unified policy (when one fits)

Honest call: there's **no single conflict-resolution policy** that
fits all three semantic categories. But each category does have a
reasonable answer:

| Category | Policy | Implementation site |
|---|---|---|
| Single-author single-pod | Pod etag is truth; CAS-retry with bounded backoff | Already done in `pod-client`, `agent-registry`. Extend to pseudo-pod cache-mode write-through. |
| Multi-author single-pod | Pod etag is truth; merge-callback for resolvable cases, `ConflictError` otherwise | Already wired in `pod-client`. Apps opt in by listening to the `'conflict'` event. |
| No-pod replication-ring | Per-resource **Lamport-style version counter** + LWW with version as tiebreaker; receiver fires `'stale-peer'` event when an inbound write is older than the local copy | NEW. `pseudo-pod` write side increments `_v` per `pseudo-pod://<deviceId>/<path>`; receiver compares + emits event. Sender-side fix: a subsequent envelope replays the newer version when the receiver signals stale. |
| Cache vs pod | Pod is truth on conflict (CAS handles writes); for reads, **explicit `freshness: 'fresh' \| 'cached'`** opt — default cached for speed, `fresh` forces a head-request etag check | NEW. `pseudo-pod.read(uri, {freshness: 'fresh'})` triggers a HEAD/conditional-GET against the pod; on 304 the cache stays valid, on 200 it refreshes. |

## What the substrate would need

To land the "no-pod replication-ring" answer (the load-bearing one
for groupMirror retirement):

1. **`pseudo-pod` write — version counter.** Every local write to
   `pseudo-pod://<deviceId>/<path>` increments a per-key counter
   (`_v: number`, stored alongside `bytes` + `etag`). Counter is
   *device-local* — no coordination, no clock dependency.

2. **`notify-envelope` wire shape — include `_v`.** The full-
   payload fan-out carries the sender's `_v` for that ref so the
   receiver can compare.

3. **`pseudo-pod.writeFromPeer` — version-aware.** Before
   overwriting, compare incoming `_v` against the local `_v`:
   - inbound `_v` > local `_v` → write (peer is fresher).
   - inbound `_v` < local `_v` → ignore + fire `'stale-peer'`
     event with `{uri, peerActor, peerV, localV}` so the caller
     can reply.
   - inbound `_v` == local `_v` → either (a) accept (idempotent
     replay) or (b) check `etag` for content equality — diverging
     bytes at the same `_v` is a real conflict (rare; concurrent
     writes on different devices), surface as `'concurrent-write'`
     event.

4. **`notify-envelope` send — "stale-peer" reply path.** When
   the receiver fires `'stale-peer'`, an app-level handler can
   call `notifyEnvelope.publish` with the local (newer) copy back
   to the sender. The sender's `writeFromPeer` then runs the same
   version compare and adopts the newer one. Convergence in one
   round-trip per stale peer.

5. **App-level UX hooks.** Stoop / Tasks / Folio subscribe to
   `'stale-peer'` and `'concurrent-write'` events to surface
   "your data is outdated; refresh?" prompts when relevant.

## What stays out of scope (for now)

- **CRDTs** (G-Set, OR-Set, RGA, etc.) — proper conflict-free
  replicated data types would handle truly-concurrent multi-writer
  scenarios without losing any writes. Right call long-term;
  overkill for V0 buurt where conflicts are vanishingly rare and
  LWW + stale-peer signalling is enough.
- **Vector clocks across the whole stack** — would catch every
  causal relationship but adds significant per-write overhead and
  coordination. Lamport-style per-key counters are 90% of the
  benefit for 10% of the complexity.
- **Cross-pod consistency** — if Anne writes to her pod and Bob
  writes a referencing resource to his pod, neither side sees the
  other's writes until they sync. This is a Solid-spec-level
  problem (ACP + linked data semantics); out of scope for the V2
  substrate stack.

## Suggested ordering

When this work picks up:

1. **Spec the wire shape change for `notify-envelope`** — add
   `_v` to the full-payload envelope. Forward-additive, so old
   receivers ignore the field.
2. **Add `_v` to `pseudo-pod`'s `StorageBackend` interface** as
   an optional return field on `get`/`put`. Default backends fill
   in `0` if absent (legacy data).
3. **Wire the version-compare in `writeFromPeer`** with the
   three-way branch above. Tests cover all three branches +
   stale-peer event firing.
4. **Add the freshness opt to `pseudoPod.read`** (cache vs pod
   freshness check). Tests cover the HEAD-request behaviour
   against a mock pod.
5. **App-level adoption** — Stoop subscribes to `'stale-peer'`
   first (its UX has the most exposure to peer divergence).

Total estimated scope: 3–4 days of substrate work + 1 day of
Stoop wiring. Comparable to a single phase from the substrates-v2
plan.

## How this relates to other open work

- **groupMirror retirement (Q-B):** the version-vector design
  here is the missing piece that makes the substrate path
  feature-equivalent to groupMirror's current LWW-with-no-signal.
  If we ship groupMirror retirement *with* this design, the
  substrate path is strictly stronger.
- **Substrates-v2 §52.9.2:** the plan named "envelope ordering
  guarantees under heavy multi-actor write loads — possibly needs
  per-actor sequence counter" as an open question. This design
  proposes per-key counters (more local, less coordination) as a
  better fit than per-actor counters.
- **Pseudo-pod V1 cache mode (§52.8):** the cache-vs-pod
  freshness opt fits cleanly into the existing cache mode without
  disturbing the V0 surface.

## Pointer index

Substrates touched (when implementation starts):
- `packages/notify-envelope/src/NotifyEnvelope.js` — `publish` adds
  `_v` to the full-payload wire shape.
- `packages/pseudo-pod/src/StorageBackend.js` — typedef gains
  `_v?: number` on `StoredRecord`.
- `packages/pseudo-pod/src/MemoryBackend.js` — track per-key
  version counter.
- `packages/pseudo-pod/src/PseudoPod.js` — `writeFromPeer`
  three-way branch; `read({freshness})` opt.
- `packages/react-native/src/pseudo-pod-adapter/{Fs,As}Backend.js`
  — same counter on the persistent backends.

Apps touched:
- `apps/stoop/src/skills/index.js` — subscribe to `stale-peer`,
  reply via `notify-envelope.publish`.
- Eventually Tasks + Folio when they adopt replication-ring.

Tests:
- `packages/pseudo-pod/test/PseudoPod.replicationRing.test.js`
  gains the three version-compare cases.
- `packages/integration-tests/test/scenarios/substrates-v2/` —
  new scenario covering the full "Anne updates, Bob has stale
  copy, Bob replies, both converge" round-trip.

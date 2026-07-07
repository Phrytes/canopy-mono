# @canopy/pseudo-pod

A **Solid-shaped local store** that backs every app in the
Decentralised-Web-Agent (DWA) stack — runs the same `read / write /
list / subscribe` surface regardless of whether a real Solid pod is
attached.

Per the standardisation plan's §II.2 graceful-degradation lock,
the **pseudo-pod is the universal baseline**: a real pod is a
*promotable ring member* layered on top, not a replacement.

> Standardisation Phase **52.2** — see
> `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`
> and the functional design §4.1.

---

## Status: V0

V0 (this release):

- **standalone** mode — single-device. Local store is canonical;
  no fan-out.
- **replication-ring** mode — every write is eagerly fanned out to
  peers via `transport.publishEnvelope`. Local store is canonical;
  peers reconcile via `writeFromPeer`.

V1 (Phase 52.8) adds **cache** mode (write-through to a real pod
with the pending-pod-upload queue + per-write reachability gating).

---

## Quick start

### Standalone

```js
import { createPseudoPod, createMemoryBackend } from '@canopy/pseudo-pod';

const pod = createPseudoPod({
  backend:  createMemoryBackend(),
  mode:     'standalone',
  deviceId: 'laptop-anne',
});

const { etag } = await pod.write(
  'pseudo-pod://laptop-anne/tasks/abc',
  { type: 'task', text: 'paint the fence' },
);
const rec = await pod.read('pseudo-pod://laptop-anne/tasks/abc');
//   → { uri, bytes, etag }
```

### Replication-ring

```js
const pod = createPseudoPod({
  backend:  createMemoryBackend(),
  mode:     'replication-ring',
  deviceId: 'laptop-anne',
  transport: agent.transport,          // exposes publishEnvelope()
  getPeers:  () => circle.peerAddresses, // dynamic peer set
  fromActor: agent.actorUri,
});

// Writes fan out to peers automatically.
await pod.write('pseudo-pod://laptop-anne/tasks/abc', taskBytes);

// On the receive path (called by the notify-envelope substrate,
// Phase 52.4):
await peerPod.writeFromPeer(uri, bytes, etag);
```

### Exposing your pod over the wire

The peer-fetch protocol is implemented as a core skill
(`makeFetchResourceSkill`), bound to a pseudo-pod's reader:

```js
agent.skills.register(pod.fetchResourceSkill());

// Caller side:
const parts = await agent.callSkill({
  target: peerAddress,
  skill:  'fetch-resource',
  args:   { uri: 'pseudo-pod://laptop-anne/tasks/abc' },
});
```

---

## API

```text
createPseudoPod({ backend, mode, deviceId, transport?, getPeers?, fromActor? })
  → pseudoPod

pseudoPod.read(uri, {freshness}?)    → { uri, bytes, etag?, _v? } | null
                                       //   freshness: 'cached' (default) | 'fresh'
                                       //   'fresh' triggers a conditional-GET against
                                       //   the pod (cache mode only).
pseudoPod.write(uri, bytes, etag?)   → { uri, etag, _v }
pseudoPod.delete(uri)                → void
pseudoPod.list(containerUri)         → string[]   (URI keys)
pseudoPod.subscribe(uri, cb)         → unsubscribe fn
pseudoPod.writeFromPeer(uri, bytes, etag?, _v?, opts?)
                                       → { status: 'peer-update' | 'stale-peer' |
                                                   'concurrent-write' | 'idempotent' |
                                                   'written-no-version' }
                                       // replication-ring receive path; runs the
                                       // 3-way version compare.
pseudoPod.flush(uri)                 — no-op in V0 (V1: cache flush)
pseudoPod.mode(uri)                  → 'standalone' | 'replication-ring' | 'cache'
pseudoPod.on(event, cb)              → unsubscribe fn
pseudoPod.off(event, cb)             → void
                                       // events (Phase 52.14): 'peer-update',
                                       //                       'stale-peer',
                                       //                       'concurrent-write'
pseudoPod.fetchResourceSkill({groupCheck?, capCheck?}?)
                                     → skill definition (core)
                                     // Phase 52.2.x peer-fetch gates:
                                     //   groupCheck(uri, {from, envelope, agent, parts, capToken}) → bool
                                     //   capCheck(uri, {... + capToken from parts})              → bool
                                     // When BOTH supplied → allow if EITHER returns truthy.
                                     // When NEITHER supplied → trust-the-transport (back-compat).

pseudoPod.deviceId
pseudoPod.backend
pseudoPod.currentMode
```

### URI scheme

- `pseudo-pod://<deviceId>/<path>` — the only scheme V0 handles.
- `https://...` URIs route via `pod-client` once Phase 52.6 lands.

A pseudo-pod can **read** any `pseudo-pod://*` URI (including peers'
URIs once replicated locally) but only **write** to its own
`pseudo-pod://<deviceId>/...` namespace. Inbound peer writes use
`writeFromPeer`, which bypasses the device check by design.

### Etag behaviour

- The backend assigns an etag on every write if the caller doesn't
  pass one explicitly.
- Etags are opaque strings — `MemoryBackend` uses a monotonic
  counter; production backends may use content hashes.
- V0 does **not** enforce CAS (compare-and-swap) on writes. That
  ships with V1 cache mode and the pending-upload queue.

### Conflict resolution — Lamport `_v` (Phase 52.14)

Every record carries a per-key Lamport-style version counter `_v`.
Local writes auto-increment it; replication-ring receivers run a
three-way compare:

| inbound `_v` vs local `_v` | etag match | outcome | event |
|---|---|---|---|
| `> local`                  | n/a        | adopt peer's write | `peer-update` |
| `< local`                  | n/a        | ignore (peer is stale) | `stale-peer` |
| `== local`                 | yes        | idempotent — no-op | — |
| `== local`                 | no         | ignore (keep local) | `concurrent-write` |
| no `_v` on inbound         | n/a        | last-write-wins fallback (legacy peers) | — |

The `'stale-peer'` event carries `{localBytes, localEtag, localV}`
so the app can publish the fresher local copy back via
`notify-envelope.publish` — one round-trip is enough to converge.

```js
pod.on('stale-peer', async ({ uri, fromActor, localBytes, localEtag, localV }) => {
  // Reply with the newer local copy.
  await notifyEnvelope.publish({
    type: 'task',
    ref: uri,
    payload: localBytes,
    etag: localEtag,
    _v: localV,
    recipients: [fromActor],
  });
});
```

### Cache-vs-pod freshness (Phase 52.14)

In cache mode, `read(uri, {freshness: 'fresh'})` runs a
conditional-GET against the real pod via your `podFetcher`. The
fetcher receives a second arg `{ifNoneMatch: <localEtag>}`; return
`{notModified: true}` to keep the cached copy, or
`{bytes, etag}` to refresh. The default `'cached'` returns the
local copy as-is.

### Subscribe semantics

- Fires only on **future** writes (no replay of existing state).
- Prefix-matched: `subscribe('pseudo-pod://x/tasks/', cb)` fires for
  every write whose key starts with that prefix.
- Subscriber errors are swallowed (a bad callback can't break
  siblings or block the writer).

---

## Replication-ring envelope shape

When a `replication-ring` pseudo-pod writes, it publishes:

```js
transport.publishEnvelope({
  kind:       'pseudo-pod.write',
  ref:        uri,
  etag,
  _v,                                 // Phase 52.14 — Lamport counter at top level
  fromActor:  '<agent-uri>',
  recipients: getPeers(),
  payload:    { uri, bytes, etag, _v },
});
```

V0 owns the `pseudo-pod.write` kind directly. Phase 52.4
(`@canopy/notify-envelope`) will wrap this in a richer envelope
type with kind-aware routing.

Fan-out is **best-effort**: a transport error or empty peer set
doesn't fail the write. The local store always reflects the write
immediately; replication is the consumer's concern (V1 adds the
dirty-queue + retry).

---

## StorageBackend interface

`PseudoPod` delegates all persistence to a `StorageBackend`. V0
ships `MemoryBackend` (in-process Map). The RN-side adapter
(AsyncStorage / SQLite) is parallel work in
`@canopy/react-native` Phase 51.1.

```text
get(key)                       → { bytes, etag?, _v? } | null
put(key, bytes, etag?, _v?)    → { etag, _v }
delete(key)                    → void
list(prefix)                   → string[]
subscribe(prefix, cb)          → unsubscribe
listDirty()                    → string[]            (V1 cache mode)
subscribeDirty(cb)             → unsubscribe         (V1 cache mode)
```

The optional `_v` arg on `put` pins the version (the "accept
peer's write" path); otherwise it auto-increments by 1 (new keys
start at 1).

The dirty-set surface exists on the V0 interface so V1's
pod-upload retry queue can layer in without changing the API
shape. `MemoryBackend` exposes `_markDirty / _markClean` for tests
+ V1 wiring.

---

## What V0 deliberately does not do

- ~~**CAS / conflict resolution.** `groupMirror`'s last-write-wins
  semantics carry through V0 untouched. Pinning happens in P3.~~
  **Resolved 2026-05-14 via Phase 52.14** — see "Conflict
  resolution — Lamport `_v`" above.
- **Cache mode + pod attachment.** Real pods enter the picture in
  V1 (Phase 52.8) along with the reachability gate +
  pending-upload queue.
- **Authentication on peer fetch.** Currently relies on the
  transport's security layer; cap-token shape for third-party
  fetches is open (functional design §4.1.6, P1 pin).
- **Backend persistence.** `MemoryBackend` is process-local. The
  RN adapter ships persistence; a Node SQLite adapter can layer
  later if needed.

See `Project Files/Substrates/substrates-v2-functional-design-2026-05-11.md`
§4.1.6 for the full open-question list.

---

## Files

```
packages/pseudo-pod/
├── index.js
├── src/
│   ├── StorageBackend.js   — typedef-only interface
│   ├── MemoryBackend.js    — in-memory implementation
│   └── PseudoPod.js        — createPseudoPod()
└── test/
    ├── MemoryBackend.test.js
    ├── PseudoPod.standalone.test.js
    └── PseudoPod.replicationRing.test.js
```

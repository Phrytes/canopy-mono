# @onderling/notify-envelope

Mediates **persistent-content writes** for the Decentralised-Web-Agent
(DWA) stack. Apps call `notifyEnvelope.publish({type, ref, payload, …})`
and the substrate decides per-write whether to send a small
envelope-only message or a full-payload eager fan-out — guided by the
ref scheme + the pod-reachability cache.

Also owns the **pending-pod-upload queue** that powers the graceful-
degradation gate: a pod-having writer that's offline still emits to
the circle via replication-ring, and queues the resource for upload on
reconnect.

> Standardisation Phase **52.4** — see
> `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`
> and the functional design §4.4.

---

## What it does

```js
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createPodRouting }                     from '@onderling/pod-routing';
import { createNotifyEnvelope }                 from '@onderling/notify-envelope';

const pseudoPod  = createPseudoPod({ /* … */ });
const podRouting = createPodRouting({ pseudoPod, deviceId: 'laptop-anne', anchorPodUri: 'https://anne.pod' });
const ne = createNotifyEnvelope({
  transport: agent.transport,
  pseudoPod,
  podRouting,
  uploadFn:  async (entry) => podClient.put(entry.uri, entry.payload, entry.etag),
});

ne.start();   // hook the transport receiver

await ne.publish({
  type:       'task',
  ref:        'https://anne.pod/sharing/tasks/abc.ttl',
  etag:       '"v1"',
  payload:    { text: 'paint the fence' },
  recipients: ['agent://bob', 'agent://carol'],
  fromActor:  'agent://anne',
  circleId:     'buurt-abc',
});

ne.subscribe({
  kind: 'task',
  callback: async (env) => {
    // For envelope-only: fetch the resource via pod-client.
    // For full-payload: it's already in your pseudo-pod
    //   (writeFromPeer ran before this callback).
    const item = await pseudoPod.read(env.ref);
    app.render(item);
  },
});
```

---

## Per-write mode picker

Two wire formats; the picker chooses on every `publish` call:

| Condition                                | Wire shape       | Queue?       |
| ---------------------------------------- | ---------------- | ------------ |
| `ref` starts with `pseudo-pod://`         | **full-payload** | no           |
| `https://` ref + pod reachable            | **envelope-only**| no           |
| `https://` ref + pod unreachable          | **full-payload** | yes (drain on reconnect) |

The picker is intentionally scheme-driven: a pseudo-pod URI says "no
pod attached for this resource" and skips the reachability check.

### Envelope-only (≈ 150 bytes)

```json
{
  "v": 1,
  "kind": "task",
  "ref": "https://anne.pod/sharing/tasks/abc.ttl",
  "etag": "\"v1\"",
  "fromActor": "agent://anne",
  "timestamp": "2026-05-11T10:00:00Z"
}
```

### Full-payload eager fan-out

```json
{
  "v": 1,
  "kind": "task",
  "ref": "pseudo-pod://anne-device/tasks/abc",
  "etag": "<content-hash>",
  "_v": 3,
  "fromActor": "pseudo-pod://anne-device/agent",
  "payload": { "text": "paint the fence", ... },
  "timestamp": "2026-05-11T10:00:00Z"
}
```

`_v` (Phase 52.14) is the sender's Lamport-style per-key version
counter. Forward-additive: legacy receivers that don't know about
`_v` simply ignore it and fall back to last-write-wins.

---

## Receiver-side behaviour

When the substrate is `start()`ed, it subscribes to
`transport.subscribeEnvelopes` and:

1. **Full-payload envelopes** — calls
   `pseudoPod.writeFromPeer(ref, payload, etag, _v, {fromActor})`
   to stash the resource locally **before** firing any subscriber.
   By the time the callback runs, `pseudoPod.read(env.ref)`
   returns the resource (assuming the inbound write wasn't
   rejected as stale by the 3-way version compare — see
   `@onderling/pseudo-pod` README §"Conflict resolution").
2. **Envelope-only envelopes** — no local-store side-effect;
   subscribers handle the ref themselves (typically lazy-fetch via
   `pod-client`).
3. Subscribers are dispatched both by per-`kind` registration and the
   `'*'` wildcard. Callback errors are swallowed so siblings keep firing.

---

## Pending-pod-upload queue

Locked 2026-05-11. The queue solves the "writer momentarily offline"
case for pod-having circles. Per-write flow when reachability says
*unreachable*:

1. `pseudoPod.write(...)` stores locally (the V0 substrate doesn't
   wire write-through cache yet — that's Phase 52.8). The caller
   does that step.
2. `publish` fires the full-payload envelope so peers stay current.
3. The resource also lands in the queue at
   `__pending-pod-uploads__/<id>` on `pseudoPod.backend`.
4. On reconnect, the caller (or wired connectivity event) calls
   `markPodReachable()` + `drainQueue()`. Each pending entry:
   - is uploaded via the caller-supplied `uploadFn`;
   - triggers a fresh **envelope-only** message so recipients
     promote their ring-cached copy to "pod-canonical";
   - is deleted from the queue.

Persistence: the queue is keyed under `__pending-pod-uploads__/` on
the pseudo-pod's backend (bypassing `pseudoPod.write` so the queue
itself doesn't fan out to peers in replication-ring mode). Survives
process restart as long as the backend does.

Drain stops on the first upload failure, preserving order — the next
reconnect retries the same entry.

---

## API

```text
createNotifyEnvelope({ transport, pseudoPod, podRouting, uploadFn?, queueBackend?, logger? })

ne.publish({ type, ref, payload?, etag?, _v?, recipients, fromActor?, circleId? })
  → { mode: 'envelope-only' | 'full-payload', queued: boolean, decision }
  // _v (Phase 52.14): Lamport version forwarded on full-payload envelopes.

ne.subscribe({ kind, callback })
  → unsubscribe fn        // kind: item-types name, or '*' for all

ne.start()   // hook transport.subscribeEnvelopes
ne.stop()    // unhook
ne.running   // boolean

await ne.drainQueue()    → { drained, remaining, error? }
await ne.listPending()   → QueueEntry[]
await ne.pendingCount()  → number
```

Lower-level exports (`pickMode`, `createPendingQueue`, `QUEUE_PREFIX`)
ship for advanced use cases and integration tests.

---

## What V0 deliberately does not do

- **Run the pod upload itself.** `uploadFn` is caller-supplied —
  apps wire `pod-client` here once Phase 52.6 lands.
- **Auto-detect reachability.** The substrate trusts whatever
  `podRouting.isPodReachable` returns. Connectivity-event wiring is
  the host application's responsibility (transport-level hooks,
  network change observers, etc.).
- **Handle ephemeral content.** Chat messages, presence, audio/video,
  skill-match races stay on `notifier` directly — see §4.4.5.
- **Per-actor sequence counters.** Today's relay is best-effort;
  reorder is possible. Open question per functional design §4.4.6.
- **Validate against item-types.** Type validation is the caller's
  job (or wire `@onderling/item-types` at the app layer). Substrate
  doesn't gatekeep.
- **Upload-on-behalf.** V2 work, deferred. Other members uploading
  the writer's content to the writer's own pod is a separate design
  with four open questions (authority, conflict, ACP, product fit).
  See plan §II.2 and functional design §4.4.6.

---

## Files

```
packages/notify-envelope/
├── index.js
├── src/
│   ├── NotifyEnvelope.js   — createNotifyEnvelope()
│   ├── picker.js           — per-write mode selection
│   └── pendingQueue.js     — pending-pod-upload queue
└── test/                    — 47 tests
```

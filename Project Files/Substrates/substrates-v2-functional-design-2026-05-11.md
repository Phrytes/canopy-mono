# Substrates V2 — Functional design (2026-05-11)

> What the substrate layer in `packages/` does for apps,
> post-standardisation. Describes the state after the Hub-free
> interim path ships (P0–P3 + non-Hub portion of P5 of the
> [standardisation plan](../standardisation-plan-restructured-2026-05-10.md)).
> Core companion: [`../SDK/core-v2-functional-design-2026-05-11.md`](../SDK/core-v2-functional-design-2026-05-11.md).
>
> Covers all new substrates (`pseudo-pod`, `pod-onboarding`,
> `pod-routing`, `notify-envelope`, `item-types`,
> `agent-registry`) plus targeted extensions to existing
> substrates (`item-store`, `pod-client`, `sync-engine`,
> `sync-engine-rn`, `notifier`, `identity-resolver`,
> `local-store`).

## 1. Pitch

The substrate layer is **what apps stand on**. Apps compose
substrates from `packages/`; substrates own data structures,
communication protocols, and the storage/transport plumbing.
V2 reshapes the substrate layer around three commitments:

- **Pseudo-pod everywhere as the unified read path.**
  Apps don't branch on "are we pod-attached" — every read
  goes through the pseudo-pod, which transparently caches a
  real pod when attached, stands alone when not, or
  replicates with peers in a no-pod crew.
- **Persistent writes adapt to the crew's storage policy.**
  Apps call `substrate.writeItem(...)` without knowing the
  policy; `notify-envelope` + `pod-routing` pick the wire
  shape (pod-primary + envelope or pseudo-pod-replicated
  eager fan-out) per the crew's §II.2 choice.
- **Config-on-pod.** Storage-mapping, agent-registry, audit
  log — all canonical state lives as **pod resources** (or
  pseudo-pod resources for no-pod users). Substrates read +
  write these resources through the pseudo-pod like any
  other item; the WebID profile carries small pointers.

The substrate layer is **Hub-independent** (P0–P3 + non-Hub-
P5 deliverables). When the Hub ships (P4+), it consumes these
substrates rather than rebuilding them.

## 2. Scope locks

These are decided 2026-05-11 and shape the rest of the doc:

1. **Substrate-first rule applies.** Data structures + comm
   protocols are always substrate. Helpers lift on first
   consumer if their API is stable + the jsdoc + tests can
   be written without referencing the caller. App-local
   until evidence otherwise.
2. **Substrate names are role-with-suggested-name.** Final
   names follow [`../Substrates/policies.md`](policies.md) at
   lock time. Names in this doc are suggestions.
3. **Backwards compatibility within the interim path.**
   Where the V1 substrates already exist (`item-store`,
   `pod-client`, `sync-engine`, `notifier`,
   `identity-resolver`, `local-store`, `oidc-session-rn`,
   `pod-search`), V2 extends rather than replaces. Breaking
   changes are deferred to P5+ with shims.
4. **No-pod operation is preserved.** Where the substrate
   layer offers a capability today without requiring pods,
   V2 continues to offer that mode. See
   [`../standardisation-transition-2026-05-11.md`](../standardisation-transition-2026-05-11.md)
   §V.6 for the audit.
5. **The pseudo-pod is the unified storage substrate.**
   Three new substrates (`pseudo-pod`, `pod-onboarding`,
   `pod-routing`) absorb the work that `local-store`,
   `sync-engine`, and Stoop's `groupMirror` did today. Where
   absorption applies, the older substrate retires by P3 with
   a dual-run transition.
6. **No iOS-specific substrate code.** Per the main project
   lock.

## 3. Substrate inventory

| Substrate | Status | Phase | Hub-coupled? | Section |
|---|---|---|---|---|
| `pseudo-pod` | new | P1 V0 / P3 V1 | no | §4.1 |
| `pod-onboarding` | new | P1 | no | §4.2 |
| `pod-routing` | new | P1 | no | §4.3 |
| `notify-envelope` | new | P1 | no | §4.4 |
| `item-types` | new | P2 | no | §4.5 |
| `agent-registry` | new | P5 | no (Hub consumes) | §4.6 |
| `interface-registry` | new (direction) | P6 | yes | §6.1 |
| `protocol` | new (direction) | P6 | yes | §6.2 |
| `pod-search` | exists; lifted earlier | P3 | partly | §6.3 |
| `item-store` | extended | P1 / P5 | no | §5.1 |
| `pod-client` | extended | P1 | no | §5.2 |
| `sync-engine` / `sync-engine-rn` | absorbed by pseudo-pod | P3 | no | §5.3 |
| `notifier` | extended | P3 | no | §5.4 |
| `identity-resolver` | extended | P5 | no | §5.5 |
| `local-store` | absorbed by pseudo-pod | P1 V0 + P3 V1 | no | §5.6 |
| `oidc-session-rn` | exists; standardised on | P1 | no | §5.7 |
| `react-native` | extended | P1 (pseudo-pod RN adapter) / P4 (hub-discovery + hub-binding) | partly | §5.8 |
| `relay` | stays unchanged | — | no | §5.9 |
| `online-cadence` | extends in P4 | P4 | partly | §5.9 |
| `skill-match` | stays unchanged | — | no | §5.9 |
| `chat-p2p` | stays unchanged | — | no | §5.9 |
| `chat-agent` | stays unchanged | — | no | §5.9 |
| `agent-ui` | stays unchanged | — | no | §5.9 |
| `llm-client` | stays unchanged | — | no | §5.9 |
| `integration-tests` | gains pod-having + no-pod test matrices in P1; Hub track tests in P4 | P1 / P4 | partly | §5.9 |

---

## 3a. User journeys (traced through the substrate layer)

End-user actions traced through the substrate layer. Each
journey crosses several substrates; the trace shows how a
single user action flows through the per-substrate machinery
in §4–§5.

### Journey 1 — Writing a task in a centralised pod-having crew

Anne adds a task in her household crew (centralised policy,
group pod is the household's shared Solid pod).

1. **App layer:** Tasks calls
   `substrate.writeItem({crewId: 'household', type: 'task',
   text: 'paint the fence', dependencies: [parentRef]})`.
2. **`item-types` (§4.5):** validates the shape; rejects on
   schema mismatch.
3. **`pod-routing` (§4.3):** consults
   `crewPolicy('household') = {policy: 'centralised',
   groupPodUri: '<household-pod>'}`. Resolves
   `group/household/tasks/<id>` → `<household-pod>/sharing/
   tasks/<id>.ttl`.
4. **`pseudo-pod` (§4.1):** writes the resource locally in
   cache mode + queues a write-through. Background:
   `pod-client` PUT to the real pod via OIDC; etag returned.
5. **`notify-envelope` (§4.4):** picks `'pod-primary'` mode
   from the crew's policy; emits the small envelope
   `{kind: 'task', ref, etag, fromActor, timestamp}` via
   the relay to crew recipients.
6. **Each recipient's agent:** `notify-envelope.recv` fires;
   app subscribes to `kind: 'task'`; callback fetches
   `pod-client.fetch(ref)` (cache miss → pod GET); item
   appears in the recipient's workspace.

### Journey 2 — Writing a task in a no-pod crew

Anne adds the same task in a no-pod crew (e.g., a try-
before-pod weekend project).

1. Same app call.
2. `item-types`: same validation.
3. `pod-routing`: `crewPolicy('weekend-project') = {policy:
   'no-pod'}`. Resolves `group/weekend-project/tasks/<id>`
   → `pseudo-pod://<anne-device>/group/weekend-project/
   tasks/<id>`.
4. `pseudo-pod`: writes the resource locally in
   replication-ring mode; the local store is the canonical
   one for this resource.
5. `notify-envelope`: picks `'pseudo-pod-replicated'` mode;
   emits the full payload (resource bytes + envelope) via
   the relay to crew recipients.
6. Each recipient's agent: `notify-envelope.recv` fires
   with the full payload; `pseudo-pod.writeFromPeer` writes
   the resource into the recipient's local pseudo-pod
   replication-ring store; app handlers fire.

App code is identical to Journey 1; substrate adapts the
wire shape.

### Journey 3 — Crew upgrades from no-pod to centralised

Anne's household crew has been no-pod for two weeks; she
decides to move to a Solid pod for durability + multi-device
coherence.

1. **App layer:** Tasks (or the Hub editor UI) calls
   `podOnboarding.provisionDefault` (if Anne doesn't yet
   have a pod) and then `pod-routing.updateMapping` to
   change the crew's policy to `'centralised'` with the new
   pod URI.
2. **`pod-onboarding` (§4.2):** runs OIDC against the
   provider, provisions sub-containers, writes WebID
   pointers, creates the empty `storage-mapping` +
   `agent-registry` resources.
3. **`pod-routing`:** writes the updated mapping resource
   (etag-based write); the new policy is now visible to
   every agent that reloads.
4. **Lazy migration:** the substrate walks every existing
   `pseudo-pod://...` URI for this crew; for each, queues a
   write-through to the new `<pod>/sharing/...` URI;
   maintains a per-user redirect map so existing refs in
   item bodies (`embeds[]`) resolve through the rewrite.
5. **Other members:** on their next pod-routing reload, see
   the new policy. Their pseudo-pod transitions
   replication-ring entries to cache-mode entries for this
   crew's resources. They don't need to provision pods of
   their own — Anne's pod is the central store.
6. **Recipient reads:** pseudo-pod cache walks fetch from
   Anne's pod (cache miss → pod GET).

### Journey 4 — User restores from mnemonic on a new device

1. **App layer:** new device, app calls
   `podOnboarding.restoreFromMnemonic({mnemonic})`.
2. **`pod-onboarding`:** reconstitutes the keypair from
   seed; walks the WebID profile to fetch pointers
   (`storage-mapping-uri`, `agent-registry-uri`).
3. **`pseudo-pod`:** brought up in cache-for-real-pod mode;
   immediately fetches storage-mapping + agent-registry
   resources via `pod-client` (warming the cache).
4. **Core:** registers the new device's agent in
   agent-registry (separate entry from the lost device's;
   user revokes the old entry separately).
5. **App layer:** sees the same data as on the old device;
   re-renders the workspace.

For no-pod users, the same flow runs against the local
pseudo-pod — but vault recovery depends on at least one
peer device being reachable (peer fetch over BLE / mDNS /
relay) to hand over the encrypted vault blob.

### Journey 5 — Third-party tool edits storage-mapping

Anne uses a generic Solid pod editor to change her
`<pod>/private/storage-mapping` resource directly (e.g., to
remap `private/notes/...` to a custom container).

1. **Solid pod editor:** PUTs the updated mapping resource
   with an If-Match header.
2. **Anne's running agents:** on next pod-routing reload
   (heartbeat or explicit `reload()`), see the updated
   config; cached URIs invalidate.
3. **Effect on subsequent calls:** any
   `podRouting.resolve('private/notes/...', ...)` now
   returns the new URI; pseudo-pod transparently fetches
   from there.

No app code change; the config-on-pod design means any
pod-aware tool can edit the substrate's config.

### Journey 6 — Envelope arrives at an offline-then-online recipient

1. Anne writes a task (Journey 1 pod-primary mode).
2. Bob's device is offline; the relay queues the envelope
   (or NKN's persistent inbox holds it).
3. Bob comes online; relay drains the queue.
4. `notify-envelope.recv` fires on Bob's agent.
5. `pseudo-pod` doesn't have the resource cached; consults
   `pod-client` to fetch from `<household-pod>/sharing/
   tasks/...` via Bob's OIDC. (Bob is a household member,
   so ACPs grant read.)
6. Resource arrives; cached; app callback fires.

### Journey 7 — Pod-routing config conflict resolves via etag

Anne edits her storage-mapping on her phone the same instant
her desktop writes a change. Both reads picked the same etag
E0.

1. Phone writes first: PUT with If-Match: E0 → success →
   etag E1.
2. Desktop writes second: PUT with If-Match: E0 → 412
   Precondition Failed.
3. **`pod-routing` substrate** (on desktop) catches the 412
   → retries with bounded backoff: re-reads (now etag E1) →
   merges desktop's change on top of phone's → PUT with
   If-Match: E1 → success → etag E2.
4. On persistent merge conflict (e.g., both writes change
   the same storage function to different URIs), substrate
   surfaces a "config changed on another device, reload?"
   UI affordance via a callback.

This is also how multi-app concurrency works in the Hub-
free interim (three apps writing to agent-registry on the
same device); each app's `agent-registry` substrate
instance handles its own retries.

### Journey 8 — User embeds a task in a Stoop supply offer

1. Anne is in Stoop on mobile, posting "ladder lenen."
2. She taps "embed item" → search UI surfaces.
3. **`pod-search`** (lifted into pseudo-pod's read path
   during P3): searches across Anne's accessible pods +
   pseudo-pod content → returns "Move the ladder" task
   from her Tasks crew.
4. Stoop's `postRequest` writes the offer with `embeds:
   [{type: 'task', ref: '<task uri>'}]` in the body.
5. Recipients receive the offer (Journey 1 or 2 depending
   on the buurt's policy).
6. On a recipient's prikbord, the embed renderer (P6
   interface-registry; pre-P6 a fallback chip) renders the
   task title + status pill inline on the card.
7. Tap-through: pre-P6 a deep-link to Tasks; post-P6 a
   Hub-mediated route through the interface registry.

---

# Part I — New substrates

## §4.1 — `pseudo-pod`

### 4.1.1 Pitch

A Solid-shaped local store hosted by the agent. Single read
path everywhere. Three operating modes, same API in all
three. Replaces the V1 chain of `pod-client →
CachingDataSource → Solid pod` with one substrate.

### 4.1.2 Three modes

- **Cache-for-real-pod.** Write-through queue against the
  user's pod when attached; transparent caching of reads.
  This is the pod-having user's default — when the pod is
  reachable.
- **Standalone.** No upstream pod; pseudo-pod is the
  canonical store for one user on one device.
  Try-before-pod; single-user testing.
- **Replication-ring-with-peer-pseudo-pods.** For no-pod
  crews (§II.2 policy 4 of the plan) **and** as the
  graceful-degradation fallback for pod-having crews when
  the pod is unreachable. Pseudo-pod is the canonical store
  for content authored on this device, and the cache for
  content authored on peer devices. Inbound full-payload
  eager fan-out from `notify-envelope` writes resources into
  the local pseudo-pod; outbound writes fan-out.

Mode is per-resource: a user with both a personal pod and
membership in a no-pod crew runs `cache` for their personal
content + `replication-ring` for the no-pod crew's content,
on the same pseudo-pod instance.

### 4.1.2a The replication ring is the universal baseline (locked 2026-05-11)

The three modes above look like alternatives, but they
share **one runtime story**: every pseudo-pod instance is
fundamentally a **replication-ring participant**. The pod
(when reachable) is just a *promotable ring member* with
extra durability + ACPs. This unifies what used to look
like a binary {pod, no-pod} choice into a single mechanism
with graceful degradation:

- **Pod reachable → write goes to local pseudo-pod, queues
  for pod write-through, AND emits an envelope** (no full
  payload — recipients fetch the now-pod-canonical ref).
- **Pod unreachable → write goes to local pseudo-pod, stays
  in the pending-pod-upload queue, AND emits a full-payload
  ring fan-out** so the crew keeps functioning. When the
  pod is reachable again, the queue drains + a fresh
  envelope re-announces the now-pod-canonical version.
- **Recipients don't care which mode the sender was in** —
  they receive either an envelope (fetch lazily) or a
  full-payload (write into local ring store). The downstream
  effect is identical.

This is why the `Agent.pseudoPod` slot can hold a single
substrate instance regardless of crew policy — the substrate
is doing the same job every time, just with different
participation from the pod node.

### 4.1.3 Public API

```
pseudoPod.read(uri)            // returns resource bytes + etag
pseudoPod.write(uri, bytes)    // queues write per the URI's mode
pseudoPod.list(containerUri)   // lists immediate children
pseudoPod.subscribe(uri, cb)   // local watcher
pseudoPod.flush(uri)           // force write-through (cache mode)
pseudoPod.setHost('hub', binder) // P4 — Hub-delegate
```

URI scheme:

- `https://...` — resolves to the real pod (cache mode).
- `pseudo-pod://<deviceId>/...` — resolves to a local
  pseudo-pod resource (standalone) or a peer pseudo-pod
  (replication-ring).

The substrate sits below `pod-client`; `pod-client` routes
URIs to the pseudo-pod by scheme.

### 4.1.4 Wire / on-disk shape

- **In standalone / cache mode:** pseudo-pod stores resources
  in `local-store` (in-memory + persistent SQLite-ish
  layer). For cache mode, also tracks `(uri, etag, dirty)`
  for the write-through queue.
- **In replication-ring mode:** same local store, plus an
  outbound queue for fan-out via `notify-envelope`. Inbound
  resources arrive via the receiver-side callback (see
  `notify-envelope` §4.4).
- **Peer fetch protocol:** a "fetch resource" skill that
  serves resources from the local pseudo-pod to peers (used
  when a peer's envelope ref resolves to
  `pseudo-pod://<deviceId>/...`). Skill defined in core
  (`core.skills.fetchResource`); pseudo-pod consumes it.

### 4.1.5 Consumer patterns

App writes a task in a centralised pod-having crew:

```
app calls substrate.writeItem({type: 'task', ...})
  → notify-envelope picks 'pod-primary' (from crew policy)
  → pod-routing resolves URI to `<pod>/sharing/tasks/abc...`
  → pseudoPod.write(uri, bytes)
      → cache write + queue write-through
      → background: pod-client PUT via OIDC
  → notify-envelope.emit({kind: 'task', ref: uri, etag, ...})
      → transport fan-out (envelope only)
```

App writes a task in a no-pod crew:

```
app calls substrate.writeItem({type: 'task', ...})
  → notify-envelope picks 'pseudo-pod-replicated' (from crew policy)
  → pod-routing resolves URI to `pseudo-pod://<deviceId>/tasks/abc...`
  → pseudoPod.write(uri, bytes)
      → local store write
      → outbound queue: full payload to crew members
  → notify-envelope.emit({kind: 'task', ref: uri, payload: bytes, ...})
      → transport fan-out (eager full payload)
```

Recipient (no-pod crew member) receives:

```
notify-envelope.recv({kind, ref, payload, etag, ...})
  → pseudoPod.writeFromPeer(ref, payload, etag)
      → local store write
  → app event handlers fire on subscribed URIs
```

### 4.1.6 Open questions

- Peer fetch authentication when a third-party app
  requests a resource via the fetch skill. Cap-token shape;
  pin during P1.
- Conflict resolution in replication-ring mode when two
  members write to the "same" logical resource. Today's
  `groupMirror` uses last-write-wins; pseudo-pod
  replication-ring inherits that. Pin during P3.
- **Pending-pod-upload queue durability (locked 2026-05-11).**
  When a pod-having writer is offline and the substrate
  falls back to ring-mode for that write, the resource sits
  in a pending-upload queue until the pod is reachable. Open:
  the queue's own persistence (must survive process restart;
  uses the local pseudo-pod's storage backing). Pin during
  P3.
- **Reachability-check cadence.** The substrate has to decide
  "is my pod reachable right now?" cheaply enough to gate
  every write. Default proposed: track last successful pod
  request + transport-level connectivity events; cache "pod
  reachable" for N seconds. Pin during P1.
- **Open (V2, deferred) — upload-on-behalf.** Other members
  uploading an offline writer's content to the writer's pod.
  Authority model, conflict resolution, ACP semantics, and
  product fit are all open. See plan §II.2 + §II.6 for the
  V2 design block.

### 4.1.7 Phase

- **P1 V0:** standalone + replication-ring modes; in-memory
  store via `local-store`; peer fetch skill.
- **P3 V1:** cache-for-real-pod mode; write-through queue
  against `pod-client`; absorbs `sync-engine`'s role.

---

## §4.2 — `pod-onboarding`

### 4.2.1 Pitch

One-tap "create my pod" provisioning. Provisions the default
one-pod layout (`/private/`, `/sharing/`, `/sharing/public/`
sub-containers), runs the OIDC flow, writes the pointer
predicates on the user's WebID profile, and binds the agent
to the pod.

Also handles the **two-pod upgrade preset** (one-click split
of `private/*` and `sharing/*` to separate pods), the
**custom mapping** editor (advanced; full editor lives in the
Hub-web-console), and **mnemonic-restore** (walk the WebID
profile to re-attach).

### 4.2.2 Public API

```
podOnboarding.provisionDefault({
  oidcProvider,
  mnemonic | newIdentity,
}) → { podUri, webidUri, pointers }

podOnboarding.upgradeToTwoPods({
  privatePodOidcProvider,
  sharingPodOidcProvider,    // may be same provider
}) → { privatePodUri, sharingPodUri, migrationPlan }

podOnboarding.restoreFromMnemonic({
  mnemonic,
}) → { agent, pointers, storageMapping }

podOnboarding.signOut({
  keepLocalData: bool,
}) → void
```

### 4.2.3 Wire / on-pod shape

After `provisionDefault`:

- `<pod>/private/` exists with ACPs locked to the agent.
- `<pod>/sharing/` exists with default-deny ACPs.
- `<pod>/sharing/public/` exists with world-read,
  owner-write ACPs.
- `<pod>/private/storage-mapping` exists with the default
  policy (see `pod-routing` §4.3).
- `<pod>/private/agent-registry` exists with this agent's
  entry (see `agent-registry` §4.6).
- The user's WebID profile gains predicates:
  - `solid:storage <pod>` (already standard).
  - `storage-mapping-uri <pod>/private/storage-mapping`.
  - `agent-registry-uri <pod>/private/agent-registry`.
  - `audit-log-uri <pod>/private/audit-log` (deferred).

### 4.2.4 Consumer patterns

Pattern 1: first-run provisioning (Hub-web-console or
in-app):

```
const { podUri, pointers } = await podOnboarding.provisionDefault({
  oidcProvider: 'https://inrupt.net',
  mnemonic: '<bip39 12 words>',
});
// User can immediately use the agent; pseudo-pod is in cache mode.
```

Pattern 2: in-app two-pod upgrade:

```
const { privatePodUri, sharingPodUri, migrationPlan } =
  await podOnboarding.upgradeToTwoPods({
    sharingPodOidcProvider: 'https://other-provider.com',
  });
// migrationPlan describes which resources will move; substrate
// kicks off lazy migration with ref rewriting in the background.
```

### 4.2.5 Open questions

- Default `/sharing/public/` ACPs — broadcast-only-the-
  profile-card, or open the container? Pin during P1.
- Two-pod migration cancellation mid-flight. Pin during P1.
- Provider list curation. Pin during P1; project ships a
  starter list (Inrupt, self-hosted CSS).

### 4.2.6 Phase

P1. Both Hub-Android (P4) and Hub-web-console (P5) consume
it; in-app slice (each app's pod-settings screen) also
consumes it.

---

## §4.3 — `pod-routing`

### 4.3.1 Pitch

Storage-function → URI mapping. The substrate exposes a list
of named storage functions; each maps to a URI per the
user's policy. Default policy ships sensible defaults; user
overrides via the storage-mapping editor.

Storage functions:

- `private/identity-vault`
- `private/state/<app>`
- `private/drafts/<app>`
- `sharing/profile-public`
- `sharing/<resource>`
- `group/<crewId>/<container>`
- `personal-in-group/<crewId>`

### 4.3.2 Public API

```
podRouting.resolve(storageFn, vars?) → uri
podRouting.crewPolicy(crewId) → {
  policy: 'centralised' | 'decentralised' | 'hybrid' | 'no-pod',
  groupPodUri?: uri,
}
podRouting.updateMapping({fn, uri}) → ack
podRouting.reload() → fresh config from pseudo-pod
```

### 4.3.3 Wire / on-pod shape

Storage-mapping config resource at
`<anchor-pod>/private/storage-mapping`:

```json
{
  "version": 2,
  "default-policy": "one-pod",
  "mappings": {
    "private/identity-vault": "<anchor-pod>/private/identity-vault",
    "private/state/tasks": "<anchor-pod>/private/state/tasks/",
    "private/drafts/folio": "<anchor-pod>/private/drafts/folio/",
    "sharing/profile-public": "<anchor-pod>/sharing/public/profile-card",
    "sharing/*": "<anchor-pod>/sharing/",
    "group/buurt-abc/*": "<anne-pod>/sharing/stoop/abc/"
  },
  "crew-policies": {
    "buurt-abc": {"policy": "centralised", "groupPodUri": "<anne-pod>"},
    "household-xyz": {"policy": "no-pod"},
    "project-def": {"policy": "decentralised"}
  },
  "updated-at": "2026-05-11T10:00:00Z"
}
```

For no-pod users, the config lives in the local pseudo-pod
and replicates across the user's own devices via the
replication-ring.

### 4.3.4 Default policy

When `mappings.<fn>` is absent, `pod-routing` applies the
default:

- `private/*` → `<anchor-pod>/private/`.
- `sharing/*` → `<anchor-pod>/sharing/`.
- `sharing/profile-public` → `<anchor-pod>/sharing/public/profile-card`.
- `group/<crewId>/*` → resolves to the crew's
  `groupPodUri/<crewId>/...` for pod-having policies, or
  `pseudo-pod://<deviceId>/group/<crewId>/...` for no-pod
  crews.

### 4.3.5 Consumer patterns

```
const taskUri = podRouting.resolve('sharing/tasks/abc', {crewId: 'buurt-abc'});
// → 'https://anne.pod/sharing/stoop/abc/tasks/abc.ttl'
// (because buurt-abc's policy is centralised on Anne's pod)

await pseudoPod.write(taskUri, bytes);
```

### 4.3.6 Open questions

- Migration semantics when a user upgrades from one-pod to
  two-pod, or adds a new pod. Per-user redirect map shape;
  pin during P1.
	> you can just map a new place for storage/retrieval. The user must take care of proper migration themselves 
- Substrate-vs-app authority on storage-function names. The
  substrate ships a canonical list; can apps register new
  ones? Default proposed: yes, with a registry that the
  substrate ships defaults for and apps extend. Pin during
  P1.
	> yeah why not

### 4.3.7 Phase

P1. The editor UI lives in the Hub-web-console (P5 Hub
portion) + each app's pod-settings screen.

---

## §4.4 — `notify-envelope`

### 4.4.1 Pitch

The substrate that mediates **persistent-content writes**.
Picks the wire format **per-write** based on three inputs
(locked 2026-05-11, replacing the earlier static
per-crew-policy model):

1. **Content nature** — persistent (handled here) vs
   ephemeral (handled by `notifier`, see §4.4.5).
2. **Crew preference** — the §II.2 policy on the crew
   (centralised / decentralised / hybrid / no-pod).
3. **Current reachability** — can THIS writer reach the
   pod right now (consulted before every persistent write).

Two wire formats:

- **Envelope-only** for pod-having writes when the writer
  CAN reach the pod: `{kind, ref, etag, timestamp,
  fromActor}` over the relay; recipients fetch by ref.
- **Full-payload eager fan-out** for either (a) no-pod
  crews, or (b) pod-having crews where the writer is
  momentarily offline. The whole resource over the relay
  / BLE / mDNS; recipients write to their pseudo-pod
  replication ring. In case (b), the writer's own
  pending-pod-upload queue holds the resource until the
  pod is reachable; on reconnect, the queue drains AND a
  fresh envelope re-announces the now-pod-canonical
  version.

App code is identical across modes — apps don't know the
crew's policy or the writer's current reachability.

### 4.4.2 Public API

```
notifyEnvelope.publish({
  type,           // item type from item-types taxonomy
  ref,            // resource URI (pod or pseudo-pod)
  payload,        // bytes — used for no-pod mode
  etag,           // pod etag (or pseudo-pod content hash)
  recipients,     // crew member URIs
  fromActor,      // agent URI
})

notifyEnvelope.subscribe({
  kind, callback  // callback fires on inbound envelopes
})
```

The substrate consults `pod-routing.crewPolicy(crewId)` AND
`pod-routing.isPodReachable(uri)` internally to decide the
wire shape per-write.

### 4.4.3 Wire shape

**Envelope-only (pod-having):**

```json
{
  "v": 1,
  "kind": "task",
  "ref": "https://anne.pod/sharing/tasks/abc.ttl",
  "etag": "\"abc123\"",
  "timestamp": "2026-05-11T10:00:00Z",
  "fromActor": "https://anne.pod/profile#me/agent/laptop"
}
```

Typically ~150 bytes; fits well in a single relay packet.

**Full-payload eager fan-out (no-pod):**

```json
{
  "v": 1,
  "kind": "task",
  "ref": "pseudo-pod://anne-device-xyz/tasks/abc",
  "etag": "<content-hash>",
  "payload": "<base64-encoded bytes>",
  "timestamp": "2026-05-11T10:00:00Z",
  "fromActor": "pseudo-pod://anne-device-xyz/agent"
}
```

Size depends on the resource being mirrored.

### 4.4.4 Consumer patterns

App-side write:

```js
await substrate.writeItem({
  crewId: 'buurt-abc',
  type: 'supply-offer',
  body: {text: 'ladder lenen', ...},
});

// Inside the substrate:
// 1. item-types validates the shape.
// 2. pod-routing resolves URI.
// 3. pseudo-pod writes locally.
// 4. notify-envelope publishes with the right wire shape.
// 5. notifier emits via transport.
```

App-side subscribe:

```js
notifyEnvelope.subscribe({
  kind: 'supply-offer',
  callback: (env) => {
    // For envelope-only mode: fetch the resource via pseudo-pod.
    // For full-payload mode: the resource is already in the
    // local pseudo-pod (written by pseudo-pod.writeFromPeer in
    // the envelope handler). Just read it.
    const item = await pseudoPod.read(env.ref);
    app.renderItem(item);
  },
});
```

### 4.4.5 Ephemeral content stays separate

`notify-envelope` is **not** for ephemeral content (chat
messages, presence, audio/video, skill-match races). Those
keep using `notifier` directly for full-payload relay
fan-out, with optional archive-to-pod for durability.

### 4.4.5a Graceful degradation: per-write reachability check

Locked 2026-05-11. The per-write reachability check makes
the four §II.2 crew policies **runtime-soft**: a pod-having
crew never loses offline capability. Concretely, for each
persistent write:

1. App calls `substrate.writeItem({crewId, type, body, ...})`.
2. `pod-routing` resolves the URI (e.g.
   `<group-pod>/sharing/tasks/<id>` for centralised crews).
3. **`pod-routing.isPodReachable(uri)` is consulted.** Cheap
   check: did the last pod request within N seconds succeed,
   AND has there been no transport-level disconnect event
   since? Default N = 30 seconds.
4. **If reachable:** pseudo-pod writes locally (cache-mode);
   queues a write-through to the pod via `pod-client`;
   notify-envelope publishes the small envelope.
5. **If unreachable:** pseudo-pod writes locally (now in
   ring-mode for this resource); the write goes into the
   writer's **pending-pod-upload queue** (persistent — survives
   process restart); notify-envelope publishes a full-payload
   fan-out. When the pod becomes reachable again, the queue
   drains: each pending resource is uploaded to the pod, and
   a fresh envelope is emitted to the crew so receivers can
   update their local entry from "ring-cached" to
   "pod-canonical."

Recipients of a full-payload fan-out (case 5) **don't know
or care** whether the writer was offline by choice (no-pod
crew) or by circumstance (pod-having crew, momentarily
offline). The wire shape and receiver-side behaviour are
identical: write the resource into the local ring, emit a
subscriber callback. The pseudo-pod's replication-ring mode
is the universal baseline.

### 4.4.6 Open questions

- Bandwidth tuning for no-pod crews at scale. Eager fan-out
  is O(N) per write. Pin during P1 with measurements.
- Envelope ordering guarantees. Today's relay is best-effort;
  reorders are possible. Pin during P1 — the substrate may
  need a per-actor sequence counter.
- **Reachability-check cadence** (locked 2026-05-11 as open).
  How exactly does `pod-routing.isPodReachable(uri)` work?
  Default proposed: "last successful pod request within N
  seconds AND no transport disconnect since." Tunable per
  app; pinned during P1 implementation.
- **Pending-pod-upload queue semantics** (locked 2026-05-11
  as open). Where does the queue persist (local pseudo-pod
  store under a reserved namespace)? When does it drain
  (reconnect event + opportunistic retries on next pod
  read)? Pin during P3 alongside pseudo-pod V1's
  write-through-queue.
- **Re-emit on drain** — when a pending resource is uploaded
  to the pod, the substrate emits a fresh envelope with the
  now-pod-canonical ref. Receivers must accept the second
  envelope as a "ring → pod" promotion of the same logical
  resource (not as a new resource). Pin during P3.
- **Open (V2, deferred 2026-05-11) — upload-on-behalf.** V1
  drains the writer's *own* queue to the writer's *own*
  pod on reconnect. V2 considers letting **a different
  member** upload the writer's content on their behalf —
  closing the durability gap when the writer themselves
  stays offline for extended periods. The hard design
  questions (carried from plan §II.2 + §II.6):
    1. **Authority model.** Who has the right to write to
       another member's pod? A "pod-shepherd" role per
       crew? A per-resource grant cap-token?
    2. **Conflict resolution.** Offline + online writes
       arrive in different orders; how reconcile?
    3. **ACP semantics for proxy uploads.** When member B
       uploads member A's content, whose ACPs apply?
    4. **Product fit.** Is upload-on-behalf desirable for
       the project's value system, or is "everyone manages
       their own pod" the durable answer? Likely yes for
       buurt-style crews where some members never get a
       pod. Pin during V2 design with stakeholder input.

### 4.4.7 Phase

P1 ships all three patterns under `notify-envelope` +
`pod-routing`. P3 retires legacy app-specific fan-out paths
(Stoop's `groupMirror`, Tasks's relay-fan-out helpers).

---

## §4.5 — `item-types`

### 4.5.1 Pitch

The cross-app type taxonomy. Defines the canonical item types
that every app speaks: `task`, `note`, `chat-message`,
`supply-offer`, `demand-offer`, `lend-request`, `contact`,
`calendar-event`, `announcement`, `reveal-request`, …. Each
type has a shape (frontmatter / JSON schema) including a
standard `embeds: [{type, ref}, …]` field on every type.

### 4.5.2 Public API

```
itemTypes.validate(item) → ok | errors
itemTypes.schema(typeName) → JSON Schema
itemTypes.list() → all known types
itemTypes.registerType(name, schema) → registry entry  // by an app
```

### 4.5.3 Wire shape

Every item carries:

```json
{
  "v": 1,
  "type": "task",
  "id": "<uri>",
  "createdAt": "<iso>",
  "updatedAt": "<iso>",
  "createdBy": "<agent uri>",
  "embeds": [
    {"type": "note", "ref": "<note uri>"},
    {"type": "supply-offer", "ref": "<offer uri>"}
  ],
  // ... type-specific fields
}
```

Types ship in `packages/item-types/src/types/` as one file
per type. The `embeds` field is a substrate-level guarantee
across every type.

### 4.5.4 Canonical types V2 ships

| Type | Owning app | Shape highlights |
|---|---|---|
| `task` | Tasks | text, status, assignee, parents (refs), DoD, approver |
| `note` | Folio | title, body (markdown), tags, frontmatter |
| `chat-message` | Stoop (+ generic) | author, body, threadId, embeds |
| `supply-offer` | Stoop | author, body, kind, group, expiry, attachments |
| `demand-offer` | Stoop | author, body, kind, group, expiry, attachments |
| `lend-request` | Stoop | author, item, dueDate, claimedBy |
| `contact` | Stoop (+ generic) | webid, displayName, trustLevel, flags |
| `calendar-event` | Tasks | title, start, end, location, organiser |
| `announcement` | Stoop (+ generic) | author, body, audience |
| `reveal-request` | Stoop | requester, target, status |
| `neighbourhood-job` | Stoop | author, body, claim, lifecycle |

P6's `interface-registry` consumes this list to know which
types have registered renderers.

### 4.5.5 Consumer patterns

Pattern 1: app produces an item:

```js
const validated = itemTypes.validate({
  type: 'task',
  text: 'paint the fence',
  dependencies: [parentTaskUri],
});
if (!validated.ok) throw new Error(validated.errors);
await substrate.writeItem(validated.item);
```

Pattern 2: app registers a new type (its own):

```js
itemTypes.registerType('protocol/proof-of-location', {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    type: { const: 'protocol/proof-of-location' },
    location: { ... },
    proofs: { type: 'array' },
  },
});
```

### 4.5.6 Open questions

- Versioning of types across app releases. If Tasks updates
  the `task` schema in V3, do V2 clients break? Default
  proposed: schemas are forward-additive only; V3 fields
  are optional from V2's perspective. Pin during P2.
- Schema-registry hosting. Today's `item-types` ships the
  schemas embedded; a future variant could publish them via
  the user's pod for runtime discovery. Pin post-P6.

### 4.5.7 Phase

P2 ships the substrate + per-app adoption. Tasks types Stoop
types Folio types all in the same P2 cycle.

---

## §4.6 — `agent-registry`

### 4.6.1 Pitch

The user's agents listed in one place. Each device, each bot
is its own agent with its own keypair. The registry maps
`pubKey ↔ webid ↔ agent-URI ↔ role` and carries each agent's
**capability-requirements** (polling cadence, foreground-
service expectations, socket retention) for the Hub's P4
scheduler to aggregate.

### 4.6.2 Public API

```
agentRegistry.register({
  agentId, pubKey, role, name, deviceId, capabilities,
}) → ack

agentRegistry.list() → [agent, ...]
agentRegistry.lookup(agentId | pubKey | webid) → agent | null
agentRegistry.revoke(agentId) → ack
agentRegistry.updateCapabilities(agentId, caps) → ack
```

### 4.6.3 Wire / on-pod shape

The registry is a pod resource at
`<anchor-pod>/private/agent-registry`:

```json
{
  "v": 1,
  "agents": [
    {
      "agentId": "https://anne.pod/profile#me/agent/laptop-xyz",
      "pubKey": "<base64 ed25519>",
      "webid": "https://anne.pod/profile#me",
      "role": "human",
      "name": "Anne's laptop",
      "deviceId": "laptop-xyz",
      "capabilities": {
        "pollIntervalMs": 2000,
        "onlineWindow": null,
        "allowHopThrough": false
      },
      "signedAt": "2026-05-11T10:00:00Z",
      "revoked": null
    },
    {
      "agentId": "https://anne.pod/profile#me/agent/phone-abc",
      "pubKey": "<base64 ed25519>",
      ...
    },
    {
      "agentId": "https://anne.pod/profile#me/agent/telegraf-bot-1",
      "pubKey": "<base64 ed25519>",
      "role": "bot",
      ...
    }
  ],
  "updated-at": "2026-05-11T11:00:00Z"
}
```

For no-pod users the resource lives in the pseudo-pod
replication ring across the user's own devices.

### 4.6.4 Concurrency

Etag-based optimistic concurrency. Substrate ships:

- `register / updateCapabilities / revoke` operations are
  read-modify-write under an `If-Match` etag.
- On conflict, the substrate retries up to 3 times with
  bounded backoff.
- On persistent conflict, surface a "registry changed on
  another device, reload?" UI affordance.

This matters in the Hub-free interim path where three apps
on the same device might write concurrently (each registers
its own agent on first run).

### 4.6.5 Consumer patterns

Pattern 1: agent first-run registration:

```js
await agentRegistry.register({
  agentId: agent.identity.uri,
  pubKey: agent.identity.publicKey,
  role: 'human',
  name: 'Anne\'s laptop',
  deviceId: '<deviceId from VaultMemory>',
  capabilities: {
    pollIntervalMs: app.settings.pollIntervalMs,
    onlineWindow: app.settings.onlineWindow,
    allowHopThrough: app.settings.allowHopThrough,
  },
});
```

Pattern 2: revoke a lost-phone agent:

```js
await agentRegistry.revoke(missingAgentUri);
// All tokens issued by this agent become invalid;
// PolicyEngine will reject signed-by-this-agent items.
```

Pattern 3: identity-resolver looks up author:

```js
const agent = agentRegistry.lookup(pubKey);
// returns the agent entry → identity-resolver maps to webid + role
```

### 4.6.6 Open questions

- Etag concurrency under heavy multi-writer load. Three apps
  writing on the same device + a desktop write
  simultaneously. Pin during P5 design pass.
- Bot capability-requirements semantics. Bots typically run
  on servers with always-on sockets; how does the Hub
  weight bot caps vs phone caps? Pin during P4.

### 4.6.7 Phase

P5. The Hub V1 (P4) registers itself on first run via this
substrate.

---

# Part II — Extensions to existing substrates

## §5.1 — `item-store` (extended)

### 5.1.1 What changes

- **P1.** Add a standard `embeds: [{type, ref}, …]` field to
  the type schema (cross-pod refs §II.4 of the plan). Refs
  may point to resources on other pods. `treeOf` + the
  hard-deps gate walk refs cross-pod; permission failures
  yield a placeholder.
- **P1.** V2.7 hard-deps logic + `effectiveStatus` /
  `unmetDeps` / `openDeps[]` lift out of Tasks's
  `apps/tasks-v0/src/dag.js` into the substrate.
- **P5.** Item ID format becomes URI-shaped. Migration:
  dual-resolve during a deprecation window (substrate
  accepts either format on read; emits URI-shaped on write).
  Existing data on pods stays at-rest in the legacy shape;
  rewrites happen lazily on next write.

### 5.1.2 New API surface

```
itemStore.computeEffectiveStatus(item, openItems, closedItems)
itemStore.computeUnmetDeps(item, openItems, closedItems)
// (Both lifted from Tasks's dag.js)

itemStore.treeOf(rootRef) → tree   // now walks cross-pod
itemStore.followEmbeds(item) → [resolved refs, ...]
```

### 5.1.3 Wire / on-pod shape

Items gain `embeds` as a top-level field; otherwise unchanged.
The hard-deps walk traverses via `embeds` for refs to other
parents.

---

## §5.2 — `pod-client` (extended)

### 5.2.1 What changes

- **P1.** Routes by URI scheme: `https://...` goes to the
  real-pod backend (today's path), `pseudo-pod://...` goes
  to the local pseudo-pod skill. Same API surface; the
  scheme dispatcher is a small frontend.
- No breaking changes for existing real-pod calls.

### 5.2.2 New behaviour

```js
podClient.fetch('https://anne.pod/foo')        // → real pod over OIDC
podClient.fetch('pseudo-pod://device-xyz/foo') // → fetch skill on agent
```

---

## §5.3 — `sync-engine` + `sync-engine-rn` (absorbed)

### 5.3.1 What changes

- **P1.** Cache-warming follows refs across pods (when an
  envelope arrives, the engine pre-fetches the referenced
  resource).
- **P3.** Pseudo-pod V1 ships with a write-through queue
  that subsumes sync-engine's role. Sync-engine becomes the
  **plumbing inside** pseudo-pod V1 rather than a parallel
  layer.

### 5.3.2 Migration shape

Folio is the canonical example — it currently uses
`sync-engine` directly. Post-P3, Folio's app-side
`SyncEngine` subclass routes through pseudo-pod V1 internally
but exposes the same surface to Folio. Eventually Folio talks
to pseudo-pod directly; sync-engine becomes pseudo-pod-
internal only.

`sync-engine-rn` (RN adapter) follows the same path.

---

## §5.4 — `notifier` (extended)

### 5.4.1 What changes

- **P1.** Recognise envelope-shape payloads (the new
  `notify-envelope` substrate). Routing layer learns "this
  is an envelope — emit the small wire shape; recipients
  fetch the resource by ref." Also recognises the
  pseudo-pod-replicated eager full-payload mode for no-pod
  crews.
- **P3.** App-specific full-payload broadcast paths
  (Stoop's `groupMirror`, Tasks's relay-fan-out helpers)
  retire — their work routes through the substrate's
  per-crew mode picker.

### 5.4.2 API stability

Backward-compatible. Old call sites broadcasting full
payloads keep working through the substrate; new call sites
use the substrate's writeItem API directly.

---

## §5.5 — `identity-resolver` (extended)

### 5.5.1 What changes

- **P5.** Backend swaps to consume `agent-registry`. The
  resolver becomes a thin wrapper that reads the canonical
  agent-registry pod resource (pointed at from the WebID
  profile) via the pseudo-pod, rather than relying on a
  per-call alias arg.
- API surface stays similar; consumers stop passing
  `aliases` once the migration completes (Tasks-v0
  `actorAliases` field becomes vestigial).

### 5.5.2 Migration

P5 lands the backend swap; Tasks-v0 keeps passing `aliases`
through `buildStandardRolePolicy` until P5+1 when the arg is
removed.

---

## §5.6 — `local-store` (absorbed)

### 5.6.1 What changes

- **P1.** Becomes the storage backend for pseudo-pod V0 (all
  three modes — standalone, replication-ring, cache). The
  pseudo-pod is `local-store` + Solid-shaped query API +
  mode selector.
- **P3.** Pseudo-pod V1 wraps `local-store` with a
  write-through queue against the real pod (via
  `pod-client`) for cache mode.

Existing consumers of `local-store` keep working; new
consumers use pseudo-pod.

---

## §5.7 — `oidc-session-rn` (standardised on)

### 5.7.1 What changes

- Tasks-mobile + Stoop-mobile adopt this during P1 for the
  WebID OIDC flow (for users picking a pod-having crew
  policy). No API changes to the substrate itself.
- A `oidc-session` peer for Node/desktop gets extracted from
  `core.identity` during P1 to give the desktop shells the
  same surface.

---

## §5.8 — `react-native` (platform substrate, extended)

### 5.8.1 Pitch

The **canonical RN platform layer**. Where every mobile shell
puts its React Native primitives + native modules.
Sub-modules under `@canopy/react-native/`:

- **theme + hooks** — `useTheme`, design tokens.
- **picker** — `pickAndResize({mode, preset})`, image picker.
- **qr** — `<QrCodeView>`, `classifyQrPayload`.
- **mnemonic** — `useMnemonicReveal`, `<MnemonicView>`.
- **push** — `setupPush`, `requestPushPermission`,
  `usePushOptIn`, `MobilePushBridge`.
- **i18n** — `loadLocale({bundles, defaultLang})`.
- **Native adapters** — `KeychainVault`,
  `AsyncStorageAdapter`, `FileSystemAdapter`,
  `MdnsTransport`, `BleTransport`,
  `requestMeshPermissions`, `createMeshAgent`,
  `metro-preset`, `platform/polyfills`.

V2 adds:

- **`hub-discovery`** (P4) — Android `PackageManager`
  wrapper. Returns `{hubInstalled: bool, hubVersion?:
  string}`. Apps key off this on launch to switch between
  standalone and registered-bundle modes.
- **`hub-binding`** (P4) — AIDL bound-service client.
  Wraps the binder into a promise-based API the agent's
  `TransportManager.setMode('hub-delegate', ...)` consumes.
- **Pseudo-pod RN adapter** (P1) — surfaces
  `FileSystemAdapter` + `AsyncStorageAdapter` as a unified
  storage backend that pseudo-pod V0 + V1 mount on. Lives
  here rather than in `sync-engine-rn` because the adapters
  are RN-platform-shaped (they wrap Expo APIs); pseudo-pod
  consumes them via a small abstract `StorageBackend`
  interface that the desktop side mirrors with a Node
  `local-store` backed equivalent.

### 5.8.2 New public API surface

```
// hub-discovery (P4)
hubDiscovery.check() → { hubInstalled, hubVersion? }
hubDiscovery.watch(callback)  // fires when install state changes

// hub-binding (P4)
hubBinding.bind({hubVersion, intentAction}) → IHubBinding
binding.registerBundle({manifest})
binding.declareCapabilities({capabilities})
binding.fetchResource(uri) → bytes
binding.writeResource(uri, bytes) → etag
binding.publishEnvelope({envelope, recipients})
binding.onIncomingEnvelope(callback)
binding.close()

// pseudo-pod RN adapter (P1)
pseudoPodRnAdapter.createBackend({rootDir, scope}) → StorageBackend
// Implements get / put / list / delete / subscribe.
```

### 5.8.3 What stays in this package vs lifts to a substrate

The platform layer holds **anything RN-specific**. When a
helper becomes pure-of-platform (works the same on RN +
Node), it lifts to a peer substrate:

- `oidc-session-rn` ↔ `oidc-session` (peer extracted from
  `core.identity` during P1).
- Future: a peer `mnemonic` substrate for the mnemonic
  helpers when they need to be shared with desktop UIs.

### 5.8.4 Consumer patterns

Pattern 1: Hub-discovery on app launch (Tasks-mobile,
Stoop-mobile, Folio-mobile):

```js
const hubInfo = await hubDiscovery.check();
if (hubInfo.hubInstalled) {
  const binding = await hubBinding.bind({hubVersion: hubInfo.hubVersion});
  agent.transport.setMode('hub-delegate', {binder: binding});
  agent.pseudoPod.setHost('hub', {binder: binding});
} else {
  // standalone — agent runs its own stack
}
```

Pattern 2: Pseudo-pod V0 RN backend bring-up (P1):

```js
const backend = pseudoPodRnAdapter.createBackend({
  rootDir: FileSystem.documentDirectory + 'pseudo-pod/',
  scope: 'tasks-crew-abc',
});
const pseudoPod = pseudoPod.create({backend, mode: 'standalone'});
```

Pattern 3: BLE / mDNS transport (carried from V1):

```js
const meshAgent = await createMeshAgent({
  transports: [MdnsTransport, BleTransport, RelayTransport],
});
await requestMeshPermissions({...});
```

### 5.8.5 Open questions

- **Pseudo-pod RN adapter location**: `react-native/
  pseudo-pod-adapter` (this doc's recommendation) or fold
  into `sync-engine-rn` (which already holds `createMobile-
  Bootstrap` + the RN binding for sync-engine)? The former
  is cleaner separation-of-concerns; the latter has less
  surface area. Pin during P1 implementation.
- **AIDL surface versioning** for `hub-binding` — must be
  additive across V1 → V2; lock during P4 with the Hub team.
- **Hub-discovery in standalone-only mode forever** — for
  users who never want the Hub installed, the runtime check
  is wasted overhead. Default proposed: cheap one-shot on
  app launch; cache the result for the process lifetime.

### 5.8.6 Phase

- **P1.** Pseudo-pod RN adapter.
- **P4.** `hub-discovery` + `hub-binding`. Apps gain runtime
  detection.
- **P6.** Hub V2 may extend `hub-binding` with V2 AIDL
  methods (interface-registry + protocol orchestration).

## §5.9 — Stays unchanged (relay + chat + ui + ml + tests + cadence)

The following packages are **largely untouched** by the
standardisation work. Captured here for completeness so
readers don't wonder whether they were missed.

### 5.9.1 `relay` (NKN relay infrastructure)

The relay sees opaque bytes; envelope mode and full-payload
eager fan-out are both just relay messages with different
shapes. Server-side code doesn't need changes for V2.

One open server-side question: **envelope ordering
guarantees** under heavy multi-actor write loads (do we need
a per-actor sequence counter on the server, or is the
client-side counter enough?). Tracked in §4.4.6 as an open
question; decision pinned during P1 with measurements.

### 5.9.2 `online-cadence`

Heartbeat / online-status detection per agent.

- **Through P3:** unchanged.
- **P4 (Hub track):** when the Hub is present, the
  per-agent cadence signal feeds **upward** into the Hub's
  capability-aggregator instead of driving the agent's own
  polling. Standalone mode (pre-Hub or Hub-absent) stays
  unchanged. The substrate gains one new exported helper:
  `cadence.publishToHub(binder)` for the AIDL upstream.

### 5.9.3 `skill-match`

Pubsub-of-skills broadcast for crew-wide skill availability.
The substrate is platform-neutral; it sends broadcasts via
`notifier` (which V2 reframes — see §5.4). `skill-match`'s
own surface doesn't change.

Stoop's Layer-1 deterministic-skills broadcasting + Tasks's
skill-based task dispatch both continue to work unchanged.

### 5.9.4 `chat-p2p`

Peer chat threads (`respondToItem`, `sendChatMessage`,
bilateral reveal handshake). Used by Stoop V1 + Tasks's
appeal flow. The substrate stays unchanged — chat messages
are ephemeral content (§II.6 pattern 1 of the plan); they
keep the relay-fan-out-of-full-content shape with
archive-to-pod as the durability mirror.

### 5.9.5 `chat-agent`

Chat-with-LLM / chat-with-bot helpers. Used optionally by
apps that want bot conversation flows. Stays unchanged.

### 5.9.6 `agent-ui`

Desktop UI primitives — `mountLocalUi({staticDir})` for
serving an app's `web/` directory on `127.0.0.1`, plus the
shared lifecycle-status + inbox-badge widgets. Stays
unchanged.

### 5.9.7 `llm-client`

LLM API client (Anthropic + OpenAI + local llama.cpp).
Not affected by the standardisation work.

### 5.9.8 `integration-tests`

The shared test harness. Gains in V2:

- **P1:** new harness with two test matrices
  (pod-having + no-pod) — see
  [transition doc §V.2](../standardisation-transition-2026-05-11.md#§V.2-—-test-strategy).
- **P3:** dual-path test mode for the `groupMirror`
  substrate cut-over.
- **P4+:** Android emulator-backed Hub-track tests +
  AIDL contract tests both ways.

---

# Part III — Direction substrates (P6+)

## §6.1 — `interface-registry` (direction)

### 6.1.1 Pitch

Per-type renderer registry. For every `item-types` type,
the registry maps `(type, installed bundle) → renderer`.
Two rendering modes contract: **compact** (chip / row /
card) and **full** (detail view).

Lands in P6 with the Hub V2.

### 6.1.2 Public API (sketch)

```
interfaceRegistry.register({
  type, bundleId, renderer: { compact, full }, actions,
})

interfaceRegistry.lookup(type) → renderer
interfaceRegistry.renderCompact(ref) → React/RN component
interfaceRegistry.renderFull(ref) → React/RN component
```

### 6.1.3 Conflict resolution

When two bundles register for the same type, conflict
resolves via Android's standard "open with…" picker (§II.13
of the plan). The Hub surfaces which bundle is the default
for each type.

### 6.1.4 Phase

P6 of the standardisation plan. Direction-only; not part of
the Hub-free interim path.

---

## §6.2 — `protocol` (direction)

### 6.2.1 Pitch

State-machine substrate. Multi-step processes (a negotiation,
a propose-subtask flow, a calendar invite that needs N
members to accept) are state machines that operate on items
and emit new items. State persists as items on the pod (or
pseudo-pod for no-pod crews). The Hub orchestrates lifecycle.

### 6.2.2 First consumer

Tasks's `propose-subtask` flow (the canonical first protocol
in P6).

### 6.2.3 Phase

P6. Direction-only.

---

## §6.3 — `pod-search` (existing; lifted earlier)

### 6.3.1 What changes

- The substrate already exists (`packages/pod-search/`).
  The plan's first draft expected it to ship in P6; the
  reality is the contract lifts into the pseudo-pod's read
  path during **P3**, so search-across-the-user's-pods
  becomes a pseudo-pod feature, not a separate client
  concern. Then it's available across all bundles in P6
  without further substrate work.

### 6.3.2 Phase

P3 (lift into pseudo-pod) + P6 (Hub-wide search via the
interface-registry's renderers).

---

# Part IV — Reference

## §7 — Wire formats / on-pod shapes summary

| Resource | Lives at | Substrate |
|---|---|---|
| Storage-mapping config | `<anchor-pod>/private/storage-mapping` | `pod-routing` |
| Agent registry | `<anchor-pod>/private/agent-registry` | `agent-registry` |
| Audit log (deferred) | `<anchor-pod>/private/audit-log` | (future) |
| Identity vault | `<anchor-pod>/private/identity-vault` | `core.VaultMemory` |
| Per-app private state | `<anchor-pod>/private/state/<app>/` | `pod-routing` resolves |
| Per-app drafts | `<anchor-pod>/private/drafts/<app>/` | `pod-routing` resolves |
| Sharing-public profile | `<anchor-pod>/sharing/public/profile-card` | `pod-routing` resolves |
| Group state (centralised) | `<group-pod>/<containers>` | `pod-routing` per crew policy |
| Group state (no-pod) | `pseudo-pod://<deviceId>/group/<crewId>/...` | `pod-routing` + `pseudo-pod` ring |
| Envelope (pod-having) | wire-only (relay) | `notify-envelope` |
| Eager-fan-out payload (no-pod) | wire-only (relay) | `notify-envelope` |

## §8 — Open questions

Consolidated across substrates:

- ACP defaults for `/sharing/public/`. Pin during P1.
- Pseudo-pod peer-fetch authentication (cap-token shape for
  third-party reads). Pin during P1.
- Replication-ring conflict resolution beyond last-write-wins.
  Pin during P3.
- Migration semantics when a user changes storage-mapping
  policy. Pin during P1.
- Etag concurrency at scale across multi-app + multi-device
  writes. Pin during P5.
- Type-schema versioning across app releases. Pin during P2.
- Envelope ordering guarantees on the relay (per-actor
  sequence counter?). Pin during P1.
- Substrate naming finalisation. Pin at plan-lock per
  [`./policies.md`](policies.md).

## §9 — Non-goals

- **Real-time collaborative editing primitives** (CRDTs etc.)
  — possible future substrate, not in V2.
- **End-to-end encryption layer above ACPs** — substrate or
  app layer, not part of the V2 core substrate work.
- **GUI primitives** — `@canopy/agent-ui` and
  `@canopy/react-native` own the UI layer.
- **iOS-specific substrate code.**
- **Custom WebID provider** — substrate ships a starter
  list; users with self-hosted providers configure manually.

## §10 — Phases

Substrate work aligns with the standardisation plan's
§III.A. The
[transition doc](../standardisation-transition-2026-05-11.md)
§II–III has the per-substrate phasing details:

| Phase | Substrates |
|---|---|
| P0 | (none; plan-tracking convention) |
| P1 | new: `pseudo-pod` V0, `pod-onboarding`, `pod-routing`, `notify-envelope`; extends `item-store` (refs), `pod-client` (scheme routing), `sync-engine` (cross-pod warming); absorbs `local-store` into pseudo-pod V0 |
| P2 | new: `item-types`; per-app adoption |
| P3 | new: `pseudo-pod` V1 (write-through queue); absorbs `sync-engine` + `groupMirror`; extends `notifier` (retires legacy paths); lifts `pod-search` into pseudo-pod |
| P5 | new: `agent-registry`; extends `identity-resolver` (backend swap); breaking: cap-token URI IDs, item-store URI IDs |
| P6 (Hub track) | new (direction): `interface-registry`, `protocol`; extends `pod-search` for Hub-wide search |

## §11 — References

- Standardisation plan:
  [`../standardisation-plan-restructured-2026-05-10.md`](../standardisation-plan-restructured-2026-05-10.md).
- Transition doc:
  [`../standardisation-transition-2026-05-11.md`](../standardisation-transition-2026-05-11.md).
- Core companion:
  [`../SDK/core-v2-functional-design-2026-05-11.md`](../SDK/core-v2-functional-design-2026-05-11.md).
- Substrate naming policy:
  [`./policies.md`](policies.md).
- Existing substrate sources:
  [`packages/`](../../packages/).
- Layering convention:
  [`../conventions/architectural-layering.md`](../conventions/architectural-layering.md).
- Substrate-candidates inventory:
  [`./substrate-candidates.md`](substrate-candidates.md).

# Substrates V2 — Coding plan (2026-05-11)

> Phase-by-phase build of the substrate-layer standardisation
> work. Companion to the functional design
> ([`substrates-v2-functional-design-2026-05-11.md`](substrates-v2-functional-design-2026-05-11.md)).
> Numbered **Phase 52.x** to sit alongside the existing tracks
> (50.x = core; 51.x = react-native; 52.x = substrates).
>
> Phase numbers map to the standardisation plan's P-phases:
> 52.1–52.6 land in P1; 52.7 in P2; 52.8–52.9 in P3;
> 52.10–52.11 in P5; 52.12–52.13 in P6 (direction-only).
>
> Strict layering invariant — locked
> [`../conventions/architectural-layering.md`](../conventions/architectural-layering.md#strict-layering-core-must-not-import-substrates-locked-2026-05-11):
> substrates depend on core (not vice versa). Each substrate
> stands alone — apps + the `@canopy/agent-provisioning`
> facade compose them.

## Scope locks (carried from the functional design)

1. **Substrate-first rule.** Data structures + comm protocols
   are always substrate. Helpers lift on first consumer when
   API stable.
2. **Backwards compatibility within the interim path.** Where
   V1 substrates exist (`item-store`, `pod-client`,
   `sync-engine`, `notifier`, `identity-resolver`,
   `local-store`, `oidc-session-rn`, `pod-search`), V2 extends
   rather than replaces. Breaking changes deferred to P5+ with
   shims.
3. **No-pod operation preserved.** Today's `groupMirror` shape
   continues to work via §II.2 policy 4 (pseudo-pod-
   replicated). New substrates *add* pod-attached capabilities;
   they don't *subtract* no-pod ones.
4. **Graceful degradation between pod / no-pod modes**
   (locked 2026-05-11). Pseudo-pod's replication-ring mode is
   the **universal baseline**; the pod is a *promotable ring
   member* whose participation is gated by reachability.
   Per-write reachability check + pending-pod-upload queue
   keeps pod-having crews functional offline.
5. **The pseudo-pod is the unified storage substrate.** Three
   new substrates (`pseudo-pod`, `pod-onboarding`,
   `pod-routing`) absorb the work that `local-store`,
   `sync-engine`, and Stoop's `groupMirror` did today.
6. **No iOS-specific substrate code.** Per the main project
   lock. RN-specific bits live in `@canopy/react-native`
   sub-modules (per its own coding plan, 51.x).

## Substrate inventory (mirror of the functional design)

| Substrate | Status | Phase | Hub-coupled? | Section |
|---|---|---|---|---|
| `item-types` | new | 52.1 (P2) | no | §52.1 |
| `pseudo-pod` V0 | new | 52.2 (P1) | no | §52.2 |
| `pod-routing` | new | 52.3 (P1) | no | §52.3 |
| `notify-envelope` | new | 52.4 (P1) | no | §52.4 |
| `pod-onboarding` | new | 52.5 (P1) | no | §52.5 |
| `item-store` + `pod-client` extensions | changed | 52.6 (P1) | no | §52.6 |
| App-side adoption of `item-types` | (app-side) | 52.7 (P2) | no | §52.7 |
| `pseudo-pod` V1 | extends 52.2 | 52.8 (P3) | no | §52.8 |
| `notifier` extensions | changed | 52.9 (P3) | no | §52.9 |
| `agent-registry` | new | 52.10 (P5) | no (Hub consumes) | §52.10 |
| `identity-resolver` extension | changed | 52.11 (P5) | no | §52.11 |
| `interface-registry` | new (direction) | 52.12 (P6) | yes | §52.12 |
| `protocol` | new (direction) | 52.13 (P6) | yes | §52.13 |

---

# Part I — P1 phases (Hub-free interim)

## Phase 52.1 — `@canopy/item-types`

> **Purpose:** the cross-app type taxonomy. Standardisation plan
> §II.10 puts this in P2 (per-app adoption); the substrate
> itself is foundational and ships in P1 so other substrates
> can reference type schemas.

| # | Task | Files |
|---|---|---|
| 52.1.1 | Create `packages/item-types/` package; standard layout. No runtime deps (schemas are pure data). | `packages/item-types/**` |
| 52.1.2 | Implement the type registry: `registerType(name, schema)`, `validate(item)`, `schema(typeName)`, `list()`. Schemas are JSON-Schema-flavoured but kept simple (no $refs to start). | `packages/item-types/src/registry.js` |
| 52.1.3 | Ship the canonical types as schema files. V2's initial set: `task`, `note`, `chat-message`, `supply-offer`, `demand-offer`, `lend-request`, `contact`, `calendar-event`, `announcement`, `reveal-request`, `neighbourhood-job`. One file per type. | `packages/item-types/src/types/*.js` |
| 52.1.4 | The standard `embeds: [{type, ref}, …]` field is a substrate-level guarantee on every type. Validation enforces it. | `packages/item-types/src/registry.js`, `packages/item-types/src/types/*.js` |
| 52.1.5 | Tests: schema validation per-type (positive + negative cases); embeds field always recognized; registration of new types. | `packages/item-types/test/**` |
| 52.1.6 | Substrate README. Notes the taxonomy + how apps register new types. | `packages/item-types/README.md` |

**Estimate:** 1.5 days.
**Acceptance:** Tests pass; `@canopy/item-types` exports a
working registry; apps can validate their items against the
canonical schemas before write.

## Phase 52.2 — `@canopy/pseudo-pod` V0

> **Purpose:** the unified Solid-shaped local store. V0 covers
> standalone + replication-ring modes (no pod attached yet).
> The graceful-degradation cache-mode work lives in V1
> (Phase 52.8). RN-side storage adapter is parallel work in the
> `@canopy/react-native` plan (Phase 51.1–51.4).

| # | Task | Files |
|---|---|---|
| 52.2.1 | Create `packages/pseudo-pod/` package. Peer deps: `@canopy/core` (for the peer-fetch skill helper from Phase 50.3.2). | `packages/pseudo-pod/**` |
| 52.2.2 | Define the abstract `StorageBackend` interface that the RN adapter (Phase 51.1) and a Node default both implement. Interface: `get(key)`, `put(key, bytes)`, `delete(key)`, `list(prefix)`, `subscribe(prefix, cb)`, `listDirty()`, `subscribeDirty(cb)`. | `packages/pseudo-pod/src/StorageBackend.js` |
| 52.2.3 | Implement `MemoryBackend` — an in-memory `StorageBackend` for tests + V0 default. | `packages/pseudo-pod/src/MemoryBackend.js` |
| 52.2.4 | Implement `PseudoPod` class. Constructor opts: `{backend, mode: 'standalone' \| 'replication-ring', identity, transport}`. Methods: `read(uri)`, `write(uri, bytes, etag?)`, `list(containerUri)`, `subscribe(uri, cb)`, `mode(uri)` (per-URI mode override). | `packages/pseudo-pod/src/PseudoPod.js` |
| 52.2.5 | URI scheme handling: pseudo-pod URIs are `pseudo-pod://<deviceId>/<path>`. The pod-having mode (cache) ships in V1; V0 only handles `pseudo-pod://` URIs. | `packages/pseudo-pod/src/PseudoPod.js` |
| 52.2.6 | Wire `makeFetchResourceSkill` from core (Phase 50.3.2) — when constructed with `{transport, identity}`, register the skill on the agent so peers can fetch from this pseudo-pod. | `packages/pseudo-pod/src/PseudoPod.js` |
| 52.2.7 | Replication-ring outbound: when `mode = 'replication-ring'`, every write triggers a `notify-envelope.publish({...payload})` (full-payload eager fan-out). This is the receiver-side hook — actual `notify-envelope` substrate is Phase 52.4. | `packages/pseudo-pod/src/PseudoPod.js` |
| 52.2.8 | Replication-ring inbound: a `writeFromPeer(uri, bytes, etag)` method that the envelope receiver calls when an inbound full-payload envelope arrives. Stores into the local backend. | `packages/pseudo-pod/src/PseudoPod.js` |
| 52.2.9 | Tests: in-memory backend round-trip; standalone mode; replication-ring mode with mocked transport (two pseudo-pods sharing a fake bus); fetch-resource skill round-trip. | `packages/pseudo-pod/test/**` |
| 52.2.10 | Substrate README + cross-link to functional design §4.1. | `packages/pseudo-pod/README.md` |

**Estimate:** 3 days.
**Acceptance:** Two pseudo-pods in a fake-bus test setup can
replicate writes between them via `notify-envelope` (stubbed).
A peer can call `fetch-resource` skill and get bytes back.
RN-side backend (Phase 51.1) plugs in via the
`StorageBackend` interface without modifying the substrate.

## Phase 52.3 — `@canopy/pod-routing`

> **Purpose:** storage-function → URI mapping. The user-policy
> layer over the substrate-shipped default. Reads canonical
> config from the pod resource (or pseudo-pod replica for
> no-pod users). Plus per-write reachability check for
> graceful degradation.

| # | Task | Files |
|---|---|---|
| 52.3.1 | Create `packages/pod-routing/` package. Peer deps: `@canopy/pseudo-pod` (for reading the config resource), `@canopy/webid-discovery` (for the pointer-walk that locates the config). | `packages/pod-routing/**` |
| 52.3.2 | Storage-function name registry: `private/identity-vault`, `private/state/<app>`, `private/drafts/<app>`, `sharing/profile-public`, `sharing/<resource>`, `group/<crewId>/<container>`, `personal-in-group/<crewId>`. Apps can register additional names. | `packages/pod-routing/src/storageFunctions.js` |
| 52.3.3 | Default policy: `private/*` → `<anchor-pod>/private/`, `sharing/*` → `<anchor-pod>/sharing/`, `sharing/profile-public` → `<anchor-pod>/sharing/public/profile-card`, `group/<crewId>/*` → resolves per crew policy. | `packages/pod-routing/src/defaultPolicy.js` |
| 52.3.4 | Public API: `resolve(storageFn, vars?)`, `crewPolicy(crewId)`, `isPodReachable(uri)`, `updateMapping({fn, uri})`, `reload()`. | `packages/pod-routing/src/index.js` |
| 52.3.5 | **Reachability check** (locked 2026-05-11). `isPodReachable(uri)` returns a cached truthy/falsy verdict based on last successful pod request + transport-level connectivity events. Cache TTL configurable (default 30s). | `packages/pod-routing/src/reachability.js` |
| 52.3.6 | Storage-mapping config resource is a pod resource at `<anchor-pod>/private/storage-mapping` (or pseudo-pod replica for no-pod users). Read via the pseudo-pod. WebID profile carries `storage-mapping-uri` pointer (consumed via `@canopy/webid-discovery`). | `packages/pod-routing/src/configResource.js` |
| 52.3.7 | Tests: default policy resolutions; reachability cache + TTL behaviour; mocked pseudo-pod + webid-discovery; per-crew policy lookup. | `packages/pod-routing/test/**` |
| 52.3.8 | Substrate README. | `packages/pod-routing/README.md` |

**Estimate:** 2.5 days.
**Acceptance:** Apps call `podRouting.resolve('sharing/tasks/abc', {crewId})`
and get back the right URI per the user's mapping config.
`isPodReachable` returns reliably + cheaply. Crew policy
lookup works for all four §II.2 policies.

## Phase 52.4 — `@canopy/notify-envelope`

> **Purpose:** mediates persistent-content writes. Per-write
> mode picker based on (content nature, crew preference,
> current pod reachability) — the graceful-degradation work
> from 2026-05-11.

| # | Task | Files |
|---|---|---|
| 52.4.1 | Create `packages/notify-envelope/` package. Peer deps: `@canopy/core` (transport's `publishEnvelope` + `subscribeEnvelopes` from Phase 50.7), `@canopy/pod-routing` (for crew policy + reachability), `@canopy/pseudo-pod` (local writes + inbound `writeFromPeer`), `@canopy/item-types` (validation). | `packages/notify-envelope/**` |
| 52.4.2 | Public API: `publish({type, ref, etag, fromActor, recipients, payload, timestamp})`, `subscribe({kind, callback})`. | `packages/notify-envelope/src/index.js` |
| 52.4.3 | Per-write mode picker. Three inputs: crew policy (from `pod-routing.crewPolicy`), pod reachability (from `pod-routing.isPodReachable`), content nature (caller specifies via type). Two wire formats: envelope-only OR full-payload eager fan-out. | `packages/notify-envelope/src/picker.js` |
| 52.4.4 | **Pending-pod-upload queue** (locked 2026-05-11). When a pod-having write happens offline, the resource sits in a persistent queue (stored in the local pseudo-pod under a reserved namespace `__pending-pod-uploads__`). On reconnect, the queue drains: each pending resource is uploaded to the pod + a fresh envelope is re-emitted. | `packages/notify-envelope/src/pendingQueue.js` |
| 52.4.5 | Re-emit on drain: when a pending resource is uploaded to the pod, the substrate emits a fresh envelope-only message so recipients can promote their local cache entry from "ring-cached" to "pod-canonical." | `packages/notify-envelope/src/pendingQueue.js` |
| 52.4.6 | Receiver-side: subscribes to `core.transport.subscribeEnvelopes`. For envelope-only messages, the local pseudo-pod fetches by ref on caller demand. For full-payload messages, calls `pseudoPod.writeFromPeer(uri, payload, etag)` immediately. | `packages/notify-envelope/src/receiver.js` |
| 52.4.7 | Tests: per-write mode picking for the 4 crew policies × reachable/unreachable matrix; pending queue persistence across substrate restart; re-emit on drain; receiver round-trip for both wire shapes. | `packages/notify-envelope/test/**` |
| 52.4.8 | Substrate README + functional design cross-link. | `packages/notify-envelope/README.md` |

**Estimate:** 3 days (the queue + drain semantics are the
trickiest piece).
**Acceptance:** App writes a task in (a) a centralised crew
online → envelope-only, recipient fetches lazily; (b) a
centralised crew offline → full-payload fan-out, pending
queue holds for pod, drain on reconnect; (c) a no-pod crew →
full-payload fan-out always. All three pass integration tests
with mocked transports + pseudo-pods.

## Phase 52.5 — `@canopy/pod-onboarding`

> **Purpose:** one-tap "create my pod" provisioning + two-pod
> upgrade preset + mnemonic-restore re-attach.

| # | Task | Files |
|---|---|---|
| 52.5.1 | Create `packages/pod-onboarding/` package. Peer deps: `@canopy/pod-client` (for the actual provisioning calls), `@canopy/oidc-session` (Node) / `@canopy/oidc-session-rn` (RN, via the consuming app's choice), `@canopy/pseudo-pod` (writing the initial config resources). | `packages/pod-onboarding/**` |
| 52.5.2 | `provisionDefault({oidcProvider, mnemonic | newIdentity})` — runs OIDC, provisions one pod with `/private/`, `/sharing/`, `/sharing/public/` sub-containers; writes `storage-mapping`, `agent-registry`, `audit-log` (deferred) resources; writes pointer predicates on the user's WebID profile. Returns `{podUri, webidUri, pointers}`. | `packages/pod-onboarding/src/provisionDefault.js` |
| 52.5.3 | `upgradeToTwoPods({privatePodOidcProvider, sharingPodOidcProvider})` — provisions a second pod for `sharing/*`; lazily migrates content; rewrites refs via a per-user redirect map; updates the WebID profile + storage-mapping. | `packages/pod-onboarding/src/upgradeToTwoPods.js` |
| 52.5.4 | `restoreFromMnemonic({mnemonic})` — walks the WebID profile via `@canopy/webid-discovery`, fetches `storage-mapping` + `agent-registry` via the pseudo-pod, populates the new agent. | `packages/pod-onboarding/src/restoreFromMnemonic.js` |
| 52.5.5 | `signOut({keepLocalData})` — clears OIDC session + optionally clears the local pseudo-pod. | `packages/pod-onboarding/src/signOut.js` |
| 52.5.6 | Default ACP templates for `/private/` (agent-locked), `/sharing/` (default-deny per-resource), `/sharing/public/` (world-readable, owner-write). | `packages/pod-onboarding/src/acpTemplates.js` |
| 52.5.7 | Tests with mocked pod-client + oidc-session + pseudo-pod. Cover happy path, ACP template application, two-pod upgrade with rewrite map, mnemonic restore. | `packages/pod-onboarding/test/**` |
| 52.5.8 | Substrate README. | `packages/pod-onboarding/README.md` |

**Estimate:** 2.5 days (lots of moving pieces — OIDC +
pod-client + ACP + webid + storage-mapping).
**Acceptance:** A first-run flow against a real
Community Solid Server provisions a working pod with the
default layout + ACPs + WebID pointer predicates; mnemonic
restore from another device re-attaches cleanly.

## Phase 52.6 — `item-store` + `pod-client` extensions

> **Purpose:** P1-scope extensions to two existing substrates.

| # | Task | Files |
|---|---|---|
| 52.6.1 | `@canopy/item-store`: add the standard `embeds: [{type, ref}, …]` field to every type schema. `treeOf` + the hard-deps walk traverse `embeds` cross-pod; permission failures yield a placeholder. | `packages/item-store/src/**` |
| 52.6.2 | `@canopy/item-store`: lift Tasks's `effectiveStatus` / `unmetDeps` / `openDeps[]` extension from `apps/tasks-v0/src/dag.js` into the substrate. Tasks-v0 keeps importing them from `item-store` post-migration. | `packages/item-store/src/dag.js`, `apps/tasks-v0/src/dag.js` (becomes a re-export shim) |
| 52.6.3 | `@canopy/pod-client`: URI scheme dispatch. `pod-client.fetch(uri)` routes `https://...` to the real-pod backend (current behaviour); `pseudo-pod://...` to the local pseudo-pod skill. Same API surface. | `packages/pod-client/src/PodClient.js` |
| 52.6.4 | Tests for both: `embeds` field validation + traversal; URI scheme routing. | `packages/item-store/test/**`, `packages/pod-client/test/**` |

**Estimate:** 2 days.
**Acceptance:** A Tasks task with an `embeds[]` ref to a Stoop
supply-offer renders correctly with the embedded chip; the
hard-deps walk works across two pods. `pod-client.fetch(pseudo-pod://...)`
returns bytes from the local pseudo-pod.

---

# Part II — P2 phases

## Phase 52.7 — Per-app `item-types` adoption

> **Purpose:** apps adopt the canonical `item-types` taxonomy
> (substrate-side already ships in Phase 52.1). Mostly
> app-side work; substrate is unchanged.

| # | Task | Files |
|---|---|---|
| 52.7.1 | Tasks adopts `task` type — calls `itemTypes.validate(item)` before write; stops using its implicit schema. | `apps/tasks-v0/src/skills/**`, `apps/tasks-v0/src/Crew.js` |
| 52.7.2 | Stoop adopts `offer`, `request`, `claim`, `chat-message`, `announcement`, `reveal-request`, `neighbourhood-job` types (vocabulary refresh 2026-05-12; legacy names `supply-offer` / `demand-offer` / `lend-request` registered as aliases). `kind` subfield carries the verb direction (`lend` / `borrow` / `give` / etc.). Stoop's UX needs a direction-disambiguation step at post time. | `apps/stoop/src/skills/**` |
| 52.7.3 | Folio adopts `note` type. **Revised 2026-05-12.** Metadata (title, tags, etc.) lives on the `note` data object in the pseudo-pod, NOT in markdown frontmatter — the data object is the authoritative source of truth, the `.md` file syncs the body verbatim. Validation runs at the substrate boundary when the data object is written to the pseudo-pod, not at file-read time. Adoption is contingent on Folio growing a notes-with-metadata feature; pure file-sync V0 has nothing structured to validate and the task is effectively no-op. | `apps/folio/src/**` |
| 52.7.4 | Per-app inbox uses canonical type strings. | each app |

**Estimate:** 2 days (1 per app, parallel).
**Acceptance:** All three apps validate items against the
canonical taxonomy before writing; inbox filters use the
canonical type strings.

---

# Part III — P3 phases

## Phase 52.8 — `@canopy/pseudo-pod` V1 (cache mode + graceful degradation)

> **Purpose:** V1 adds the cache-for-real-pod mode + the
> graceful-degradation drain. Absorbs `@canopy/sync-engine`'s
> role. Folio is the natural first consumer of V1.

| # | Task | Files |
|---|---|---|
| 52.8.1 | Add cache-for-real-pod mode. When `mode = 'cache'`, every write is local-immediate; queued for write-through to the real pod via `pod-client`. Reads check local first; fetch from real pod on miss. | `packages/pseudo-pod/src/PseudoPod.js`, `packages/pseudo-pod/src/cacheMode.js` |
| 52.8.2 | Per-resource mode override. A single PseudoPod instance can run different modes for different resources (e.g., the user's notes are cache-mode while a no-pod crew's items are replication-ring-mode). | `packages/pseudo-pod/src/PseudoPod.js` |
| 52.8.3 | Write-through queue. Internal queue: each pending write retried on reconnect; etag-conflict (412) triggers a re-fetch + caller-side conflict-resolution callback. Persistent state in the backend's `__write-through__` namespace. | `packages/pseudo-pod/src/writeThroughQueue.js` |
| 52.8.4 | Graceful-degradation drain semantics (locked 2026-05-11). When the pod is unreachable, the writer falls back to ring-mode for that resource. When reachable again, the write-through queue drains; a callback into `notify-envelope` triggers the envelope re-emit. | `packages/pseudo-pod/src/PseudoPod.js` (degradation policy hook) |
| 52.8.5 | Absorb `@canopy/sync-engine`'s role. `sync-engine` becomes pseudo-pod-internal plumbing rather than a parallel layer. Existing Folio consumers transparently migrate. | `packages/sync-engine/`, `packages/pseudo-pod/src/syncEngineAdapter.js` |
| 52.8.6 | Tests: write while offline → reconnect → drains; 412 conflict → re-fetch + retry; per-resource mode override; sync-engine absorption parity tests. | `packages/pseudo-pod/test/**` |
| 52.8.7 | Folio integration test — `bin/folio sync` continues to work end-to-end against a real CSS, routing through pseudo-pod V1. | `apps/folio/test/**` |

**Estimate:** 4 days (the queue + conflict-resolution
semantics are the hard part).
**Acceptance:** Folio's existing sync flows still pass
against a real CSS; pseudo-pod V1 round-trips writes via the
queue; graceful degradation handles offline→online
transitions without losing writes.

## Phase 52.9 — `@canopy/notifier` extensions

> **Purpose:** notifier recognises envelope-shape payloads
> (delegating to `notify-envelope`'s receiver) + retires
> legacy app-specific fan-out paths (Stoop's `groupMirror`,
> Tasks's relay-fan-out helpers).

| # | Task | Files |
|---|---|---|
| 52.9.1 | Notifier recognises envelope-shape payloads vs full-payload broadcasts. Envelope-shape: emit small wire; receivers fetch by ref via pseudo-pod. Full-payload: route through `notify-envelope`'s pseudo-pod-replicated path. | `packages/notifier/src/index.js` |
| 52.9.2 | Stoop's `groupMirror` substrate retires. Its work moves into `notify-envelope` + `pseudo-pod` (ring mode). Dual-run during transition: groupMirror + new substrate emit in parallel; reads prefer the substrate side; flip per-crew once parity tests pass. | `apps/stoop/src/groupMirror.js` (deprecation shim), `packages/notify-envelope` |
| 52.9.3 | Tasks's relay-fan-out helpers: route through `notify-envelope` instead of bespoke `groupMirror`-style code. | `apps/tasks-v0/src/skills/**` |
| 52.9.4 | Test matrix: pod-having + no-pod crew round-trips for every legacy fan-out path that's now substrate-mediated. | `packages/integration-tests/notify-envelope-migration/**` |

**Estimate:** 3 days (Stoop's `groupMirror` cut-over is the
load-bearing piece; per the transition doc §IV.2, plan two
weeks of dual-path runtime in production before the final
flip).
**Acceptance:** Stoop crews on both pod-having and no-pod
policies pass parity tests against the new substrate path;
Tasks's relay-fan-out replaced with the substrate's
notify-envelope path; legacy `groupMirror` substrate
deletable after parity holds.

---

# Part IV — P5 phases

## Phase 52.10 — `@canopy/agent-registry`

> **Purpose:** the user's agents listed in one place. Pod
> resource at `<anchor-pod>/private/agent-registry`; WebID
> profile carries pointer. Implements the `ActorResolver`
> interface from core's Phase 50.9.

| # | Task | Files |
|---|---|---|
| 52.10.1 | Create `packages/agent-registry/` package. Peer deps: `@canopy/pseudo-pod` (read/write the resource), `@canopy/webid-discovery` (locate via pointer), `@canopy/core` (the `ActorResolver` interface). | `packages/agent-registry/**` |
| 52.10.2 | Public API: `register({agentId, pubKey, role, name, deviceId, capabilities})`, `lookup(identifier)`, `revoke(agentId)`, `updateCapabilities(agentId, caps)`, `list()`. | `packages/agent-registry/src/index.js` |
| 52.10.3 | Etag-based optimistic concurrency. `register / updateCapabilities / revoke` use If-Match on the pod resource; conflict-retry with bounded backoff (3 retries); on persistent conflict, surface a "registry changed on another device, reload?" callback. | `packages/agent-registry/src/concurrency.js` |
| 52.10.4 | Resource shape: `{v: 1, agents: [{agentId, pubKey, webid, role, name, deviceId, capabilities, signedAt, revoked}], updated-at}`. Defined as a `item-types` schema; validation on read/write. | `packages/agent-registry/src/resource.js`, `packages/item-types/src/types/agent-registry-entry.js` |
| 52.10.5 | `makeActorResolver(registry)` factory implementing core's `ActorResolver` interface (Phase 50.9). Indexes by pubKey / webid / agentUri; bridges across identifier shapes. | `packages/agent-registry/src/makeActorResolver.js` |
| 52.10.6 | Tests: register + lookup; concurrent writes with simulated 412 conflicts; resolver bridges pubKey ↔ agentUri ↔ webid; revoke flips `revokedAt`. | `packages/agent-registry/test/**` |
| 52.10.7 | Substrate README. | `packages/agent-registry/README.md` |

**Estimate:** 3 days (the concurrency story is the hard
part).
**Acceptance:** A user with 3 apps installed registers 3
agents in one registry without losing entries; lookup by
pubKey returns the correct entry; the resolver lets
`PolicyEngine` + `CapabilityToken.verify` (Phase 50.9–50.10)
bridge URI-shaped IDs to pubKeys.

## Phase 52.11 — `@canopy/identity-resolver` extension

> **Purpose:** swap backend to consume `agent-registry`. The
> resolver becomes a thin wrapper that reads the canonical
> agent-registry pod resource via the pseudo-pod, rather than
> relying on a per-call alias arg.

| # | Task | Files |
|---|---|---|
| 52.11.1 | `identity-resolver`: new backend reads from `agent-registry` via the pseudo-pod (pointer walk through webid-discovery). | `packages/identity-resolver/src/**` |
| 52.11.2 | API surface stays similar. Consumers stop passing `aliases` once the migration confirms parity. | `packages/identity-resolver/src/**` |
| 52.11.3 | Tasks-v0's `buildStandardRolePolicy` consumers migrate off `aliases`. | `apps/tasks-v0/src/rolePolicy.js`, `apps/tasks-mobile/src/**` |
| 52.11.4 | Deprecation shim: legacy `aliases` arg accepted + ignored if registry is available; logs warning. Removed in P5+1. | `packages/identity-resolver/src/**` |
| 52.11.5 | Tests covering both shim + new path. | `packages/identity-resolver/test/**` |

**Estimate:** 1.5 days.
**Acceptance:** Tasks-v0 + Tasks-mobile run with the new
resolver backend; role enforcement equivalence verified
across the shim transition.

---

# Part V — P6 phases (direction-only)

## Phase 52.12 — `@canopy/interface-registry`

> **Purpose:** per-type renderer registry. Hub V2 territory;
> direction-only until timing committed. The Agent slot for
> this substrate already exists in core (Phase 50.13).

| # | Task | Files |
|---|---|---|
| 52.12.1 | Create `packages/interface-registry/`. Peer deps: `@canopy/item-types` (types being registered), `@canopy/core` (Agent slot). | `packages/interface-registry/**` |
| 52.12.2 | Public API: `register({type, bundleId, renderer: {compact, full}, actions})`, `lookup(type)`, `renderCompact(ref)`, `renderFull(ref)`. | `packages/interface-registry/src/index.js` |
| 52.12.3 | Two-mode rendering contract. Compact mode (chip / row / card) for embedded refs; full mode (detail view) for direct views. Both required from any bundle registering a type. | `packages/interface-registry/src/renderModes.js` |
| 52.12.4 | Conflict resolution at the OS level: Android's "default app for type" picker resolves cross-bundle conflicts. Substrate just records which bundle is the current default for each type. | `packages/interface-registry/src/defaultPicker.js` |
| 52.12.5 | Default permission-denied rendering for cross-pod refs the receiver can't fetch. Same fallback chip used across all types. | `packages/interface-registry/src/permissionDenied.js` |
| 52.12.6 | Tests with mocked Agent + mocked bundle registrations. | `packages/interface-registry/test/**` |
| 52.12.7 | Substrate README. | `packages/interface-registry/README.md` |

**Estimate:** 4 days (direction-only).
**Acceptance:** Tasks-bundle registers its `task` type's
compact + full renderers; Stoop renders an embedded Tasks
task as a compact chip + tap-through opens the full view.

## Phase 52.13 — `@canopy/protocol`

> **Purpose:** state-machine substrate. Multi-step processes
> (negotiation, propose-subtask, calendar accept) modelled as
> state machines over items. Direction-only; the Tasks
> propose-subtask flow is the canonical first consumer.

| # | Task | Files |
|---|---|---|
| 52.13.1 | Create `packages/protocol/`. Peer deps: `@canopy/item-types`, `@canopy/pseudo-pod` (state persistence), `@canopy/notify-envelope` (state transitions emit items). | `packages/protocol/**` |
| 52.13.2 | Protocol definition shape: `{id, name, initial, states, transitions, validators}`. State machines persist state as items on the pod / pseudo-pod. | `packages/protocol/src/defineProtocol.js` |
| 52.13.3 | Orchestrator: `protocol.start(protocolId, args)`, `protocol.step(instanceId, event)`, `protocol.subscribe(instanceId, callback)`. | `packages/protocol/src/orchestrator.js` |
| 52.13.4 | First canonical protocol: Tasks's `propose-subtask` flow. Spec it explicitly so substrate API gets shaped against real load. | `packages/protocol/src/protocols/propose-subtask.js` |
| 52.13.5 | Tests: state-machine transitions; persistence across substrate restart; the propose-subtask scenario end-to-end. | `packages/protocol/test/**` |
| 52.13.6 | Substrate README + design note that V0 ships with ONE consumer (propose-subtask) so the API gets shaped against a real load-bearing case before opening to other apps. | `packages/protocol/README.md` |

**Estimate:** 5 days (direction-only).
**Acceptance:** A declared protocol (propose-subtask) runs
end-to-end; state persists on the pod / pseudo-pod; an
observer can subscribe to state transitions.

---

# Part VI — What stays unchanged

These substrates are listed in the functional design §5.9
as "stays unchanged":

| Substrate | Why no change |
|---|---|
| `@canopy/relay` | NKN relay infrastructure. Sees opaque bytes; envelope + full-payload modes are both just relay messages with different shapes. Server-side code doesn't need changes for V2. **One open server-side question: envelope ordering guarantees under heavy multi-actor write loads — possibly needs per-actor sequence counter; pin during P1 with measurements.** |
| `@canopy/online-cadence` | Heartbeat / online-status. Through P3: unchanged. P4 (Hub track): per-agent cadence signal feeds upward into the Hub's capability-aggregator instead of driving polling. |
| `@canopy/skill-match` | Pubsub-of-skills broadcast. Sends via `notifier` which V2 extends; the substrate's own surface doesn't change. |
| `@canopy/chat-p2p` | Peer chat threads. Ephemeral content stays on relay-fan-out + archive-to-pod. No change. |
| `@canopy/chat-agent` | Chat-with-LLM helpers. No change. |
| `@canopy/agent-ui` | Desktop UI primitives (`mountLocalUi`, status widgets). No change. |
| `@canopy/llm-client` | LLM API client. No change. |
| `@canopy/integration-tests` | Test harness. Gains in V2: P1 two-matrix harness (pod-having + no-pod); P3 dual-path mode for groupMirror absorption; P4+ emulator + AIDL contract tests. |

---

# Part VII — Phasing summary

| Phase range | Standardisation P-phase | Estimate | Notes |
|---|---|---|---|
| 52.1 (item-types) | P2 (substrate ships in P1 schedule) | ≈1.5 days | Foundational; other substrates reference its schemas |
| 52.2 – 52.6 | P1 (Hub-free) | ≈13 days | The big chunk: pseudo-pod V0 + pod-routing + notify-envelope + pod-onboarding + existing-substrate extensions |
| 52.7 | P2 (Hub-free) | ≈2 days | App-side adoption of item-types |
| 52.8 – 52.9 | P3 (Hub-free) | ≈7 days | Pseudo-pod V1 + notifier extensions; **groupMirror cut-over is the cliff** |
| 52.10 – 52.11 | P5 (Hub-free) | ≈4.5 days | agent-registry substrate + identity-resolver swap |
| 52.12 – 52.13 | P6 (Hub track, direction) | ≈9 days | interface-registry + protocol substrates |

**Total ≈37 days of substrate-side work** across the
standardisation arc — substantially larger than core (10
days) or RN (12 days), which reflects the substrates being
the bulk of the new functionality.

Hub-track phases (52.12 / 52.13) are direction-only until
the Hub V2 timing is committed.

## Acceptance gates per P-phase

- **P1 (52.1–52.6) gate:** all three apps' desktop shells can
  provision a pod via `pod-onboarding`; persistent writes
  route through `notify-envelope` per crew policy; offline
  writes queue for pod-upload + drain on reconnect; pseudo-pod
  V0 hosts standalone + replication-ring modes; `item-types`
  validates the canonical taxonomy.
- **P2 (52.7) gate:** all three apps validate items against
  `item-types` schemas; inbox filters use canonical types.
- **P3 (52.8–52.9) gate:** pseudo-pod V1 round-trips writes
  via the queue; Stoop's `groupMirror` substrate retires
  cleanly; Tasks's relay-fan-out routes through
  `notify-envelope`. **Parity tests pass for both pod-having
  and no-pod crews** — load-bearing test that the no-pod
  capability was preserved, not just renamed.
- **P5 (52.10–52.11) gate:** all three apps' agents register
  in the `agent-registry` resource; `identity-resolver` bridges
  pubKey ↔ webid ↔ agentUri via the resolver; deprecation
  warnings appear at the expected call sites; cap-tokens
  issue + verify in both shapes during the deprecation window.
- **P6 (52.12–52.13) gate:** Tasks-bundle registers its
  `task` interface; propose-subtask runs as a declared
  protocol; one bundle (Tasks) embeds + renders refs of
  another's type (e.g., a Stoop supply-offer chip inside a
  Tasks task body).

## Open questions

Carried from the functional design + the 2026-05-11
graceful-degradation work — these aren't blockers but need
attention during implementation:

1. **ACP defaults for `/sharing/public/`.** Pin during 52.5.
2. **Pseudo-pod peer-fetch authentication.** Cap-token shape
   for third-party reads. Pin during 52.2.
3. **Replication-ring conflict resolution.** Beyond
   last-write-wins. Pin during 52.8.
4. **Storage-mapping migration.** When a user upgrades from
   one-pod to two-pod, rewrite map shape + lifecycle. Pin
   during 52.5.
5. **Etag concurrency at scale** (multi-app + multi-device
   writes to agent-registry). Pin during 52.10.
6. **Type-schema versioning** across app releases. Forward-
   additive only? Pin during 52.7.
7. **Envelope ordering guarantees** (relay-side or
   client-side sequence counter). Pin during 52.4.
8. **Reachability-check cadence** in pod-routing. Default
   proposed: last successful pod request within N seconds
   AND no transport disconnect since. Pin during 52.3.
9. **Pending-pod-upload queue semantics.** Where it persists,
   when it drains, re-emit on drain. Pin during 52.4 + 52.8.
10. **AIDL surface versioning discipline** (for the future
    interface-registry + protocol delegation through the
    Hub). Pin during P6 with the Hub team.

## Open V2 questions (deferred to post-V1, documented for later)

These are flagged across plan / substrates / transition / app
docs and intentionally **not** tackled in V1:

**Upload-on-behalf** (locked 2026-05-11 as V2 work):

1. **Authority model.** Who has the right to write to another
   member's pod? Pod-shepherd role per crew? Per-resource
   grant cap-token? Opt-in flag per member?
2. **Conflict resolution.** Offline + online writes touch
   same resource at different times — reconciliation
   strategy?
3. **ACP semantics for proxy uploads.** When B uploads A's
   content, whose ACPs apply — A's intent (substrate-
   recorded) or B's authorisation (actual writer)?
4. **Product fit.** Is upload-on-behalf desirable in the
   project's value system, or is "everyone manages their own
   pod" the durable answer? Probably yes for buurt-style
   crews with tech-shy members; pin during V2 design with
   stakeholder input.

Revisit once V1 has been running long enough to surface real
"this person's content is stuck on their phone for two
weeks" scenarios in the field.

## Cross-cutting tests

- **Today's app test suites stay green throughout** (Tasks
  412/412 + Tasks-mobile 106/106, Stoop 378+, Folio 451+).
  No regression on existing surface is the acceptance bar
  per phase.
- **New integration-test harness** at
  `packages/integration-tests/standardisation/` with two
  test matrices:
  - Pod-having tests: write to real pod via pseudo-pod, read
    back, envelope round-trip, cross-pod refs, hard-deps
    walk across pods.
  - No-pod tests: write to pseudo-pod in replication-ring
    mode, eager fan-out to peers, peer pseudo-pods receive
    + render, durability across the union of online devices,
    recovery when individual devices drop offline.
- **Graceful-degradation test matrix** (new 2026-05-11):
  per-write reachability variations (online → offline
  mid-write; offline → online during pending-queue drain;
  multiple sequential offline writes; offline write +
  online recipient receiving full-payload + later
  envelope-re-emit promotion).
- **`groupMirror` cut-over test mode** (Phase 52.9): dual-
  path runtime, parity assertions across a multi-device
  crew simulation.

## References

- Functional design:
  [`substrates-v2-functional-design-2026-05-11.md`](substrates-v2-functional-design-2026-05-11.md).
- Standardisation plan:
  [`../standardisation-plan-restructured-2026-05-10.md`](../standardisation-plan-restructured-2026-05-10.md).
- Transition doc:
  [`../standardisation-transition-2026-05-11.md`](../standardisation-transition-2026-05-11.md).
- Core coding plan companion:
  [`../SDK/core-v2-coding-plan-2026-05-11.md`](../SDK/core-v2-coding-plan-2026-05-11.md).
- React-native coding plan companion:
  [`../SDK/react-native-v2-coding-plan-2026-05-11.md`](../SDK/react-native-v2-coding-plan-2026-05-11.md).
- Layering convention:
  [`../conventions/architectural-layering.md`](../conventions/architectural-layering.md)
  — strict layering rule + four mechanisms.
- Substrate naming policy:
  [`./policies.md`](policies.md).

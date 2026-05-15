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
| 52.9.2 | **Stoop's `groupMirror` retired (clean break, 2026-05-14, Q-B).** No dual-run — the user picked clean-break matching Q-A's cutover style (no production users to disrupt). New files: `apps/stoop/src/substrateMirror.js` (substrate-shaped receive) + `apps/stoop/src/lib/substrateStack.js` (pseudoPod + podRouting + notifyEnvelope wiring with per-recipient transport routing). Publisher dual-publishes: `skillMatch.broadcast` keeps the claim-flow on the pubsub topic; `notifyEnvelope.publish({type:'request'})` replicates posts via the substrate path. Receiver-side notify-envelope auto-runs the Q-D 3-way version compare via `pseudoPod.writeFromPeer`. `groupMirror.js` + its addPeer-race test deleted (no per-peer race on the substrate path — receive is one global subscription). Tests: **460/460 stoop, 73/73 pseudo-pod, 47/47 notify-envelope, 41/41 integration**. Q-D bugfix found during wiring: `core.Transport.publishEnvelope` now forwards `_v` (was being dropped in the destructure). | `apps/stoop/src/{substrateMirror,index}.js`, `apps/stoop/src/lib/substrateStack.js`, `packages/core/src/transport/Transport.js`, `apps/stoop-mobile/src/lib/{agentBundle,bootstrapBundle}.js`, `apps/stoop/bin/stoop-testbed.js`, 5 stoop test files |
| 52.9.3 | ~~Tasks's relay-fan-out helpers: route through `notify-envelope` instead of bespoke `groupMirror`-style code.~~ **Deferred to Tasks V2 (2026-05-14).** Survey 2026-05-14 found `apps/tasks-v0/src/skills/**` has NO existing fan-out helpers to migrate — Tasks-v0 is single-household / local-only today. The phase's premise was wrong about Tasks's current state. Adoption of the substrate path (notify-envelope + pseudo-pod) will happen when Tasks goes multi-device (V2 mobile + concurrent multi-instance crew servers). Substrate side is ready (Stoop's `apps/stoop/src/substrateMirror.js` is the template). Tracked in `Project Files/Tasks App/v2-{web,mobile}-functional-design-2026-05-11.md` §8 Open questions. | `apps/tasks-v0/src/skills/**` |
| 52.9.4 | Test matrix: pod-having + no-pod crew round-trips for every legacy fan-out path that's now substrate-mediated. **Stoop coverage shipped 2026-05-14 via Phase 52.9.2's substrate-mirror tests + integration-tests substrates-v2 scenarios. Graceful-degradation matrix (third axis) shipped 2026-05-14** at `packages/integration-tests/test/scenarios/graceful-degradation/cache-mode-edge-cases.scenario.test.js` — 5 scenarios covering sequential offline writes, pending-queue persistence across substrate restart, partial drain failure with retry, online↔offline mid-batch, notify-envelope re-emit on drain. Integration suite now 46/46. Tasks coverage waits on 52.9.3 (deferred above). | `packages/integration-tests/test/scenarios/{substrates-v2,graceful-degradation}/**` |

**Estimate:** 3 days (originally planned; **groupMirror
retirement (52.9.2) shipped 2026-05-14 as a clean break**,
not the dual-path approach the transition doc proposed —
worked because there are no production users yet, and Q-D's
substrate path was strictly stronger than groupMirror's LWW
at flip time).
**Acceptance:** Stoop crews on both pod-having and no-pod
policies pass parity tests against the new substrate path;
Tasks's relay-fan-out replaced with the substrate's
notify-envelope path (still TODO — Stoop done first); legacy
`groupMirror` substrate deleted.

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

## Phase 52.14 — Conflict resolution (Q-D, 2026-05-14)

> **Purpose:** answer the "whose copy wins?" question for
> replication-ring resources, and surface stale-vs-fresh signals
> apps can act on. Closes Q-D from
> [`Project Files/Stoop/open-questions-2026-05-12.md`](../Stoop/open-questions-2026-05-12.md)
> and pins open-question #3 above. Full design lives in
> [`../Stoop/conflict-resolution-design-2026-05-14.md`](../Stoop/conflict-resolution-design-2026-05-14.md).
>
> **Scope.** Replication-ring (no-pod) and cache-mode (cache vs
> pod) are the two situations we tackle. Single-author single-pod
> stayed as-is (etag-CAS already in `pod-client` + `agent-registry`);
> multi-author single-pod stayed as-is (`pod-client`'s `conflict`
> event already wired — apps opt in).

| # | Task | Files |
|---|---|---|
| 52.14.1 | `StorageBackend` typedef gains optional `_v: number` on `StoredRecord`. `put(key, bytes, etag?, _v?)` returns `{etag, _v}`; pinning `_v` is the "accept peer's write" path. | `packages/pseudo-pod/src/StorageBackend.js` |
| 52.14.2 | `MemoryBackend` tracks a per-key Lamport-style counter; new keys start at 1, default puts increment by 1, caller-supplied `_v` pins. `delete` clears the counter. | `packages/pseudo-pod/src/MemoryBackend.js` |
| 52.14.3 | RN persistent backends (`AsBackend`, `FsBackend`) persist `_v` alongside bytes + etag; same pin-or-increment semantics. | `packages/react-native/src/pseudo-pod-adapter/AsBackend.js`, `FsBackend.js` |
| 52.14.4 | `PseudoPod.write` returns `{uri, etag, _v}`. Replication-ring publish includes `_v` at the envelope top level AND inside the payload (belt-and-braces). | `packages/pseudo-pod/src/PseudoPod.js` |
| 52.14.5 | `PseudoPod.writeFromPeer(uri, bytes, etag, _v?, opts?)` runs the three-way version compare: inbound `_v` > local → adopt + `'peer-update'`; < local → ignore + `'stale-peer'` (carries local snapshot); == local → idempotent-or-`'concurrent-write'` depending on etag match. Legacy peers (no `_v`) fall back to LWW. | `packages/pseudo-pod/src/PseudoPod.js` |
| 52.14.6 | Event-emitter surface on `PseudoPod` (`on(event, cb)` / `off(event, cb)`); events: `'peer-update'`, `'stale-peer'`, `'concurrent-write'`. Errors thrown by subscribers are swallowed. | `packages/pseudo-pod/src/PseudoPod.js` |
| 52.14.7 | `PseudoPod.read(uri, {freshness})` opt — cache mode only. `'fresh'` runs a conditional GET (caller's `podFetcher` accepts `{ifNoneMatch}` second arg; `notModified: true` keeps cached copy, else refreshes). `'cached'` is the default. | `packages/pseudo-pod/src/PseudoPod.js` |
| 52.14.8 | `notify-envelope.publish({..., _v})` forwards the counter (forward-additive — legacy receivers ignore). Receive path passes `payload._v` + `payload.fromActor` into `writeFromPeer`. Pending-queue entries also carry `_v`. | `packages/notify-envelope/src/NotifyEnvelope.js` |
| 52.14.9 | Tests: peer-update / stale-peer / concurrent-write / idempotent / legacy fall-back; stale-peer reply round-trip (divergent peers converge in one round); envelope wire-shape carries `_v`. | `packages/pseudo-pod/test/PseudoPod.replicationRing.test.js`, `packages/react-native/test/pseudo-pod-adapter/*.test.js` |
| 52.14.10 | App-level adoption (Stoop first; Tasks + Folio when they adopt replication-ring): subscribe to `'stale-peer'` and reply via `notify-envelope.publish`. **Deferred** — implementation lands once an app feels the need. | `apps/stoop/src/skills/index.js` |

**Estimate:** ≈3 days (1.5 days substrate + 1 day tests + 0.5
day docs; app-level adoption deferred).
**Acceptance:** 73/73 pseudo-pod tests + 47/47 notify-envelope
tests pass; the three-way version compare fires its events
under the scenarios above; pseudoPod.read with `freshness:
'fresh'` works against a mock pod.

**Shipped 2026-05-14.** Substrate side complete; app-side hooks
remain deferred until the first real divergence shows up in
field testing.

## Phase 52.15 — Solid-auth consolidation (Scoped 2026-05-14)

> **Purpose:** consolidate the Solid OIDC sign-in UX across every
> app + add multi-issuer support (Inrupt + community + self-hosted).
> Subsumes the older "Default pod issuer flexibility" TODO. Full
> design + plan: [`../Inrupt-migration/`](../Inrupt-migration/).
>
> **Status:** SCOPED 2026-05-14, implementation pending.
>
> **Critical path:** lands BEFORE any new sign-in UX in Tasks V1 or
> Household V2 (per TODO-GENERAL).

| # | Task | Files |
|---|---|---|
| 52.15.1 | `KNOWN_ISSUERS`, `DEFAULT_ISSUER_ID`, `resolveIssuer()` exports + shared `SolidAuth` typedef. | `packages/oidc-session/src/issuers.js`, `packages/oidc-session/index.js` |
| 52.15.2 | `createSolidAuthNode({vault, clientName, redirectUrl})` — substrate-promote `OidcSession.js` from apps/folio + apps/stoop. | `packages/oidc-session/src/createSolidAuthNode.js` |
| 52.15.3 | Drop `apps/folio/src/auth/OidcSession.js` + `apps/stoop/src/lib/OidcSession.js`; update call sites. | `apps/{folio,stoop}/**` |
| 52.15.4 | `getIssuerPickerHtml()` web component + adoption in Folio + Stoop sign-in pages. | `packages/oidc-session/src/issuerPickerHtml.js`, `apps/folio/src/server/static/*.html`, `apps/stoop/web/sign-in.html` |
| 52.15.5 | `<IssuerPicker>` RN component + adoption in folio-mobile + stoop-mobile + tasks-mobile SignInScreens. | `packages/oidc-session-rn/src/picker/`, `apps/{folio,stoop,tasks}-mobile/src/screens/SignInScreen.js` |
| 52.15.6 | Terminology lock — per-app locale fixes + `locales-audit` CI hook. | `apps/*/locales/*.json`, `Project Files/conventions/localisation.md` |
| 52.15.7 | Tests: exports shape; createSolidAuthNode round-trip; IssuerPicker renders provided list. | `packages/oidc-session/test/**`, `packages/oidc-session-rn/test/picker/**` |
| 52.15.8 | README updates + cross-link to inventory + design + plan. | `packages/{oidc-session,oidc-session-rn}/README.md` |

**Estimate:** ≈4 days.
**Acceptance:** every app uses the same issuer-picker shape;
defaults align on Inrupt; users can switch to solidcommunity.net /
solidweb.org / custom; terminology audit passes CI.

**Shipped 2026-05-14.** All 8 sub-phases landed in one session
(2026-05-14). Folio + Stoop web embed the picker (manual mirror of
`getIssuerPickerHtml()`); folio-mobile + stoop-mobile + tasks-mobile
adopt `<IssuerPicker>` from `@canopy/oidc-session-rn/picker`. The
copy-pasted `OidcSession.js` wrappers retired. Audit script reports
clean (one EN + one NL terminology violation fixed during the
adoption pass). Tests: 79 oidc-session, 44 oidc-session-rn, 452
Folio, 460 Stoop.

## Phase 52.16 — Sharing v2 (ACP-mediated, Scoped 2026-05-14)

> **Purpose:** add real Solid ACP/WAC mutation to `pod-client`. Folio
> adopts; non-ACP pods fall back to cap-token cleanly. The bespoke
> cap-token surface stays for power-user CLI + bot/admin scope.
> Full design: [`../Inrupt-migration/substrate-design-2026-05-14.md`](../Inrupt-migration/substrate-design-2026-05-14.md).
>
> **Status:** SCOPED 2026-05-14, implementation pending. Lands after
> 52.15 ships; not blocking other Phase 52.x work.

| # | Task | Files |
|---|---|---|
| 52.16.1 | `client.sharing.{grant, revoke, list, capabilities}` API. ACP-via-Inrupt-SDK impl. | `packages/pod-client/src/sharing/**` |
| 52.16.2 | `SharingUnsupportedError` + capability probe. | `packages/pod-client/src/sharing/capabilities.js` |
| 52.16.3 | Folio CLI + server `/share` adopt the new API. `--mode cap-token \| acp` flag. | `apps/folio/src/{cli,server}/**` |
| 52.16.4 | Folio browser Share pane adopts the new API; UX shows mode used. | `apps/folio/src/server/static/share.{js,html}` |
| 52.16.5 | Folio auto-share `with-<webid>/` gets `acp` mode (capability-detection at sync time). | `apps/folio/src/autoShare.js` |
| 52.16.6 | folio-mobile ShareScreen adopts new API (falls back to cap-token when engine.identity absent). | `apps/folio-mobile/src/screens/ShareScreen.js` |
| 52.16.7 | Tests: ACP grant/revoke/list round-trip; capability probe; fall-back paths. | `packages/pod-client/test/sharing/**` |
| 52.16.8 | Integration: pod-having Folio test that creates a `with-<webid>/` folder + verifies the share is ACP-mediated. | `packages/integration-tests/test/scenarios/sharing-v2/**` |

**Estimate:** ≈5 days.
**Acceptance:** Folio's share UX defaults to ACP-mediated grants when
the pod supports it; falls back to cap-token cleanly; already-issued
cap-tokens remain valid via the unchanged consumer-side path.

**Shipped 2026-05-14.** All 8 sub-phases landed (same session as
52.15, ≈4 days of design + impl compressed). `client.sharing.*` in
`pod-client` uses Inrupt's `universalAccess` API (lazy-loaded);
`SharingUnsupportedError` + `parseSharingLinkHeader` /
`probeCapabilities` ship as named exports. Folio CLI gets a
`--mode cap-token|acp` flag (CLI stays cap-token-only; `--mode acp`
points to the server). Folio server `/share` accepts `mode:
'auto'|'cap-token'|'acp'` and returns `{mode, token? | grant?}`.
Browser Share pane labels rows with the share mode. `autoShare`
probes capabilities once per pod origin and prefers ACP when
supported (with cap-token fall-back per-folder). folio-mobile
ShareScreen tries ACP first when `engine.podClient` is wired,
fall-back to cap-token. Tests: **188 pod-client** (+37 sharing),
**463 folio** (+11 mode/ACP), **79 folio-mobile**.

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
| 52.14 | (out-of-band) | ≈3 days | **Shipped 2026-05-14** — conflict resolution (Q-D) |
| 52.15 | (out-of-band) | ≈4 days | Scoped 2026-05-14 — Solid-auth consolidation (multi-issuer + picker + substrate-promote). Critical path for Tasks V1 / Household V2 sign-in UX. |
| 52.16 | (out-of-band) | ≈5 days | Scoped 2026-05-14 — Sharing v2 (ACP/WAC via `client.sharing.*`). Lands after 52.15. |

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
attention during implementation. **Status traversal 2026-05-14:**
of 10 questions, 5 are now resolved (#1, #3, #5, #8, #9), 4
remain genuinely open (#2, #4, #6, #7), and 1 is Hub-track
deferred (#10).

1. ~~**ACP defaults for `/sharing/public/`.** Pin during 52.5.~~
   **Resolved 2026-05-11 in code** — see
   `packages/pod-onboarding/src/acpTemplates.js`:
   `/private/` is agent-locked, `/sharing/` is default-deny
   per-resource (owner-write, no-read), `/sharing/public/` is
   world-readable + owner-write. The user / app explicitly
   opts in to public placement by writing into the
   `/sharing/public/` container.

2. **Pseudo-pod peer-fetch authentication.** Cap-token shape
   for third-party reads. Pin during 52.2. **DECIDED
   2026-05-14 (hybrid); IMPLEMENTATION PENDING.**
   `pseudoPod.fetchResourceSkill({groupCheck?, capCheck?})`
   ships TWO opt-in hooks:
   - `groupCheck(uri, caller) → boolean | Promise<boolean>` —
     default model: caller is authorised if a shared
     group-membership exists for the resource. Substrate
     ships a default that consults an app-provided membership
     lookup; falls back to "allow" when no lookup is wired
     (matches current behaviour, so adoption is opt-in).
   - `capCheck(uri, caller, capToken?) → boolean` —
     orthogonal cap-token verification path. When supplied,
     callers can present a `PodCapabilityToken`-shaped
     credential whose scope must match the requested URI.
   When BOTH are supplied, the responder accepts the fetch
   if EITHER returns truthy (group OR cap-token), so an
   external (non-member) consumer can still read via an
   issued cap-token. When NEITHER is supplied, default
   trust-the-transport behaviour stays — back-compat for
   apps that haven't migrated.

   **SUBSTRATE SIDE SHIPPED 2026-05-14** as Phase 52.2.x.
   `core.makeFetchResourceSkill({read, groupCheck?, capCheck?, …})`
   gained the two opt-in gate hooks; `pseudoPod.fetchResourceSkill(opts)`
   passes them through. When BOTH supplied → allow if EITHER
   returns truthy (group OR cap-token). When NEITHER supplied →
   trust-the-transport (back-compat for current callers). Tests:
   **9 new gate tests in `packages/core/test/Agent.pseudoPod.test.js`
   + 2 gate-flow tests in `packages/pseudo-pod/test/PseudoPod.standalone.test.js`.**
   Per-app adoption pending — Stoop, Tasks, Folio register
   `fetch-resource` with their group-membership lookup when
   they start exposing it (current state: no app calls
   `fetch-resource` yet; substrate-mirror replicates payloads
   inline). When that changes (envelope-only mode adoption,
   cross-app embeds), apps wire `groupCheck` from their
   `MemberMap` / equivalent.

   **Safety rationale (2026-05-14):** Stoop's existing
   `EvictionRoster` filters INBOUND posts from evicted
   members but does NOT gate OUTBOUND fetches. An ex-member
   who retains the agent pubkey + URI structure can still
   read group resources via `fetch-resource` once apps
   expose that skill. The hybrid design is the V1 protection
   against this; cap-token opt-in covers cross-group sharing
   when that becomes a real product need.

3. ~~**Replication-ring conflict resolution.** Beyond
   last-write-wins. Pin during 52.8.~~ **Resolved 2026-05-14
   via Phase 52.14** — Lamport-style per-key counter + 3-way
   version compare in `writeFromPeer`; events fired for
   `peer-update` / `stale-peer` / `concurrent-write`. See
   §Phase 52.14 above + the design note.

4. **Storage-mapping migration.** When a user upgrades from
   one-pod to two-pod, rewrite map shape + lifecycle. Pin
   during 52.5. **DESIGN SKETCHED 2026-05-14, IMPLEMENTATION
   DEFERRED V2.** Locked scope: **changing the mapping only
   affects future storage actions; data migration is the
   user's responsibility, not the substrate's**. Substrate
   ships ONE primitive — `podRouting.setStorageMapping(newMap)`
   — an atomic CAS rewrite with `config-changed` event +
   history array. Sketch lives at
   [`storage-migration-design-2026-05-14.md`](./storage-migration-design-2026-05-14.md).
   V2 phase: ≈4 days. Trigger conditions: real user wants to
   switch pod providers, household upgrade, or app path
   restructure.

5. ~~**Etag concurrency at scale** (multi-app + multi-device
   writes to agent-registry). Pin during 52.10.~~ **Resolved
   2026-05-14 in code** —
   `packages/agent-registry/src/concurrency.js` ships
   `withCAS(...)`: read current resource (with etag), mutate,
   write back with `If-Match: <etag>`, bounded retry on
   CAS-failure (returns `{retries}`), throws persistent
   `CONFLICT` after exhausting retries.

6. ~~**Type-schema versioning** across app releases. Forward-
   additive only? Pin during 52.7.~~ **Resolved 2026-05-14 —
   ratified Stoop's de-facto pattern as the formal policy.**
   - **Forward-additive types + kinds** — new values added
     freely; older apps treat unknown values as `'other'` /
     ignore.
   - **Aliases for renames** — legacy names persist in the
     registry resolving to canonical names
     (`supply-offer` → `offer`).
   - **No removals** — types may be marked deprecated, never
     removed. Apps may stop emitting deprecated values, but
     readers must keep recognising them.
   Policy documented in `@canopy/item-types/README.md`.

7. ~~**Envelope ordering guarantees** (relay-side or
   client-side sequence counter). Pin during 52.4.~~
   **Resolved 2026-05-14: deferred + documented as known
   limitation.** Substrate ships current behaviour (each
   envelope carries `timestamp`; UI components sort by
   sender's wall clock). Cross-actor total ordering isn't
   physically meaningful without a central authority; intra-
   actor reorderings are bounded by transport latency.
   Known limitation: **displayed order ≈ post time ± clock
   skew**; multi-actor bursts may visibly reorder. Revisit
   if real-world field testing surfaces visible reorderings
   that confuse users. Phase 52.14's `_v` is per-resource
   (Lamport), unrelated to envelope-level ordering.

8. ~~**Reachability-check cadence** in pod-routing. Default
   proposed: last successful pod request within N seconds
   AND no transport disconnect since. Pin during 52.3.~~
   **Resolved 2026-05-11 in code** —
   `packages/pod-routing/src/PodRouting.js` ships
   `createPodRouting({reachabilityTTLms: 30_000})` with
   `markPodReachable(uri)` / `markPodUnreachable(uri)` /
   `isPodReachable(uri)`. Default TTL is 30s; caller-driven
   reachability marking (no auto-poll).

9. ~~**Pending-pod-upload queue semantics.** Where it
   persists, when it drains, re-emit on drain. Pin during
   52.4 + 52.8.~~ **Resolved 2026-05-11 in code** — locked
   per §Phase 52.4.4 above. Queue persists in the local
   pseudo-pod under reserved namespace
   `__pending-pod-uploads__`; drains on caller-driven
   reconnect signal (`notifyEnvelope.drainQueue()` /
   `pseudoPod.drainWriteThroughQueue()`); re-emit
   envelope-only message per drained entry so peers can
   promote their cached copy to pod-canonical.

10. **AIDL surface versioning discipline** (for the future
    interface-registry + protocol delegation through the
    Hub). Pin during P6 with the Hub team. **DEFERRED** —
    P6 is direction-only until Hub V1 timing commits.

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

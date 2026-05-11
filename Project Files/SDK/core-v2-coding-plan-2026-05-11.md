# Core V2 — Coding plan (2026-05-11)

> Phase-by-phase build of `packages/core`'s standardisation
> work. Companion to the functional design
> ([`core-v2-functional-design-2026-05-11.md`](core-v2-functional-design-2026-05-11.md)).
> Numbered **Phase 50.x** to reserve a fresh prefix for the
> standardisation track (40.x = Stoop V3 mobile; 41.x =
> Tasks V1 mobile).
>
> Phase numbers map to the standardisation plan's P-phases:
> 50.1–50.5 land in P1; 50.6–50.7 in P3; 50.8–50.10 in P5;
> 50.11–50.12 in P4 (Hub track); 50.13–50.15 in P6 (Hub track).
> The Hub-track phases are **direction-only** until the timing
> is committed.

## Scope locks (carried from the functional design)

1. **Single-agent topology unchanged.** One `core.Agent` per
   process; per-crew `CrewState`.
2. **Keypair stays load-bearing.** Pod writes carry both the
   keypair signature (audit) and the WebID OIDC authorization.
3. **OIDC integration is optional.** Pod-having users wire
   it; no-pod users run keypair-only.
4. **Standalone mode is the only mode pre-P4.** Hub-delegate
   ships in P4.
5. **Cap-tokens stay useful for scoping skill calls** between
   agents; the signature shape changes in P5.
6. **No iOS-specific code.** Per the main project lock.
7. **Substrate-first applies inside core too.** When core
   logic becomes pure-of-platform, it lifts to a substrate.

## Substrate touches (overview)

Three substrate-level changes that fall out of core's V2 work:

| Substrate | Action | Phase |
|---|---|---|
| `@canopy/oidc-session` | NEW — extract from `core.identity.SolidOidcAuth`; peer of `oidc-session-rn`. | 50.1 |
| `@canopy/webid-discovery` | NEW — pure-of-platform WebID-profile pointer-walk + cache. Lifted from the in-core `core.identity.webid` module. | 50.2 |
| `@canopy/agent-registry` | NEW — consumed by core, separately authored in the substrate coding plan. Core just wires it. | 50.8 |

Core's residual scope is the Agent wiring + the lifecycle hooks
+ Bootstrap; the substrates above are spun out where the API
crystallises early.

---

# Part I — P1 phases (Hub-free interim)

## Phase 50.1 — Extract `@canopy/oidc-session` substrate

> **Purpose:** today's `core.identity.SolidOidcAuth` is the
> desktop / Node OIDC client; `oidc-session-rn` (separate
> package) is the RN peer. Standardisation wants the two
> peers to mirror each other's surface. Extract a substrate
> from `core.identity` so the OIDC flow is callable the same
> way from desktop + Node + mobile.

| # | Task | Files |
|---|---|---|
| 50.1.1 | Create `packages/oidc-session/` package; standard layout (`src/`, `index.js`, `package.json`, `vitest.config.js`). Peer deps: `@inrupt/solid-client-authn-node`. | `packages/oidc-session/**` |
| 50.1.2 | Move + adapt `core.identity.SolidOidcAuth` and the desktop-side OIDC flow helpers (`startPodSignIn`, `completePodSignIn`, `signOutOfPod`) into the substrate. Generalise: accept an `appId` prefix for storage keys (so Tasks's, Stoop's, Folio's tokens don't collide). | `packages/oidc-session/src/{OidcSession,runOidcSignIn,storage}.js` |
| 50.1.3 | Mirror the public API of `oidc-session-rn` (same method names; same arg shapes). Where mobile uses `expo-auth-session`, desktop uses `solid-client-authn-node` underneath, but the consumer-facing surface is identical. | `packages/oidc-session/src/index.js` |
| 50.1.4 | `@canopy/core` keeps a re-export of the new substrate's surface during the deprecation window (`core.identity.oidc` → re-exports). Add a deprecation notice + remove after one minor release. | `packages/core/src/identity/{SolidOidcAuth,index}.js` |
| 50.1.5 | Tests: substrate-level unit tests (token storage, refresh, discovery). Existing desktop OIDC integration tests in `packages/integration-tests/` keep passing. | `packages/oidc-session/test/*.test.js` |
| 50.1.6 | Substrate README. Notes the cross-platform pattern: this is the Node peer of `oidc-session-rn`; consumer code is identical. | `packages/oidc-session/README.md` |

**Estimate:** 2 days.
**Acceptance:** Stoop V1.5's `startPodSignIn` continues to
work; Folio's `bin/folio init` continues to work; both now
import from `@canopy/oidc-session`. Mobile shells continue
to use `oidc-session-rn` unchanged.

## Phase 50.2 — New module `core.identity.webid` + substrate extraction

> **Purpose:** the WebID-discovery pointer-walk is the same
> on desktop and mobile (both fetch from the user's WebID
> profile via the pseudo-pod). Pure-of-platform from day one
> → lift directly to a substrate.

| # | Task | Files |
|---|---|---|
| 50.2.1 | Create `packages/webid-discovery/` package. Peer deps: `@canopy/pod-client` (for the actual fetch). | `packages/webid-discovery/**` |
| 50.2.2 | Implement `discoverPointers(webidUri, podClient)` — fetches the WebID profile, parses `storage-mapping-uri`, `agent-registry-uri`, `audit-log-uri` predicates. Returns `{pointers, raw}`. | `packages/webid-discovery/src/discoverPointers.js` |
| 50.2.3 | Implement `resolvePointers(pointers, pseudoPod)` — for each pointer, fetches the resource via the pseudo-pod (cache-or-fetch). Returns `{storageMapping?, agentRegistry?, auditLog?}`. | `packages/webid-discovery/src/resolvePointers.js` |
| 50.2.4 | In-memory cache with a default 60s heartbeat refresh + explicit `refresh()`. | `packages/webid-discovery/src/cache.js` |
| 50.2.5 | Wire into `core.Agent` lifecycle: on agent start (post-OIDC), call `discoverPointers` + `resolvePointers`; cache results on `agent.webid`. | `packages/core/src/Agent.js`, `packages/core/src/identity/webid.js` (small wrapper) |
| 50.2.6 | Tests: mocked pod-client; verify pointer parsing, resolution, cache invalidation, heartbeat refresh. | `packages/webid-discovery/test/*.test.js` |
| 50.2.7 | Substrate README. | `packages/webid-discovery/README.md` |

**Estimate:** 2 days.
**Acceptance:** a `core.Agent` started with a pod-having user
exposes `agent.webid.pointers` + `agent.webid.storageMapping`
+ `agent.webid.agentRegistry` reflecting the user's pod
state. For no-pod users, `agent.webid` is `null`.

## Phase 50.3 — Pseudo-pod V0 client wiring

> **Purpose:** `core.Agent` exposes a `pseudoPod` handle
> that calls the new substrate (separately built per the
> substrates coding plan). Core's responsibility is the
> wiring + the mode-detection.

| # | Task | Files |
|---|---|---|
| 50.3.1 | Add `agent.pseudoPod` field. Constructed by `Bootstrap` per the `pseudoPodMode` arg: `'cache'` (pod-having), `'standalone'` (no-pod single user), or `'replication-ring'` (no-pod crew). | `packages/core/src/Agent.js` |
| 50.3.2 | When `pseudoPodMode === 'cache'`, wire the pseudo-pod to use `pod-client` for the upstream. When `'standalone'` or `'replication-ring'`, no upstream. | `packages/core/src/Agent.js` |
| 50.3.3 | `core.skills.fetchResource` — declares the peer-fetch skill the pseudo-pod uses for replication-ring + peer reads. Routes resource fetches to the local pseudo-pod's read API. | `packages/core/src/skills/fetchResource.js` |
| 50.3.4 | Tests with a mocked pseudo-pod substrate; verify the right mode binding happens per Bootstrap args. | `packages/core/test/Agent.pseudoPod.test.js` |

**Estimate:** 1 day.
**Acceptance:** `Bootstrap.startAgent({pseudoPodMode: 'standalone'})`
returns an agent with a standalone pseudo-pod; a peer's
`agent.callSkill('fetchResource', {uri})` returns the
resource.

## Phase 50.4 — `VaultMemory` pod write-through

> **Purpose:** the encrypted vault blob lives at
> `<anchor-pod>/private/identity-vault` for pod-having users,
> via the pseudo-pod's cache mode. Mnemonic-restore walks
> the WebID profile + fetches the blob from the pod.

| # | Task | Files |
|---|---|---|
| 50.4.1 | Extend `VaultMemory` to accept a `podClient + storageFn` config. When set, every keypair / refresh-token mutation writes through to the pod (encrypted with the seed-derived key). | `packages/core/src/identity/VaultMemory.js` |
| 50.4.2 | Failure mode: pod unreachable → local write succeeds + queues for retry; vault read prefers local. Failure surface: an event `vault.write-through-failed` for the agent to observe. | `packages/core/src/identity/VaultMemory.js` |
| 50.4.3 | Mnemonic-restore path: when `Bootstrap.startAgent({mnemonic})` resolves, fetches `<anchor-pod>/private/identity-vault` from the pod, decrypts with seed, populates the vault. | `packages/core/src/Bootstrap.js` |
| 50.4.4 | For no-pod users: vault writes go to the local pseudo-pod (which replicates across the user's own devices in ring mode). No pod write-through. | `packages/core/src/identity/VaultMemory.js` |
| 50.4.5 | Tests: write to pod-having vault → restart agent → keypair reconstitutes; write to no-pod vault → identical local-only path. | `packages/core/test/VaultMemory.test.js` |

**Estimate:** 1 day.
**Acceptance:** Tasks V1 desktop's existing vault flows
continue to work; mnemonic-restore from a new device fetches
the encrypted blob correctly.

## Phase 50.5 — `Bootstrap` profile walk

> **Purpose:** wire the full pod-having bring-up sequence
> together: OIDC → discoverPointers → resolvePointers →
> register in agent-registry (P5; placeholder pre-P5) →
> agent ready.

| # | Task | Files |
|---|---|---|
| 50.5.1 | `Bootstrap.startAgent({mnemonic, oidcProvider, vaultMode})` — full sequence orchestrated. Branches early on `oidcProvider: null` for no-pod path. | `packages/core/src/Bootstrap.js` |
| 50.5.2 | First-run provisioning: if the WebID profile has no `storage-mapping-uri` pointer, kick off `pod-onboarding.provisionDefault` (P1 substrate; assumed available). | `packages/core/src/Bootstrap.js` |
| 50.5.3 | Pre-P5 placeholder: agent-registry registration is a no-op (the substrate doesn't exist yet). Add a structured stub that records the intent locally so the P5 phase can drain it. | `packages/core/src/Bootstrap.js` |
| 50.5.4 | Tests: full Bootstrap end-to-end (mocked OIDC + pod-client + pseudo-pod); verifies pointer-walk + vault init + pseudo-pod bring-up. | `packages/core/test/Bootstrap.test.js` |
| 50.5.5 | Update `core.identity.Bootstrap` README + CHANGELOG entries. | `packages/core/{README.md,CHANGELOG.md}` |

**Estimate:** 1 day.
**Acceptance:** Tasks V1 desktop + Folio's `bin/folio init`
+ Stoop V1.5 desktop continue to start their agents
unchanged; first-run pod provisioning works against a real
pod.

---

# Part II — P3 phases

## Phase 50.6 — Pseudo-pod V1 write-through-queue client

> **Purpose:** P3 ships pseudo-pod V1 (substrate work
> separate). Core's responsibility is the queue + retry +
> failure-event surface.

| # | Task | Files |
|---|---|---|
| 50.6.1 | Extend `agent.pseudoPod` to support write-through queue: queued writes drain async to `pod-client`; on conflict (412) the substrate retries; on persistent failure, surfaces a `pseudoPod.write-through-failed` event. | `packages/core/src/Agent.js` |
| 50.6.2 | Backpressure: queue size cap + LRU eviction for pure caches (read-only items can be re-fetched). Persistent writes don't get evicted. | `packages/core/src/Agent.js` |
| 50.6.3 | Reconnect drain semantics: when transport reconnects, kick off queue drain in the background. | `packages/core/src/Agent.js` |
| 50.6.4 | Tests: simulate write while offline → reconnect → queue drains; simulate 412 conflict → substrate retries → success after re-fetch. | `packages/core/test/Agent.writeThrough.test.js` |

**Estimate:** 1.5 days.
**Acceptance:** Folio's existing sync-engine drain semantics
match parity against the new write-through queue;
integration tests at the pseudo-pod V1 boundary pass.

## Phase 50.7 — `TransportManager` envelope-emit path

> **Purpose:** the substrate-side `notify-envelope` calls
> `agent.transport.send(...)` with the envelope wire shape.
> Core's responsibility is to expose the right path for both
> modes (envelope-only + full-payload-eager).

| # | Task | Files |
|---|---|---|
| 50.7.1 | Add `transport.publishEnvelope({kind, ref, etag, fromActor, recipients, payload?})` as the public surface notify-envelope calls. Internally routes to the existing `transport.send` machinery. | `packages/core/src/transport/TransportManager.js` |
| 50.7.2 | Receive-side: a `transport.subscribeEnvelopes(callback)` that fires on inbound envelopes per the wire shape. | `packages/core/src/transport/TransportManager.js` |
| 50.7.3 | Tests: round-trip an envelope through a mocked transport; verify the receive-side callback fires with the right shape. | `packages/core/test/TransportManager.envelope.test.js` |

**Estimate:** 0.5 day.
**Acceptance:** notify-envelope substrate publishes through
core's transport; receive-side fires reliably.

---

# Part III — P5 phases (breaking with shims)

## Phase 50.8 — `agent-registry` consumption

> **Purpose:** core consumes the `agent-registry` substrate
> (separately authored). Wires up the lookup paths + the
> registration on first run.

| # | Task | Files |
|---|---|---|
| 50.8.1 | Add `agent.agentRegistry` field exposing the substrate's lookup + register API. Constructed by Bootstrap. | `packages/core/src/Agent.js` |
| 50.8.2 | Replace the pre-P5 placeholder agent-registration stub from 50.5.3 with a real call to `agent-registry.register({...capabilities})`. | `packages/core/src/Bootstrap.js` |
| 50.8.3 | Tests with mocked `agent-registry`. | `packages/core/test/Bootstrap.agentRegistry.test.js` |

**Estimate:** 0.5 day.
**Acceptance:** Bootstrap-started agents register in the
user's agent-registry; lookup by pubKey returns the right
agent entry.

## Phase 50.9 — `PolicyEngine` actor-resolution rewrite

> **Purpose:** swap the alias-table backend for
> agent-registry lookups. Breaking change with shim during
> deprecation window.

| # | Task | Files |
|---|---|---|
| 50.9.1 | New backend: `PolicyEngine.resolveActor(pubKey | webid | agentUri)` reads from `agent-registry` (via the substrate). | `packages/core/src/permissions/PolicyEngine.js` |
| 50.9.2 | Shim: legacy `aliases` arg accepted + ignored if `agent-registry` is available; logs a deprecation warning. Removed in P5+1. | `packages/core/src/permissions/PolicyEngine.js` |
| 50.9.3 | Update Tasks-v0's `buildStandardRolePolicy` consumers to stop passing `aliases` once the migration confirms parity. | `apps/tasks-v0/src/rolePolicy.js` |
| 50.9.4 | Tests: verify shim path + new path produce equivalent role resolutions; verify deprecation warning. | `packages/core/test/PolicyEngine.test.js` |

**Estimate:** 1 day.
**Acceptance:** Tasks V1 + Tasks V2 tests pass with the new
backend; role enforcement equivalence is verified across the
shim transition.

## Phase 50.10 — `CapabilityToken` URI-shaped agent IDs

> **Purpose:** P5 changes cap-tokens to embed agent-URIs
> instead of pubKeys. Migration is dual-resolve during a
> deprecation window.

| # | Task | Files |
|---|---|---|
| 50.10.1 | `CapabilityToken.issue` emits the new URI-shaped form (still includes pubKey internally as a fallback verification path). | `packages/core/src/permissions/CapabilityToken.js` |
| 50.10.2 | `TokenRegistry.verify` accepts both shapes during the deprecation window; for new tokens, looks up agents by URI via `agent-registry`. | `packages/core/src/permissions/TokenRegistry.js` |
| 50.10.3 | One-off shim that translates legacy pubKey-tokens to URI-tokens lazily on first use via `agent-registry`. | `packages/core/src/permissions/shim.js` |
| 50.10.4 | Tests: round-trip an issued token; verify legacy pubKey-shaped tokens still verify; deprecation window respected. | `packages/core/test/CapabilityToken.test.js` |

**Estimate:** 1 day.
**Acceptance:** Existing cap-token-issuing flows (Folio
share, Stoop closed-beta cap-tokens) continue to work; new
issuances carry the URI shape.

---

# Part IV — P4 phases (Hub track)

## Phase 50.11 — `TransportManager` mode flag

> **Purpose:** support Hub-delegate mode. The mode is set by
> the bundle-discovery shim at startup (in
> `react-native/hub-discovery`).

| # | Task | Files |
|---|---|---|
| 50.11.1 | Add `transport.setMode('standalone' | 'hub-delegate', config)` API. Standalone is the existing behaviour; hub-delegate accepts an `IHubBinding` instance. | `packages/core/src/transport/TransportManager.js` |
| 50.11.2 | When in hub-delegate mode, all `transport.send` / `transport.subscribe` calls round-trip through the binder. | `packages/core/src/transport/TransportManager.js` |
| 50.11.3 | Tests with a mocked binder; verify send/subscribe parity. | `packages/core/test/TransportManager.hubDelegate.test.js` |

**Estimate:** 1 day.
**Acceptance:** When the Hub is present + bound, the agent's
NKN socket is **not opened** — all traffic flows through the
Hub via AIDL.

## Phase 50.12 — Pseudo-pod hosting AIDL delegation

> **Purpose:** when bound to the Hub, the agent's pseudo-pod
> defers reads + writes to the Hub-hosted device pseudo-pod.

| # | Task | Files |
|---|---|---|
| 50.12.1 | Add `agent.pseudoPod.setHost('hub', binder)` API. | `packages/core/src/Agent.js` |
| 50.12.2 | In hub-host mode, `pseudoPod.read/write/list` round-trip through the binder's `fetchResource / writeResource` methods. | `packages/core/src/Agent.js` |
| 50.12.3 | Tests with a mocked binder. | `packages/core/test/Agent.pseudoPodHubDelegate.test.js` |

**Estimate:** 0.5 day.
**Acceptance:** When the Hub is present, all agent's
pseudo-pod calls route through the Hub-hosted device store;
the in-process pseudo-pod is dormant.

---

# Part V — P6 phases (Hub track, direction)

## Phase 50.13 — Consume `interface-registry` substrate

| # | Task | Files |
|---|---|---|
| 50.13.1 | Add `agent.interfaceRegistry` field exposing the substrate's lookup + register API. | `packages/core/src/Agent.js` |
| 50.13.2 | Bundle manifest declaration: bundles register their types + renderers via the Hub binding (`hub-binding.registerBundle`). | `packages/core/src/Agent.js` |
| 50.13.3 | Tests with mocked substrate. | `packages/core/test/Agent.interfaceRegistry.test.js` |

**Estimate:** 0.5 day.
**Acceptance:** Tasks-bundle can register its `task` type's
compact + full renderers through the agent's binding to the
Hub.

## Phase 50.14 — Consume `protocol` substrate

| # | Task | Files |
|---|---|---|
| 50.14.1 | Add `agent.protocol` field exposing protocol state-machine orchestration. | `packages/core/src/Agent.js` |
| 50.14.2 | Wire the propose-subtask flow (Tasks's canonical first protocol) as the integration test case. | `packages/core/test/Agent.protocol.test.js` |

**Estimate:** 0.5 day.
**Acceptance:** A declared protocol (propose-subtask) runs
end-to-end with state on the pod / pseudo-pod.

## Phase 50.15 — AIDL surface V2 plumbing

| # | Task | Files |
|---|---|---|
| 50.15.1 | Extend `hub-binding` plumbing (in core's transport mode flag) to recognise V2 method additions: `registerInterface`, `orchestrateProtocol`. | `packages/core/src/transport/TransportManager.js` |
| 50.15.2 | Version negotiation: core knows the highest AIDL version it understands; bundles request V2 only when the Hub exposes it. | `packages/core/src/transport/TransportManager.js` |
| 50.15.3 | Tests. | `packages/core/test/TransportManager.aidlV2.test.js` |

**Estimate:** 0.5 day.
**Acceptance:** A V2 Hub + V2-capable agent successfully
negotiate V2 features; V1 agents on V2 Hubs still work.

---

## Phasing summary

| Phase range | Standardisation P-phase | Estimate |
|---|---|---|
| 50.1 – 50.5 | P1 (Hub-free) | ≈7 days |
| 50.6 – 50.7 | P3 (Hub-free) | ≈2 days |
| 50.8 – 50.10 | P5 (Hub-free, breaking-with-shim) | ≈2.5 days |
| 50.11 – 50.12 | P4 (Hub track) | ≈1.5 days |
| 50.13 – 50.15 | P6 (Hub track, direction) | ≈1.5 days |

Total ≈14.5 days of core-side work across the standardisation
arc. The Hub-track phases are direction-only until timing is
committed.

## Acceptance gates per P-phase

- **P1 (50.1–50.5) gate:** all three apps' desktop shells
  continue to start unchanged; new agents created via
  `Bootstrap` register their intent locally (pre-P5
  placeholder); WebID-discovery resolves pointers when
  present; vault writes through to the pod.
- **P3 (50.6–50.7) gate:** pseudo-pod V1 round-trips writes
  via the queue; envelopes emit + receive via the transport
  per the wire shape contract.
- **P5 (50.8–50.10) gate:** all three apps run with the
  agent-registry-backed PolicyEngine; deprecation warnings
  appear at the expected call sites; cap-tokens issue +
  verify in both shapes during the deprecation window.
- **P4 (50.11–50.12) gate:** when the Hub is installed,
  agents detect + delegate transport + pseudo-pod hosting;
  battery + memory profile drops measurably.
- **P6 (50.13–50.15) gate:** Tasks-bundle registers its
  `task` interface through the registry; propose-subtask
  runs as a declared protocol with pod-side state.

## References

- Functional design:
  [`core-v2-functional-design-2026-05-11.md`](core-v2-functional-design-2026-05-11.md).
- Standardisation plan:
  [`../standardisation-plan-restructured-2026-05-10.md`](../standardisation-plan-restructured-2026-05-10.md).
- Transition doc:
  [`../standardisation-transition-2026-05-11.md`](../standardisation-transition-2026-05-11.md)
  — §II covers core changes.
- Substrates functional design:
  [`../Substrates/substrates-v2-functional-design-2026-05-11.md`](../Substrates/substrates-v2-functional-design-2026-05-11.md)
  — the substrate-side counterpart work.
- React-native coding plan companion:
  [`react-native-v2-coding-plan-2026-05-11.md`](react-native-v2-coding-plan-2026-05-11.md).

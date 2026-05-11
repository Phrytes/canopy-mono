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
8. **Strict layering: core MUST NOT import from substrates**
   (locked 2026-05-11). The dependency direction is one-way:
   `apps → substrates → core`. Core exposes opaque slots
   (`Agent.webid`, `Agent.pseudoPod`, etc.) that callers
   populate; core's own internal logic (Bootstrap, identity)
   uses **dependency injection** — substrate objects come in
   as constructor args, never imported. Substrates compose
   onto core in a higher layer (apps, or a facade package).

## Substrate touches (overview)

Substrates spun out of core during V2 work:

| Substrate | Action | Phase |
|---|---|---|
| `@canopy/oidc-session` | NEW — extract Node SolidVault out of `core.storage`; peer of `oidc-session-rn`. | 50.1 |
| `@canopy/vault` | NEW — extract the entire `Vault` family (`Vault`, `VaultMemory`, `VaultLocalStorage`, `VaultIndexedDB`, `VaultNodeFs`, `OAuthVault`) out of `core.identity`. Resolves the SolidVault compat re-export by also moving Vault out of core. Locked 2026-05-11 to fix the layering inversion. | 50.1.A |
| `@canopy/webid-discovery` | NEW — pure-of-platform WebID-profile pointer-walk + cache. **Lives as a substrate** (no core re-export). Apps import directly. | 50.2 |
| `@canopy/agent-registry` | NEW — substrate; **core does NOT import it**. Composition via Agent's opaque slot + dependency injection in higher-layer provisioning. | 50.8 |
| `@canopy/pseudo-pod` | NEW — substrate; same composition story (Agent has an opaque `pseudoPod` slot; the substrate package itself owns the construction). | 50.3 |

After the V2 work, core's residual scope is: Agent + transport
stack + skill registry + security + permissions (cap-tokens) +
Bootstrap (identity-only). Bootstrap takes vault, oidc, and
webid as **injected** args; it never imports those substrates.
The "Bootstrap profile walk" lives outside core (in a facade
package or in apps) so it can import substrates safely.

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

## Phase 50.1.A — Extract `@canopy/vault` substrate

> **Purpose:** the entire `Vault` family (`Vault`, `VaultMemory`,
> `VaultLocalStorage`, `VaultIndexedDB`, `VaultNodeFs`,
> `OAuthVault`) is a data-store primitive that **substrates**
> need (oidc-session, agent-registry, pseudo-pod). Moving it
> out of `core` into a sibling substrate package fixes the
> layering inversion that the Phase 50.1 deprecation re-export
> introduced: with Vault gone from core, the re-export of
> `SolidVault` (which lives in `oidc-session`) is also dropped
> — core has nothing left to re-export from.
>
> Locked 2026-05-11 to enforce the **strict layering**: core
> never imports from substrates.

| # | Task | Files |
|---|---|---|
| 50.1.A.1 | Create `packages/vault/` package with the standard layout. No runtime deps (the Vault family is platform-portable; persistence variants use Node's `fs` or the platform's storage APIs which are runtime-provided). | `packages/vault/**` |
| 50.1.A.2 | Move `Vault.js`, `VaultMemory.js`, `VaultLocalStorage.js`, `VaultIndexedDB.js`, `VaultNodeFs.js`, `OAuthVault.js` (with `makeAuthorizedFetch`) into the new package. | `packages/vault/src/`, `packages/core/src/identity/` (deletions) |
| 50.1.A.3 | Update internal callers inside `packages/core/` to import from `@canopy/vault` — `AgentIdentity`, `Bootstrap`, `IdentityPodStore`, `IdentitySync`, `KeyRotation`, `migrateVaultToPod`. These are core modules that **consume** a vault; that's fine — core's package.json gains a `@canopy/vault` dep, but only because core itself uses Vault internals, **not** because core re-exports a substrate. Conceptually: Vault is a substrate dependency of core (like `@inrupt/solid-client-authn-node`), not a substrate re-export. | `packages/core/src/identity/**` |
| 50.1.A.4 | **Update core's `src/index.js`**: remove the direct vault exports (`Vault`, `VaultMemory`, `OAuthVault`, `makeAuthorizedFetch`, `VaultLocalStorage`, `VaultIndexedDB`, `VaultNodeFs`). Also remove the `SolidVault` deprecation re-export — its purpose was to bridge the Phase 50.1 move, but with Vault itself no longer in core, the re-export no longer makes sense. Callers update their imports to `@canopy/vault` and `@canopy/oidc-session` respectively. | `packages/core/src/index.js` |
| 50.1.A.5 | Update `@canopy/oidc-session` to import `VaultMemory` from `@canopy/vault` in tests (replacing the devDep on `@canopy/core`). Drop the inline `InMemoryTokenStore` if it's no longer needed (or keep as a tiny default; either way). | `packages/oidc-session/test/**`, `packages/oidc-session/package.json` |
| 50.1.A.6 | Update **all callers across the monorepo** that import a Vault class from `@canopy/core` to import from `@canopy/vault` instead. Grep + replace; verify each app's tests. Apps affected: `apps/tasks-v0`, `apps/tasks-mobile`, `apps/stoop`, `apps/stoop-mobile`, `apps/folio`, `apps/folio-mobile`. Substrate consumers: `packages/pod-client` (tests), `packages/agent-ui` if applicable. Each consumer adds `@canopy/vault` to its `dependencies`. | `apps/**`, `packages/**` |
| 50.1.A.7 | Vault tests move with the implementation (or are written fresh against the substrate boundary). | `packages/vault/test/**` |
| 50.1.A.8 | Substrate README + CHANGELOG entry. Document the migration; note that the Vault family is **platform-portable** (Node, browser via IndexedDB / LocalStorage, RN via the storage adapters in `@canopy/react-native`). | `packages/vault/README.md` |

**Estimate:** 1.5 days (the heavy lift is the mechanical
import migration across consumers; the substrate itself is
mostly a file move).

**Acceptance:**
- `@canopy/vault` tests pass.
- `@canopy/core` tests pass with no `Vault*` imports left in
  `src/index.js`.
- All apps continue to start; mnemonic-flows + identity vault
  bring-up still work.
- `import { VaultMemory } from '@canopy/core'` now fails
  (intentional breaking change; callers updated to import from
  `@canopy/vault`).
- The Phase 50.1 `SolidVault` deprecation re-export is **gone**
  from core (callers import from `@canopy/oidc-session`).

## Phase 50.2 — `@canopy/webid-discovery` substrate (substrate only)

> **Purpose:** the WebID-discovery pointer-walk is the same on
> desktop and mobile. Pure-of-platform from day one → lift
> directly to a substrate. **Strict layering: core never
> imports this substrate; the `Agent.webid` slot is opaque.**
>
> Status: shipped 2026-05-11 (commit 1826af4 + revert b7f7389
> that dropped the inadvertent core wrapper). The tasks below
> reflect the as-shipped scope after the wrapper revert.

| # | Task | Files |
|---|---|---|
| 50.2.1 | Create `packages/webid-discovery/` package. No core dep; `fetch` + `read` are injected by callers. | `packages/webid-discovery/**` |
| 50.2.2 | Implement `discoverPointers(webidUri, { fetch })` — fetch the WebID profile, parse `storage-mapping-uri`, `agent-registry-uri`, `audit-log-uri` predicates (Turtle + JSON-LD). Returns `{pointers, raw}`. | `packages/webid-discovery/src/discoverPointers.js` |
| 50.2.3 | Implement `resolvePointers(pointers, { read, onError? })` — for each pointer, fetch the pointed-at resource via the supplied reader (typically the pseudo-pod's `read`). | `packages/webid-discovery/src/resolvePointers.js` |
| 50.2.4 | `WebIdCache` class — in-memory cache + heartbeat refresh + EventEmitter ('refresh', 'error'). | `packages/webid-discovery/src/WebIdCache.js` |
| 50.2.5 | Add **opaque `Agent.webid` slot** (just a property bag; no substrate import in core). Bootstrap populates it later via injection (Phase 50.5); apps populate it directly today. | `packages/core/src/Agent.js` |
| 50.2.6 | Tests: pointer parsing (Turtle + JSON-LD + edge cases), resolution, cache invalidation, heartbeat with fake timers, idempotent start, disappearing-pointer semantics. | `packages/webid-discovery/test/*.test.js` |
| 50.2.7 | Substrate README. | `packages/webid-discovery/README.md` |

**Estimate:** 1.5 days (shipped).
**Acceptance:** `@canopy/webid-discovery` ships as a standalone
substrate. Apps can construct a `WebIdCache` and pass it to
`Agent` via the constructor's `webid` option. Core has **zero
imports from this substrate**; `core/src/index.js` does not
re-export anything from `@canopy/webid-discovery`.

## Phase 50.3 — `Agent.pseudoPod` opaque slot + peer-fetch skill helper

> **Purpose:** core does **not** import the pseudo-pod
> substrate. Core adds an opaque `Agent.pseudoPod` slot the
> caller populates, plus a generic `peer-fetch` skill helper
> that the pseudo-pod substrate can register on the agent
> (skills are core's API — the substrate uses it from above).
> The substrate itself (`@canopy/pseudo-pod`) ships
> separately in the substrates coding plan.

| # | Task | Files |
|---|---|---|
| 50.3.1 | Add an opaque `Agent.pseudoPod` slot (constructor arg + getter). Like `Agent.webid`, just a property bag; no substrate import. | `packages/core/src/Agent.js` |
| 50.3.2 | Add `core.skills.makeFetchResourceSkill({read})` — a factory that returns a skill definition the pseudo-pod substrate (or anyone else) can register on the agent. Core ships the skill **shape**; the substrate ships the storage backing. | `packages/core/src/skills/fetchResource.js` |
| 50.3.3 | Tests: agent accepts a `pseudoPod` constructor arg + exposes the getter; the fetch-resource skill helper registers cleanly + dispatches reads through the supplied `read` callback. | `packages/core/test/Agent.pseudoPod.test.js` |

**Estimate:** 0.5 day (smaller than the original plan since
the substrate-side work moved out).

**Acceptance:**
- `new Agent({ ..., pseudoPod })` exposes `agent.pseudoPod`
  for the caller.
- An app that imports the (forthcoming) `@canopy/pseudo-pod`
  substrate can construct a pseudo-pod, register the
  fetch-resource skill, and pass it to `Agent` — without any
  core import of the substrate.

## Phase 50.4 — VaultMemory pod write-through (moves into `@canopy/vault`)

> **Purpose:** the original 50.4 wired pod write-through into
> `core.identity.VaultMemory`. Under the new layering, the
> `Vault` family lives in `@canopy/vault` (Phase 50.1.A) —
> so the write-through extension belongs in the **vault
> substrate's coding plan**, not core's.
>
> **Status:** moved out of core's plan. See the vault
> substrate's coding plan (forthcoming, part of the
> substrates coding plan effort).

Core's residual responsibility for vault-pod-write-through is
**nil** — `Vault*` classes are no longer in core. The
mnemonic-restore path inside `core.Bootstrap` accepts a
restored vault as an injected arg (see 50.5).

## Phase 50.5 — `core.Bootstrap` stays identity-only; provisioning facade lives outside core

> **Purpose:** the original 50.5 imagined `core.Bootstrap`
> orchestrating OIDC + WebID-discovery + agent-registry.
> Under the new layering, **`Bootstrap` in core can only
> import core**. Cross-substrate provisioning lives in a
> higher-layer facade.

### 50.5.a — Keep `core.Bootstrap` identity-only

| # | Task | Files |
|---|---|---|
| 50.5.a.1 | `Bootstrap.startAgent({ mnemonic | newIdentity, vault, oidc?, webid?, pseudoPod?, agentRegistry? })` — accepts **all substrate-supplied objects as injected args**. Bootstrap composes them onto `Agent` (sets opaque slots) but does not import them. | `packages/core/src/Bootstrap.js` |
| 50.5.a.2 | Branches: if `oidc` is provided + has tokens, the agent is pod-attached; otherwise local-only. Bootstrap calls injected functions (`oidc.login()`, `webid.refresh()`, etc.) but never constructs them. | `packages/core/src/Bootstrap.js` |
| 50.5.a.3 | Mnemonic-restore: Bootstrap reconstitutes the keypair from the seed and asks the injected `vault` to load any encrypted vault blob (the vault knows where to find it; core doesn't). | `packages/core/src/Bootstrap.js` |
| 50.5.a.4 | Tests: Bootstrap-startAgent with mocked vault / oidc / webid / pseudoPod / agentRegistry; verify Agent gets all the right slots populated. | `packages/core/test/Bootstrap.test.js` |

### 50.5.b — New facade package: `@canopy/agent-provisioning`

> Higher-layer "compose all the substrates" function. **Imports
> core + every relevant substrate**; provides a one-call
> `provisionAgent(opts)` for apps that want the canonical flow.
> Apps can use this OR compose substrates themselves.

| # | Task | Files |
|---|---|---|
| 50.5.b.1 | Create `packages/agent-provisioning/` package. Imports: `@canopy/core`, `@canopy/vault`, `@canopy/oidc-session`, `@canopy/webid-discovery`, and (forthcoming) `@canopy/pseudo-pod`, `@canopy/agent-registry`, `@canopy/pod-onboarding`. | `packages/agent-provisioning/**` |
| 50.5.b.2 | Implement `provisionAgent({ mnemonic, oidcProvider?, pseudoPodMode })` → constructs vault, oidc (if pod-having), webid cache, pseudo-pod, agent-registry registration, calls core's `Bootstrap.startAgent` with all of them as injected args. | `packages/agent-provisioning/src/provisionAgent.js` |
| 50.5.b.3 | First-run pod provisioning: when the WebID profile has no `storage-mapping-uri` pointer, kick off `pod-onboarding.provisionDefault`. This composition is in the facade, not in core. | `packages/agent-provisioning/src/firstRun.js` |
| 50.5.b.4 | Tests: full provisioning flow with mocked substrates. | `packages/agent-provisioning/test/**` |
| 50.5.b.5 | Update Tasks V1 desktop + Folio's `bin/folio init` + Stoop V1.5 desktop to use `provisionAgent` from the facade (instead of importing pieces from core). | `apps/**` |

**Estimate:** 1.5 days (50.5.a is mostly editing Bootstrap;
50.5.b is new but bounded since it's just composition glue).

**Acceptance:**
- `core.Bootstrap` has **zero imports** from `@canopy/vault`,
  `@canopy/oidc-session`, `@canopy/webid-discovery`,
  `@canopy/pseudo-pod`, `@canopy/agent-registry`. All come
  in as injected args.
- `@canopy/agent-provisioning` ships; existing apps migrate
  to it as the canonical bring-up path.
- All three apps continue to start unchanged from the user's
  perspective.

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

## Phase 50.8 — `Agent.agentRegistry` opaque slot + Bootstrap injection

> **Purpose:** like `Agent.pseudoPod` (50.3), core adds an
> opaque slot. The `@canopy/agent-registry` substrate itself
> is built in the substrates coding plan; the facade
> (`@canopy/agent-provisioning`, 50.5.b) constructs it and
> hands it to core's `Bootstrap`.

| # | Task | Files |
|---|---|---|
| 50.8.1 | Add `Agent.agentRegistry` opaque slot (constructor arg + getter). | `packages/core/src/Agent.js` |
| 50.8.2 | `core.Bootstrap` accepts the injected `agentRegistry` arg (already covered by 50.5.a.1; this task is the migration: the facade now passes a real registry instead of `null`). | `packages/core/src/Bootstrap.js`, `packages/agent-provisioning/src/provisionAgent.js` |
| 50.8.3 | Tests: Bootstrap-startAgent with mocked agentRegistry; verify slot is populated; first-run registration call fires via the injected substrate. | `packages/core/test/Bootstrap.agentRegistry.test.js` |

**Estimate:** 0.5 day.
**Acceptance:** Bootstrap-started agents (via the facade) get
the agent-registry slot populated; lookup by pubKey returns
the right agent entry. Core has **zero imports** from
`@canopy/agent-registry`.

## Phase 50.9 — `PolicyEngine` accepts injected `actorResolver`

> **Purpose:** the original 50.9 had `PolicyEngine` reading
> from `agent-registry` (a substrate) directly. Under the new
> layering, `PolicyEngine` defines an `ActorResolver`
> **interface** in core; the substrate implements it; the
> caller injects the implementation. Breaking change with
> shim during deprecation window.

| # | Task | Files |
|---|---|---|
| 50.9.1 | Define an `ActorResolver` interface in core: `{ resolve(identifier) → {pubKey, webid, role} \| null }`. Add to `PolicyEngine`'s constructor options. | `packages/core/src/permissions/PolicyEngine.js` |
| 50.9.2 | Shim: legacy `aliases` arg accepted + wrapped into an `ActorResolver` automatically. Logs a deprecation warning. Removed in P5+1. | `packages/core/src/permissions/PolicyEngine.js` |
| 50.9.3 | `@canopy/agent-registry` substrate exports a `makeActorResolver(registry)` factory implementing the interface. (Lives in the substrate, not core.) | `packages/agent-registry/src/makeActorResolver.js` |
| 50.9.4 | Update Tasks-v0's `buildStandardRolePolicy` consumers to construct a resolver via the substrate + pass it to `PolicyEngine`. Stop passing `aliases` once parity confirms. | `apps/tasks-v0/src/rolePolicy.js` |
| 50.9.5 | Tests: verify shim path + injected-resolver path produce equivalent role resolutions; verify deprecation warning. Core's tests use a fake in-memory resolver — no substrate import in core's tests. | `packages/core/test/PolicyEngine.test.js` |

**Estimate:** 1 day.
**Acceptance:** Tasks V1 + Tasks V2 tests pass with the
injected-resolver backend. Core has **no import** from
`@canopy/agent-registry`.

## Phase 50.10 — `CapabilityToken` URI-shaped agent IDs (via injected resolver)

> **Purpose:** P5 changes cap-tokens to embed agent-URIs
> instead of pubKeys. `TokenRegistry`'s verify path uses the
> same `ActorResolver` interface from 50.9 — not a direct
> import of `agent-registry`.

| # | Task | Files |
|---|---|---|
| 50.10.1 | `CapabilityToken.issue` emits the new URI-shaped form (still includes pubKey internally as a fallback verification path). Format-only change; no substrate dep. | `packages/core/src/permissions/CapabilityToken.js` |
| 50.10.2 | `TokenRegistry.verify` accepts both shapes during the deprecation window. For URI-shaped tokens, calls the injected `actorResolver` (same one PolicyEngine uses, 50.9.1) to look up the agent's pubKey. | `packages/core/src/permissions/TokenRegistry.js` |
| 50.10.3 | One-off shim that translates legacy pubKey-tokens to URI-tokens lazily on first use via the resolver. | `packages/core/src/permissions/shim.js` |
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

| Phase range | Standardisation P-phase | Estimate | Notes |
|---|---|---|---|
| 50.1, 50.1.A, 50.2, 50.3, 50.5 | P1 (Hub-free) | ≈6 days | 50.4 moved to the vault substrate's plan; 50.5 split into core-side `Bootstrap` + new `@canopy/agent-provisioning` facade |
| 50.6 – 50.7 | P3 (Hub-free) | ≈2 days | Transport envelope-emit (core-only) + pseudo-pod V1 client (substrate-side, but core may need a write-through queue helper) |
| 50.8 – 50.10 | P5 (Hub-free, breaking-with-shim) | ≈2.5 days | All use injected `ActorResolver` interface — no substrate import in core |
| 50.11 – 50.12 | P4 (Hub track) | ≈1.5 days | Same opaque-slot + injection pattern for Hub-delegate mode |
| 50.13 – 50.15 | P6 (Hub track, direction) | ≈1.5 days | interface-registry + protocol consumption via injection |

Total ≈13.5 days of core-side work across the standardisation
arc. The Hub-track phases are direction-only until timing is
committed.

**The layering invariant (locked 2026-05-11)**: every phase
above respects `apps → substrates → core`. Core never imports
from substrates; substrate composition happens in the facade
(`@canopy/agent-provisioning`, 50.5.b) or in apps directly.

## Acceptance gates per P-phase

- **P1 (50.1, 50.1.A, 50.2, 50.3, 50.5) gate:** all three apps'
  desktop shells continue to start unchanged (via the new
  `@canopy/agent-provisioning` facade); core has zero
  substrate imports; the `Vault*` and `SolidVault` re-exports
  are gone from core; `Agent.webid` / `Agent.pseudoPod` /
  `Agent.agentRegistry` opaque slots populated by the facade.
- **P3 (50.6–50.7) gate:** pseudo-pod V1 round-trips writes
  via the queue (substrate-side); envelopes emit + receive
  via core's transport per the wire shape contract.
- **P5 (50.8–50.10) gate:** all three apps run with the
  injected-`ActorResolver` `PolicyEngine`; deprecation
  warnings appear at the expected call sites; cap-tokens
  issue + verify in both shapes during the deprecation
  window. Core has no `agent-registry` import.
- **P4 (50.11–50.12) gate:** when the Hub is installed,
  agents detect + delegate transport + pseudo-pod hosting via
  injected binders; battery + memory profile drops measurably.
- **P6 (50.13–50.15) gate:** Tasks-bundle registers its
  `task` interface through the registry (substrate-side) via
  the injected handle on `Agent`; propose-subtask runs as a
  declared protocol with pod-side state.

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

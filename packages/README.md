# `packages/` — substrate inventory

The `@canopy` SDK layered as **apps → substrates → core**.
Strict one-way dependency: core never imports substrates;
substrates never import each other except through their explicit
peer deps; apps compose freely.

> See `Project Files/conventions/architectural-layering.md` for the
> formal layering rule. This file is the navigation aid — what each
> package is, which standardisation phase it shipped under, and how
> the pieces fit together.
>
> Last refresh: 2026-05-12 (post-Phase-52.13).

---

## Layering picture

```
  ┌──────────────────────────────────────────────────────────┐
  │ apps/                                                     │
  │   tasks-v0  stoop  folio  *-mobile  household  …          │
  └──────────────────────────────────────────────────────────┘
                ↓ (compose freely; one-way)
  ┌──────────────────────────────────────────────────────────┐
  │ Substrates  (this directory)                              │
  │                                                           │
  │   Storage + Solid:                                        │
  │     pseudo-pod   pod-routing   pod-client                 │
  │     pod-onboarding   pod-search   local-store             │
  │     item-store   item-types   sync-engine(-rn)            │
  │                                                           │
  │   Identity + agents:                                      │
  │     agent-registry   identity-resolver   webid-discovery  │
  │     oidc-session(-rn)   vault                             │
  │                                                           │
  │   Messaging + delivery:                                   │
  │     notify-envelope   notifier   relay                    │
  │     chat-agent   chat-p2p   skill-match   online-cadence  │
  │                                                           │
  │   Future-state (direction-only):                          │
  │     interface-registry   protocol                         │
  │                                                           │
  │   Facade + RN platform:                                   │
  │     agent-provisioning   react-native                     │
  │                                                           │
  │   Cross-cutting:                                          │
  │     llm-client   agent-ui   integration-tests             │
  └──────────────────────────────────────────────────────────┘
                ↓
  ┌──────────────────────────────────────────────────────────┐
  │ @canopy/core                                            │
  │   Agent  Transport  PolicyEngine  CapabilityToken         │
  │   AgentIdentity  ActorResolver(interface)  Skill          │
  │   makeFetchResourceSkill  HubDelegateTransport            │
  └──────────────────────────────────────────────────────────┘
```

---

## Inventory

### Core

| Package | Role |
|---|---|
| `@canopy/core` | Agent, Transport, identity, security, skills, permissions interfaces. Never imports substrates. |

### Storage + Solid

| Package | Role | Phase |
|---|---|---|
| `@canopy/pseudo-pod` | Solid-shaped local store. V0 standalone + replication-ring; V1 cache mode + write-through queue. | 52.2 + 52.8 |
| `@canopy/pod-routing` | Storage-function → URI mapping. Per-write reachability gate for graceful degradation. | 52.3 |
| `@canopy/pod-client` | High-level Solid pod read/write with capability + OIDC auth. V2 hook: optional `pseudoPod` injection routes `pseudo-pod://` URIs locally. | 52.6.3 |
| `@canopy/pod-onboarding` | Provisioning orchestration. `provisionDefault`, `restoreFromMnemonic`, `signOut`. Provider-agnostic via injected `podProvisioner`. | 52.5 |
| `@canopy/item-store` | Item-shaped state with role-policy gates. V2 hooks: lifted DAG helpers + `treeOf` cross-pod embed walk. | 52.6.1 + 52.6.2 |
| `@canopy/item-types` | Cross-app canonical type taxonomy (`task`, `note`, `chat-message`, …). JSON-Schema validator + `validateCanonical` adapter for item-store-shaped items. | 52.1 + 52.7 |
| `@canopy/sync-engine` | Pre-V2 pod-sync. Absorbed by pseudo-pod cache mode in V1 (Phase 52.8 acceptance work; legacy callers still work). | (pre-V2) |
| `@canopy/local-store` | In-memory/disk store used by tasks/household. Pre-V2; pseudo-pod V0 covers the same surface. | (pre-V2) |
| `@canopy/pod-search` | Pod-side search index. Unchanged in V2. | (pre-V2) |

### Identity + agents

| Package | Role | Phase |
|---|---|---|
| `@canopy/vault` | Pluggable secret store (memory, OS keychain, etc.). | (pre-V2) |
| `@canopy/oidc-session` / `-rn` | Solid OIDC session management. Provides the authenticated `fetch` to `pod-client`. | (pre-V2) |
| `@canopy/webid-discovery` | WebID profile pointer walk. `discoverPointers` reads `dec:storage-mapping-uri` etc. off the user's profile. | (pre-V2; ns updated for V2) |
| `@canopy/agent-registry` | Canonical agent list per user. Etag-based optimistic concurrency. Implements core's `ActorResolver` via `makeActorResolver`. V0 store is on the pseudo-pod (pod-side mirroring is cache-mode V1+ work). | 52.10 |
| `@canopy/identity-resolver` | WebID ↔ display-name resolution + member maps + reveals. V2 hook: `createAgentRegistryMemberMap(registry)` adapts an agent-registry into the MemberMap surface. | 52.11 |

### Messaging + delivery

| Package | Role | Phase |
|---|---|---|
| `@canopy/relay` | NKN relay infrastructure. Opaque transport. | unchanged |
| `@canopy/notify-envelope` | Persistent-content writes mediator. Per-write mode picker (envelope-only vs full-payload); pending-pod-upload queue for graceful degradation. Receiver-side `writeFromPeer` integration. | 52.4 |
| `@canopy/notifier` | Scheduler for recurring digests + one-shot nudges. V2 hook: `createEnvelopeBridge` for time-shifted envelope delivery. | 52.9 |
| `@canopy/chat-agent` | Chat-with-LLM helpers + bridge interface. | unchanged |
| `@canopy/chat-p2p` | P2P chat threads. Ephemeral content stays on relay-fan-out. | unchanged |
| `@canopy/skill-match` | Pubsub-of-skills broadcast. Routes via `notifier`. | unchanged surface |
| `@canopy/online-cadence` | Heartbeat / online-status. | unchanged |

### Direction-only (Hub V2 territory)

| Package | Role | Phase |
|---|---|---|
| `@canopy/interface-registry` | Per-type renderer registry. `register({type, bundleId, renderer: {compact, full}})` + lookup + permission-denied fallback. | 52.12 (direction-only) |
| `@canopy/protocol` | State-machine substrate over items. `defineProtocol` + `createProtocolOrchestrator`. Canonical first consumer: `PROPOSE_SUBTASK`. | 52.13 (direction-only) |

### Facade + RN platform

| Package | Role | Phase |
|---|---|---|
| `@canopy/agent-provisioning` | One-call agent bring-up facade. Composes core + vault + oidc-session + webid-discovery; optional pseudo-pod + agent-registry slots. | 50.5.b |
| `@canopy/react-native` | RN platform layer + adapters. V2 additions: `pseudo-pod-adapter` (FsBackend + AsBackend + size-routing composite + persistent dirty-set), `hub-discovery`, `hub-binding` (AIDL surface + JS-side wrappers, native modules direction-only). | 51.1–51.10 |

### Cross-cutting

| Package | Role |
|---|---|
| `@canopy/llm-client` | LLM API client. Unchanged. |
| `@canopy/agent-ui` | Desktop UI primitives (`mountLocalUi`, status widgets). Unchanged. |
| `@canopy/integration-tests` | Cross-component scenario tests including the substrates-v2 end-to-end pipeline. |

---

## Composition reference

Common substrate compositions, in canonical order. Each composition
is **dependency-injected** — substrates never reach across the
strict layering boundary themselves.

### Provisioning a fresh agent (pod-having)

```js
import { provisionDefault }          from '@canopy/pod-onboarding';
import { createPseudoPod, createMemoryBackend } from '@canopy/pseudo-pod';
import { createAgentRegistry, makeActorResolver } from '@canopy/agent-registry';
import { createPodRouting }          from '@canopy/pod-routing';
import { PolicyEngine }              from '@canopy/core';

const pseudoPod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId });
const provision = await provisionDefault({
  mnemonic,
  pseudoPod,
  podProvisioner,        // app-supplied (Inrupt / CSS / mock)
  agentInfo: { deviceId, agentUri, displayName },
});
const podRouting = createPodRouting({ pseudoPod, deviceId, anchorPodUri: provision.podUri });
await podRouting.reload();

const registry = createAgentRegistry({ pseudoPod, deviceId, anchorPodUri: provision.podUri });
const policy   = new PolicyEngine({ /* … */ actorResolver: makeActorResolver(registry) });
// `policy.resolveActor(pubKey | webid | agentUri)` now bridges identifier shapes.
```

### Cache-mode pseudo-pod (offline-tolerant write-through)

```js
const cachePod = createPseudoPod({
  backend,
  mode:          'cache',
  deviceId,
  podFetcher:    (uri) => podClient.read(uri),
  podUploader:   (uri, bytes, etag) => podClient.write(uri, bytes, { ifMatch: etag }),
  isPodReachable: (uri) => podRouting.isPodReachable(uri),
});
// Online: writes upload via uploader, pod etag wins.
// Offline: writes queue. On reconnect:
await cachePod.drainWriteThroughQueue({
  onSuccess: async ({uri, result}) => notifyEnvelope.republishEnvelopeOnly(...),
});
```

### Notify-envelope + receiver-side cache

```js
const ne = createNotifyEnvelope({ transport: agent.transport, pseudoPod, podRouting, uploadFn });
ne.start();   // hooks transport.subscribeEnvelopes — auto-writeFromPeer on full-payload
ne.subscribe({ kind: 'task', callback: async (env) => {
  const item = await pseudoPod.read(env.ref);    // already locally cached for full-payload
  app.render(item);
}});
```

### RN-platform storage backend

```js
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createBackend } from '@canopy/react-native/pseudo-pod-adapter';

const backend = createBackend({
  AsyncStorage, FileSystem,
  rootDir:          `${FileSystem.documentDirectory}pseudo-pod/`,
  scope:            'tasks-app',
  fsThresholdBytes: 4096,
});
const pod = createPseudoPod({ backend, mode: 'cache', deviceId, podFetcher, podUploader });
```

### Hub-binding (when the Hub-Android service ships)

```js
import { NativeModules } from 'react-native';
import { createHubDiscovery } from '@canopy/react-native/hub-discovery';
import { bind }               from '@canopy/react-native/hub-binding';

const hd = createHubDiscovery({ nativeModule: NativeModules.HubDiscovery });
const { hubInstalled } = await hd.check();
if (hubInstalled) {
  const binding = await bind({
    nativeModule:   NativeModules.HubBinding,
    manifest:       { bundleId: 'tasks-bundle', supportedTypes: ['task'] },
    clientVersions: [1, 2],
  });
  // binding.fetchResource / writeResource / publishEnvelope / onIncomingEnvelope / close
}
```

---

## What ships where: standardisation plan ↔ packages

| Phase | Packages touched |
|---|---|
| **50.x** (core) | `@canopy/core` ActorResolver / HubDelegateTransport / opaque slots / `agent-provisioning` facade |
| **51.1–51.4** | `@canopy/react-native/pseudo-pod-adapter` |
| **51.5** | persistent dirty-set in `pseudo-pod-adapter` |
| **51.6–51.10** | `@canopy/react-native/hub-discovery` + `/hub-binding` + AIDL surface |
| **52.1** | `@canopy/item-types` (taxonomy + validator) |
| **52.2** | `@canopy/pseudo-pod` V0 |
| **52.3** | `@canopy/pod-routing` |
| **52.4** | `@canopy/notify-envelope` |
| **52.5** | `@canopy/pod-onboarding` |
| **52.6** | `@canopy/item-store` + `@canopy/pod-client` extensions |
| **52.7** | per-app `item-types` adoption (Tasks ✓, Stoop ✓, Folio N/A) |
| **52.8** | `@canopy/pseudo-pod` V1 cache mode |
| **52.9** | `@canopy/notifier` envelope bridge |
| **52.10** | `@canopy/agent-registry` |
| **52.11** | `@canopy/identity-resolver` agent-registry adapter; Tasks `actorResolver` opt |
| **52.12** | `@canopy/interface-registry` (direction-only) |
| **52.13** | `@canopy/protocol` (direction-only) |

The companion plans live under `Project Files/`:

- `Project Files/standardisation-plan-restructured-2026-05-10.md`
- `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`
- `Project Files/Substrates/substrates-v2-functional-design-2026-05-11.md`
- `Project Files/SDK/core-v2-coding-plan-2026-05-11.md`
- `Project Files/SDK/react-native-v2-coding-plan-2026-05-11.md`

---

## Strict layering — the four mechanisms

Core defines the **shape** of capabilities it consumes from
substrates but never imports them. Apps + the
`@canopy/agent-provisioning` facade wire substrates into core via
one of four mechanisms (locked 2026-05-11):

1. **Opaque slots on Agent** — `webid`, `pseudoPod`, `agentRegistry`,
   `interfaceRegistry`, `protocol`. Substrate-shaped objects the
   Agent carries but doesn't call directly.
2. **Interface contracts** — typedef-only files in core
   (`ActorResolver.js`, `StorageBackend.js`). Substrates implement
   the shape; core consumers receive instances via DI.
3. **Skill-shape factories** — core exports `makeFetchResourceSkill`
   etc.; substrates supply the storage-backing callback. The skill
   wire-contract lives in core, the data lives in the substrate.
4. **Duck-typed binding methods** — Agent methods like
   `bindToHub(binder)` take any object exposing the documented
   contract (`publishEnvelope`, `subscribeEnvelopes`, etc.). The
   substrate implements the contract; core doesn't import the
   substrate.

See `Project Files/conventions/architectural-layering.md` for the
formal version + the rationale per mechanism.

---

## Open follow-up work

JS-side substrate V2 work is complete. Remaining items are app-side
integration, native Android, or major new projects:

- **App adoption** — Stoop `postRequest` shorthand → canonical-type
  vocab mapping. Tasks-mobile `actorResolver` wiring at boot.
  Stoop `groupMirror` retirement (2-week dual-runtime per plan).
- **Native Android** — `HubDiscoveryModule.kt` + `HubBindingModule.kt`
  implementations alongside Hub-Android's own Android build pipeline.
- **Hub-Android service** — new project; consumes the AIDL surface
  this directory ships under `react-native/android/aidl/`.
- **Folio frontmatter validation** — wires `item-types.note` schema
  into a markdown frontmatter pipeline (Folio doesn't have one yet).

---

## Smoke test

`@canopy/integration-tests/test/scenarios/substrates-v2/substrate-pipeline.scenario.test.js`
exercises the full pipeline end-to-end. Run it on any change that
touches multiple substrates — it catches the duck-typed-interface
mismatches that per-piece unit tests miss.

```sh
cd packages/integration-tests
npm test test/scenarios/substrates-v2
```

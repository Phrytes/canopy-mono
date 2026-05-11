# @canopy/pod-onboarding

Pod-provisioning orchestration for the Decentralised-Web-Agent (DWA)
stack — one-tap "create my pod" + mnemonic-restore on a new device.

The substrate owns the **orchestration logic + defaults**; real
Solid-server interactions (OIDC, PUT, ACP, WebID patch) ride on an
**injected `podProvisioner`**. This keeps server-specific glue
(Inrupt, Community Solid Server, …) out of the substrate.

> Standardisation Phase **52.5**. See
> `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`
> and the functional design §4.2.

---

## What it does

```js
import { createPodOnboarding } from '@canopy/pod-onboarding';
import { generateMnemonic }    from '@canopy/core';

const onboarding = createPodOnboarding({
  pseudoPod,
  podProvisioner,          // ← provider-specific; see contract below
  oidcSession,             // optional
  webidCache,              // optional
  deviceId:    'laptop-anne',
});

const mnemonic = generateMnemonic();
const { podUri, webidUri, pointers, identity } = await onboarding.provisionDefault({
  oidcProvider: 'https://inrupt.net',
  mnemonic,
  agentInfo: {
    deviceId:    'laptop-anne',
    agentUri:    'agent://anne/laptop',
    displayName: 'Anne',
  },
});
```

After `provisionDefault` completes:

- The pod has `/private/`, `/sharing/`, `/sharing/public/` containers
  with their default ACPs applied.
- `<pod>/private/storage-mapping` holds the seeded pod-routing config.
- `<pod>/private/agent-registry` lists this device's agent entry.
- A local mirror of both resources lives on the pseudo-pod
  (so no-pod or offline reads keep working).
- The user's WebID profile carries the canonical pointer predicates
  (`solid:storage`, `dec:storage-mapping-uri`, `dec:agent-registry-uri`,
  `dec:audit-log-uri`).

---

## Operations

### `provisionDefault({ oidcProvider, mnemonic | identity, pseudoPod, podProvisioner, agentInfo })`

Performs the seven-step provisioning flow (functional design §4.2.3):

1. Reconstitute the agent identity (BIP-39 → HKDF seed).
2. `podProvisioner.createPod()` — create the pod + run OIDC.
3. `createContainer()` × 3 (private / sharing / sharing-public).
4. `setAcp()` × 3 with `defaultAcpTemplates({agentWebid})`.
5. `putResource()` × 2 — storage-mapping + agent-registry.
6. Mirror both resources on the local pseudo-pod.
7. `patchWebidProfile()` — stamp the pointer predicates.

Returns `{podUri, webidUri, pointers, storageMapping,
agentRegistryEntry, acpTemplates, identity, mnemonic?}`.

### `restoreFromMnemonic({ mnemonic, webidCache?, pseudoPod?, deviceId?, podProvisioner?, oidcSession? })`

Re-attach an existing agent on a new device:

1. Reconstitute the identity from the mnemonic (deterministic; same
   pubkey as the original).
2. Walk the WebID profile via the supplied `webidCache` to find pod
   pointers.
3. Fetch `storage-mapping` + `agent-registry` from the pod (via
   `podProvisioner.getResource`) when a provisioner + OIDC are wired;
   fall back to the local pseudo-pod replica when the pod is offline
   or unreachable.

Returns `{identity, vault, webidUri, pointers, storageMapping,
agentRegistry}`.

### `signOut({ oidcSession?, pseudoPod?, deviceId?, keepLocalData = true })`

Clears the OIDC session. When `keepLocalData: false`, also wipes
device-local data under `pseudo-pod://<deviceId>/` — peer-cached
resources from other devices stay put.

### `upgradeToTwoPods(...)`

**V0 stub** — throws `NOT_IMPLEMENTED`. The full design (move
`sharing/*` to a second pod, with ref rewriting + migration plan) is
open per functional design §4.3.6; pinned during P5.

---

## Provisioner contract

The substrate stays oblivious to Solid-server specifics by routing
all server-side work through a provisioner you supply.

```ts
podProvisioner = {
  // REQUIRED. Runs OIDC + creates a fresh pod.
  createPod({ oidcProvider, identity, agentInfo })
    → Promise<{ podUri: string, webidUri: string, fetch: AuthedFetch }>,

  // REQUIRED for restoreFromMnemonic + pod-side reads.
  getResource({ uri, fetch })
    → Promise<{ body, contentType, etag? } | null>,

  // REQUIRED. Pod-side resource writes.
  putResource({ uri, body, contentType, fetch })
    → Promise<{ etag? }>,

  // Optional. Container creation (some servers auto-create on PUT).
  createContainer({ uri, fetch }) → Promise<void>,

  // Optional. Translate the substrate's ACP template to the server's wire format.
  setAcp({ uri, acp, fetch }) → Promise<void>,

  // Optional. Add the pointer predicates to the user's WebID profile.
  patchWebidProfile({ webidUri, pointers, predicates, fetch }) → Promise<void>,
}
```

V0 ships **no built-in provisioner** — apps wire their own
(Inrupt-SDK-based for Inrupt pods; CSS-specific for self-hosted CSS;
test mocks for unit tests). Real implementations land alongside the
`@canopy/pod-client` extensions in Phase 52.6.

---

## ACP templates

The substrate ships **inert** JSON-LD-shaped ACP templates. They
describe the policies — your provisioner is responsible for
serializing them to the Solid-server's preferred wire format
(Turtle for ACP resources is standard).

```js
import { defaultAcpTemplates, MODES } from '@canopy/pod-onboarding';

const t = defaultAcpTemplates({ agentWebid: 'https://anne.pod/profile#me' });
// t.private        — agent-locked
// t.sharing        — default-deny, owner-write
// t.sharingPublic  — world-readable, owner-write
```

---

## Initial resource builders

```js
import {
  buildInitialStorageMapping,
  buildInitialAgentRegistry,
  buildWebidPointers,
  pointerPredicates,
} from '@canopy/pod-onboarding';
```

These are pure-data helpers exposed so consumer code (apps,
provisioners) can use them outside the orchestration flow — e.g.
to re-write the storage-mapping when adding a second pod.

---

## API

```text
createPodOnboarding({ pseudoPod?, podProvisioner?, oidcSession?, webidCache?, deviceId? })

onboarding.provisionDefault(opts)
onboarding.restoreFromMnemonic(opts)
onboarding.signOut(opts)
onboarding.upgradeToTwoPods()     // throws NOT_IMPLEMENTED in V0
onboarding.defaultAcpTemplates({agentWebid})

// Free functions (same signatures).
provisionDefault(opts)
restoreFromMnemonic(opts)
signOut(opts)
upgradeToTwoPods()                // throws NOT_IMPLEMENTED in V0

// Pure-data helpers.
defaultAcpTemplates({agentWebid})
privateAcp({agentWebid})
sharingAcp({agentWebid})
sharingPublicAcp({agentWebid})
buildInitialStorageMapping({podUri, deviceId})
buildInitialAgentRegistry({agentInfo, podUri})
buildWebidPointers({podUri})
pointerPredicates()
```

---

## What V0 deliberately does not do

- **Run real Solid-server calls.** The substrate is provider-agnostic;
  apps wire a real `podProvisioner` (Inrupt / CSS / test mock).
- **Migrate `sharing/*` between pods.** `upgradeToTwoPods` is a stub.
  Ref-rewriting + migration semantics are P5 work (functional design
  §4.3.6).
- **Validate ACP templates against the target server.** The templates
  are shaped for ACP-the-spec; server quirks are the provisioner's
  problem.
- **Manage OIDC session refresh.** That's `@canopy/oidc-session`'s
  job; the onboarding substrate just calls `logout()` on sign-out.
- **Track audit-log resources.** Pointer predicate is written
  (`dec:audit-log-uri`) but no consumer / writer exists yet.

---

## Files

```
packages/pod-onboarding/
├── index.js
├── src/
│   ├── PodOnboarding.js       — createPodOnboarding facade
│   ├── provisionDefault.js
│   ├── restoreFromMnemonic.js
│   ├── signOut.js
│   ├── upgradeToTwoPods.js    — V0 stub
│   ├── acpTemplates.js        — pure-data ACPs
│   └── initialResources.js    — storage-mapping / agent-registry / WebID pointer builders
└── test/                       — 42 tests
```

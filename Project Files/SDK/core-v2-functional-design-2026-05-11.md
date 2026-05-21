# Core V2 — Functional design (2026-05-11)

> What `packages/core` does for callers, post-standardisation.
> Describes the state after the Hub-free interim path ships
> (P0–P3 + non-Hub portion of P5 of the
> [standardisation plan](../standardisation-plan-restructured-2026-05-10.md)).
> Companion: [`../Substrates/substrates-v2-functional-design-2026-05-11.md`](../Substrates/substrates-v2-functional-design-2026-05-11.md)
> covers the substrate layer that sits on top of core.
>
> V1 baseline is the current `packages/core` —
> `core.Agent`, `VaultMemory`, `TransportManager`, skill registry,
> `PolicyEngine`, `CapabilityToken` + `TokenRegistry`, single-agent
> topology (V2.8), `InternalTransport`. V2 inherits that surface
> unless this doc overrides it.

## 1. Pitch

`packages/core` is the **agent foundation**: one
`core.Agent` per process, owning keypair identity, transport
stack, skill registry, role policy, cap-token issuance, and
in-process state. V2 keeps everything V1 did and adds three
things:

- **Dual-auth pod writes.** The agent's keypair signs content
  (audit precision); WebID OIDC authorizes the pod (Solid
  semantics).
- **WebID-discovery + pod-resource pointer walk.** On agent
  start, the agent reads pointers from the user's WebID
  profile and follows each to the canonical config resource
  (storage-mapping, agent-registry, audit-log) via the
  pseudo-pod.
- **Two new runtime modes** that the agent picks up at
  startup: standalone (Hub-absent, today's behaviour) vs
  Hub-delegate (Hub-Android present; transport + pseudo-pod
  hosting deferred to the Hub via AIDL). Standalone is the
  only mode during the Hub-free interim.

V2 also has two breaking changes deferred to P5 with shims:
cap-token URI-shaped agent IDs and `PolicyEngine` actor
resolution swapping to the new `agent-registry` substrate.

## 2. Scope locks

These are decided 2026-05-11 and shape the rest of the doc:

1. **Single-agent topology unchanged.** One `core.Agent` per
   process, per-crew `CrewState`. V2.8's invariant carries
   forward.
2. **Keypair stays load-bearing.** Every agent has its own
   keypair. Pod writes carry both the keypair signature
   (audit) and the WebID OIDC authorization (pod). No "the
   Hub holds master tokens" — each device authenticates
   independently.
3. **OIDC integration is optional.** For pod-having users,
   core wires an OIDC session alongside the keypair. For
   no-pod users (§II.2 policy 4), core runs without OIDC —
   the keypair alone suffices, content lives on the
   pseudo-pod replication ring.
4. **Standalone mode is the only mode pre-P4.** Hub-delegate
   mode (transport + pseudo-pod hosting via AIDL) ships in
   P4. Through P0–P3 + non-Hub-P5, every agent runs its own
   transport stack + its own pseudo-pod.
5. **Cap-tokens stay useful, less central.** WebID OIDC +
   per-agent signatures handle the auth layer for pod writes;
   cap-tokens scope skill calls between agents (bot → user
   agent). P5 changes the token signature shape; no semantic
   change.
6. **No iOS-specific code.** Per the main project lock.
7. **Substrate-first applies inside core too.** When core
   logic becomes pure-of-platform with a stable jsdoc + tests,
   it lifts to a substrate. The V2 work itself surfaces a few
   candidates: `webid-discovery`, `oidc-session` (extracted
   peer of `oidc-session-rn`).

## 3. What stays in core

- `core.Agent` — process-level agent instance; one per
  process.
- `VaultMemory` — keypair store. Extended in V2 (see §5).
- `TransportManager` — NKN + BLE + mDNS transport stack.
  Extended in V2 with a mode flag.
- Skill registry + `defineSkill` API.
- `PolicyEngine` — role-policy enforcement. Extended in V2
  (see §5).
- `CapabilityToken` + `TokenRegistry`. Cap-token issuance +
  verification; signature shape changes in P5.
- `InternalTransport` — in-process routing. Unchanged.
- `MemorySource`, `DataPart`, `FileSystemSource` — core
  source types. Unchanged.
- Single-agent topology (V2.8) — one Agent per process,
  per-crew `CrewState`. Unchanged.
- `AgentIdentity` — agent keypair shape, `stableId` for
  cross-rotation identity.
- `Bootstrap` — mnemonic-driven identity bring-up. Extended
  in V2 to walk the WebID profile (when applicable).

## 4. What core gains in V2

Three additive responsibilities, all on top of V1:

### 4a. OIDC integration alongside the keypair (pod-having users)

The agent holds a WebID OIDC session in addition to its
keypair. The session uses `@canopy/oidc-session` (extracted
peer of `oidc-session-rn` during P1) on desktop / Node, and
the RN equivalent on mobile.

```
agent
├── keypair (VaultMemory)
├── oidc-session (when pod-attached)
│   ├── refresh token
│   ├── access token (short-lived)
│   └── WebID provider hostname
└── transport stack
```

Refresh-token lifecycle is the agent's responsibility;
tokens persist in `VaultMemory` alongside the keypair. On pod
writes, the substrate (`pseudo-pod` → `pod-client`) consults
both: OIDC authorises the pod, keypair signs the content.

For no-pod users the OIDC session is absent; everything else
behaves identically.

### 4b. WebID-discovery on connect (pod-having users)

New module: `core.identity.webid`. On agent start (when
pod-attached), reads the user's WebID profile to learn
pointers:

- `storage-mapping-uri` → fetch the storage-mapping pod
  resource via the pseudo-pod (consumed by `pod-routing`).
- `agent-registry-uri` → fetch the agent-registry pod
  resource (consumed by `agent-registry` substrate).
- `audit-log-uri` → fetch the audit-log pod resource (for
  the Hub web-console; mostly unused pre-Hub).

The WebID profile itself stays small — pointers, not fat
state. Heavy state lives at the dedicated pod resources.

Caching: the pointer set + the resolved resources cache in
memory per-`Agent`; refresh on a small heartbeat (default 60s)
and on explicit `webid.refresh()`. Mnemonic-restore walks the
WebID profile fresh.

For no-pod users this module is a no-op; the agent reads its
local pseudo-pod config replica directly.

### 4c. Agent-registry registration on first run

The agent registers itself in the user's agent-registry on
first run via the `agent-registry` substrate (P5). The
substrate writes a pod resource for pod-having users
(`<anchor-pod>/private/agent-registry`); for no-pod users it
writes into the pseudo-pod replication ring across the user's
own devices. Etag-based optimistic concurrency handles
multi-writer collisions (multiple apps may write in the
Hub-free interim — design pass during P5 makes sure this
works without a single coordinator).

Each entry carries:

```
{
  agentId: "<URI-shaped agent ID>",
  pubKey:  "<base64 ed25519 pubkey>",
  webid:   "<the user's WebID>" | null,
  role:    "human" | "device" | "bot",
  name:    "<display name>",
  deviceId: "<deviceId for this install>",
  capabilities: {
    pollIntervalMs: <number>,
    onlineWindow: {...},
    allowHopThrough: <bool>,
    ...
  },
  signedAt: "<ISO timestamp>",
  revoked:  null | "<ISO timestamp>"
}
```

The `capabilities` field is what the Hub aggregates in P4 to
compute device-wide scheduling.

## 5. What core extends in V2

Targeted extensions to existing core surface:

### 5a. `TransportManager` mode flag (P4+)

Today's `TransportManager` owns its own NKN socket. Under P4
it gains a mode flag:

- `'standalone'` — current behaviour. Owns its own socket;
  BLE / mDNS scanners run in-process. Only mode pre-P4.
- `'hub-delegate'` — defers to the Hub-Android via AIDL.
  Internally, all `transport.send()` / `transport.subscribe()`
  calls round-trip through the AIDL binder; the Hub holds
  the actual socket.

Mode is set by the bundle-discovery shim at startup (when the
Hub is detected); everything inside `core` downstream of
`TransportManager` stays the same.

Standalone mode is the **only** mode during the Hub-free
interim path. Hub-delegate mode ships in P4.

### 5b. `VaultMemory` writes through to pod (P1)

`VaultMemory` today stores the keypair locally encrypted.
V2 extends:

- Stores OIDC refresh tokens alongside the keypair (when
  pod-having).
- When the `private/identity-vault` storage function maps to
  a pod URI (default policy for pod-having users routes it
  there), `VaultMemory` writes the encrypted blob through to
  the pod via `pod-client`. Recovery (mnemonic restore)
  walks the pod-side blob.

For no-pod users, the vault lives in the local pseudo-pod and
replicates across the user's own devices via the
pseudo-pod-replicated mode; restore is local-only.

### 5c. `PolicyEngine` actor-resolution swap (P5, breaking with shim)

Today's `PolicyEngine` resolves `pubKey ↔ webid ↔ role` via a
static alias table passed in by the caller (the Tasks-v0
`actorAliases` field on `CrewState`).

P5 swaps the backend to consume `agent-registry`. The engine
becomes a thin wrapper that reads the canonical pod resource
via the pseudo-pod, rather than relying on a per-call alias
arg. Shim: `aliases` arg accepted but ignored after P5; logs
a deprecation warning; removed in P5+1.

### 5d. `CapabilityToken` URI-shaped agent IDs (P5, breaking with shim)

Today's cap-tokens embed pubKey identifiers. P5 changes them
to carry agent-URIs (for pod-having agents: URI rooted at the
WebID's host; for no-pod agents: `pseudo-pod://<deviceId>/...`).

Migration: tokens issued before the migration remain valid; a
one-off shim translates pubKey → agent-URI using the
agent-registry. Verification accepts both shapes during the
deprecation window.

### 5e. `Bootstrap` walks the WebID profile (P1)

`Bootstrap` today provisions identity + Solid pod credentials
from a mnemonic. V2 extends:

- After OIDC succeeds, walks the WebID profile to discover
  pointers (storage-mapping, agent-registry, audit-log).
- Registers the new agent into the agent-registry.
- If the WebID profile has no pointers (fresh provisioning),
  `Bootstrap` writes them.

For no-pod users, `Bootstrap` provisions the local pseudo-pod
+ writes config locally without OIDC.

## 6. What core sheds eventually

Two responsibilities move out of core, both deferred to P4–P6
so the interim path doesn't disturb existing code:

- **Transport-socket ownership** (when bound to a Hub) — via
  the `TransportManager` mode flag (§5a). Standalone mode
  stays for the Hub-absent case.
- **Pseudo-pod hosting** (when bound to a Hub) — core's
  `pseudo-pod` skill defers reads to the Hub via AIDL. The
  in-process pseudo-pod skill stays as the fallback when
  the Hub is absent.

Both extensions are additive — apps detect at runtime which
mode they're in.

## 6a. User journeys

End-user actions traced through core. Where a journey
involves substrates above core, the substrate doc covers the
later half of the trace; this section stops at the core
boundary.

### Journey 1 — First-time agent bring-up (pod-having)

1. Anne installs an app (any of Tasks / Stoop / Folio /
   the Hub).
2. App calls `Bootstrap.startAgent({mnemonic | newIdentity,
   oidcProvider, vaultMode: 'pod-attached'})`.
3. `Bootstrap` walks the OIDC flow against the provider →
   provisions the pod if new → writes `<pod>/private/...`
   sub-containers → writes the `storage-mapping-uri` +
   `agent-registry-uri` pointers on the WebID profile.
4. `core.identity.webid` resolves the pointers + fetches the
   resources via the pseudo-pod (initially empty for a
   fresh user; pre-existing resources for a returning user
   on a new device).
5. `VaultMemory` stores the keypair encrypted locally and
   write-throughs the encrypted blob to
   `<pod>/private/identity-vault`.
6. The agent registers itself in the agent-registry
   resource via the `agent-registry` substrate.
7. Agent is ready; app continues with `wireSkills` etc.

Wall-clock target on a warm network: under 20 seconds end-
to-end including OIDC redirect.

### Journey 2 — First-time agent bring-up (no-pod)

1. Anne installs an app and picks "skip pod setup" /
   joins a no-pod crew.
2. App calls `Bootstrap.startAgent({mnemonic, oidcProvider:
   null, vaultMode: 'local-only'})`.
3. `Bootstrap` skips OIDC. `VaultMemory` stores the keypair
   encrypted locally.
4. The agent registers itself in the local pseudo-pod's
   agent-registry replica (no pod resource yet; the
   replication ring will distribute it when the crew has
   peers online).
5. Pseudo-pod operates in `standalone` mode initially; flips
   to `replication-ring` when the user joins a no-pod crew.

### Journey 3 — Mnemonic-restore on a new device

1. Anne's laptop dies; she installs the app on a fresh
   laptop.
2. App calls `Bootstrap.startAgent({mnemonic: '<12 words>',
   oidcProvider: 'inferred from WebID profile'})`.
3. `Bootstrap` reconstitutes the keypair from the seed.
4. For pod-having users: WebID lookup → OIDC against the
   user's provider → walks pointers → fetches
   `<pod>/private/identity-vault` → decrypts with seed →
   reconstructs the vault. For no-pod users: vault lives
   in the pseudo-pod replication ring; new device fetches
   from a peer's pseudo-pod on first peer contact.
5. `agent-registry.register` adds the new device's agent
   entry (the old laptop's entry stays — Anne revokes it
   separately via the web console).
6. App is back where it was.

### Journey 4 — Bot added from the web console

1. Anne opens the Hub-web-console and declares a new bot
   (name, scope `['sendChatMessage', 'subscribeChat']`).
2. The console mints an OIDC token for the bot agent +
   issues a cap-token via `CapabilityToken.issue` scoping
   the bot's skill calls.
3. Anne pastes the OIDC token + cap-token into the bot's
   config + starts the bot process.
4. Bot calls `Bootstrap.startAgent` with the supplied OIDC
   token + a `role: 'bot'` flag.
5. `Bootstrap` registers the bot agent in the agent-registry
   resource (pod or pseudo-pod ring); `revoked: null`.
6. Bot is online; can call user's skills using the cap-token.

### Journey 5 — Revoking a lost-device agent

1. Anne loses her phone.
2. From the Hub-web-console (or another of her devices),
   she calls `agentRegistry.revoke(missingAgentUri)`.
3. The substrate writes the registry resource with
   `revoked: '<timestamp>'` for that entry, signed by
   another of Anne's agents.
4. `PolicyEngine` on every other agent reads the updated
   registry on its next heartbeat refresh; signed-by-
   missing-agent items are no longer accepted.
5. (When the Hub V1 is in place) the Hub stops aggregating
   the missing phone's capability declarations.

### Journey 6 — Bot calls a skill on Anne's agent

1. Bot has a cap-token issued by Anne's user agent
   (issued during journey 4).
2. Bot calls `botAgent.callSkill({target: anneAgentUri,
   skill: 'sendChatMessage', args, capToken})`.
3. Anne's agent receives the call via the transport stack.
4. `PolicyEngine` verifies the cap-token: looks up the bot
   in agent-registry → fetches its pubKey → verifies the
   token's signature was over `(forAgent: anneAgentUri,
   scope, expiresAt)` using Anne's keypair (Anne issued
   it) → confirms `skill` is in `scope`.
5. Skill executes; result returned via transport.

### Journey 7 — Hub installed mid-life

1. Anne's app has been running standalone for a month.
2. Anne installs the Hub-Android from Play Store.
3. On the app's next launch, `hub-discovery.check()` returns
   `{hubInstalled: true, hubVersion: 1}`.
4. App calls `hub-binding.bind` → AIDL binder returned.
5. App switches `TransportManager` to `hub-delegate` mode
   and `pseudo-pod.setHost('hub', binder)`.
6. From this point on, the app's transport + pseudo-pod
   reads round-trip through the Hub-Android. Battery draw
   drops; one foreground-service slot on the device
   instead of one per app.

### Journey 8 — Two apps register concurrently on the same device

1. Anne has Tasks-mobile + Stoop-mobile installed; both
   launch on first run after device install.
2. Tasks-mobile's `Bootstrap` registers its agent →
   `agent-registry.register` reads etag E0 → writes →
   success → etag E1.
3. Stoop-mobile's `Bootstrap` (concurrent) reads etag E0
   (still cached) → writes → 412 Precondition Failed.
4. Substrate retries with bounded backoff: reads etag E1
   (now fresh) → adds its entry → writes → success →
   etag E2.
5. Both agents now in the registry. (Multi-writer-without-
   Hub concurrency works without a coordinator — see plan
   §III.C risk on multi-writer concurrency.)

## 7. Consumer patterns

How apps use core post-V2. Five representative patterns.

### Pattern 1: Pod-having user, agent start

```js
const agent = await Bootstrap.startAgent({
  mnemonic,
  oidcProvider: 'https://inrupt.net',
  vaultMode: 'pod-attached', // or 'local-only'
});

// At this point:
// - agent.identity has the keypair
// - agent.oidc has the WebID OIDC session
// - agent.webid.pointers has storage-mapping-uri, etc.
// - agent.webid.storageMapping has the resolved config
// - agent.webid.agentRegistry has the resolved entries
// - VaultMemory wrote refresh tokens locally + the encrypted
//   blob to <pod>/private/identity-vault

await app.wireSkills({agent, ...});
```

### Pattern 2: No-pod user, agent start

```js
const agent = await Bootstrap.startAgent({
  mnemonic,
  oidcProvider: null,            // no OIDC
  vaultMode: 'local-only',
});

// At this point:
// - agent.identity has the keypair
// - agent.oidc is null
// - agent.pseudoPod is in standalone mode (no upstream pod)
//   or replication-ring mode (if joining a no-pod crew)
// - VaultMemory stored the keypair locally only

await app.wireSkills({agent, ...});
```

### Pattern 3: Pod write (any caller)

App calls `substrate.writeItem({type: 'task', ...})`. Inside
the substrate, the write goes through `notify-envelope`,
which picks the mode per crew policy. For pod-having crews:

1. `pseudo-pod` writes the resource to the local cache.
2. `pseudo-pod` queues a write-through to the real pod via
   `pod-client`.
3. `pod-client` calls `agent.oidc.fetch(uri, ...)` with the
   OIDC bearer token attached.
4. The resource carries an agent-signature in its metadata
   (via `agent.identity.sign(...)`).
5. `notify-envelope` emits the envelope via
   `agent.transport.send(...)`.

For no-pod crews: same call from app code; the substrate
fan-outs full payload via `agent.transport.send(...)`
eagerly to every crew member; recipients write to their
pseudo-pod's replication-ring store.

### Pattern 4: Skill call between agents (cap-token scoped)

A bot wants to call a skill on the user's agent. The user
issues a cap-token scoping the bot to specific skills:

```js
const token = agent.permissions.issueToken({
  forAgent: botAgentUri,
  scope: ['sendChatMessage', 'subscribeChat'],
  expiresAt: '...',
});
// token.signature is over (forAgent, scope, expiresAt) using
// agent.identity (the user's keypair)
```

The bot uses the token when calling `user.skill(...)`:

```js
await botAgent.callSkill({
  target: userAgentUri,
  skill: 'sendChatMessage',
  args: {...},
  capToken: token,
});
```

User's agent verifies the token via `TokenRegistry` + the
agent-registry (to look up the bot's pubKey for signature
verification).

### Pattern 5: Bundle detects Hub on launch (P4+)

```js
const hubInfo = await hubDiscovery.check();
// hubInfo = { hubInstalled: bool, hubVersion?: string }

if (hubInfo.hubInstalled) {
  const binding = await hubBinding.bind({hubInfo, agent});
  agent.transport.setMode('hub-delegate', {binder: binding});
  agent.pseudoPod.setHost('hub', {binder: binding});
} else {
  // standalone — today's behaviour
}
```

`hub-discovery` + `hub-binding` live in
`@canopy/react-native` (mobile) or are no-ops on desktop.
Pre-P4 the check returns `{hubInstalled: false}` always.

## 8. Public API surface

Top-level exports from `@canopy/core`:

```
// Identity
Agent
AgentIdentity
VaultMemory
Bootstrap
validateMnemonic
PodCapabilityToken
SolidOidcAuth    // node-side OIDC; mobile uses oidc-session-rn

// Transport
TransportManager
InternalTransport

// Skills
defineSkill

// Permissions
PolicyEngine
CapabilityToken
TokenRegistry

// Sources
MemorySource
DataPart
FileSystemSource
VaultNodeFs

// Identity discovery (new in V2)
core.identity.webid             // pointer-walk + cache
core.identity.discoverPointers  // one-shot WebID-discovery
```

## 9. Wire format / on-pod shape

Core itself doesn't define on-pod resources directly — those
are the substrate layer's job. But core consumes two:

- **WebID profile pointers.** Predicates on the user's WebID
  profile RDF: `storage-mapping-uri`, `agent-registry-uri`,
  `audit-log-uri`. Each is a URI string. Pre-V2 these
  predicates don't exist; V2 writes them during `Bootstrap`.
- **Encrypted vault blob.** `<pod>/private/identity-vault`
  (for pod-having users). Format: encrypted JSON containing
  the keypair + refresh tokens. Encryption key derives from
  the mnemonic.

The agent-registry shape is documented in the substrates doc
(`agent-registry` section); core consumes it via the
substrate.

## 10. Open questions

- **Webid-discovery cache invalidation.** A user changes
  storage-mapping on one device; how fast should other
  devices see the change? Default proposed: 60s heartbeat +
  on-demand `webid.refresh()` after a config-change event.
  Pin during P1.
> fine
- **OIDC token refresh under heavy load.** Multiple
  concurrent writes to the pod while the refresh token is
  expiring. Today's `oidc-session-rn` queues; need parity in
  `oidc-session` (desktop). Pin during P1.
> whatever you think is best/most useful
- **VaultMemory pod write-through failure modes.** What if
  the pod is unreachable for an hour? Local writes queue.
  Conflict resolution if the user modifies the vault from
  two devices? Pin during P1.
> yes, conflict resolution is vital (we have already build something for that in the substrates!)
- **Cap-token URI shape edge cases.** Tokens issued by a
  no-pod agent (which has a `pseudo-pod://` URI rather than
  a WebID-rooted URI) and presented to a pod-having agent:
  does the pod-having side accept? Default proposed: yes,
  with a note in the audit log. Pin during P5.
> yes

## 11. Non-goals

- **iOS-specific code paths.**
- **Real-time collaboration primitives** (CRDTs etc.) —
  substrate or app layer, not core.
- **Database adapter abstractions beyond `MemorySource` /
  `FileSystemSource`** — substrate layer.
- **HTTP server primitives** — apps that need an HTTP server
  (e.g. Folio's `bin/folio serve`) use Express directly;
  core stays a library.
- **GUI primitives** — `@canopy/agent-ui` /
  `@canopy/react-native` own the UI layer.

## 12. Phases

Core work aligns with the standardisation plan's §III.A. The
[transition doc](../standardisation-transition-2026-05-11.md)
§II.5 has the per-phase table:

| Phase | Core work | Compatibility |
|---|---|---|
| P0 | none directly | non-breaking |
| P1 | WebID-discovery module; OIDC session alongside keypair (mobile via `oidc-session-rn`, desktop via extracted `oidc-session`); pseudo-pod-V0 client wiring; `VaultMemory` pod write-through; `Bootstrap` profile walk | additive |
| P2 | none — taxonomy in `item-types`, consumed by apps | non-breaking |
| P3 | pseudo-pod-V1 write-through-queue client; `TransportManager` envelope-emit path | additive |
| P5 | `agent-registry` consumption; `PolicyEngine` swap; cap-token URI shift | breaking, with shim |
| P4 (Hub) | `TransportManager` `hub-delegate` mode; pseudo-pod hosting via AIDL | additive (runtime detect) |
| P6 (Hub) | core consumes `interface-registry` + `protocol` substrates; AIDL surface plumbing | additive |

## 13. References

- Standardization plan:
  [`../standardisation-plan-restructured-2026-05-10.md`](../standardisation-plan-restructured-2026-05-10.md).
- Transition doc:
  [`../standardisation-transition-2026-05-11.md`](../standardisation-transition-2026-05-11.md)
  — §II covers core changes.
- Substrates companion:
  [`../Substrates/substrates-v2-functional-design-2026-05-11.md`](../Substrates/substrates-v2-functional-design-2026-05-11.md).
- Current core implementation:
  [`packages/core/`](../../packages/core/).
- OIDC mobile substrate:
  [`packages/oidc-session-rn/`](../../packages/oidc-session-rn/).
- Layering convention:
  [`../conventions/architectural-layering.md`](../conventions/architectural-layering.md).
- Single-agent convention:
  [`../conventions/single-agent.md`](../conventions/single-agent.md).

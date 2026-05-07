# Slim Agent — refactor proposal

**Status:** design.  No code changes yet.
**Supersedes:** `ARCHITECTURE-REVIEW.md` §5 (high-level sketch).
**Goal:** drop `Agent.js` from 1219 LoC to ~350 LoC by extracting
every optional feature as a standalone `attach*` module — without
changing the wire protocol, breaking apps, or losing test coverage.

This doc has three parts:

1. **Inventory** — every method/getter on `Agent` today, classified.
2. **Extension mechanics** — three patterns extensions can use, with
   worked examples drawn from the existing code.
3. **Proposed split** — concrete end-state file layout and a
   step-by-step migration order, each step independently shippable.

---

## 1. Inventory

`packages/core/src/Agent.js` (1219 lines) currently exposes:

| Member | Kind | Disposition | Notes |
|---|---|---|---|
| **— Lifecycle / composition (slim core) —** | | | |
| `constructor({ … })` | method | **stay** | Composition root.  Drop unused `policyEngine` / `trustRegistry` / `tokenRegistry` from the explicit param list once we have an `agent.extensions` registry; injection still possible via `extensions.set('policy', engine)`. |
| `start()` | method | **stay** | Connects every transport in `#transports`.  Re-entry already guarded by `#started`. |
| `stop()` | method | **stay** | Symmetric of `start`.  Calls cleanup hooks; needs to call `extensions.values().forEach(ext => ext.stop?.())` once we have the registry. |
| `_dispatch(envelope)` | method | **stay** | Inbound envelope router. The Group-FF `_rotationMigrated` mirror also fires here — that's a built-in safety hook, not an extension. |
| `_asCallCtx()` | method | **stay** | Internal helper; tiny. |
| **— Public state getters (stay) —** | | | |
| `address`, `pubKey`, `label`, `identity` | getters | **stay** | Identity / addressing surface. |
| `security`, `skills`, `stateManager` | getters | **stay** | Direct accessors to slim-core dependencies. |
| `transport`, `peers`, `storage`, `config`, `routing` | getters | **stay** | Injected dependencies; getters keep the public access pattern. |
| `policyEngine`, `trustRegistry`, `tokenRegistry` | getters | **stay (move to `extensions`)** | These will likely become `agent.extensions.get('policy')` etc., with the getters as deprecated shims for one release. |
| `maxTaskTtl`, `pubSubHistory` | getters | **stay** | Config knobs. |
| **— Transport mux (stay) —** | | | |
| `addTransport(name, t)` | method | **stay** | Used by every secondary-transport setup (relay, BLE, mDNS, rendezvous). |
| `removeTransport(name)` | method | **stay** | Symmetric. |
| `getTransport(name)` | method | **stay** | Public lookup. |
| `transportNames` | getter | **stay** | Public list. |
| **— Skill + peer registry (stay) —** | | | |
| `register(id, handler, opts)` | method | **stay** | The core "I expose a skill" call. |
| `addPeer(address, pubKeyB64)` | method | **stay** | Manual peer-key registration; low-level primitive. |
| `forget(pubKeyOrAddress)` | method | **stay** | Drop a peer from `SecurityLayer` + `PeerGraph`.  Counterpart to `addPeer`. |
| **— Routing primitives (stay) —** | | | |
| `transportFor(peerId, opts)` | method | **stay** | Used by `taskExchange` and any code that needs a `Transport` instance. |
| `routeFor(peerId, opts)` | method | **stay** | Group-EE addition; both name + transport for failure reporting. |
| **— Direct RPC (stay) —** | | | |
| `hello(peerAddress, timeout)` | method | **stay** | The handshake. |
| `call(peerId, skillId, input, opts)` | method | **stay** | Returns `Task`. |
| `invoke(peerId, skillId, input, opts)` | method | **stay** | Returns `Promise<Parts[]>`.  Thin wrapper over `call`. |
| **— Hop RPC (extract as free functions, keep method shims) —** | | | |
| `invokeWithHop(peerId, skillId, input, opts)` | method | **method shim** | Free function `invokeWithHop(agent, …)` exists already in `routing/`.  Method becomes a 1-line shim — keeps `agent.invokeWithHop(…)` working for ergonomics. |
| `callWithHop(peerId, skillId, input, opts)` | method | **method shim** | Same, free function `callWithHop(agent, …)` exists. |
| **— Identity rotation —** | | | |
| `rotateIdentity({ gracePeriodSeconds, broadcast })` | method | **stay (for now)** | Touches multiple Agent internals (`#identity`, `#security`, `#peers`).  Could later move to `attachIdentityRotation` + free function `rotateIdentity(agent, opts)`; for now leave it on Agent. |
| **— Optional features → extract as `attach*` —** | | | |
| `enableRelayForward(opts)` | method | **`attachRelayForward(agent, opts)`** | `skills/relayForward.js` already exposes `registerRelayForward(agent, opts)` — absorb the policy-set + idempotency guard there. |
| `enableTunnelForward(opts)` | method | **`attachTunnelForward(agent, opts)`** | New file `skills/tunnel.js` (or extend `skills/tunnelOpen.js`).  Calls `registerTunnelOpen` + `registerTunnelOw`. |
| `enableSealedForwardFor(groupId, opts)` | method | **`attachSealedForward(agent, groupId, opts)`** | Owns a `SealedForwardManager` registered under `agent.extensions.get('sealedForward')`. |
| `disableSealedForwardFor(groupId)` | method | **manager method** | Becomes `agent.extensions.get('sealedForward').remove(groupId)`. |
| `getSealedForwardConfig(groupId)` | method | **manager method** | Becomes `agent.extensions.get('sealedForward').getConfig(groupId)`. |
| `enableReachabilityOracle(opts)` | method | **`attachReachabilityOracle(agent, opts)`** | Already a pure wrapper — easiest extraction (start here). |
| `enableRendezvous(opts)` | method | **`attachRendezvous(agent, opts)`** | Returns the `RendezvousTransport` instance for follow-up wiring. |
| `upgradeToRendezvous(peerPubKey, timeout)` | method | **manager method** | `agent.extensions.get('rendezvous').upgrade(peerPubKey, timeout)`. |
| `isRendezvousActive(peerPubKey)` | method | **manager method** | Same: `agent.extensions.get('rendezvous').isActive(peerPubKey)`. |
| `setHelloGate(fn)` / `helloGate` getter | method/getter | **`setHelloGate(agent, fn)`** | Tiny; just a closure-stored function.  Can use a WeakMap keyed by agent to keep state out of Agent's class. |
| `startDiscovery(opts)` / `discovery` getter | method/getter | **`attachDiscovery(agent, opts)`** | Returns the `PeerDiscovery` instance.  Holds `#discovery`. |
| `enableAutoHello(opts)` + `#bindAutoHello` | method | **`attachAutoHello(agent, opts)`** | Holds `#autoHelloBound`, `#autoHelloedMacs` — both go into the closure. |
| **— Higher-level conveniences (consider extracting) —** | | | |
| `message(peerId, parts)` | method | **stay (low-cost wrapper)** | One line; `transport.sendOneWay`.  Keep on Agent for ergonomics. |
| `introduce(peerId, card)` | method | **stay** | Same shape; one line. |
| `publish(topic, parts)` | method | **stay (lazy import)** | Imports `protocol/pubSub.js` dynamically — already mostly external. |
| `clearPubSubHistory(topic)` | method | **stay** | Tiny. |
| `discoverSkills(peerId, timeout)` | method | **stay (lazy import)** | One-line wrapper. |
| **— A2A interop (extract together) —** | | | |
| `discoverA2A(url, opts)` | method | **`attachA2A(agent, opts)`** + lookup | A2A is a self-contained subsystem; group with the others. |
| `issueA2ACapabilityToken(opts)` | method | **`attachA2A` controller method** | Same. |
| `storeA2AToken(peerUrl, token)` | method | **`attachA2A` controller method** | Same. |
| `issueCapabilityToken(opts)` | method | **stay** | Native token issuance — small, no extra state. |
| **— Export —** | | | |
| `export(opts)` | method | **stay** | Card export is intrinsic to the agent's identity. |

**Net target:** the slim Agent retains ~30 methods/getters, mostly
small.  Roughly half are getters or 1-liners.

---

## 2. Extension mechanics

Three concrete patterns, listed by complexity.  Pick the simplest one
that fits.

### Pattern A — closure-only (no shared state)

For features whose state lives entirely inside the
function (a few WeakSets, one or two Maps).  Simplest possible
extension.

**Worked example: `attachAutoHello`.**

Today:

```js
// Agent.js (current)
#autoHelloOpts   = null;
#autoHelloBound  = new WeakSet();
#autoHelloedMacs = new Set();

enableAutoHello(opts = {}) {
  this.#autoHelloOpts = opts;
  for (const t of this.#transports.values()) this.#bindAutoHello(t);
  return this;
}

#bindAutoHello(transport) {
  if (this.#autoHelloBound.has(transport)) return;
  this.#autoHelloBound.add(transport);
  transport.on('peer-discovered', (addr) => {
    if (addr.includes(':')) {        // BLE MAC
      if (this.#autoHelloedMacs.has(addr)) return;
      this.#autoHelloedMacs.add(addr);
      transport.sendHello?.(addr).catch(() => {});
    } else {
      if (this.security.getPeerKey(addr)) return;   // already hello'd
      this.hello(addr).catch(() => {});
      if (this.#autoHelloOpts.pullPeers) pullPeerList(this, addr).catch(() => {});
    }
  });
}
```

Extracted:

```js
// protocol/autoHello.js
import { pullPeerList } from '../discovery/pullPeerList.js';

export function attachAutoHello(agent, opts = {}) {
  const bound        = new WeakSet();
  const helloedMacs  = new Set();

  const bindOne = (transport) => {
    if (bound.has(transport)) return;
    bound.add(transport);
    transport.on('peer-discovered', (addr) => {
      if (addr.includes(':')) {
        if (helloedMacs.has(addr)) return;
        helloedMacs.add(addr);
        transport.sendHello?.(addr).catch(() => {});
      } else {
        if (agent.security.getPeerKey(addr)) return;
        agent.hello(addr).catch(() => {});
        if (opts.pullPeers) pullPeerList(agent, addr).catch(() => {});
      }
    });
  };

  for (const name of agent.transportNames) bindOne(agent.getTransport(name));

  // Re-bind on later addTransport(): the slim Agent emits 'transport-added'
  // exactly for this purpose.  (Today's Agent doesn't; we'll add it as part
  // of the slim refactor.)
  agent.on('transport-added', ({ transport }) => bindOne(transport));

  // No return value needed; everything lives in this closure.
}
```

Notes:
- The closure captures `bound`, `helloedMacs`, `opts`.  No state on the
  Agent class.
- Touches only public Agent surface (`agent.security`, `agent.hello`,
  `agent.transportNames`, `agent.getTransport`, `agent.on`).
- Rebinding on new transports requires Agent to emit `transport-added`
  on `addTransport`.  That's a one-line change worth making once for
  every closure-style extension.

### Pattern B — closure with controller object (state queried by other code)

For features whose state must be queryable by callers other than
the extension itself.  Sealed-forward is the canonical example —
`callWithHop` needs to ask "is sealed-forward enabled for group X?"
without knowing the extension exists.

**Worked example: `attachSealedForward`.**

```js
// security/sealedForward.js
class SealedForwardManager {
  #configs = new Map();      // groupId → { enabled, ...opts }

  add(groupId, opts = {})  { this.#configs.set(groupId, { enabled: true, ...opts }); }
  remove(groupId)          { this.#configs.delete(groupId); }
  getConfig(groupId)       { return this.#configs.get(groupId) ?? null; }
  isEnabled(groupId)       { return !!this.#configs.get(groupId)?.enabled; }
}

export function attachSealedForward(agent, groupId, opts = {}) {
  let mgr = agent.extensions.get('sealedForward');
  if (!mgr) {
    mgr = new SealedForwardManager();
    agent.extensions.set('sealedForward', mgr);
  }
  mgr.add(groupId, opts);
  return mgr;
}
```

Caller side (`routing/callWithHop.js`):

```js
// before:
const groupCfg = opts.group ? agent.getSealedForwardConfig?.(opts.group) ?? null : null;

// after:
const sealedMgr = agent.extensions.get('sealedForward');
const groupCfg  = opts.group ? sealedMgr?.getConfig(opts.group) ?? null : null;
```

The `agent.extensions` registry is a `Map<string, controller>`.  It's
*the only* state the Agent class needs to add for the refactor.  Anyone
implementing an extension picks a key and stuffs whatever they want
under it.  Conventional keys: `'sealedForward'`, `'rendezvous'`,
`'discovery'`, `'autoHello'`, `'a2a'`, `'policy'`, `'trust'`,
`'tokens'`.

### Pattern C — free function (no installation, called per-use)

For one-shot operations that don't need any agent-side state at all.
The hop-routing functions are like this — every `invokeWithHop` call
is independent; nothing is "installed."

**Worked example: `invokeWithHop`.**

```js
// routing/invokeWithHop.js  — already exists as a free function
export function invokeWithHop(agent, peerId, skillId, parts, opts = {}) {
  // … reads agent.peers, agent.invoke, agent.routing, agent.identity …
}

// Agent.js  — keep a 1-line shim for ergonomic continuity
invokeWithHop(peerId, skillId, input = [], opts = {}) {
  return invokeWithHop(this, peerId, skillId, Parts.wrap(input), opts);
}
```

The shim is optional but cheap (one line) and lets existing app code
keep using `agent.invokeWithHop(…)` without changes.  Free-function
form is canonical; method form is sugar.

---

## 3. Proposed split

### 3.1 `agent.extensions` registry — the one Agent change

Add three lines to Agent.js:

```js
#extensions = new Map();
get extensions() { return this.#extensions; }
```

…and one event in `addTransport`:

```js
addTransport(name, transport) {
  this.#transports.set(name, transport);
  if (this.#routing?.addTransport) this.#routing.addTransport(name, transport);
  if (this.#started) {
    transport.useSecurityLayer(this.#security);
    transport.setReceiveHandler(env => this._dispatch(env));
    transport.connect().catch(err => this.emit('error', err));
  }
  this.emit('transport-added', { name, transport });   // ← new
}
```

Plus an extension lifecycle hook in `stop()`:

```js
async stop() {
  // … existing transport teardown …
  for (const ext of this.#extensions.values()) {
    if (typeof ext.stop === 'function') {
      try { await ext.stop(); } catch (err) { this.emit('error', err); }
    }
  }
  this.#extensions.clear();
}
```

That's the entire Agent-side change.  Everything else is moves +
renames in the extension files.

### 3.2 New file layout

```
packages/core/src/
  Agent.js                  ~350 LoC  (down from 1219)
  protocol/
    autoHello.js            new        attachAutoHello(agent, opts)
    keyRotation.js          existing   handleKeyRotationOW (no change)
  discovery/
    Discovery.js            new        attachDiscovery(agent, opts)
    PeerDiscovery.js        existing   (now consumed only by Discovery.js)
  skills/
    relayForward.js         existing   + attachRelayForward(agent, opts)
    tunnel.js               new        attachTunnelForward(agent, opts)
    capabilities.js         existing   (no change)
    reachablePeers.js       existing   + attachReachabilityOracle(agent, opts)
  security/
    sealedForward.js        existing   + SealedForwardManager + attachSealedForward
    helloGates.js           existing   + setHelloGate(agent, fn) (WeakMap-backed)
  transport/
    rendezvous.js           new        attachRendezvous(agent, opts) → RendezvousManager
    RendezvousTransport.js  existing   (no change)
  a2a/
    a2a.js                  new        attachA2A(agent, opts) → A2AController
  routing/
    invokeWithHop.js        existing   (no change)
    callWithHop.js          existing   reads agent.extensions.get('sealedForward')
    hopBridges.js           existing   (no change)
    hopTunnel.js            existing   (no change)
    hopOneShot.js           existing   (no change)
  MeshAgent.js              new        ~40 LoC opinionated subclass
```

### 3.3 `MeshAgent.js` as the named bundle

For users who want "the standard mesh feature set" — what
`createMeshAgent` (the RN factory) wires up today:

```js
// packages/core/src/MeshAgent.js
import { Agent } from './Agent.js';
import { attachAutoHello }          from './protocol/autoHello.js';
import { attachDiscovery }          from './discovery/Discovery.js';
import { attachRelayForward }       from './skills/relayForward.js';
import { attachTunnelForward }      from './skills/tunnel.js';
import { attachReachabilityOracle } from './skills/reachablePeers.js';

export class MeshAgent extends Agent {
  constructor(opts) {
    super(opts);
    attachAutoHello         (this, { pullPeers: true });
    attachDiscovery         (this, { gossipIntervalMs: 60_000 });
    attachRelayForward      (this, { policy: 'authenticated' });
    attachTunnelForward     (this, { policy: 'authenticated' });
    attachReachabilityOracle(this);
  }
}
```

`createMeshAgent` (RN factory) becomes a thin transport-wiring helper
that ends with `new MeshAgent({ … })`.

### 3.4 Public API delta (slim Agent)

```js
// Slim Agent — methods removed from the class but still callable as
// before via deprecation shims (one release of warnings, then drop):
agent.enableRelayForward        → attachRelayForward(agent, …)
agent.enableTunnelForward       → attachTunnelForward(agent, …)
agent.enableSealedForwardFor    → attachSealedForward(agent, group, …)
agent.disableSealedForwardFor   → agent.extensions.get('sealedForward').remove(group)
agent.getSealedForwardConfig    → agent.extensions.get('sealedForward').getConfig(group)
agent.enableReachabilityOracle  → attachReachabilityOracle(agent, …)
agent.enableRendezvous          → attachRendezvous(agent, …)
agent.upgradeToRendezvous       → agent.extensions.get('rendezvous').upgrade(…)
agent.isRendezvousActive        → agent.extensions.get('rendezvous').isActive(…)
agent.setHelloGate              → setHelloGate(agent, fn)
agent.helloGate                 → getHelloGate(agent)
agent.startDiscovery            → attachDiscovery(agent, …)
agent.discovery                 → agent.extensions.get('discovery')
agent.enableAutoHello           → attachAutoHello(agent, …)
agent.discoverA2A               → attachA2A(agent).discover(url, …)
agent.issueA2ACapabilityToken   → attachA2A(agent).issueToken(…)
agent.storeA2AToken             → attachA2A(agent).storeToken(…)
```

Methods that **stay** unchanged:
`hello`, `call`, `invoke`, `invokeWithHop`, `callWithHop`,
`rotateIdentity`, `register`, `addPeer`, `forget`, `addTransport`,
`removeTransport`, `getTransport`, `transportFor`, `routeFor`,
`message`, `introduce`, `publish`, `clearPubSubHistory`,
`discoverSkills`, `issueCapabilityToken`, `export`, `start`, `stop`.

---

## 4. Migration order

Each step is one PR, runs against the existing test suite, can be
reverted in isolation.

1. **Add `agent.extensions` registry + `transport-added` event +
   `stop()` cleanup hook.**  Three small additions to `Agent.js`.  No
   behavior change.  Lets all later steps land cleanly.

2. **`attachReachabilityOracle`** — currently a 4-line wrapper around
   `registerReachablePeersSkill`.  Extract verbatim, deprecate the
   Agent method, update mesh-demo to use the new entry.  Proves the
   pattern with the lowest risk.

3. **`attachRelayForward`** — same pattern as #2, also small.

4. **`attachTunnelForward` + `attachSealedForward` together.**  These
   two interact: `callWithHop` reads `agent.getSealedForwardConfig`,
   which we replace with `agent.extensions.get('sealedForward')…`.  Do
   them in one PR to avoid a half-migrated state.

5. **`attachAutoHello`** — needs the `transport-added` event from
   step 1.  All state moves into the closure.

6. **`attachDiscovery`** — wraps `PeerDiscovery`, returns it as the
   controller.  Replaces `agent.startDiscovery` + the `agent.discovery`
   getter.

7. **`attachRendezvous`** — extract the upgrade-pin / downgrade-clear
   listener wiring.  Returns a `RendezvousManager` with `upgrade`,
   `isActive`, `disconnect` methods.  Drops `enableRendezvous`,
   `upgradeToRendezvous`, `isRendezvousActive` from Agent.

8. **`setHelloGate(agent, fn)`** — tiny; WeakMap-backed.

9. **`attachA2A`** — bundles `discoverA2A`, `issueA2ACapabilityToken`,
   `storeA2AToken` into a single controller object.

10. **Introduce `MeshAgent`** — opinionated subclass, used by
    `createMeshAgent`.  Update `apps/mesh-demo/src/agent.js` to use
    `MeshAgent` instead of the ad-hoc `enable*` chain.

11. **Delete deprecated method shims** after one release.

After step 10, `Agent.js` should be ~350 LoC.  Each `attach*` module
sits at 30–150 LoC.

---

## 5. Decisions to surface

These shape the result; worth deciding before step 1.

1. **Keep method shims for one release, or hard-break?** Soft path is
   strictly safer; hard break gets to a clean Agent immediately.
   Recommended: soft.

2. **`MeshAgent` location — core or react-native?** It's pure JS so
   `core` works.  But it embeds opinionated defaults (`pullPeers:
   true`, 60s gossip) that match RN ergonomics, not Node.  Both work;
   I'd put it in `core` and let `createMeshAgent` (RN) wrap it.

3. **`agent.extensions` exposed as `Map` directly, or a typed wrapper?**
   `Map` is dead simple.  A typed wrapper (e.g. `agent.ext('sealedForward')`)
   would let TypeScript users get autocomplete on extension names but
   adds plumbing.  Recommended: plain `Map`.

4. **A2A bundle — extract or leave?** A2A is a separate protocol with
   its own surface.  Extracting `attachA2A(agent)` keeps it conceptually
   separable.  Leaving the four methods on Agent is also fine since
   they're already lazy-imported.  Recommended: extract — it makes the
   "core agent vs. external-protocol bridge" line visible.

5. **Should `rotateIdentity` be extracted in this refactor?**  Just
   shipped (FF/FF+1), touches `vault`/`security`/`peers`, but is
   self-contained.  Could move to `attachIdentityRotation` for symmetry,
   but the savings are small (~50 LoC) and the code is fresh.
   Recommended: leave it on Agent for now; revisit if a third
   identity-management feature appears.

6. **Order of bundled `attach*` calls in `MeshAgent` — does it matter?**
   Currently no.  Each extension is independent and accesses
   `agent.transportNames` / `agent.peers` etc.  If two extensions ever
   compete over the same skill name we'd add dependency declarations,
   but not yet.

---

## 6. What this does NOT change

- **Wire protocol.** Same envelopes, same skills, same handshake.
- **Behavior.** Every test must keep passing.
- **Existing code paths.** A user who never calls an `enableXxx`
  method (or its `attach*` replacement) gets the same flat-RPC agent
  they have today.
- **Tree-shake-ability of features users don't use.** That's a *gain*,
  not a constraint — a browser demo that only needs `Agent` + one
  transport pulls in nothing else.

---

## 7. Reference: extensions table

For quick scanning during implementation.

| Extension | File | Pattern | Returns | Owns state |
|---|---|---|---|---|
| `attachAutoHello` | `protocol/autoHello.js` | A (closure) | void | `bound` WeakSet, `helloedMacs` Set |
| `attachDiscovery` | `discovery/Discovery.js` | B (controller) | `PeerDiscovery` | `peers`, `gossip`, `pings` |
| `attachRelayForward` | `skills/relayForward.js` | A | void | none beyond skill registration |
| `attachTunnelForward` | `skills/tunnel.js` | A | void | none |
| `attachSealedForward` | `security/sealedForward.js` | B | `SealedForwardManager` | `configs` Map<group, opts> |
| `attachReachabilityOracle` | `skills/reachablePeers.js` | A | void | none |
| `attachRendezvous` | `transport/rendezvous.js` | B | `RendezvousManager` | rdv transport reference |
| `setHelloGate` | `security/helloGates.js` | A (WeakMap) | void | gate fn (per agent) |
| `attachA2A` | `a2a/a2a.js` | B | `A2AController` | a2a transport reference, token store |
| `invokeWithHop`, `callWithHop` | `routing/invokeWithHop.js` | C (free fn) | per-call | none |

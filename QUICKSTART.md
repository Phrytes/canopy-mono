# Quickstart

Build a working agent in ~20 lines.  This page is for evaluating the
shape of the API; once you're past the smoke test, see
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for the bigger picture.

---

## 1. Two agents, one process — no network setup

Smallest possible thing that's still a real round-trip.  Two agents
share an in-process bus and call each other's skills.  No relay, no
sockets — just `Agent` + `InternalTransport`.

```js
// quickstart-pair.js
import {
  Agent, AgentIdentity, VaultMemory,
  InternalBus, InternalTransport,
  TextPart, Parts,
} from '@canopy/core';

const bus = new InternalBus();

async function makeAgent(label) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({
    identity:  id,
    transport: new InternalTransport(bus, id.pubKey, { identity: id }),
    label,
  });
  await agent.start();
  return agent;
}

const alice = await makeAgent('alice');
const bob   = await makeAgent('bob');

// Bob exposes a skill.
bob.register('greet', async ({ parts, from }) => {
  const name = Parts.text(parts) ?? 'stranger';
  return [TextPart(`Hello, ${name}! (you are ${from.slice(0, 8)}…)`)];
}, { visibility: 'public' });

// Alice introduces herself, then calls Bob's skill.
await alice.hello(bob.address);
const reply = await alice.invoke(bob.address, 'greet', [TextPart('the author')]);
console.log(Parts.text(reply));    // → "Hello, the author! (you are …)"
```

Run with `node quickstart-pair.js` after `npm install
@canopy/core` (or via the file-link in this monorepo).

What just happened:
- Each agent generated an Ed25519 keypair (stored in memory).
- `hello()` did a signed handshake; afterwards both `SecurityLayer`s
  hold each other's pubkey.
- `invoke()` encrypted + signed the call, ran Bob's skill, returned
  the parts.

---

## 2. Standalone agent talking to a relay

For two agents in different processes (or browser ↔ Node), use a
relay.  The relay is a dumb broker — it forwards `nacl.box`-encrypted
envelopes; it can't read them.

```bash
# terminal 1
node packages/relay/src/server.js          # listens on :8787 by default
```

```js
// my-agent.js
import {
  Agent, AgentIdentity, VaultNodeFs,
  RelayTransport,
  TextPart, Parts,
} from '@canopy/core';

const vault    = new VaultNodeFs({ path: './my-agent.vault' });
let identity;
try   { identity = await AgentIdentity.restore(vault); }
catch { identity = await AgentIdentity.generate(vault); }

const transport = new RelayTransport({
  identity,
  relayUrl: 'ws://localhost:8787',
});

const agent = new Agent({ identity, transport, label: 'my-app' });

agent.register('greet', async ({ parts, from }) => {
  return [TextPart(`Hello, ${Parts.text(parts) ?? 'stranger'}!`)];
}, { visibility: 'public' });

await agent.start();
console.log('my pubkey:', identity.pubKey);

// To call another peer once you know its pubkey:
//   const reply = await agent.invoke(otherPubKey, 'greet', [TextPart('the author')]);
//   console.log(Parts.text(reply));
```

Run two copies of this in separate terminals (each writes its own
vault file → distinct identities).  Print each pubkey, then
`agent.invoke(otherPubKey, 'greet', …)` to round-trip a call.

---

## 3. Phone app — `createMeshAgent`

For a React-Native / Expo phone app, `@canopy/react-native` bundles
the BLE + mDNS + relay + identity wiring behind one factory:

```js
import {
  createMeshAgent,
  KeychainVault,
} from '@canopy/react-native';
import { TextPart, Parts } from '@canopy/core';

const agent = await createMeshAgent({
  label:    'my-phone',
  relayUrl: 'ws://192.168.2.20:8787',                        // your LAN relay
  vault:    new KeychainVault({ service: 'my-app' }),
});

agent.register('greet', async ({ parts, from }) => {
  return [TextPart(`Hi from phone — you said "${Parts.text(parts) ?? ''}"`)];
}, { visibility: 'public' });

// Optional opt-ins — match what apps/mesh-demo turns on.
agent.enableAutoHello({ pullPeers: true });
agent.startDiscovery({ gossipIntervalMs: 60_000 });

// Start the agent ONLY after registering everything you want
// advertised in the first hello payload (capabilities snapshot).
await agent.start();
```

`createMeshAgent` handles permission requests, identity restore-or-
generate, BLE central+peripheral, mDNS over TCP, relay reconnection,
peer-graph persistence, and the live routing strategy that learns
which transport works best per peer.

For a fully wired example see
[`apps/mesh-demo/src/agent.js`](./apps/mesh-demo/src/agent.js) — it
opts into hop tunnels, sealed-forward, reachability oracle, and
rendezvous (WebRTC upgrade).

---

## 4. The three methods you'll use 90% of the time

| Method | Use when |
|---|---|
| `agent.register(id, handler, meta)` | Defining a skill peers can call. |
| `agent.invoke(peerId, skillId, parts, opts)` | Calling a peer directly (you have a path to them). Returns `Promise<Part[]>`. |
| `agent.invokeWithHop(peerId, skillId, parts, opts)` | Calling a peer that may only be reachable via a bridge (Group CC).  Auto-falls-back to a one-shot relay-forward if no tunnel-capable bridge is around. |

Skills are `async (ctx) => parts | iterable<parts>`.  The context
carries `{ parts, from, originFrom, originVerified, envelope }`.
Yield from a generator to stream chunks; throw `Task.InputRequired`
to ask the caller for more input.

---

## 5. Gotchas the tutorial glosses over

- **Two peers must hello each other first.**  `invoke` after a
  `hello` works; without one, `SecurityLayer` rejects with
  `UNKNOWN_RECIPIENT`.  In RN the factory's `enableAutoHello()` does
  this on every newly-discovered peer.
- **Sealed tunnels need both sides to opt in.**  See the mesh-demo
  app for how to wire `enableTunnelForward` + `registerTunnelReceiveSealed`
  + `enableSealedForwardFor('groupId')`.
- **The relay is currently for trusted networks only.**  No auth, no
  rate limit.  Hardening is on the roadmap — see
  `TODO-GENERAL.md § Production-ready relay for online deployment`.
- **Vault choice depends on host.**  `VaultMemory` for tests,
  `VaultNodeFs` for Node, `VaultLocalStorage` / `VaultIndexedDB` for
  browsers, `KeychainVault` for RN.
- **Identity rotation works** (`agent.rotateIdentity({
  gracePeriodSeconds })`) but mid-grace peers that were offline at
  broadcast time auto-migrate via inline proof on the first
  post-rotation envelope.  See `Design-v3/` for the full story.

---

## 6. Where to go next

- **Try it on hardware** — `apps/mesh-demo` is the reference Expo app.
  Build it, run it on two phones, run the relay on your laptop, and
  watch them gossip.
- **Browser demo** — `examples/mesh-demo/` for a no-RN single-page version.
- **Architecture map** — [`ARCHITECTURE.md`](./ARCHITECTURE.md) for
  the full feature list and where things live.
- **Critique-of-current-state** — [`ARCHITECTURE-REVIEW.md`](./ARCHITECTURE-REVIEW.md)
  if you want to know what's solid and what's still drifting.

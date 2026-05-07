# Cooperative Mesh Routing — Design Sketch
## Trusted agents become each other's relay servers across transport gaps

**Goal**: Agents in a trusted network relay for peers they cannot both reach directly.
The same mechanism covers two overlapping scenarios that share identical code:

| Scenario | Agent A | Bridge (relay hop) | Agent B |
|---|---|---|---|
| Cross-transport | Laptop (WiFi/LAN) | Phone-A (WiFi + BLE) | Phone-B (BLE only) |
| Same-machine tabs | Browser Tab-B | Browser Tab-A (WebRTC connected) | Phone |

In both cases: A cannot reach B directly → A asks the bridge peer to forward → bridge relays.
The `relay-forward` skill, `invokeWithHop` helper, and gossip layer are **identical** for both.

---

## Architecture overview

```
                        ┌─ same-machine tab scenario ──────────────────────┐
                        │                                                    │
Tab-B ─LocalTransport─▶ local relay server ◀─LocalTransport─ Tab-A ─RDV(WebRTC)─▶ Phone
       (ws://localhost)  (@canopy/relay)                    (WebRTC / WAN)
                        └────────────────────────────────────────────────────┘

                        ┌─ cross-transport scenario ───────────────────────┐
                        │                                                    │
Laptop ─(WiFi/LAN)────▶ Phone-A ─────(BLE)──────────────────────────────▶ Phone-B
                        └────────────────────────────────────────────────────┘

Both reduce to:   Agent-without-link  →  Bridge-peer  →  Target
```

### LocalTransport in browsers
`LocalTransport` uses the browser's native `WebSocket` API — no Node.js needed in the
browser tab itself. But it connects **to** a server, so `@canopy/relay` must be running
as a local Node.js process on `localhost:PORT` to serve as the same-machine message bus.

For a pure browser-only same-machine solution (no local server), a
`BroadcastChannelTransport` would be the right tool — not yet implemented; noted as a
future addition.

---

## Packages used

| Package | Role |
|---|---|
| `@canopy/core` | Agent, all transports, security, protocol, PeerGraph, RoutingStrategy |
| `@canopy/relay` | Local relay server for same-machine tab-to-tab routing |
| `@canopy/react-native` | MdnsTransport, BleTransport, KeychainVault, AsyncStorageAdapter |
| `react-native-ble-plx` | BLE GATT (peer dep of BleTransport) |
| `react-native-zeroconf` | mDNS discovery (peer dep of MdnsTransport) |
| `react-native-keychain` | Secure key storage (peer dep of KeychainVault) |
| `@react-native-async-storage/async-storage` | PeerGraph persistence on-device |

---

## Delegation groups

```
Group A  AgentSetup              (no internal deps)
Group B  PeerDiscovery UI        (depends: A)
Group C  Relay skill + routing   (depends: A)
Group D  MessageUI               (depends: A, B, C)
Group E  RoutingStrategy wiring  (depends: A, C)
Group F  Future: BroadcastChannelTransport  (browser-only, no local server needed)
```

---

## Group A — Agent setup

### A1 — React Native app (Phone-A: bridge device)

**File**: `src/agent.js`

```js
import { Agent, AgentConfig, AgentIdentity } from '@canopy/core';
import { KeychainVault, MdnsTransport,
         BleTransport, AsyncStorageAdapter } from '@canopy/react-native';
import { PeerGraph }     from '@canopy/core';
import AsyncStorage      from '@react-native-async-storage/async-storage';

export async function createAgent() {
  const vault    = new KeychainVault({ service: 'mesh-demo' });
  const identity = await AgentIdentity.restore(vault)
                       .catch(() => AgentIdentity.generate(vault));

  const mdns = new MdnsTransport({
    hostname: `${identity.pubKey.slice(0, 8)}.local`,
    identity,
  });
  const ble = new BleTransport({ identity, advertise: true, scan: true });

  const peers = new PeerGraph({
    storageBackend: new AsyncStorageAdapter(AsyncStorage),
  });

  const config = new AgentConfig({
    overrides: {
      discovery: { discoverable: true, acceptHelloFromTier0: true },
      policy:    { allowRelayFor: 'trusted' },   // ← opt-in; 'never' is the default
    },
  });

  const agent = new Agent({
    identity,
    transport: mdns,      // primary: mDNS/WiFi
    peers,
    config,
    label: 'mesh-phone-a',
  });
  agent.addTransport('ble', ble);

  return agent;
}
```

### A2 — Browser (laptop, Tab-A: WebRTC-connected tab)

```js
// Tab-A: has WebRTC connection to phone
const relay  = new RelayTransport({ relayUrl, identity });
const rdv    = new RendezvousTransport({ signalingTransport: relay, identity });
const local  = new LocalTransport({ port: 8788, identity });   // local relay server

const agent = new Agent({ identity, transport: relay, peers, config });
agent.addTransport('rendezvous', rdv);
agent.addTransport('local', local);   // same-machine link to Tab-B
await agent.start();
```

### A3 — Browser (laptop, Tab-B: no direct connection to phone)

```js
// Tab-B: can only reach the phone via Tab-A
const local = new LocalTransport({ port: 8788, identity });

const agent = new Agent({ identity, transport: local, peers, config });
await agent.start();
// Tab-B knows Tab-A via the local relay server; asks it to forward
```

### A4 — Local relay server (laptop, Node.js process)

```js
// relay-server.js — run once: node relay-server.js
import { RelayAgent } from '@canopy/relay';
const relay = new RelayAgent({ port: 8788 });
await relay.start();
console.log('Local relay ready on ws://localhost:8788');
```

**Exit criteria**:
- Phone-A: `agent.transportNames` is `['default', 'ble']`
- Tab-A: `agent.transportNames` is `['default', 'rendezvous', 'local']`
- Tab-B: `agent.transportNames` is `['default']` (local = default)
- All `agent.start()` calls succeed without throwing

---

## Group B — Peer discovery UI

**File**: `src/screens/PeersScreen.js` (React Native) / `peers.html` section (browser)

Displays all known peers — direct and indirect — with transport badges and hop count.

### Peer row data shape

```js
{
  pubKey:     string,
  label:      string | null,
  hops:       number,         // 0 = direct, 1 = via one relay peer
  via:        string | null,  // pubKey of the relay peer (if hops > 0)
  transports: string[],       // e.g. ['ble'], ['mdns'], ['rendezvous']
  latencyMs:  number | null,
  reachable:  boolean,
}
```

### Peer sections

```
Direct (BLE)           — peers reachable via BleTransport
Direct (WiFi/mDNS)     — peers reachable via MdnsTransport
Direct (WebRTC)        — peers reachable via RendezvousTransport
Direct (local)         — same-machine peers via LocalTransport
Indirect (1 hop)       — peers reachable through a relay-capable trusted peer
                         shows: "via Phone-A" or "via Tab-A"
```

Indirect peers come from the gossip `peer-list` skill response (Group E).

**Exit criteria**:
- Laptop appears in "Direct (WiFi)" on Phone-A
- Phone-B appears in "Direct (BLE)" on Phone-A
- After gossip, Phone-B appears in "Indirect (1 hop) via Phone-A" on laptop
- Tab-B sees "Indirect (1 hop) via Tab-A" for phone entry

---

## Group C — Relay skill + routing helper

### C1 — `relay-forward` skill

**File**: `src/relaySkill.js`

This skill is registered by **every agent that opts in to relaying**.
It checks the `policy.allowRelayFor` config before forwarding.

```js
import { Parts, DataPart } from '@canopy/core';

export function registerRelaySkill(agent) {
  agent.register('relay-forward', async ({ parts, from }) => {
    // ── Trust check (opt-in guard) ────────────────────────────────────
    const allowPolicy = agent.config?.get('policy.allowRelayFor') ?? 'never';
    if (allowPolicy === 'never') {
      return [DataPart({ error: 'relay not enabled on this agent' })];
    }
    if (allowPolicy === 'trusted') {
      const tier = await agent.trustRegistry?.getTier(from) ?? 0;
      if (tier < 1) return [DataPart({ error: 'relay requires trust tier ≥ 1' })];
    }
    // allowPolicy === 'always' → skip tier check (only for dev/testing)

    const d = Parts.data(parts);
    if (!d?.targetPubKey || !d?.skill) {
      return [DataPart({ error: 'missing targetPubKey or skill' })];
    }

    // ── Target reachability check ─────────────────────────────────────
    const record = await agent.peers?.get(d.targetPubKey);
    if (!record?.reachable) {
      return [DataPart({ error: 'target not reachable from this node' })];
    }

    // ── Forward ───────────────────────────────────────────────────────
    try {
      const result = await agent.invoke(
        d.targetPubKey, d.skill,
        Parts.wrap(d.payload ?? []),
        { timeout: d.timeout ?? 10_000 },
      );
      return [DataPart({ forwarded: true, result: Parts.data(result) })];
    } catch (err) {
      return [DataPart({ error: err.message })];
    }
  }, {
    visibility:  'authenticated',
    description: 'Relay a message to an indirectly reachable peer (opt-in)',
  });
}
```

### C2 — `invokeWithHop` helper

**File**: `src/routing/invokeWithHop.js`

Transparent helper: tries direct first, falls back to a relay hop.

```js
export async function invokeWithHop(agent, targetPubKey, skillId, parts, opts = {}) {
  // 1. Try direct
  const direct = await agent.peers?.get(targetPubKey);
  if (direct?.reachable) {
    return agent.invoke(targetPubKey, skillId, parts, opts);
  }

  // 2. Find a relay peer that knows the target
  const allPeers = await agent.peers?.all() ?? [];
  for (const p of allPeers.filter(r => r.reachable && r.pubKey !== targetPubKey)) {
    const knownPeers = p.knownPeers ?? [];
    if (!knownPeers.includes(targetPubKey)) continue;

    return agent.invoke(p.pubKey, 'relay-forward', [DataPart({
      targetPubKey,
      skill:   skillId,
      payload: parts,
      timeout: opts.timeout,
    })], opts);
  }

  throw new Error(`No route to ${targetPubKey.slice(0, 10)}… (no reachable relay peer knows the target)`);
}
```

**Exit criteria**:
- Phone-A has `relay-forward` registered with `policy.allowRelayFor: 'trusted'`
- Tab-B calls `invokeWithHop(agent, phoneB.pubKey, 'echo', [...])` → resolves via Tab-A
- Calling `relay-forward` on an agent with `allowRelayFor: 'never'` returns error DataPart
- Tier-0 peer calling `relay-forward` on a `'trusted'`-policy agent gets policy error

---

## Group D — Message UI

**File**: `src/screens/MessageScreen.js` (React Native) / `messages.html` section (browser)

Chat-style per-peer log. Uses `invokeWithHop` transparently.

### `receive-message` skill (registered once in Group A setup)

```js
agent.register('receive-message', async ({ parts, from }) => {
  const text = Parts.text(parts);
  messageStore.dispatch({ type: 'RECEIVED', from, text, ts: Date.now() });
  return [DataPart({ ack: true })];
}, { visibility: 'public' });
```

### Send path

```js
// hops badge: 'direct' or 'via <label> (1 hop)'
const result = await invokeWithHop(agent, peer.pubKey, 'receive-message',
  [TextPart(inputText)], { timeout: 8_000 });
```

**Exit criteria**:
- Laptop sends text to Phone-B → message appears on Phone-B with "via Phone-A (1 hop)"
- Phone-B replies → appears on laptop
- Tab-B sends to Phone → message goes through Tab-A → appears on phone with "via Tab-A (1 hop)"
- Direct messages (no gap) show "direct" badge

---

## Group E — RoutingStrategy + gossip (transparent routing)

**File**: `src/routing/setup.js`

Once this group is in, `invokeWithHop` can be retired in favour of `agent.invoke()` working
transparently — the routing layer finds the relay path automatically.

### `peer-list` skill

Each agent exposes its directly reachable peers to trusted peers.
This is how indirect peers appear in the PeerGraph.

```js
agent.register('peer-list', async ({ parts, from }) => {
  const tier = await agent.trustRegistry?.getTier(from) ?? 0;
  const all  = await agent.peers?.all() ?? [];
  return [DataPart({
    peers: all
      .filter(p => p.reachable && p.discoverable !== false && (tier >= 1 || p.visibility !== 'private'))
      .map(p => ({
        pubKey:     p.pubKey,
        label:      p.label,
        transports: Object.keys(p.transports ?? {}),
      })),
  })];
}, { visibility: 'authenticated', description: 'Return list of directly reachable peers' });
```

### RoutingStrategy wiring

```js
import { RoutingStrategy, PeerDiscovery } from '@canopy/core';

export function setupRouting(agent) {
  const transports = Object.fromEntries(
    agent.transportNames.map(n => [n, agent.getTransport(n)])
  );

  const routing = new RoutingStrategy({
    transports,
    peerGraph: agent.peers,
    config:    agent.config?.snapshot().policy,
  });

  // Gossip: periodically pull peer-list from trusted peers
  const discovery = new PeerDiscovery({ agent, peerGraph: agent.peers });
  discovery.start();

  return routing;
}
```

### Indirect peer upsert (after receiving `peer-list`)

```js
// Called after invoking 'peer-list' on a direct peer P:
for (const remoteCard of result.peers) {
  await agent.peers.upsert({
    type:        'native',
    pubKey:      remoteCard.pubKey,
    label:       remoteCard.label,
    reachable:   true,
    hops:        1,
    via:         directPeer.pubKey,
    discoveredVia: 'gossip',
    knownPeers:  [],
  });
}
```

**Exit criteria**:
- Laptop's PeerGraph contains Phone-B as indirect (hops: 1, via: Phone-A) within 30 s
- `agent.invoke(phoneBPubKey, 'echo', [...])` on laptop completes without calling `invokeWithHop`
- `RoutingStrategy.selectTransport(phoneBPubKey)` returns `{ name: 'relay-hop', via: phoneA }`

---

## Group F — BroadcastChannelTransport (future, browser-only)

For a pure browser setup where no local server is available.
`BroadcastChannel` is a browser-native API that lets same-origin tabs/workers
exchange messages without a server.

```js
// Future — not yet implemented
class BroadcastChannelTransport extends Transport {
  constructor({ channelName, identity })
  // new BroadcastChannel(channelName) — all tabs on same origin see messages
  async _put(to, envelope)
  // channel.postMessage({ to, envelope })
  // _receive() on matching 'to'
}
```

**Why it matters**: eliminates the need for a local relay server in the same-machine tab
scenario. Both tabs join the same named channel; no Node.js process needed.
This is straightforward to implement and would be a clean Phase F addition.

---

## `policy.allowRelayFor` config field

Added to `AgentConfig` defaults:

```js
policy: {
  ping:           'always',
  messaging:      'on-request',
  streaming:      'negotiated',
  taskAccept:     'on-request',
  transportFilter: null,
  allowRelayFor:  'never',    // ← new; opt-in; options: 'never' | 'trusted' | 'always'
}
```

Values:

| Value | Meaning |
|---|---|
| `'never'` | Default. Agent never relays for anyone. `relay-forward` skill returns error. |
| `'trusted'` | Relays only for peers at trust tier ≥ 1 (explicit hello + known pubKey). |
| `'group:X'` | Relays only for members of group X (requires valid GroupProof). |
| `'always'` | Relays for anyone. Use only in controlled dev environments. |

---

## File map

```
relay-demo-app/           (React Native Android — phone-side)
  src/
    agent.js                ← Group A1: agent factory (mDNS + BLE)
    relaySkill.js           ← Group C1: relay-forward skill
    routing/
      invokeWithHop.js      ← Group C2: hop-aware invoke helper
      setup.js              ← Group E: RoutingStrategy + PeerDiscovery
    screens/
      PeersScreen.js        ← Group B: peer list with hop badges
      MessageScreen.js      ← Group D: per-peer chat
    store/
      messages.js           ← Group D: message state
    context/
      AgentContext.js       ← React context provider
  App.js
  package.json

browser-mesh/             (Laptop browser tabs — same code for both tabs)
  agent.js                  ← Group A2/A3: browser agent factory
  relaySkill.js             ← Group C1: same file, same skill
  routing/
    invokeWithHop.js        ← Group C2: identical
  ui.js                     ← Group B + D combined (simple HTML UI)

relay-server/             (Laptop local relay server — same-machine bus)
  server.js                 ← Group A4: @canopy/relay on localhost:8788
```

---

## Implementation phases

| Phase | Groups | Goal |
|---|---|---|
| 1 | A | Agents start cleanly; all transports connect; `allowRelayFor` in config |
| 2 | A + B (read-only) | PeersScreen shows real discovered peers with transport badges |
| 3 | A + C | `relay-forward` registered with trust check; `invokeWithHop` works manually |
| 4 | D | MessageScreen sends/receives across hops; hop badge shown correctly |
| 5 | E | Gossip + RoutingStrategy; indirect peers appear automatically; `agent.invoke` transparent |
| 6 | F | BroadcastChannelTransport; remove local relay server requirement for browser tabs |

---

## Key risks

| Risk | Mitigation |
|---|---|
| Android BLE permissions (BLUETOOTH_SCAN, BLUETOOTH_CONNECT, ACCESS_FINE_LOCATION) | Request all at startup; check Android 12+ model |
| mDNS unreliable on some Android versions / corporate WiFi | Add RelayTransport as fallback; config `transportFilter` |
| Relay abuse: compromised tier-1 peer uses you to send to your contacts | `allowRelayFor: 'never'` default; rate-limit per-hop in production |
| BLE MTU chunking latency for large payloads | Keep relay messages small; large payloads use BulkTransfer |
| Same-machine tabs: ICE NAT conflict (two tabs, same external IP) | Use LocalTransport via local relay server, not WebRTC, for same-machine hops |
| `BroadcastChannel` origin restriction (same-origin only) | For cross-origin tabs: still need local relay server or LocalTransport |
```

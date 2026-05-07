# mesh-demo — Cooperative Mesh Routing Design
## Trusted agents relay for peers they cannot both reach directly

> **Note**: This file replaces `relay-demo-app.md`. The app lives at `apps/mesh-demo/`.
> Phases 1–5 are implemented. Phase 6 (BroadcastChannelTransport) remains future work.

**Goal**: Agents in a trusted network relay for peers they cannot reach directly.
The same mechanism covers two overlapping scenarios that share identical code:

| Scenario | Agent A | Bridge (relay hop) | Agent B |
|---|---|---|---|
| Cross-transport | Laptop (WiFi/LAN) | Phone-A (WiFi + BLE) | Phone-B (BLE only) |
| Same-machine tabs | Browser Tab-B | Browser Tab-A (relay-connected) | Phone |

In both cases: A cannot reach B directly → A asks the bridge peer to forward → bridge relays.
The `relay-forward` skill, `invokeWithHop` helper, and gossip layer are **identical** for both.

---

## Architecture overview

```
                        ┌─ same-machine tab scenario ──────────────────────┐
                        │                                                    │
Tab-B ─RelayTransport─▶ relay server (ws://) ◀─RelayTransport─ Tab-A ─RDV(WebRTC)─▶ Phone
       (ws://localhost)  (@canopy/relay)
                        └────────────────────────────────────────────────────┘

                        ┌─ cross-transport scenario ───────────────────────┐
                        │                                                    │
Laptop ─(WiFi/mDNS)───▶ Phone-A ─────(BLE)──────────────────────────────▶ Phone-B
                        └────────────────────────────────────────────────────┘

Both reduce to:   Agent-without-link  →  Bridge-peer  →  Target
```

### Transport architecture (React Native)

mDNS and TCP are handled by two custom Kotlin native modules compiled into the APK.
BLE peripheral (advertising) mode is also a custom Kotlin native module.
This eliminates dependency on `react-native-zeroconf`, `react-native-tcp-socket`, and
any third-party BLE peripheral package — all of which had maintenance/compatibility issues.

```
JS (BleTransport)       ──▶  react-native-ble-plx (central / scan)
                         ──▶  BlePeripheralModule.kt (GATT server / advertise)

JS (MdnsTransport)      ──▶  MdnsModule.kt (NsdManager discovery + TCP server/client)
```

---

## Packages

| Package | Role |
|---|---|
| `@canopy/core` | Agent, transports, security, protocol, PeerGraph, RoutingStrategy |
| `@canopy/relay` | Relay server for same-machine tab-to-tab routing |
| `@canopy/react-native` | MdnsTransport, BleTransport, KeychainVault, AsyncStorageAdapter |
| `react-native-ble-plx` | BLE GATT central (scan/connect) — peer dep of BleTransport |
| `react-native-keychain` | Secure key storage — peer dep of KeychainVault |
| **`BlePeripheralModule.kt`** | Custom native: BLE GATT server (peripheral/advertise mode) |
| **`MdnsModule.kt`** | Custom native: Android NsdManager + TCP socket server/client |

---

## Delegation groups

```
Group A  AgentSetup              (no internal deps)
Group B  PeerDiscovery UI        (depends: A)
Group C  Relay skill + routing   (depends: A)
Group D  MessageUI               (depends: A, B, C)
Group E  RoutingStrategy wiring  (depends: A, C)
Group F  Future: BroadcastChannelTransport  (browser-only, no server needed)

Infrastructure (cross-cutting):
  AgentContext       React context + lifecycle (loading → starting → ready/error)
  SetupScreen        First-launch relay URL configuration
  permissions.js     Android runtime permission requests (BLE, location)
  store/messages.js  In-memory per-peer message log (session-scoped)
  store/settings.js  AsyncStorage persistence for relay URL
```

---

## Group A — Agent setup

### A1 — React Native app (`src/agent.js`)

```js
export async function createAgent({ relayUrl } = {}) {
  const perms = await requestPermissions();

  const vault    = new KeychainVault({ service: 'mesh-demo' });
  const identity = await AgentIdentity.restore(vault)
                       .catch(() => AgentIdentity.generate(vault));

  // Each transport is wrapped in try/catch so one failure doesn't block startup.
  let mdns = null;
  if (MdnsTransport.isAvailable()) {
    try { mdns = new MdnsTransport({ identity, hostname: `dw-${identity.pubKey.slice(0, 8)}` }); }
    catch (e) { console.warn('MdnsTransport init failed:', e?.message); }
  }

  let ble = null;
  if (perms.ble) {
    try { ble = new BleTransport({ identity, advertise: true, scan: true }); }
    catch (e) { console.warn('BleTransport init failed:', e?.message); }
  }

  let relay = null;
  if (relayUrl) {
    try { relay = new RelayTransport({ relayUrl, identity }); }
    catch (e) { console.warn('RelayTransport init failed:', e?.message); }
  }

  const primary = mdns ?? relay;
  if (!primary) throw new Error('No transport could be initialised.');

  const peers  = new PeerGraph({ storageBackend: new AsyncStorageAdapter({ prefix: 'mesh-demo:peers:' }) });
  const config = new AgentConfig({
    overrides: {
      discovery: { discoverable: true, acceptHelloFromTier0: true },
      policy:    { allowRelayFor: 'trusted' },
    },
  });

  const agent = new Agent({ identity, transport: primary, peers, config, label: 'mesh-phone' });
  if (ble)                        agent.addTransport('ble',   ble);
  if (relay && primary !== relay) agent.addTransport('relay', relay);

  // Wire inbound hellos into PeerGraph (app-level decision, not automatic in SDK).
  agent.on('peer', ({ address, pubKey, label, ack }) => {
    if (!pubKey) return;
    peers.upsert({ type: 'native', pubKey, label: label ?? null, reachable: true,
                   lastSeen: Date.now(), discoveredVia: ack ? 'hello-ack' : 'hello-inbound',
                   transports: { default: { address, lastSeen: Date.now() } } }).catch(() => {});
  });

  agent.register('receive-message', async ({ parts, from }) => {
    const text = Parts.text(parts) ?? JSON.stringify(Parts.data(parts));
    messageStore.add(from, { direction: 'in', text });
    return [DataPart({ ack: true })];
  }, { visibility: 'public' });

  registerRelaySkill(agent);
  registerPeerListSkill(agent);

  await agent.start();
  return agent;
}
```

**Key deviations from original design:**
- `relayUrl` is a required parameter (no relay → phone-only mode, not tested)
- `MdnsTransport.isAvailable()` guards instantiation (native module check)
- Skills are registered inside `createAgent`, not separately
- `allowRelayFor: 'trusted'` is the default (not `'never'`)

### A2 — Browser agent (laptop, relay-connected)

```js
const relay = new RelayTransport({ relayUrl, identity });
const rdv   = new RendezvousTransport({ signalingTransport: relay, identity });
// RendezvousTransport.isSupported() → false on React Native; only used in browser
const agent = new Agent({ identity, transport: relay, peers, config });
agent.addTransport('rendezvous', rdv);
await agent.start();
```

### A3 — AgentContext (React Native lifecycle)

`src/context/AgentContext.js` wraps the agent lifecycle in React context:

```
status: 'loading' → 'needs-setup' (no relay URL saved)
                  → 'starting'    (relay URL found or entered)
                  → 'ready'       (agent.start() succeeded)
                  → 'error'       (transport/crypto failure)
```

Exposes: `agent`, `status`, `error`, `relayUrl`, `configure(url)`, `reset()`.

**Exit criteria (Phase 1 ✓):**
- Phone: `agent.transportNames` contains `'default'` (mDNS) and `'ble'` if BLE available
- Browser: `agent.transportNames` contains `'default'` and `'rendezvous'`
- `agent.config.get('policy.allowRelayFor')` is `'trusted'`
- All `agent.start()` calls succeed without throwing

---

## Group B — Peer discovery UI (`src/screens/PeersScreen.js`)

SectionList with three sections:

```
Direct     — peers with hops === 0 (reachable directly via mDNS or BLE)
Indirect   — peers with hops >= 1  (reachable via a relay hop)
Offline    — peers with reachable === false
```

### Peer row data shape (from PeerGraph record)

```js
{
  pubKey:       string,
  label:        string | null,
  reachable:    boolean,
  hops:         number,          // 0 = direct, 1 = one relay hop
  via:          string | null,   // pubKey of relay peer (if hops > 0)
  discoveredVia: string,         // 'hello-inbound' | 'hello-ack' | 'gossip'
  transports:   object,          // { default: { address, lastSeen }, ble: {...} }
}
```

Transport badges: 📶 mDNS (default transport), 🔵 BLE, 🔁 relay.
Tap a peer row → navigate to MessageScreen for that peer.

**Exit criteria (Phase 2 ✓):**
- Laptop appears in "Direct" on Phone-A
- Phone-B appears in "Direct" on Phone-A after BLE discovery
- After gossip, Phone-B appears in "Indirect (1 hop) via Phone-A" on laptop

---

## Group C — Relay skill + routing helper

### C1 — `relay-forward` skill (`src/relaySkill.js`)

Registered by any agent that opts in to relaying. Checks `policy.allowRelayFor`:

```js
'never'    → returns { error: 'relay-not-enabled' }
'trusted'  → checks trustRegistry.getTier(from) >= TIER_LEVEL.trusted (tier 2)
             caller must be explicitly elevated via trustRegistry.setTier(pubKey, 'trusted')
             default after hello is 'authenticated' (tier 1) — NOT sufficient
'group:X'  → checks security.groupManager.hasValidProof(from, groupId)
'always'   → no check (dev/testing only)
```

**Important**: `'trusted'` policy requires tier 2 ('trusted'), NOT tier 1 ('authenticated').
The original design doc said tier ≥ 1; the implementation requires tier ≥ 2.

Input validation: returns `{ error: 'missing targetPubKey' }` or `{ error: 'missing skill' }` if incomplete.
Reachability: returns `{ error: 'target-unreachable' }` if target not in peers or not reachable.
Loop guard: returns `{ error: 'relay-loop: target is the caller' }` if targetPubKey === from.

On success returns: `[DataPart({ forwarded: true, parts: <target's result array> })]`
On target failure returns: `[DataPart({ error: 'forward-failed: <message>' })]`

### C2 — `invokeWithHop` helper (`src/routing/invokeWithHop.js`)

```js
export async function invokeWithHop(agent, targetPubKey, skillId, parts, opts = {}) {
  // 1. Direct if target is in PeerGraph and reachable
  const direct = await agent.peers?.get(targetPubKey);
  if (direct?.reachable) return agent.invoke(targetPubKey, skillId, parts, opts);

  // 2. Find relay peers: reachable, and whose knownPeers includes targetPubKey
  const relayPeers = (await agent.peers?.all() ?? [])
    .filter(p => p.reachable && p.pubKey !== targetPubKey && p.knownPeers?.includes(targetPubKey));

  if (!relayPeers.length) throw new Error(`No route to ${targetPubKey.slice(0,12)}…`);

  // 3. Pick lowest-hop relay, invoke relay-forward
  const relay = relayPeers.sort((a, b) => (a.hops ?? 0) - (b.hops ?? 0))[0];
  const result = await agent.invoke(relay.pubKey, 'relay-forward', [DataPart({
    targetPubKey, skill: skillId, payload: parts, timeout: opts.timeout,
  })]);

  const data = Parts.data(result);
  if (data?.error) throw new Error(`Relay hop failed: ${data.error}`);
  if (data?.forwarded) return data.parts ?? [];
  return result;
}
```

**Exit criteria (Phase 3 ✓):**
- `relay-forward` registered on Phone-A with `allowRelayFor: 'trusted'`
- `invokeWithHop(agent, phoneBPubKey, 'echo', [...])` on laptop resolves via Phone-A
- Policy / trust / validation checks match the table above

---

## Group D — Message UI (`src/screens/MessageScreen.js`)

Per-peer chat screen. Uses `invokeWithHop` to send, `receive-message` skill to receive.

### `receive-message` skill (registered in `createAgent`)

```js
agent.register('receive-message', async ({ parts, from }) => {
  const text = Parts.text(parts) ?? JSON.stringify(Parts.data(parts));
  messageStore.add(from, { direction: 'in', text });
  return [DataPart({ ack: true })];
}, { visibility: 'public' });
```

### MessageStore (`src/store/messages.js`)

In-memory, session-scoped. Backed by `Emitter` from `@canopy/core`.

```js
messageStore.add(peerPubKey, { direction: 'in'|'out', text, hops?, via?, status? })
// → returns entry: { id, ts, direction, text, hops:0, via:null, status:'ok' }

messageStore.get(peerPubKey)   // → Message[]
messageStore.clear(peerPubKey) // emits 'cleared'
messageStore.on('message', ({ peerPubKey, message }) => ...)
```

### Send path

```js
const result = await invokeWithHop(agent, peer.pubKey, 'receive-message',
  [TextPart(inputText)], { timeout: 8_000 });
// MessageScreen shows 'direct ✓' or 'N hops via X ✓'
```

**Exit criteria (Phase 4 ✓):**
- Laptop sends text → appears on Phone-B with hop info
- Phone-B reply → appears on laptop
- Direct messages show "direct" badge; relayed show "N hops via X"

---

## Group E — Gossip + RoutingStrategy (`src/routing/setup.js`)

### `registerPeerListSkill(agent)`

Returns directly-reachable peers to authenticated callers.
Filters: `reachable === true`, `discoverable !== false`.
Private peers (`visibility: 'private'`) only returned to callers with tier ≥ 1.

### `pullPeerList(agent, directPeerPubKey)`

Gossip initiator: asks a direct peer for its peer list, upserts results as indirect peers.
Never downgrades a direct (hops:0) record to indirect.
Skips the calling agent itself and the relay peer (already direct).

### `setupRouting(agent, opts)`

Wires `RoutingStrategy` + `PeerDiscovery`. Returns `{ routing, discovery }`.
Default intervals: ping 30 s, gossip 60 s.

**Exit criteria (Phase 5 ✓):**
- `pullPeerList(agentA, agentB.pubKey)` → agentC appears in agentA's PeerGraph as `hops:1, via:B`
- Direct records are not overwritten
- `setupRouting` returns non-null routing and discovery objects

---

## Group F — BroadcastChannelTransport (future, browser-only)

Not yet implemented. Eliminates the need for a local relay server for same-machine tabs.

```js
// Future
class BroadcastChannelTransport extends Transport {
  constructor({ channelName, identity })
  // Uses browser's BroadcastChannel API — same-origin tabs/workers only
}
```

---

## `policy.allowRelayFor` config field

| Value | Meaning |
|---|---|
| `'never'` | Default (SDK). Agent never relays. |
| `'trusted'` | Relays for peers at tier 2 (`'trusted'`) only. Requires `trustRegistry.setTier()`. |
| `'group:X'` | Relays for members of group X (valid GroupProof required). |
| `'always'` | Relays for anyone. Dev/testing only. |

**Note**: `'trusted'` does NOT include the default post-hello tier of `'authenticated'` (tier 1).
Tier 1 is automatic; tier 2 requires explicit app-level elevation.

---

## File map

```
apps/mesh-demo/                  (React Native Android — phone)
  src/
    agent.js                     Group A1: agent factory (mDNS + BLE + relay)
    relaySkill.js                Group C1: relay-forward skill
    permissions.js               Infrastructure: Android runtime permission requests
    routing/
      invokeWithHop.js           Group C2: hop-aware invoke helper
      setup.js                   Group E: peer-list skill, pullPeerList, setupRouting
    screens/
      PeersScreen.js             Group B: peer list (Direct / Indirect / Offline sections)
      MessageScreen.js           Group D: per-peer chat with hop badge
      SetupScreen.js             Infrastructure: first-launch relay URL input
    store/
      messages.js                Group D: in-memory message log (Emitter-backed)
      settings.js                Infrastructure: AsyncStorage relay URL persistence
    context/
      AgentContext.js            Infrastructure: React context + agent lifecycle
    hooks/
      usePeers.js                Infrastructure: reactive peer list hook
  test/
    helpers.js                   Shared: makeAgent(), startAndConnect()
    agentSetup.test.js           Group A tests
    relaySkill.test.js           Group C1 tests
    invokeWithHop.test.js        Group C2 tests
    routing.test.js              Group E tests
    messageStore.test.js         Group D tests
    receiveMessage.test.js       Group A/D integration tests
  android/
    app/src/main/java/com/canopy/meshdemo/
      BlePeripheralModule.kt     Custom native: BLE GATT server
      BlePeripheralPackage.kt    Native module registration
      MdnsModule.kt              Custom native: NsdManager + TCP server/client
      MdnsPackage.kt             Native module registration
      MainApplication.kt         Registers both packages
```

---

## Implementation phases

| Phase | Groups | Status |
|---|---|---|
| 1 | A | ✓ Done — agents start, transports connect, config wired |
| 2 | A + B | ✓ Done — PeersScreen shows discovered peers with badges |
| 3 | A + C | ✓ Done — relay-forward + invokeWithHop working |
| 4 | D | ✓ Done — MessageScreen sends/receives across hops |
| 5 | E | ✓ Done — gossip + indirect peers appear automatically |
| 6 | F | ☐ Future — BroadcastChannelTransport (browser tabs, no server) |

---

## Key risks

| Risk | Mitigation |
|---|---|
| Android BLE permissions (BLUETOOTH_SCAN, BLUETOOTH_CONNECT, ACCESS_FINE_LOCATION) | Requested at startup in permissions.js; handled gracefully if denied |
| mDNS unreliable on some Android versions / corporate WiFi | RelayTransport as fallback; MdnsTransport.isAvailable() guard |
| NsdManager serial resolve limit (Android < 12) | MdnsModule.kt retries with exponential backoff (max 5 attempts) |
| Relay abuse: compromised tier-2 peer relays to your contacts | `allowRelayFor: 'never'` default; tier-2 elevation is explicit |
| BLE MTU chunking latency for large payloads | Keep relay messages small; large payloads should use BulkTransfer |
| BLE peripheral mode (GATT server) not available without BlePeripheralModule | module is compiled in; `BlePeripheral ?? null` guard in JS |
| `BroadcastChannel` origin restriction (same-origin only) | Cross-origin tabs still need a relay server or LocalTransport |

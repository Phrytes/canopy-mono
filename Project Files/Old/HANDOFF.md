# Handoff: Electron App — Full Transport Stack & NLnet Proposal Alignment

**Project**: Portable Decentralized Agents compatible with Web Apps (NLnet PoC)
**Repo**: https://github.com/Phrytes/canopy-mono
**Author**: the author

---

## 0. What has already been completed

### Phase 1 — Browser agent + connection (DONE)
- `demo.html`: A2A agent running in browser
- Profiles: Echo Bot, Calculator, Note Taker, Greeter, Admin
- Acceptance policies: `accept_all`, `group_only`, `manual`, `skill_whitelist`
- Task protocol: submitted → working → completed / failed / rejected

### Phase 2 — Discovery + capability exchange (DONE)
- Gossip-based peer discovery: `peer_list_request` / `peer_list_response`
- Agent card exchange: `agent_card_request` / `agent_card_response`
- `knownPeers` map: `{ id, label, card, connected, transport }`

### Phase 3 — Local state map + task submission (DONE)
- Task state visible in UI (pending, working, completed)
- Skills invocable by remote agents
- Group/whitelist/manual acceptance UI

### What is NOT yet done (this handoff covers it)
- NKN transport in a desktop client (needs Electron to bypass port blocking)
- WiFi Direct / local network transport
- Bluetooth transport
- Formal agent properties file (YAML/JSON schema)
- Polished SDK as an importable npm package
- Documentation and final demo for NLnet milestone delivery

---

## 1. Current transport situation in `demo.html`

```
demo.html          — main demo app (browser, uses CDN globals)
examples/
  basic-agent.html — SDK usage example
sdk/src/
  Agent.js         — multi-transport Agent (rebuilt)
  AgentFile.js     — YAML/JSON agent definition parser
  Emitter.js       — tiny EventEmitter
  transport/
    Transport.js       — abstract base class + PATTERNS
    NknTransport.js    — NKN transport (browser CDN global, all fixes applied)
    MqttTransport.js   — MQTT transport (extracted from demo.html)
    PeerJSTransport.js — PeerJS transport (updated to new API)
    BleTransport.js    — BLE stub (future)
  patterns/
    Envelope.js        — envelope format + P codes (OW/AS/AK/RQ/RS/PB/…)
    PatternHandler.js  — interaction pattern layer (wraps a transport)
    Session.js         — stub
    Streaming.js       — stub
    BulkTransfer.js    — stub
  roles/
    Role.js            — role definition + inheritance
    RoleRegistry.js    — global role registry
  groups/
    GroupManager.js    — HMAC-SHA256 group membership proofs
  protocol/Task.js     — task state machine
  discovery/
    AgentCache.js      — peer cache (localStorage-backed)
    PeerDiscovery.js   — gossip discovery protocol
  index.js             — exports everything
```

| Transport | Status | Notes |
|-----------|--------|-------|
| **MQTT** | ✅ Working cross-device | `wss://broker.hivemq.com:8884`, 16-char hex address |
| **NKN** | ✅ Working in browser | Uses CDN global `nkn.Client` — port 30002 works fine in browser/mobile |
| **PeerJS** | ✅ Working same-network | `0.peerjs.com` cloud signaling, UUID address |
| **WiFi Direct** | 🔲 Not yet implemented | Needs Electron + mDNS/Bonjour |
| **Bluetooth** | 🔲 Stub only | Needs Electron + noble/bleno, or Capacitor BLE plugin |

> **Note**: NKN was previously believed to be blocked in mobile browsers (port 30002).
> This was incorrect — `nkn.Client` from the browser CDN build works on desktop and mobile.
> The fix was switching from `nkn.MultiClient` to `nkn.Client` and adding `{ noReply: true }`.

`send(peerId, msg)` routes by `knownPeers.get(peerId).transport`.
`checkAutoConnect()` detects address type: 64-char hex (optional `name.`) → NKN, UUID → PeerJS, else → MQTT.

---

## 2. Transport roadmap

All transports share the same `Transport` base class in `sdk/src/transport/Transport.js`:

```js
export class Transport {
  async connect() { throw new Error('not implemented'); }
  async send(address, message) { throw new Error('not implemented'); }
  onMessage(handler) { throw new Error('not implemented'); }
  async disconnect() { throw new Error('not implemented'); }
  get localAddress() { throw new Error('not implemented'); }
}
```

### Layered discovery strategy (matches NLnet proposal)
```
┌──────────────────────────────────────────────────────┐
│ 1. Bluetooth (BLE)        — ultra-local, ~10m        │
│ 2. WiFi Direct / mDNS     — local network, same LAN  │
│ 3. NKN (Electron)         — global, decentralized    │
│ 4. MQTT (browser/mobile)  — global, centralized      │
│ 5. PeerJS (same-network)  — WebRTC fallback           │
└──────────────────────────────────────────────────────┘
```
An agent advertises itself on all available transports simultaneously.
When connecting, prefer the most local transport (lower latency, more private).

---

## 3. Electron app — full architecture

### Directory structure
```
electron-app/
  package.json
  main.js           ← Node.js: NKN + WiFi Direct + Bluetooth + IPC handlers
  preload.js        ← contextBridge: exposes APIs to renderer
  renderer/
    demo.html       ← copy of demo.html, adapted for Electron APIs
```

### `electron-app/package.json`
```json
{
  "name": "canopy-electron",
  "version": "0.1.0",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder"
  },
  "dependencies": {
    "nkn-sdk": "^1.3.6",
    "bonjour-service": "^1.1.1",
    "@abandonware/noble": "^1.9.2-17",
    "@abandonware/bleno": "^0.5.1-5"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.0.0"
  }
}
```

---

## 4. NKN transport (Electron)

### Why NKN doesn't work in the browser
NKN's JS SDK works in Node.js. In the browser it fails because after RPC discovery (HTTPS/443, OK) it connects to NKN nodes via **WebSocket on port 30002**, which is blocked on mobile networks and many firewalls. Node.js has no such restriction.

### `main.js` — NKN IPC handlers

```js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const nkn  = require('nkn-sdk');

let mainWindow;
let nknClient;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'demo.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── NKN ──────────────────────────────────────────────────────────────────────

ipcMain.handle('nkn:connect', async (_event, { seed, identifier }) => {
  if (nknClient) { nknClient.close(); nknClient = null; }
  const opts = {};
  if (seed)       opts.seed       = seed;
  if (identifier) opts.identifier = identifier;

  return new Promise((resolve, reject) => {
    nknClient = new nkn.MultiClient(opts);
    nknClient.on('connect', () => resolve({ addr: nknClient.addr, seed: nknClient.seed }));
    nknClient.on('message', ({ src, payload }) => {
      mainWindow?.webContents.send('nkn:message', { src, payload: payload.toString() });
    });
    nknClient.on('error', reject);
    setTimeout(() => reject(new Error('NKN connect timeout')), 30000);
  });
});

ipcMain.handle('nkn:send', async (_event, addr, msgJson) => {
  if (!nknClient) throw new Error('NKN not connected');
  await nknClient.send(addr, msgJson);
});

ipcMain.handle('nkn:getAddr', () => nknClient?.addr ?? null);
ipcMain.handle('nkn:close', () => { nknClient?.close(); nknClient = null; });
```

---

## 5. WiFi Direct transport (Electron)

### Concept
"WiFi Direct" here means **local network peer discovery via mDNS/Bonjour** + direct WebSocket connections. True WiFi Direct (P2P without a router) is OS-specific and hard to implement cross-platform. mDNS achieves the same goal: agents on the same LAN find each other automatically.

### Architecture
1. On start, advertise a mDNS service: `_canopy._tcp` on a random port
2. Browse for other `_canopy._tcp` services on the LAN
3. When a peer is found, open a WebSocket connection to it
4. Messages are JSON, same format as other transports

### SDK class: `WifiDirectTransport.js`
```js
import { Transport } from './Transport.js';
import Bonjour from 'bonjour-service';
import { WebSocketServer, WebSocket } from 'ws';

export class WifiDirectTransport extends Transport {
  constructor() {
    super();
    this._bonjour = new Bonjour();
    this._port = 40000 + Math.floor(Math.random() * 5000);
    this._address = null;
    this._server = null;
    this._connections = new Map(); // peerId → WebSocket
    this._handler = null;
  }

  async connect() {
    // Start WebSocket server
    this._server = new WebSocketServer({ port: this._port });
    this._server.on('connection', (ws) => {
      ws.on('message', (data) => {
        try {
          const { _from, ...msg } = JSON.parse(data.toString());
          if (_from && this._handler) this._handler(_from, msg);
        } catch {}
      });
    });

    // Advertise via mDNS
    this._bonjour.publish({
      name: this._address,       // set this._address before calling connect()
      type: 'canopy',
      port: this._port,
      txt: { addr: this._address }
    });

    // Browse for peers
    const browser = this._bonjour.find({ type: 'canopy' });
    browser.on('up', (service) => {
      const peerAddr = service.txt?.addr;
      if (!peerAddr || peerAddr === this._address) return;
      this._connectToPeer(peerAddr, service.host, service.port);
    });
  }

  _connectToPeer(peerAddr, host, port) {
    if (this._connections.has(peerAddr)) return;
    const ws = new WebSocket(`ws://${host}:${port}`);
    ws.on('open', () => {
      this._connections.set(peerAddr, ws);
      // Announce ourselves
      ws.send(JSON.stringify({ type: 'agent_card_request', _from: this._address }));
    });
    ws.on('message', (data) => {
      try {
        const { _from, ...msg } = JSON.parse(data.toString());
        const from = _from ?? peerAddr;
        if (this._handler) this._handler(from, msg);
      } catch {}
    });
    ws.on('close', () => this._connections.delete(peerAddr));
  }

  async send(address, message) {
    const ws = this._connections.get(address);
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('WiFi peer not reachable');
    ws.send(JSON.stringify({ ...message, _from: this._address }));
  }

  onMessage(handler) { this._handler = handler; }

  get localAddress() { return this._address; }

  async disconnect() {
    this._bonjour.unpublishAll();
    this._bonjour.destroy();
    this._server?.close();
    for (const ws of this._connections.values()) ws.close();
    this._connections.clear();
  }
}
```

### `main.js` — WiFi Direct IPC handlers
```js
const { WifiDirectTransport } = require('./sdk/WifiDirectTransport');
let wifiTransport = null;

ipcMain.handle('wifi:connect', async (_event, address) => {
  wifiTransport = new WifiDirectTransport();
  wifiTransport._address = address;
  wifiTransport.onMessage((src, msg) => {
    mainWindow?.webContents.send('wifi:message', { src, msg });
  });
  await wifiTransport.connect();
  return { addr: address, port: wifiTransport._port };
});

ipcMain.handle('wifi:send', async (_event, addr, msgJson) => {
  if (!wifiTransport) throw new Error('WiFi not started');
  await wifiTransport.send(addr, JSON.parse(msgJson));
});

ipcMain.handle('wifi:close', async () => {
  await wifiTransport?.disconnect();
  wifiTransport = null;
});
```

### `demo.html` — `startWifi()` function
```js
let wifiAddress = null;

async function startWifi() {
  if (!window.electronAPI?.wifi) return;
  const mqttAddr = localStorage.getItem('demo_mqtt_id') ?? 'agent-' + Date.now().toString(16);
  try {
    const result = await window.electronAPI.wifi.connect(mqttAddr);
    wifiAddress = result.addr;
    log('sys', `WiFi Direct ready on port ${result.port}`);
    updateDot();

    window.electronAPI.wifi.onMessage(({ src, msg }) => {
      if (!knownPeers.has(src))
        knownPeers.set(src, { id: src, label: src.slice(0,20)+'…', card: null, connected: true, transport: 'wifi' });
      handleMessage(src, msg);
      renderPeers(); updateTargetDropdown();
    });
  } catch (e) {
    log('err', 'WiFi Direct failed: ' + e.message);
  }
}
```

---

## 6. Bluetooth transport (Electron)

### Concept
Use **BLE (Bluetooth Low Energy)** GATT to:
1. **Advertise** agent presence and NKN/MQTT address (peripheral role via `bleno`)
2. **Scan** for nearby agents (central role via `noble`)
3. **Exchange messages** — BLE is low-bandwidth (~20 bytes/packet), so use it for:
   - Agent card exchange (compressed)
   - Short tasks
   - Bootstrapping: exchange the agent's NKN or WiFi address, then switch transport

### SDK class: `BluetoothTransport.js`
```js
import { Transport } from './Transport.js';
import noble from '@abandonware/noble';
import bleno from '@abandonware/bleno';

const SERVICE_UUID  = 'decw';          // 16-bit short UUID
const CHAR_UUID     = 'decwchar';

export class BluetoothTransport extends Transport {
  constructor() {
    super();
    this._address = null;
    this._handler = null;
    this._peers   = new Map();   // peerId → { address, characteristic }
  }

  async connect() {
    // ── Peripheral: advertise our presence ──
    bleno.on('stateChange', (state) => {
      if (state !== 'poweredOn') return;

      const characteristic = new bleno.Characteristic({
        uuid: CHAR_UUID,
        properties: ['write', 'notify'],
        onWriteRequest: (data, offset, withoutResponse, callback) => {
          try {
            const { _from, ...msg } = JSON.parse(data.toString('utf8'));
            if (_from && this._handler) this._handler(_from, msg);
          } catch {}
          callback(bleno.Characteristic.RESULT_SUCCESS);
        }
      });

      bleno.setServices([
        new bleno.PrimaryService({ uuid: SERVICE_UUID, characteristics: [characteristic] })
      ]);

      // Advertise agent address in local name (truncated to 20 chars)
      bleno.startAdvertising(this._address.slice(0, 20), [SERVICE_UUID]);
    });

    // ── Central: scan for other agents ──
    noble.on('stateChange', (state) => {
      if (state === 'poweredOn') noble.startScanning([SERVICE_UUID], false);
    });

    noble.on('discover', (peripheral) => {
      const peerAddr = peripheral.advertisement.localName;
      if (!peerAddr || peerAddr === this._address.slice(0,20)) return;

      peripheral.connect((err) => {
        if (err) return;
        peripheral.discoverSomeServicesAndCharacteristics(
          [SERVICE_UUID], [CHAR_UUID],
          (err, services, characteristics) => {
            if (err || !characteristics[0]) return;
            this._peers.set(peerAddr, { peripheral, characteristic: characteristics[0] });
            // Bootstrap: send our full address
            const msg = JSON.stringify({ type: 'agent_card_request', _from: this._address });
            characteristics[0].write(Buffer.from(msg), true);
          }
        );
      });
    });
  }

  async send(address, message) {
    const peer = this._peers.get(address) ?? this._peers.get(address.slice(0, 20));
    if (!peer) throw new Error('BLE peer not reachable: ' + address);
    const data = Buffer.from(JSON.stringify({ ...message, _from: this._address }));
    // BLE MTU ~512 bytes — split large messages
    for (let i = 0; i < data.length; i += 512) {
      peer.characteristic.write(data.slice(i, i + 512), true);
    }
  }

  onMessage(handler) { this._handler = handler; }
  get localAddress() { return this._address; }

  async disconnect() {
    bleno.stopAdvertising();
    noble.stopScanning();
    for (const { peripheral } of this._peers.values()) peripheral.disconnect();
    this._peers.clear();
  }
}
```

### `main.js` — Bluetooth IPC handlers
```js
const { BluetoothTransport } = require('./sdk/BluetoothTransport');
let bleTransport = null;

ipcMain.handle('ble:connect', async (_event, address) => {
  bleTransport = new BluetoothTransport();
  bleTransport._address = address;
  bleTransport.onMessage((src, msg) => {
    mainWindow?.webContents.send('ble:message', { src, msg });
  });
  await bleTransport.connect();
  return { addr: address };
});

ipcMain.handle('ble:send', async (_event, addr, msgJson) => {
  if (!bleTransport) throw new Error('BLE not started');
  await bleTransport.send(addr, JSON.parse(msgJson));
});

ipcMain.handle('ble:close', async () => {
  await bleTransport?.disconnect();
  bleTransport = null;
});
```

### `demo.html` — `startBluetooth()` function
```js
let bleAddress = null;

async function startBluetooth() {
  if (!window.electronAPI?.ble) return;
  const addr = localStorage.getItem('demo_mqtt_id') ?? 'agent-' + Date.now().toString(16);
  try {
    await window.electronAPI.ble.connect(addr);
    bleAddress = addr;
    log('sys', 'Bluetooth ready — scanning for nearby agents');
    updateDot();

    window.electronAPI.ble.onMessage(({ src, msg }) => {
      if (!knownPeers.has(src))
        knownPeers.set(src, { id: src, label: '📶 ' + src.slice(0,16)+'…', card: null, connected: true, transport: 'ble' });
      handleMessage(src, msg);
      renderPeers(); updateTargetDropdown();
    });
  } catch (e) {
    log('err', 'Bluetooth failed: ' + e.message);
  }
}
```

### Bluetooth notes
- **BLE MTU**: ~20–512 bytes. Agent cards may need to be compressed. Use the BLE channel to exchange NKN/WiFi addresses, then promote to a higher-bandwidth transport.
- **Platform support**: `noble` needs BlueZ on Linux (install `bluez` package), CoreBluetooth on macOS. Windows support is partial.
- **Permissions**: macOS requires user approval in System Preferences → Bluetooth.
- **bleno conflict**: On some systems, `noble` and `bleno` cannot both run simultaneously. If this is an issue, do peripheral-only or central-only mode.

---

## 7. `preload.js` — full contextBridge

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  nkn: {
    connect:   (opts)      => ipcRenderer.invoke('nkn:connect', opts),
    send:      (addr, msg) => ipcRenderer.invoke('nkn:send', addr, msg),
    getAddr:   ()          => ipcRenderer.invoke('nkn:getAddr'),
    close:     ()          => ipcRenderer.invoke('nkn:close'),
    onMessage: (cb) => ipcRenderer.on('nkn:message', (_e, d) => cb(d)),
    offMessage: ()  => ipcRenderer.removeAllListeners('nkn:message'),
  },

  wifi: {
    connect:   (address)   => ipcRenderer.invoke('wifi:connect', address),
    send:      (addr, msg) => ipcRenderer.invoke('wifi:send', addr, msg),
    close:     ()          => ipcRenderer.invoke('wifi:close'),
    onMessage: (cb) => ipcRenderer.on('wifi:message', (_e, d) => cb(d)),
    offMessage: ()  => ipcRenderer.removeAllListeners('wifi:message'),
  },

  ble: {
    connect:   (address)   => ipcRenderer.invoke('ble:connect', address),
    send:      (addr, msg) => ipcRenderer.invoke('ble:send', addr, msg),
    close:     ()          => ipcRenderer.invoke('ble:close'),
    onMessage: (cb) => ipcRenderer.on('ble:message', (_e, d) => cb(d)),
    offMessage: ()  => ipcRenderer.removeAllListeners('ble:message'),
  },
});
```

---

## 8. Adapting `demo.html` for all Electron transports

### 8a. Transport state variables
```js
let peer, myAddress;          // PeerJS
let mqttClient, mqttAddress;  // MQTT
let nknAddress = null;        // NKN (Electron)
let wifiAddress = null;       // WiFi Direct (Electron)
let bleAddress  = null;       // Bluetooth (Electron)
```

### 8b. Extended `send()` function
```js
async function send(peerId, msg) {
  const transport = knownPeers.get(peerId)?.transport ?? 'mqtt';

  if (transport === 'nkn') {
    if (!window.electronAPI?.nkn) return;
    await window.electronAPI.nkn.send(peerId, JSON.stringify(msg));

  } else if (transport === 'wifi') {
    if (!window.electronAPI?.wifi) return;
    await window.electronAPI.wifi.send(peerId, JSON.stringify(msg));

  } else if (transport === 'ble') {
    if (!window.electronAPI?.ble) return;
    await window.electronAPI.ble.send(peerId, JSON.stringify(msg));

  } else if (transport === 'mqtt') {
    if (!mqttClient?.connected) return;
    mqttClient.publish(MQTT_TOPIC(peerId), JSON.stringify({ ...msg, _from: mqttAddress }));

  } else {
    // peerjs
    const conn = connections.get(peerId);
    if (conn?.open) conn.send(JSON.stringify(msg));
  }
}
```

### 8c. Extended `updateDot()`
```js
function updateDot() {
  const ready = (nknAddress && window.electronAPI?.isElectron)
             || (wifiAddress && window.electronAPI?.isElectron)
             || (bleAddress  && window.electronAPI?.isElectron)
             || mqttClient?.connected
             || peer?.open;
  document.getElementById('dot').className = ready ? 'dot ready' : 'dot warn';
}
```

### 8d. Boot section
```js
renderAll();
start();           // PeerJS
startMqtt();       // MQTT
startNkn();        // NKN (no-op if not in Electron)
startWifi();       // WiFi Direct (no-op if not in Electron)
startBluetooth();  // BLE (no-op if not in Electron)
checkAutoConnect();
```

### 8e. Address detection in `checkAutoConnect()`
```js
const isNkn    = /^(?:[a-zA-Z0-9_-]+\.)?[0-9a-f]{64}$/.test(id);
const isPeerJS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
// isNkn    → fill nkn-connect-input + connectViaNkn()
// isPeerJS → fill peerjs-connect-input + connectViaPeerJS()
// else     → fill mqtt-connect-input + connectViaMqtt()
```

### 8f. Show Electron-only sections
```js
if (window.electronAPI?.isElectron) {
  document.getElementById('nkn-connect-section').style.display  = '';
  document.getElementById('nkn-address-section').style.display  = '';
  document.getElementById('wifi-connect-section').style.display = '';
  document.getElementById('ble-status-section').style.display   = '';
}
```

---

## 9. Agent Properties File (NLnet deliverable 1)

The proposal requires an **agent properties file** — a structured file that encodes everything needed to identify and connect to an agent.

### Format (YAML — also support JSON)
```yaml
# canopy-agent.yaml
version: 1
agent:
  id: myagent.56cb429b71b520bc4cb7f0c53920351ced3b55bca650548b18c44d078ff6e00e
  name: "My Agent"
  description: "Does useful things"

connections:
  nkn:
    address: myagent.56cb429b71b520bc4cb7f0c53920351ced3b55bca650548b18c44d078ff6e00e
  mqtt:
    address: a3f9d2b071c84e5a
    broker: wss://broker.hivemq.com:8884/mqtt
  peerjs:
    # generated per-session; omit in persistent file

groups:
  - dev-team
  - nlnet-demo

permissions:
  mode: group_only       # accept_all | group_only | manual | skill_whitelist
  allowed_skills: []     # for skill_whitelist mode

skills:
  - name: echo
    description: Echoes text back
  - name: ping
    description: Returns pong

storage:
  type: local            # local | solid
  # solid_pod: https://mypod.example.org/agent/  (future)

metadata:
  created: 2025-06-01T00:00:00Z
  updated: 2025-06-01T00:00:00Z
```

### Encryption
Sensitive fields (NKN address, group IDs) should be encrypted with the agent's private key before sharing publicly. Use `tweetnacl` or `libsodium` (already available as browser-compatible npm packages):

```js
import nacl from 'tweetnacl';
import { encodeUTF8, decodeUTF8, encodeBase64, decodeBase64 } from 'tweetnacl-util';

// Encrypt agent properties for sharing
function encryptProperties(yaml, recipientPublicKey) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const message = encodeUTF8(yaml);
  const encrypted = nacl.box(message, nonce, recipientPublicKey, mySecretKey);
  return { nonce: encodeBase64(nonce), data: encodeBase64(encrypted) };
}
```

### Storage targets (from proposal)
- **Phase 4 (now)**: Local file — user can export/import `.yaml` or `.json`
- **Future**: Solid Pod — `PUT` to `https://pod.example.org/agent/properties.yaml`

### Implementation steps
1. Add "Export Properties" button to `demo.html` sidebar → downloads `canopy-agent.yaml`
2. Add "Import Properties" button → reads YAML file, restores agent state (profile, group, addresses)
3. Add YAML parser (`js-yaml` CDN): `<script src="https://cdn.jsdelivr.net/npm/js-yaml/dist/js-yaml.min.js"></script>`
4. In Electron, persist the properties file automatically to the OS app data directory: `app.getPath('userData')`

---

## 10. SDK as npm package (NLnet deliverable 2)

The proposal requires a **JavaScript package** that developers can import.

### Target API
```js
import { Agent, NknTransport, MqttTransport, WifiDirectTransport, BluetoothTransport } from 'canopy-sdk';

const agent = new Agent({
  name: 'My Agent',
  transport: new NknTransport({ seed: '...' }),
  policy: { mode: 'accept_all' },
  skills: [
    { name: 'echo', handler: async ({ text }) => ({ echo: text }) }
  ]
});

await agent.start();
console.log('Agent address:', agent.address);

// Connect to a peer
await agent.connect('remote.address.here');

// Submit a task
const result = await agent.submitTask('remote.address.here', 'echo', { text: 'hello' });
console.log(result);  // { echo: 'hello' }
```

### Package structure
```
sdk/
  src/
    Agent.js               — core agent (already done)
    transport/
      Transport.js          — abstract base (already done)
      NknTransport.js       — NKN (Node.js only, already done)
      PeerJSTransport.js    — PeerJS (already done)
      MqttTransport.js      — MQTT (extract from demo.html)
      WifiDirectTransport.js — new (section 5 above)
      BluetoothTransport.js  — new (section 6 above)
    protocol/
      Task.js               — task state machine (already done)
    AgentProperties.js      — load/save/encrypt properties file (new)
  index.js                  — exports all
  package.json              — npm metadata
  README.md                 — developer docs
```

### Steps to publish
```bash
cd sdk
npm init  # or update package.json
npm publish --access public
```

---

## 11. NLnet proposal alignment

### Milestone 1 (€3,500) — core protocol
| Deliverable | Status | Notes |
|-------------|--------|-------|
| Agent properties file (YAML/JSON schema) | Needs implementation | See section 9 |
| Agent ID generation + persistence | Done | MQTT addr in localStorage |
| Group IDs in properties file | Needs formal implementation | Groups exist in UI, not in file |
| Permissions/policies | Done | `accept_all`, `group_only`, `manual`, `skill_whitelist` |
| Connection addresses (NKN) | Partially done | NKN needs Electron; MQTT/PeerJS done |

### Milestone 2 (€9,100) — SDK + discovery + demo
| Deliverable | Status | Notes |
|-------------|--------|-------|
| JavaScript SDK package | Skeleton exists in `sdk/` | Needs `MqttTransport`, `WifiDirectTransport`, `BluetoothTransport` |
| Gossip discovery | Done | `peer_list_request/response` |
| Capability exchange | Done | `agent_card_request/response` |
| Task submission | Done | Full state machine: submitted → working → completed/failed/rejected |
| Cross-device demo (MQTT) | Done | Works on any browser, any network |
| Cross-device demo (NKN) | In progress | Needs Electron app (this handoff) |
| Local network (WiFi Direct) | Not started | See section 5 |
| Bluetooth | Not started | See section 6 |
| Layered discovery | Not started | Prefer BLE → WiFi → NKN → MQTT |
| Documentation | Not started | README + inline JSDoc |
| Solid Pod storage | Future / out of scope for PoC | |

### What to build next (priority order)
1. **Electron app with NKN** (section 4) — unlocks true decentralized transport
2. **WiFi Direct** (section 5) — local network, no internet required
3. **Agent Properties File** (section 9) — required NLnet deliverable
4. **SDK package polish** (section 10) — extract `MqttTransport`, write docs
5. **Bluetooth** (section 6) — nice to have, hardware-dependent
6. **Layered discovery** — automatic transport selection

---

## 12. Installation and running

### Install Electron app
```bash
cd electron-app
npm install
npm start
```

### Platform-specific notes
- **Linux**: Bluetooth requires `sudo apt install bluez` and running Electron with `--no-sandbox` or appropriate capabilities
- **macOS**: Bluetooth requires user approval in System Preferences → Security & Privacy → Bluetooth
- **Windows**: BLE support via `noble` is experimental; WiFi Direct via mDNS works with Bonjour (bundled with iTunes or available standalone)

---

## 13. Future: Mobile (Tauri)

Tauri v2 supports iOS and Android. It has the same main/renderer split as Electron (Rust backend + WebView frontend). The `demo.html` renderer code is shared; only the IPC bridge changes:

| Feature | Electron | Tauri |
|---------|----------|-------|
| IPC | `window.electronAPI` | `window.__TAURI__` |
| NKN | `nkn-sdk` (Node.js) | NKN Rust SDK or raw WebSocket |
| BLE | `noble`/`bleno` | Tauri BLE plugin |
| mDNS | `bonjour-service` | Tauri mDNS plugin |

A thin adapter module handles the difference:
```js
const bridge = window.electronAPI ?? window.__TAURI__?.canopy ?? null;
```

---

## 14. Repo state at time of this handoff

- **Branch**: `master`
- **Last commit**: `0ccf05c` — "Replace NKN with MQTT transport"
- **Railway deployment**: `canopytest-production.up.railway.app` — PeerJS signaling (unused; apps use `0.peerjs.com`)
- **GitHub**: https://github.com/Phrytes/canopy-mono

All working browser code is in `demo.html`. The `sdk/` directory is a parallel Node.js SDK that is not imported by `demo.html` directly — they evolved in parallel and share architecture.

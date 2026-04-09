# Handoff: Electron + NKN implementation

**Project**: Portable Decentralized Agents compatible with Web Apps (NLnet PoC)
**Repo**: https://github.com/Phrytes/canopy-mono
**Author**: the author

---

## 1. What has been built

### Core concept
A browser-based demo of an A2A (Agent-to-Agent) protocol where agents have:
- Profiles (Echo Bot, Calculator, Note Taker, Greeter, Admin)
- Acceptance policies (`accept_all`, `group_only`, `manual`, `skill_whitelist`)
- Gossip-based peer discovery (agent cards broadcast on connect)
- Task protocol: submitted → working → completed / failed / rejected

### Files that matter
```
demo.html          — main demo app (the file you will mostly work in)
sdk/src/
  Agent.js         — A2A Agent class (transport-agnostic)
  transport/
    Transport.js       — abstract base class
    NknTransport.js    — NKN transport (Node.js only, NOT browser-safe)
    PeerJSTransport.js — PeerJS transport
  protocol/Task.js — TaskState enum + Task class
  index.js         — exports
index.html         — earlier simpler demo (ignore)
display.html       — display-only agent (ignore)
control.html       — controller agent (ignore)
client.js          — standalone Node.js NKN test script
client.html        — earlier browser NKN test (ignore)
signaling/         — PeerJS signaling server (Railway, ignore for now)
```

### Current transport situation in demo.html
`demo.html` has **two parallel transports**:

| Transport | Status | How |
|-----------|--------|-----|
| **MQTT** | Working, cross-device | `wss://broker.hivemq.com:8884`, address = 16-char hex, stored in `localStorage('demo_mqtt_id')` |
| **PeerJS** | Working, same-network | `0.peerjs.com` cloud signaling, address = UUID, stored in `sessionStorage('demo_peer_id')` |

The UI shows two connect inputs ("via MQTT" and "via PeerJS") and two address displays.
`send(peerId, msg)` routes to the correct transport via `knownPeers.get(peerId).transport`.
`checkAutoConnect()` detects address type: UUID pattern → PeerJS, anything else → MQTT.
QR code encodes the MQTT address by default.

### Why NKN doesn't work in the browser
NKN's JavaScript SDK (`nkn-sdk@1.3.6`) works fine in Node.js. In the browser it fails because:
- After RPC discovery (HTTPS port 443, works fine), it connects to NKN nodes via **WebSocket on port 30002**
- Mobile networks and many firewalls block non-standard ports
- There is no NKN gateway on port 443

This is a fundamental limitation, not a code bug. Node.js doesn't have this restriction.

---

## 2. The task: Electron app with NKN transport

### Goal
Rebuild `demo.html` as an **Electron desktop app** where:
- The **main process** (Node.js) runs the NKN client — no port blocking, works natively
- The **renderer process** loads the existing HTML/CSS/JS UI — no changes needed to the UI logic
- Main ↔ renderer communicate via Electron IPC (contextBridge)
- The result is a **cross-platform desktop app** (Windows, Mac, Linux) that can connect to any agent on any device via NKN

### Architecture

```
┌─────────────────────────────────────────────┐
│  Electron Main Process (Node.js)            │
│                                             │
│  nkn-sdk MultiClient                        │
│    ↕ (IPC)                                  │
│  ipcMain handlers:                          │
│    nkn:connect    → start NKN client        │
│    nkn:send       → client.send(addr, msg)  │
│    nkn:getAddr    → client.addr             │
│    nkn:onMessage  → push to renderer        │
└───────────────┬─────────────────────────────┘
                │ contextBridge (preload.js)
┌───────────────┴─────────────────────────────┐
│  Renderer Process (demo.html)               │
│                                             │
│  window.electronAPI.nkn.send(addr, msg)     │
│  window.electronAPI.nkn.getAddress()        │
│  window.electronAPI.nkn.onMessage(cb)       │
│                                             │
│  startNkn() uses window.electronAPI         │
│  instead of nkn-sdk directly               │
│  MQTT and PeerJS transports kept as-is      │
└─────────────────────────────────────────────┘
```

---

## 3. Step-by-step implementation plan

### Step 1 — Set up Electron project structure

Create a new directory (or use the repo root) for the Electron app:

```
electron-app/
  package.json      ← Electron entry point
  main.js           ← main process
  preload.js        ← contextBridge
  renderer/
    demo.html       ← copy of demo.html, adapted for Electron
```

**`electron-app/package.json`:**
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
    "nkn-sdk": "^1.3.6"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.0.0"
  }
}
```

### Step 2 — Write `main.js`

```js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const nkn  = require('nkn-sdk');

let mainWindow;
let nknClient;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,   // keep renderer sandboxed
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'demo.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── NKN IPC handlers ──────────────────────────────────────────────────────────

ipcMain.handle('nkn:connect', async (_event, { seed, identifier }) => {
  if (nknClient) { nknClient.close(); nknClient = null; }

  const opts = {};
  if (seed)       opts.seed       = seed;
  if (identifier) opts.identifier = identifier;

  return new Promise((resolve, reject) => {
    nknClient = new nkn.MultiClient(opts);

    nknClient.on('connect', () => {
      resolve({ addr: nknClient.addr, seed: nknClient.seed });
    });

    nknClient.on('message', ({ src, payload }) => {
      // Push incoming message to renderer
      mainWindow?.webContents.send('nkn:message', {
        src,
        payload: payload.toString(),
      });
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

ipcMain.handle('nkn:close', () => {
  nknClient?.close();
  nknClient = null;
});
```

### Step 3 — Write `preload.js`

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  nkn: {
    connect:    (opts)       => ipcRenderer.invoke('nkn:connect', opts),
    send:       (addr, msg)  => ipcRenderer.invoke('nkn:send', addr, msg),
    getAddr:    ()           => ipcRenderer.invoke('nkn:getAddr'),
    close:      ()           => ipcRenderer.invoke('nkn:close'),
    onMessage:  (callback)   => {
      ipcRenderer.on('nkn:message', (_event, data) => callback(data));
    },
    offMessage: ()           => ipcRenderer.removeAllListeners('nkn:message'),
  },
});
```

### Step 4 — Adapt `demo.html` for Electron

Copy `demo.html` to `electron-app/renderer/demo.html`.

#### 4a. Remove the NKN CDN script (not needed — NKN runs in main process)
The current `demo.html` has a `<script src="https://unpkg.com/mqtt/...">` and previously had a `<script src="nkn-sdk">` CDN. In the Electron renderer, neither is needed for NKN.

#### 4b. Replace `startMqtt()` logic — add `startNkn()` back

The current `startMqtt()` function initializes MQTT. Add a new `startNkn()` function that uses the Electron IPC bridge. Place it alongside `startMqtt()`:

```js
// ─────────────────────────────────────────────────────────────────────────────
// NKN transport (Electron only — uses main process IPC bridge)
// ─────────────────────────────────────────────────────────────────────────────

let nknAddress = null;

async function startNkn() {
  if (!window.electronAPI?.nkn) return;   // not in Electron, skip

  const savedSeed = localStorage.getItem('demo_nkn_seed');
  const savedId   = localStorage.getItem('demo_nkn_id');

  try {
    const result = await window.electronAPI.nkn.connect({
      seed:       savedSeed || undefined,
      identifier: savedId   || undefined,
    });

    nknAddress = result.addr;
    if (!savedSeed) localStorage.setItem('demo_nkn_seed', result.seed);

    document.getElementById('nkn-id-display').textContent = nknAddress;
    document.getElementById('my-addr').textContent = nknAddress.slice(0,10)+'…'+nknAddress.slice(-6);
    document.getElementById('qr-btn').disabled = false;
    updateDot();
    log('sys', `NKN ready: ${nknAddress.slice(0,30)}…`);

    // Wire incoming messages
    window.electronAPI.nkn.onMessage(({ src, payload }) => {
      try {
        const msg = JSON.parse(payload);
        if (!knownPeers.has(src))
          knownPeers.set(src, { id: src, label: src.slice(0,20)+'…', card: null, connected: true, transport: 'nkn' });
        else
          knownPeers.get(src).connected = true;
        handleMessage(src, msg);
        renderPeers();
        updateTargetDropdown();
      } catch (e) { log('err', 'NKN parse error: ' + e.message); }
    });

  } catch (e) {
    log('err', 'NKN connect failed: ' + e.message);
  }
}
```

#### 4c. Update `send()` to include the NKN branch

In the existing `send()` function, the current branches are `mqtt` and `peerjs`. Add `nkn`:

```js
async function send(peerId, msg) {
  const transport = knownPeers.get(peerId)?.transport ?? 'mqtt';

  if (transport === 'nkn') {
    if (!window.electronAPI?.nkn) return;
    try {
      await window.electronAPI.nkn.send(peerId, JSON.stringify(msg));
    } catch (e) {
      const entry = knownPeers.get(peerId);
      if (entry) { entry.connected = false; renderPeers(); updateTargetDropdown(); }
      log('sys', `${entry?.card?.name ?? peerId.slice(0,20)+'…'} went offline (NKN)`);
    }

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

#### 4d. Add NKN connect UI to the sidebar

In the HTML sidebar, add a third connect input for NKN (only show in Electron):

```html
<div id="nkn-connect-section" style="display:none">
  <div style="font-size:10px;color:var(--muted);margin-bottom:4px">via NKN</div>
  <div style="display:flex;gap:6px;margin-bottom:10px">
    <input id="nkn-connect-input" placeholder="identifier.pubkey…" style="flex:1;min-width:0" />
    <button class="btn primary" style="width:auto;padding:0 12px;flex-shrink:0" onclick="connectViaNkn()">→</button>
  </div>
</div>
```

And add an NKN address display:

```html
<div id="nkn-address-section" style="display:none">
  <div style="font-size:10px;color:var(--muted);margin-bottom:2px">NKN <span style="opacity:.5">(desktop)</span></div>
  <div id="nkn-id-display" onclick="copyNknAddr()" title="Click to copy NKN address"
       style="font-family:monospace;font-size:9px;color:var(--muted);word-break:break-all;cursor:pointer;margin-bottom:8px;line-height:1.5">connecting…</div>
</div>
```

Show these sections only in Electron by checking `window.electronAPI?.isElectron`:

```js
// In boot section, after startNkn():
if (window.electronAPI?.isElectron) {
  document.getElementById('nkn-connect-section').style.display = '';
  document.getElementById('nkn-address-section').style.display = '';
}
```

#### 4e. Add `connectViaNkn()` function

```js
async function connectViaNkn() {
  const addr = document.getElementById('nkn-connect-input').value.trim();
  if (!addr)    { toast('Paste an NKN address first'); return; }
  if (!nknAddress) { toast('NKN not ready yet'); return; }
  if (knownPeers.get(addr)?.connected) { toast('Already connected'); return; }

  knownPeers.set(addr, { id: addr, label: addr.slice(0,20)+'…', card: null, connected: false, transport: 'nkn' });
  renderPeers();

  try {
    await window.electronAPI.nkn.send(addr, JSON.stringify({ type: 'agent_card_request' }));
    await window.electronAPI.nkn.send(addr, JSON.stringify({ type: 'peer_list_request' }));
    log('sys', `NKN: reaching out to ${addr.slice(0,20)}…`);
    document.getElementById('nkn-connect-input').value = '';
  } catch (e) {
    log('err', `NKN: could not reach ${addr.slice(0,20)}… — offline?`);
    knownPeers.delete(addr);
    renderPeers();
  }
}
```

#### 4f. Update `applyCustomId()` to also restart NKN

In `applyCustomId()`, add:
```js
localStorage.setItem('demo_nkn_id', raw);
if (window.electronAPI?.nkn) {
  window.electronAPI.nkn.close();
  nknAddress = null;
  document.getElementById('nkn-id-display').textContent = 'connecting…';
}
// ... existing restart logic ...
startNkn();  // add this call alongside start() and startMqtt()
```

#### 4g. Update `checkAutoConnect()` to detect NKN addresses

NKN addresses look like `identifier.64hexchars` or just `64hexchars`.
Add to the detection logic:

```js
const isNkn    = /^(?:[a-zA-Z0-9_-]+\.)?[0-9a-f]{64}$/.test(id);
const isPeerJS = /^[0-9a-f]{8}-[0-9a-f]{4}-...$/.test(id);
// isNkn → 'nkn-connect-input' + connectViaNkn()
// isPeerJS → 'peerjs-connect-input' + connectViaPeerJS()
// else → 'mqtt-connect-input' + connectViaMqtt()
```

#### 4h. Update `updateDot()` to include NKN

```js
function updateDot() {
  const ready = (nknAddress && window.electronAPI?.isElectron)
             || mqttClient?.connected
             || peer?.open;
  document.getElementById('dot').className = ready ? 'dot ready' : 'dot warn';
}
```

#### 4i. Update `renderPeers()` peer-click routing

```js
const input = e.transport === 'nkn'   ? 'nkn-connect-input'   :
              e.transport === 'mqtt'  ? 'mqtt-connect-input'  :
                                        'peerjs-connect-input';
onclick="document.getElementById('${input}').value='${e.id}'"
```

#### 4j. Boot section

```js
renderAll();
start();         // PeerJS
startMqtt();     // MQTT
startNkn();      // NKN (no-op if not in Electron)
checkAutoConnect();
```

### Step 5 — Install and run

```bash
cd electron-app
npm install
npm start
```

### Step 6 — Test NKN cross-device

1. Open the Electron app on two machines (or phone via the MQTT path)
2. Copy the NKN address from one machine
3. Paste into the other's "via NKN" connect input
4. The NKN address format: `myname.56cb429b71b520bc4cb7f0c53920351ced3b55bca650548b18c44d078ff6e00e`

---

## 4. Key things to know going in

### The existing `demo.html` transport architecture (do not break this)

```js
// Runtime state
let peer, myAddress;          // PeerJS
let mqttClient, mqttAddress;  // MQTT
// NKN will add: let nknAddress  (main process stores nknClient)

const connections = new Map();  // peerId → DataConnection  (PeerJS only)
const knownPeers  = new Map();  // peerId → { id, label, card, connected, transport }
```

The `transport` field on a `knownPeers` entry is the key — it tells `send()` which path to use.

### MQTT message format adds `_from`
MQTT has no sender info in the protocol. The sender's address is embedded:
```js
// Publishing
mqttClient.publish(MQTT_TOPIC(peerId), JSON.stringify({ ...msg, _from: mqttAddress }));

// Receiving — strip _from before passing to handleMessage
const { _from, ...msg } = JSON.parse(payload.toString());
handleMessage(_from, msg);
```
NKN and PeerJS include the sender address natively, so they don't need `_from`.

### Message types handled by `handleMessage()`
```
agent_card_request  → reply with agent_card_response
agent_card_response → store card in knownPeers, re-render
peer_list_request   → reply with peer_list_response
peer_list_response  → merge into knownPeers (gossip discovery)
task                → evaluate policy, run skill, reply with task_update
task_update         → resolve/reject pending outbound task promise
```

### Profile/policy system
```js
const PROFILES = [
  { id:'echo',        policy:{ mode:'accept_all' },              skills:[...] },
  { id:'calculator',  policy:{ mode:'group_only', group:'dev-team' }, skills:[...] },
  { id:'notes',       policy:{ mode:'manual' },                  skills:[...] },
  { id:'greeter',     policy:{ mode:'skill_whitelist', allowed:['greet','farewell','ping'] }, skills:[...] },
  { id:'admin',       policy:{ mode:'manual' },                  skills:[...] },
];
```
Switching profiles does NOT change the agent address — it broadcasts the updated card to all connected peers.

### Persistent addresses
- **MQTT address**: `localStorage('demo_mqtt_id')` — 16-char hex, generated once
- **PeerJS address**: `sessionStorage('demo_peer_id')` — UUID, tab-local
- **NKN address**: derived from `localStorage('demo_nkn_seed')` + optional `localStorage('demo_nkn_id')` prefix

### SDK structure (`sdk/src/`)
The SDK already has `NknTransport.js` for Node.js use. The Agent class is transport-agnostic. The Electron main process could use `Agent` + `NknTransport` directly instead of raw `nkn-sdk` calls — this would be cleaner and reuse the existing abstraction. However, getting the demo working first with raw IPC calls is simpler.

---

## 5. Future: Mobile (React Native or Tauri)

Tauri v2 supports iOS and Android. It has the same main/renderer split as Electron (Rust backend + WebView frontend). NKN's JS SDK won't work in the Tauri WebView for the same port-blocking reason, but Tauri's Rust backend could:
- Use the NKN Rust SDK (`nkn-sdk-rust`) or make raw HTTP+WebSocket calls to NKN nodes
- Expose the same IPC interface as the Electron preload bridge

This means the renderer code (`demo.html`) would be shared between Electron and Tauri with minimal changes — the only difference is `window.electronAPI` vs `window.__TAURI__` for the IPC bridge. A thin adapter layer handles this.

For now: ship Electron desktop first, Tauri mobile as a follow-up milestone.

---

## 6. Repo state at time of this handoff

- **Branch**: `master`
- **Last commit**: `0ccf05c` — "Replace NKN with MQTT transport"
- **Railway deployment**: `canopytest-production.up.railway.app` — PeerJS signaling server, currently unused (apps point to `0.peerjs.com`)
- **GitHub**: https://github.com/Phrytes/canopy-mono

All working code is in `demo.html` (the browser demo). The SDK (`sdk/`) is a separate Node.js module that mirrors the architecture but is not used by `demo.html` directly — they evolved in parallel.

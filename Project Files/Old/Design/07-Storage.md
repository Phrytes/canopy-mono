# Storage

Storage in this system has three distinct concerns that are kept separate:

| Concern | What | Where |
|---------|------|-------|
| **Vault** | Private keys, credentials, tokens | Secure OS/hardware storage |
| **Agent cache** | Known peers, capability cards, gossip state | Local persistent storage |
| **Data sources** | App data the agent's capabilities work with | Anywhere — local or remote |

---

## Vault

The vault stores secret material. The private key never leaves it in plaintext. All vault backends implement the same interface:

```js
class Vault {
  async get(key)           // retrieve a secret → string | null
  async set(key, value)    // store a secret
  async delete(key)        // remove a secret
  async has(key)           // check existence → bool
  async list()             // list all stored keys (not values)
}
```

### Backends

**`VaultMemory`**
In-memory Map. Secrets lost on process exit. Used for tests and ephemeral server agents that generate a fresh identity each run.

**`VaultLocalStorage`** (browser)
Stores encrypted secrets in `localStorage`. Encryption key derived from a user passphrase via PBKDF2. PoC-level security — the encryption key lives in memory and localStorage is accessible to any same-origin JS. Good enough for development and low-risk use.

**`VaultIndexedDB`** (browser)
Same as LocalStorage variant but uses IndexedDB. Supports larger secrets and works better with async patterns. Preferred over LocalStorage for production browser use.

**`VaultNodeFs`** (Node.js)
Writes an encrypted file to disk (AES-256-GCM). Encryption key derived from a machine-specific secret (hostname + user + a random salt stored alongside the file). Used by the relay server and any Node.js desktop agent. Not interactive — no passphrase prompt.

**`VaultKeytar`** (Node.js desktop)
Uses the `keytar` npm package which wraps the OS-native secret store:
- macOS: Keychain
- Windows: Credential Manager
- Linux: libsecret / GNOME Keyring

Best desktop security. Secrets are hardware-protected on modern machines. Requires the user to be logged in — the OS handles the unlock.

**`KeychainVault`** (React Native, in `@canopy/react-native`)
Uses `react-native-keychain`. Backed by:
- iOS: Secure Enclave (hardware) or Keychain (software fallback)
- Android: Android Keystore (hardware-backed on modern devices)

Best mobile security available through JS.

### Online vault compatibility

The `Vault` interface is intentionally minimal — any key-value store with async get/set can be a vault backend. Adapters for online vaults are planned:

**`VaultBitwarden`** — Bitwarden has an open API and a self-hostable server. An adapter would authenticate once, cache secrets locally in memory, and sync on write. Bitwarden can be self-hosted, making it compatible with the project's decentralization goals.

**`VaultOnePassword`** — 1Password has a developer SDK. Similar adapter pattern.

**`VaultSolidPod`** — A Solid Pod can store encrypted vault entries in a private container. The pod acts as a portable cloud backup of the vault. Secrets are encrypted with the agent's public key before upload, so the pod provider sees only ciphertext.

```yaml
# In agent file — vault backend is declared per-agent:
vault:
  backend: solid-pod
  url: https://alice.solidpod.example/vault/
  # or: backend: keytar | indexeddb | memory | bitwarden | ...
```

The online vault adapters are future work. For PoC: use the appropriate local backend per platform.

---

## Agent cache

The agent cache stores derived, rebuildable state: known peers, their capability cards, gossip routing tables, and subscription lists. It is not secret but should be persistent across restarts.

`AgentCache.js` uses a pluggable storage backend with the same interface as a simple key-value store:

```js
class StorageBackend {
  async get(key)
  async set(key, value)
  async delete(key)
  async keys()
}
```

Backends:
- Browser: `localStorage` (simple) or `IndexedDB` (larger/async-safe)
- React Native: `AsyncStorage` via `AsyncStorageAdapter`
- Node.js: a small JSON file on disk via `FileSystemAdapter`, or SQLite via `better-sqlite3` for larger caches

---

## Data sources

Data sources are where an agent's capabilities get their data from. They are declared in the agent file under `storage.sources` and accessed by capability handlers via a label.

```js
// In a capability handler:
const data = await agent.storage.get('private', '/notes/today.md');
await agent.storage.set('app', '/tasks/new-task.json', taskData);
```

All data sources implement the same abstract interface:

```js
class DataSource {
  async read(path)              // → Buffer | string | null
  async write(path, data)       // → void
  async delete(path)            // → void
  async list(prefix)            // → string[]   (paths)
  async query(filter)           // → object[]   (optional, structured sources)
}
```

### Built-in implementations

**`MemorySource`** (all platforms)
In-memory Map. No persistence — data is lost when the process exits. Useful for testing, ephemeral capability state, and prototyping without needing any real storage setup. Works identically on browser, Node.js, and React Native.

```js
// In tests or ephemeral agents:
const agent = new Agent({
  storage: { sources: [{ label: 'scratch', type: 'memory' }] }
});
await agent.storage.write('scratch', '/tmp/result.json', data);
const result = await agent.storage.read('scratch', '/tmp/result.json');
```

`MemorySource` also pairs naturally with `VaultMemory` for a fully in-memory agent instance — useful when you want two agents to talk through `InternalTransport` in a test without touching any real storage.

**`IndexedDBSource`** (browser)
Stores structured data in browser IndexedDB. Survives page reload. Good for offline-first apps. Up to several GB depending on browser.

**`FileSystemSource`** (Node.js)
Reads/writes the local filesystem via `node:fs/promises`. Used by relay server and Node.js desktop agents. The `path` argument maps to a real file path under a configured root directory.

**`FileSystemAccessSource`** (browser, modern Chrome/Edge only)
Uses the browser's [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API). Gives a web app direct read/write access to local files — the user picks a directory once and grants permission. Useful for desktop-like web apps that need to work with local files without requiring Node.js.

### Planned implementations

**`SolidPodSource`**
Reads/writes a [Solid Pod](https://solidproject.org/) via HTTP (LDP protocol). The user owns the pod. Authentication via WebID-OIDC. All writes go to the user's pod, not any server controlled by the developer. Highest alignment with project goals.

```yaml
storage:
  sources:
    - label:      private
      type:       solid-pod
      url:        https://alice.solidpod.example/data/
      credential: vault:solid-pod-token
```

**`GoogleDriveSource`**
Google Drive API via OAuth2. Familiar to most users. Less aligned with decentralization goals but pragmatic for adoption.

**`S3Source`**
S3-compatible object storage (AWS S3, Cloudflare R2, Backblaze B2, self-hosted MinIO). Good for relay servers and power users.

**`SQLiteSource`** (Node.js)
Local SQLite database via `better-sqlite3`. Supports `query()` with SQL filter. Best for structured agent data on desktop/server.

### Declaration in agent file

```yaml
storage:
  sources:
    - label:      private        # how capability code refers to this source
      type:       solid-pod
      url:        https://alice.solidpod.example/agent/
      credential: vault:solid-pod-token   # resolved from vault at runtime

    - label:      app
      type:       indexeddb
      name:       myapp-db       # IndexedDB database name

    - label:      local
      type:       filesystem     # Node.js only
      root:       /home/alice/.agent-data/

    - label:      files
      type:       file-system-access   # browser File System Access API
      # user picks directory at first use; permission persisted by browser
```

---

## Platform summary

| Platform | Vault | Agent cache | Local data |
|----------|-------|-------------|------------|
| Browser | IndexedDB (encrypted) | IndexedDB | IndexedDB + File System Access API |
| Node.js (server/relay) | VaultNodeFs or VaultKeytar | JSON file or SQLite | Filesystem or SQLite |
| React Native (iOS) | Secure Enclave / Keychain | AsyncStorage | react-native-fs |
| React Native (Android) | Android Keystore | AsyncStorage | react-native-fs |
| Future: all platforms | SolidPod or Bitwarden | SolidPod | SolidPod or S3 |

---

## Internal vs same-machine agents

Two agents can be "local" in two different senses:

**In-app** (same JS runtime)
Multiple agents running in the same JavaScript process or browser tab. They share memory and can use `InternalTransport` — an EventEmitter bus with no network overhead. Useful for: an app that runs multiple specialized sub-agents internally, unit testing the full agent stack without a network.

```js
const bus = new InternalBus();
const agentA = new Agent({ transport: new InternalTransport(bus, 'agent-a') });
const agentB = new Agent({ transport: new InternalTransport(bus, 'agent-b') });
// agentA and agentB can now exchange messages without touching the network
```

**Same machine, different process**
Two agents running in different processes on the same physical machine — e.g. a browser tab talking to a local Node.js relay, or a desktop app talking to a local IoT agent daemon.

`LocalTransport` handles this. It uses a localhost WebSocket (or Unix domain socket on Linux/macOS for lower overhead). The connection stays on loopback — it never leaves the machine.

```
Browser tab (Agent A) ──ws://localhost:PORT──→ Node.js process (Agent B)
```

This is distinct from `InternalTransport` (no network at all) and from `MdnsTransport` (LAN, leaves the machine). The routing priority reflects this:

```
Internal (in-app) > Local (same machine) > BLE/mDNS (LAN) > NKN/MQTT > Relay
```

Note: on mobile (React Native), same-machine inter-process communication is sandboxed by the OS. iOS and Android prevent apps from talking to each other via localhost. `LocalTransport` is therefore a desktop/server-only transport. On mobile, use `MdnsTransport` for same-device discovery if needed (it can connect to `127.0.0.1` when both agents are on the same device and one acts as a mDNS server).

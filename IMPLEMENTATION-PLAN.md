# Implementation Plan — canopy Agent SDK

Concrete class-level code design and phased roadmap for the three-package agent SDK.
Design authority: `Design-v3/` (additions) + `Design/` (base spec).

---

## Package overview

```
@canopy/core          Pure JS. Browser, Node.js, React Native.
                        All transport, protocol, security, storage, A2A.

@canopy/relay         Node.js only. Relay + rendezvous server.
                        WsServerTransport, RelayAgent.

@canopy/react-native  React Native extras.
                        MdnsTransport, BleTransport, KeychainVault,
                        AsyncStorageAdapter.
```

---

## Delegation groups

Each group can be implemented independently once its dependencies are done.
Dependencies are listed at the top of each group.

```
Group A  Foundation              (no internal deps)
Group B  Vault implementations   (depends: A)
Group C  Agent + file loading    (depends: A, B)
Group D  Protocol handlers       (depends: A, B, C)
Group E  Permissions             (depends: A, C, D)
Group F  Transport impls         (depends: A)
Group G  Routing + Discovery     (depends: A, C, D, E, F)
Group H  A2A layer               (depends: A, C, D, E, G)
Group I  Storage (data sources)  (depends: A, B)
Group J  Identity advanced       (depends: A, B, C, E)
Group K  Relay package           (depends: A, F)
Group L  React Native package    (depends: A, B, F)
```

---

## Key data structures (shared across groups)

These types are consumed everywhere. Define them in `src/types.js` or as JSDoc typedefs.

### Envelope

```js
/**
 * @typedef {Object} Envelope
 * @property {number} _v        - Schema version (always 1)
 * @property {string} _p        - Pattern code: HI|OW|AS|AK|RQ|RS|PB|ST|SE|BT|IR|RI|CX
 * @property {string} _id       - UUIDv4. Dedup + correlation key.
 * @property {string|null} _re  - Reply-to _id (RS, AK, RI, IR carry this)
 * @property {string} _from     - Sender pubKey (base64url) or NKN address
 * @property {string} _to       - Recipient pubKey or transport address
 * @property {string|null} _topic - PubSub topic (PB only)
 * @property {number} _ts       - Unix timestamp ms. Replay-window check.
 * @property {string} _sig      - Ed25519 signature (base64url). HI: sig over plaintext. Others: sig over ciphertext.
 * @property {*} payload        - HI: plaintext object. Others: nacl.box ciphertext (Uint8Array or base64url).
 */
```

Pattern codes:

| Code | Name          | Direction | Notes                                     |
|------|---------------|-----------|-------------------------------------------|
| `HI` | Hello         | ↔         | Signed, not encrypted. Carries agent card.|
| `OW` | OneWay        | →         | Fire-and-forget. No reply expected.       |
| `AS` | AckSend       | →         | Sender wants delivery ACK.                |
| `AK` | Acknowledge   | ←         | Empty payload. Delivery confirmed.        |
| `RQ` | Request       | →         | Wants a result. Starts a task.            |
| `RS` | Response      | ←         | Task result or error.                     |
| `PB` | Publish       | →         | Pub-sub broadcast. `_topic` set.          |
| `ST` | StreamChunk   | →         | One chunk. nacl.secretbox encrypted.      |
| `SE` | StreamEnd     | →         | Final chunk / close signal.               |
| `BT` | BulkChunk     | →         | One chunk of an acknowledged bulk xfer.   |
| `IR` | InputRequired | ←         | Task paused; handler needs more input.    |
| `RI` | ReplyInput    | →         | Caller reply to an IR.                    |
| `CX` | Cancel        | →         | Cancel an in-progress task.               |

### TaskPayload (inside `envelope.payload` for task envelopes)

```js
// RQ — task submitted
{ taskId: string, skillId: string, parts: Part[] }

// RS — completed
{ taskId: string, state: 'completed', artifacts: [{ name: string, parts: Part[] }] }

// RS — failed
{ taskId: string, state: 'failed', error: { code: string, message: string, parts?: Part[] } }

// ST — stream chunk
{ taskId: string, seq: number, streamId: string, parts: Part[], final: false }

// SE — stream end
{ taskId: string, seq: number, streamId: string, parts: Part[], final: true }

// IR — input required
{ taskId: string, parts: Part[] }   // question

// RI — reply input
{ taskId: string, parts: Part[] }   // answer

// CX — cancel
{ taskId: string }
```

### Part types

```js
// TextPart
{ type: 'TextPart', text: string }

// DataPart
{ type: 'DataPart', data: object }

// FilePart
{ type: 'FilePart', mimeType: string, name?: string,
  data?: string /* base64 */ | url?: string }

// ImagePart
{ type: 'ImagePart', mimeType: string, data: string /* base64 */ }
```

### PeerRecord (in PeerGraph)

```js
// Native peer
{
  type: 'native',
  pubKey: string,           // stable Ed25519 identity
  id: string,               // human slug
  label: string,
  trustTier: 0|1|2|3,
  groups: string[],         // group ids for which valid proofs are held
  skills: SkillCard[],      // filtered to current trust tier
  transports: {
    [transportName]: { address?: string, url?: string,
                       lastLatencyMs: number, lastSeen: number }
  },
  reachable: boolean,
  unreachableSince: number|null,
  lastSeen: number,
  discoveredVia: string,
  introducedBy: string|null,
}

// A2A peer
{
  type: 'a2a',
  url: string,              // base URL, e.g. https://agent.example.com
  name: string,
  description: string,
  skills: SkillCard[],
  authScheme: 'Bearer'|'None',
  pubKey?: string,          // from x-canopy.pubKey
  nknAddr?: string,         // from x-canopy.nknAddr
  localTrust?: { tier: number, groups: string[] },
  lastFetched: number,
  reachable: boolean,
}
```

### SkillDefinition (internal, in SkillRegistry)

```js
{
  id: string,
  handler: async function(parts, context) | async function*(parts, context),
  description: string,
  inputModes: string[],
  outputModes: string[],
  tags: string[],
  streaming: false | 'unidirectional' | 'bidirectional',
  visibility: 'public'|'authenticated'|`group:${string}`|`token:${string}`|'private',
  policy: 'always'|'on-request'|'negotiated'|`group:${string}`|'token'|'never',
  tokenDelegation?: {
    allowed: boolean,
    maxDepth: number,
    maxChainAgeSeconds?: number,
    requireIssuerTier?: number,
  },
  enabled: boolean,
  isBuiltIn: boolean,
}
```

### SkillCard (in agent card + PeerRecord)

```js
{
  id: string,
  name: string,
  description: string,
  inputModes: string[],
  outputModes: string[],
  tags: string[],
  streaming: false | 'unidirectional' | 'bidirectional',
  requiresNative?: boolean,  // x-canopy extension for A2A callers
}
```

### CapabilityToken

```js
{
  _type: 'capability-token',
  issuer: string,            // issuer pubKey
  subject: string,           // recipient pubKey (native) or JWT sub (A2A)
  skill: string,             // skill id
  agentId: string,
  constraints: {
    maxCalls?: number,
    notBefore?: number,
    context?: object,
  },
  issuedAt: number,
  expiresAt: number,
  sig: string,               // Ed25519 sig by issuer over canonical JSON
  // Delegation:
  parent?: CapabilityToken,  // present if this is a sub-token
}
```

### GroupProof

```js
{
  _type: 'group-proof',
  groupId: string,
  memberPubKey: string,
  adminPubKey: string,
  issuedAt: number,
  expiresAt: number,
  sig: string,               // Ed25519 sig by adminPrivKey
}
```

---

## Group A — Foundation

**No internal dependencies. Implement first.**

### `src/Envelope.js`

```js
class Envelope {
  // Factory. Sets _v, _id, _ts, _from, _to. Caller sets _p and payload.
  static mk(p, from, to, payload, opts = {})
  // → { _v:1, _p, _id: uuid(), _re: opts.re ?? null, _from: from,
  //     _to: to, _topic: opts.topic ?? null, _ts: Date.now(),
  //     _sig: null,  // filled by SecurityLayer
  //     payload }

  // Canonical JSON for signing (excludes _sig)
  static canonicalize(envelope)  // → string
}
```

### `src/transport/Transport.js`

Abstract base. Subclasses implement only `_put(to, envelope)`.

```js
class Transport extends EventEmitter {
  constructor({ identity, securityLayer })

  // ── Public API ────────────────────────────────────────────────────
  get address()                                  // this agent's address on this transport
  async connect()                                // subclass lifecycle
  async disconnect()
  useSecurityLayer(layer)                        // set SecurityLayer or A2ATLSLayer
  setReceiveHandler(fn)                          // Agent calls this to register inbound dispatch

  // ── Four primitives (default envelope-based implementations) ────
  async sendOneWay(to, payload)                  // OW
  async sendAck(to, payload, timeout = 10_000)   // AS + awaits AK
  async request(to, payload, timeout = 30_000)   // RQ + awaits RS
  async respond(to, replyToId, payload)          // RS

  // ── Wire primitive (subclasses must override) ────────────────────
  async _put(to, envelope)                       // throws 'not implemented'

  // ── Inbound (subclasses call this on message receipt) ────────────
  _receive(rawEnvelope)
  // → SecurityLayer.verifyAndDecrypt → dispatch by _p code:
  //   OW/AS/RQ/PB/ST/SE/BT/IR/RI/CX/HI → emit 'envelope', invoke setReceiveHandler fn
  //   AK/RS → resolve pending promise in _pending map

  // ── Internals ─────────────────────────────────────────────────────
  _pending  // Map<_id, { resolve, reject, timer }>
  _awaitReply(id, timeout, send)  // registers pending + calls send()
}
```

### `src/transport/Envelope.js` → merged into `src/Envelope.js` above.

### `src/Parts.js`

```js
// Constructors (pure functions, no class needed)
function TextPart(text)                 // → { type: 'TextPart', text }
function DataPart(data)                 // → { type: 'DataPart', data }
function FilePart({ mimeType, name, data, url })  // → { type: 'FilePart', ... }
function ImagePart({ mimeType, data })  // → { type: 'ImagePart', ... }

class Parts {
  static text(parts)                    // first TextPart.text or null
  static data(parts)                    // merged DataPart.data objects or null
  static files(parts)                   // FilePart[] array
  static images(parts)                  // ImagePart[] array
  static wrap(value)                    // string→[TextPart], obj→[DataPart], Part[]→passthrough, Buffer→[FilePart]
  static artifact(name, parts)          // → { name, parts }
  static isValid(parts)                 // type-check a Part[]
}
```

### `src/identity/AgentIdentity.js`

```js
class AgentIdentity {
  constructor(vault)                    // vault holds private key seed

  // Called once on first run OR after mnemonic recovery
  static async generate(vault)          // → AgentIdentity (new keypair stored in vault)
  static async restore(vault)           // → AgentIdentity (loads existing keypair from vault)
  static async fromMnemonic(mnemonic, vault)  // → AgentIdentity

  get pubKey()                          // Ed25519 pubKey as base64url string
  get nknAddress()                      // deterministic from pubKey

  async sign(data)                      // Uint8Array → Uint8Array (Ed25519 sig)
  async verify(data, sig, pubKey)       // → boolean
  async box(data, recipientPubKey)      // nacl.box encrypt
  async unbox(ciphertext, senderPubKey) // nacl.box decrypt → plaintext or null
  async secretbox(data, nonce, sessionKey)     // nacl.secretbox encrypt
  async secretunbox(cipher, nonce, sessionKey) // nacl.secretbox decrypt

  // Session key (derived once after hello, reused for stream chunks)
  deriveSessionKey(peerPubKey)          // nacl.box.before(...) → sessionKey Uint8Array
}
```

### `src/identity/Mnemonic.js`

```js
// Thin wrapper over @scure/bip39
function generateMnemonic()             // → 24-word string (BIP39 256-bit)
function mnemonicToSeed(mnemonic)       // → Uint8Array (32 bytes Ed25519 seed)
function validateMnemonic(mnemonic)     // → boolean
```

### `src/identity/Vault.js`

```js
// Abstract base — implements nothing, just defines the interface + key naming conventions.
class Vault {
  // Key naming conventions (all vaults use these):
  // 'agent-privkey'          → encrypted Ed25519 private key seed
  // 'token:<peerId>:<skill>' → held capability token JSON
  // 'group-proof:<groupId>'  → signed group proof JSON
  // 'a2a-token:<url>'        → Bearer token for A2A peer
  // 'solid-pod-token'        → Solid OIDC token

  async get(key)           // → string | null
  async set(key, value)    // → void
  async delete(key)        // → void
  async has(key)           // → boolean
  async list()             // → string[] (keys only, not values)
}
```

### `src/transport/InternalTransport.js`

```js
// Two instances share an InternalBus (EventEmitter).
// Zero network — synchronous delivery via EventEmitter.
class InternalBus extends EventEmitter {}

class InternalTransport extends Transport {
  constructor(bus, address)
  async _put(to, envelope)   // bus.emit(`msg:${to}`, envelope)
  // Listens on bus.on(`msg:${address}`, ...) → _receive()
}
```

---

## Group B — Vault implementations

**Depends on: Group A (Vault base).**

Each is independent — teams can implement in parallel.

### `src/identity/VaultMemory.js`

```js
class VaultMemory extends Vault {
  constructor()              // Map in memory. No persistence.
  // Implement all 5 methods trivially.
}
```

### `src/identity/VaultLocalStorage.js` (browser)

```js
class VaultLocalStorage extends Vault {
  constructor({ prefix = 'dwag:', encryptionKey? })
  // Stores key→value in window.localStorage with optional AES-GCM encryption.
  // encryptionKey derived from user passphrase via PBKDF2.
}
```

### `src/identity/VaultIndexedDB.js` (browser)

```js
class VaultIndexedDB extends Vault {
  constructor({ dbName = 'dwag-vault', encryptionKey? })
  // IndexedDB object store. Same encryption as LocalStorage variant.
}
```

### `src/identity/VaultNodeFs.js` (Node.js)

```js
class VaultNodeFs extends Vault {
  constructor({ filePath, encryptionKey? })
  // Encrypted JSON file on disk. AES-256-GCM.
  // encryptionKey derived from machine fingerprint + stored salt if not provided.
}
```

### `src/identity/VaultKeytar.js` (Node.js desktop)

```js
class VaultKeytar extends Vault {
  constructor({ service = 'canopy' })
  // Wraps keytar npm package. macOS Keychain / Win Credential Manager / libsecret.
  // keytar is a peer dependency.
}
```

### (React Native) `src/identity/KeychainVault.js` — in `@canopy/react-native`

```js
class KeychainVault extends Vault {
  constructor({ service = 'canopy' })
  // react-native-keychain. iOS Secure Enclave / Android Keystore.
}
```

---

## Group C — Agent class and file loading

**Depends on: A, B.**

### `src/Agent.js`

The main developer-facing class. Owns everything: identity, transports, skill registry, peer graph, state manager, config.

```js
class Agent extends EventEmitter {
  constructor(options)
  // options: { identity?, vault?, skills?, transports?, config?, blueprint?, id?, label? }

  // ── Static factory methods ─────────────────────────────────────
  static async createNew(opts)            // generate keypair, store in vault
  static async fromFile(path)             // Node.js: load YAML from fs
  static async fromUrl(url, opts)         // load YAML from URL (Solid, CDN, etc.)
  static async fromFileObject(file)       // browser <input type="file">
  static async fromFileHandle(handle)     // browser File System Access API
  static async fromYaml(yamlString)
  static async fromJson(jsonString)
  static async from(plainObject)
  static async fromSolidPod(podUrl, opts)
  static async restoreFromMnemonic(mnemonic, opts)

  // ── Identity ─────────────────────────────────────────────────
  get pubKey()
  get id()
  get label()

  // ── Transports ───────────────────────────────────────────────
  addTransport(transport)
  removeTransport(name)
  getTransport(name)         // → Transport | null

  // ── Skill registration ───────────────────────────────────────
  register(id, handler, opts)               // inline style
  // defineSkill() is the standalone function; agent.register() wraps it

  // ── Interaction API (developer-facing) ───────────────────────
  async call(peerId, skillId, payload, opts)    // → Task
  async message(peerId, payload)                // OW
  async introduce(peerId, card)                 // contact forwarding
  async discoverA2A(url)                        // explicit A2A card fetch
  async issueCapabilityToken(opts)              // → token for native peer
  async issueA2ACapabilityToken(opts)           // → JWT for A2A peer
  async storeA2AToken(peerUrl, token)           // store outbound Bearer token
  async restoreFromSolidPod(podUrl)             // download backup

  // ── Sub-registries (exposed as properties) ───────────────────
  peers      // → PeerGraph instance
  skills     // → SkillRegistry instance
  vault      // → Vault instance
  storage    // → StorageManager instance
  config     // → AgentConfig instance
  identity   // → AgentIdentity instance

  // ── Lifecycle ────────────────────────────────────────────────
  async start()              // connect all transports, send hello to static peers, start ping/gossip
  async stop()               // graceful disconnect

  // ── Export / serialise ────────────────────────────────────────
  export()                   // → plain object (no secrets, safe to serialise)
}
```

### `src/skills/SkillRegistry.js`

```js
class SkillRegistry {
  register(definition)                  // SkillDefinition → void; validates and stores
  get(id)                               // → SkillDefinition | null
  all()                                 // → SkillDefinition[]
  forTier(tier)                         // → SkillDefinition[] filtered by visibility
  // Built-ins registered on construction: subscribe, file, session-open, session-message, session-close
}
```

### `src/skills/defineSkill.js`

```js
// Standalone utility used by all three registration styles.
function defineSkill(id, handler, opts)
// → SkillDefinition with defaults filled in:
//   description: '', inputModes: ['application/json'],
//   outputModes: ['application/json'], tags: [], streaming: false,
//   visibility: 'authenticated', policy: 'on-request', enabled: true
```

### `src/AgentFile.js`

```js
class AgentFile {
  // Parse YAML/JSON string → validated plain object → blueprint-resolved
  static parse(yamlOrJson)              // → AgentFileObject
  static fromPlainObject(obj)           // → AgentFileObject (fills defaults)

  // Blueprint resolution (merges blueprint chain into skill/policy/resource fields)
  static resolve(parsed, blueprintRegistry)   // → resolved AgentFileObject

  // Serialise back to YAML string (for export or pod storage)
  static toYaml(agentFileObject)        // → string
}
```

### `src/Blueprint.js` + `src/BlueprintRegistry.js`

```js
class Blueprint {
  constructor({ id, extends?, skills, policy, resources, hooks })
  // skills: MERGE up chain (child adds to parent)
  // policy/resources/hooks: OVERRIDE (child wins)

  resolve(registry)   // → merged Blueprint (all inheritance applied)
}

class BlueprintRegistry {
  register(blueprint)
  get(id)
  // Built-ins: 'default', 'household-agent', 'relay-agent', 'public-facing', 'data-worker'
}
```

### `src/config/AgentConfig.js`

```js
class AgentConfig extends EventEmitter {
  constructor({ userFile, blueprint, developerOverrides })
  // Layers: userFile (ceiling) → blueprint → developerOverrides → runtime

  get(path)                 // dot-path, e.g. 'resources.maxConnections'
  set(path, value)          // validated against user-file ceiling; throws ConfigCeilingError
  reset(path)               // remove runtime override; revert to layer below
  snapshot()                // → plain object (no secrets)
  on('changed', (path, old, new) => {})
}
```

---

## Group D — Protocol handlers

**Depends on: A, B, C.**

All handlers are thin functions or small classes that operate on Transport + Agent. They do not need to know about each other.

### `src/protocol/hello.js`

```js
async function sendHello(agent, transport, to)
// 1. Build HI envelope: { pubKey, skills (tier-0 filtered), connections, label }
// 2. envelope.payload is PLAINTEXT (HI is signed, not encrypted)
// 3. transport.request(to, hiPayload) → await HI response
// 4. PeerGraph.upsert(peerRecord from response)
// 5. Set initial trust tier

async function handleHello(agent, envelope)
// Inbound HI handler registered on transport
// Extracts peer card, upserts PeerGraph, responds with own card
```

### `src/protocol/ping.js`

```js
async function ping(agent, peerId, timeout = 5000)
// transport.sendAck(peerId, { type: 'ping' })
// → latency in ms on success, null on timeout
// Updates FallbackTable with latency
```

### `src/protocol/messaging.js`

```js
async function sendMessage(agent, peerId, parts, opts = {})
// agent.routing().selectTransport(peerId) → transport
// transport.sendAck(peerId, Parts.wrap(parts))
// Falls back to sendOneWay if sendAck times out

async function handleMessage(agent, envelope)
// Inbound OW/AS — emit 'message' on agent with { from, parts }
```

### `src/protocol/skillDiscovery.js`

(Replaces capDiscovery.js from Design/)

```js
async function requestSkills(agent, peerId, timeout = 10_000)
// transport.request(peerId, { type: 'skill-discovery' })
// → SkillCard[] filtered to our trust tier

async function handleSkillDiscovery(agent, envelope)
// Returns skills filtered by envelope._from's trust tier
// Updates PeerGraph with refreshed skills for that peer
```

### `src/protocol/taskExchange.js`

Core handler — manages the full task lifecycle for inbound and outbound tasks.

```js
// Outbound: send a task to a peer
async function callSkill(agent, peerId, skillId, parts, opts = {})
// → Task instance
// Internally:
//   1. RoutingStrategy → transport
//   2. A2A peer? → a2aTaskSend.js handles it
//   3. Native: transport.request(peerId, { taskId, skillId, parts })
//   4. Creates Task, wires up IR events
//   5. Returns Task (caller awaits task.done() or task.stream())

// Inbound: handle an incoming RQ
async function handleTaskRequest(agent, envelope)
// 1. PolicyEngine.checkInbound(peerId, skillId) → allow|deny
//    Deny → respond RS failed:policy-denied
// 2. StateManager.createTask(taskId, skillId, handler)
// 3. Run handler in Task runner
// 4. On RS: transport.respond(from, rqId, resultPayload)
// 5. On IR: transport.sendOneWay(from, irEnvelope)
// 6. On CX received: Task.cancel()
```

### `src/protocol/Task.js`

```js
class Task extends EventEmitter {
  constructor({ taskId, skillId, agent, peerId, state = 'submitted' })

  // State machine
  get state()   // 'submitted'|'working'|'completed'|'failed'|'cancelled'|'input-required'
  get taskId()

  // Caller API
  async done()                      // resolves with { state, artifacts } on complete|failed
  async* stream()                   // async generator of Part[] (unidirectional stream only)
  async cancel()                    // sends CX envelope, transitions to 'cancelled'
  async send(parts)                 // send RI reply (during input-required)

  // Events
  on('input-required', (parts) => {})   // IR received; call task.send() to continue
  on('stream-chunk', (parts) => {})     // ST received
  on('done', (result) => {})
  on('failed', (error) => {})
  on('cancelled', () => {})

  // Handler API (internal)
  static InputRequired(parts)       // throw this in a non-generator handler
  _setInputRequiredResolver(fn)     // called by taskExchange when RI arrives
}
```

### `src/state/StateManager.js`

```js
class StateManager {
  constructor()

  // Dedup cache
  isDuplicate(envelopeId)           // → boolean; caches id for 5 min
  markSeen(envelopeId)

  // Task registry
  createTask(taskId, opts)          // → Task
  getTask(taskId)                   // → Task | null
  deleteTask(taskId)

  // Stream registry (for outgoing ST/SE streams)
  openStream(streamId, opts)        // { taskId, peerId, direction, sessionKey }
  getStream(streamId)
  closeStream(streamId)

  // Session registry (bidirectional sessions — native only)
  openSession(sessionId, opts)      // { peerId, state }
  getSession(sessionId)
  closeSession(sessionId)
}
```

### `src/protocol/streaming.js`

```js
// Outbound: send a unidirectional stream from a generator
async function streamOut(agent, peerId, taskId, generator, sessionKey)
// Iterates generator → ST envelopes → _put
// Final yield / return → SE envelope
// nacl.secretbox per chunk with nonce = streamId_16 ‖ seqNumber_8

// Inbound: reassemble an incoming stream
function handleStreamChunk(agent, envelope)
// ST: StateManager.getStream(streamId) → buffer chunk → emit on Task
// SE: close stream, emit final chunk on Task

// Bidirectional: open two parallel streams (native only)
async function streamBidi(agent, peerId, taskId, handler)
// Starts outgoing stream from handler's yields
// Feeds incoming ST/SE into handler's stream.incoming async iterable
```

### `src/protocol/session.js`

Built-in skill handlers for session-open / session-message / session-close.
Native-only; A2A callers receive `failed: requires-native-transport`.

```js
async function handleSessionOpen(parts, ctx)
async function handleSessionMessage(parts, ctx)
async function handleSessionClose(parts, ctx)
// All three use StateManager session registry
```

### `src/protocol/pubSub.js`

```js
// Built-in subscribe skill handler (A2A compatible — unidirectional stream)
async function* handleSubscribe(parts, ctx)
// { topic } from DataPart
// Registers subscriber in local topic list
// Yields DataPart events as publisher calls agent.publish()

async function publish(agent, topic, parts)
// Finds all subscribers for topic in StateManager
// sends ST envelope to each (or directly via task if subscriber is active)

// Native PB envelopes (legacy pubsub for native peers)
async function handlePublish(agent, envelope)
// emit 'message' with topic on agent
```

### `src/protocol/fileSharing.js`

```js
// Outbound: smart dispatch based on peer type + file size
async function sendFile(agent, peerId, filePart)
// A2A peer OR size < threshold → inline FilePart in task payload
// Native peer + size ≥ threshold → BulkTransfer (BT/AK chunks)

// BulkTransfer implementation (native only)
async function bulkTransferSend(agent, peerId, taskId, buffer)
// Splits into 64 KB chunks → BT envelopes
// Waits for AK per chunk (retries on timeout)
// Sends BT{ _final: true } last

function handleBulkChunk(agent, envelope)
// Accumulates BT chunks in StateManager
// On _final: reassemble → deliver assembled FilePart to task handler
```

---

## Group E — Permissions

**Depends on: A, C, D.**

### `src/permissions/TrustRegistry.js`

```js
class TrustRegistry {
  constructor(vault)
  // Persists known pubKeys and their tier in vault (key: 'trust:<pubKey>')

  async setTier(pubKey, tier)
  async getTier(pubKey)          // → 0|1|2|3
  async getRecord(pubKey)        // → { tier, groups, tokenIds }
  async addGroup(pubKey, groupId)
  async removeGroup(pubKey, groupId)
  async addTokenGrant(pubKey, tokenId)
  async all()                    // → Record<pubKey, TrustRecord>
}
```

### `src/permissions/GroupManager.js`

```js
class GroupManager {
  constructor({ identity, vault })

  // Admin operations (if this agent is a group admin)
  async issueProof(memberPubKey, groupId, expiresIn = 86400)  // → GroupProof
  async revokeProof(memberPubKey, groupId)

  // Member operations
  async storeProof(proof)                    // validate + store in vault
  async getProof(groupId)                    // → GroupProof | null (own proof)
  async hasValidProof(pubKey, groupId)       // → boolean (verify any proof)
  async verifyProof(proof)                   // → boolean
  async listGroups()                         // → string[] (groups this agent is in)

  // Key rotation support
  async reissueForNewKey(oldPubKey, newPubKey, groupId)
}
```

### `src/permissions/CapabilityToken.js`

```js
class CapabilityToken {
  // Issuance
  static async issue(identity, opts)
  // opts: { subject, skill, agentId, expiresIn, constraints, parentToken? }
  // → CapabilityToken (signed)

  // Verification
  static verify(token, expectedAgentId)    // → boolean (sig + expiry check)
  static verifyChain(token)                // → boolean (walk parent chain, attenuation check)

  // JWT variant for A2A peers
  static async issueJWT(identity, opts)    // → signed JWT string
  static verifyJWT(jwt, publicKey)         // → CapabilityToken | null
}
```

### `src/permissions/TokenRegistry.js`

```js
class TokenRegistry {
  constructor(vault)

  async store(token)              // held tokens (for use as caller)
  async get(agentId, skill)       // → CapabilityToken | null (best available, not expired)
  async revoke(tokenId)           // local revocation cache
  async isRevoked(tokenId)        // → boolean
  async cleanup()                 // remove expired tokens
}
```

### `src/permissions/PolicyEngine.js`

Single entry point for all inbound permission checks. Called by all protocol handlers before invoking a skill handler.

```js
class PolicyEngine {
  constructor({ trustRegistry, groupManager, tokenRegistry, agentConfig, skillRegistry })

  // Primary check — call before every inbound task/message/discovery
  async checkInbound(opts)
  // opts: { peerPubKey, peerUrl?, skillId, action }
  // 1. Get trust tier from TrustRegistry (or A2AAuth for A2A peers)
  // 2. Check skill.visibility vs tier → throw PolicyDeniedError if not visible
  // 3. Check skill.policy vs tier → throw PolicyDeniedError if not allowed
  // 4. Check group peer cap (AgentConfig.resources.perGroup) → throw if at limit
  // → { tier, allowed: true }

  // Check outbound token for a call to a peer
  async checkOutbound(opts)
  // opts: { peerId, skillId }
  // → { token?: CapabilityToken } (token to attach if needed)

  // A2A inbound: given JWT claims
  async checkA2AInbound(opts)
  // opts: { claims, peerUrl, skillId }
  // → { tier, allowed: true }
}
```

### `src/permissions/DataSourcePolicy.js`

```js
class DataSourcePolicy {
  constructor(agentConfig)

  checkAccess(opts)
  // opts: { agentId, skillId, sourceLabel }
  // → true or throw DataSourceAccessDeniedError
}
```

---

## Group F — Transport implementations

**Depends on: A (Transport base + SecurityLayer shape). Fully independent of each other.**

Each transport extends `Transport` and implements only `_put(to, envelope)` plus any lifecycle (connect/disconnect).

### `src/transport/LocalTransport.js`

```js
class LocalTransport extends Transport {
  constructor({ port? | socketPath?, identity })
  // localhost WebSocket or Unix socket (Node.js/desktop only)
  async connect()   // connect to WS server on localhost:port or socketPath
  async _put(to, envelope)  // ws.send(JSON.stringify(envelope))
}
```

### `src/transport/NknTransport.js`

```js
class NknTransport extends Transport {
  constructor({ seed, identifier?, identity })
  // Wraps nkn-sdk. seed derived deterministically from agent pubKey.
  async connect()
  async _put(to, envelope)  // nknClient.send(to, JSON.stringify(envelope))
  get address()             // nknClient.addr
}
```

### `src/transport/MqttTransport.js`

```js
class MqttTransport extends Transport {
  constructor({ brokerUrl, address, identity })
  // brokerUrl: wss://broker.hivemq.com:8884/mqtt
  // address: hex-derived from pubKey; subscribes to topic `canopy/${address}`
  async connect()
  async _put(to, envelope)  // mqttClient.publish(`canopy/${to}`, JSON.stringify(envelope))
}
```

### `src/transport/RelayTransport.js`

```js
class RelayTransport extends Transport {
  constructor({ relayUrl, identity })
  async connect()            // WebSocket to relayUrl; sends HI to relay to register
  async _put(to, envelope)   // ws.send(JSON.stringify({ to, envelope }))
  // _receive() called by ws.onmessage after SecurityLayer wraps _put
}
```

### `src/transport/RendezvousTransport.js`

```js
class RendezvousTransport extends Transport {
  constructor({ signalingTransport, identity })
  // signalingTransport: typically RelayTransport (sends OW for SDP/ICE)
  async connect()
  async connectToPeer(peerId)
  // → creates RTCPeerConnection, exchange SDP/ICE via signalingTransport
  // → on DataChannel open: this transport takes over for that peer
  async _put(to, envelope)   // dataChannel.send(JSON.stringify(envelope))
}
```

---

## Group G — Routing + Discovery

**Depends on: A, C, D, E, F.**

### `src/routing/RoutingStrategy.js`

```js
class RoutingStrategy {
  constructor({ agent, peerGraph, fallbackTable, agentConfig })

  // Primary: pick best transport for a given peer + action
  selectTransport(peerId, opts = {})
  // opts: { pattern?, preferredTransports? }
  // 1. Look up peerId in PeerGraph
  // 2. If type === 'a2a' → return A2ATransport (no fallback chain)
  // 3. If type === 'native':
  //    Priority: Internal > Local > mDNS > Rendezvous > Relay > NKN > MQTT > BLE
  //    Skip transports not in agentConfig.policy.transportFilter
  //    Skip transports with pattern support = false for requested pattern
  //    Return best available (using FallbackTable latency data)
  // 4. Unknown peer starting with 'https://' → try a2aDiscover first
  // 5. Unknown peer → try native hello on best available transport

  onTransportFailure(peerId, transport)
  // Update FallbackTable; demote transport for this peer; may trigger hello-retry
}
```

### `src/routing/FallbackTable.js`

```js
class FallbackTable {
  constructor()

  record(peerId, transportName, latencyMs, patternSupport)
  // patternSupport: { streaming, bulk, bidi } → booleans

  getBest(peerId, filter)    // → transportName with lowest latency that supports filter
  markDegraded(peerId, transportName, until?)
  clear(peerId)
}
```

### `src/discovery/PeerGraph.js`

```js
class PeerGraph extends EventEmitter {
  constructor({ storageBackend })
  // storageBackend: StorageBackend (localStorage, IndexedDB, AsyncStorage, JSON file, SQLite)

  async upsert(record)          // native or A2A peer record; merges with existing
  async get(pubKeyOrUrl)        // → PeerRecord | null
  async all()                   // → PeerRecord[]

  // Filtered queries
  async withSkill(skillId, opts) // opts: { includeA2A, streaming, mode }
  async inGroup(groupId)
  async reachable()
  async fastest(n)
  async a2aAgents()
  async canHandle(opts)         // opts: { skill, streaming, mode }
  // Respects streaming/mode constraints — excludes A2A for bidi, session, bulk

  async setReachable(pubKeyOrUrl, reachable)
  async updateLatency(pubKey, transportName, latencyMs)
  async updateTier(pubKey, tier)

  async export()               // → JSON (no secrets)
  async import(json)           // merge external graph

  // Events
  on('added', (peer) => {})
  on('removed', (peer) => {})
  on('reachable', (peer) => {})
  on('unreachable', (peer) => {})
  on('tiered', (peer, oldTier, newTier) => {})
}
```

### `src/discovery/PeerDiscovery.js`

```js
class PeerDiscovery {
  constructor({ agent, peerGraph, pingScheduler, gossipProtocol })

  async start()              // starts ping + gossip background loops
  async stop()

  // Discovery entry points (all converge on hello or card fetch)
  async discoverByQR(qrPayload)          // parse QR → hello or card fetch
  async discoverByUrl(httpsUrl)          // → a2aDiscover
  async discoverByIntroduction(card, introducerPubKey)
  async discoverByGroupBootstrap(memberList, adminPubKey)
}
```

### `src/discovery/GossipProtocol.js`

```js
class GossipProtocol {
  constructor({ agent, peerGraph, agentConfig })

  async start()              // runs every agentConfig.discovery.gossip.interval seconds
  async stop()
  async runRound()
  // 1. Pick random Tier 1+ peer from PeerGraph
  // 2. request('peer-list', { count: N })
  // 3. For each returned card with discoverable: true → discoverByIntroduction
  // Privacy: only share peers with discoverable: true
}
```

### `src/discovery/PingScheduler.js`

```js
class PingScheduler {
  constructor({ agent, peerGraph, agentConfig })

  async start()   // pings every agentConfig.discovery.ping.interval seconds
  async stop()
  async pingAll()
  // On consecutive failure → PeerGraph.setReachable(false)
  // On recovery → PeerGraph.setReachable(true) + re-hello
  // Exponential backoff on failure
}
```

---

## Group H — A2A layer

**Depends on: A, C, D, E, G.**

### `src/a2a/A2ATLSLayer.js`

Security layer used by A2ATransport in place of SecurityLayer (nacl.box not used for A2A).

```js
class A2ATLSLayer {
  constructor({ agent, a2aAuth })

  // Wraps outbound: attach Authorization: Bearer header
  async wrapOutbound(peerUrl, requestInit)  // → requestInit with Authorization header
  // Validates inbound: Bearer JWT → trust tier
  async validateInbound(req)               // → { tier, claims, peerId: url }
}
```

### `src/a2a/A2AAuth.js`

```js
class A2AAuth {
  constructor({ vault, groupManager, tokenRegistry, agentConfig })

  // Inbound: validate Bearer JWT from HTTP request
  async validateInbound(req, agent)
  // 1. No Authorization header → tier 0
  // 2. Valid JWT → tier 1
  // 3. JWT + x-canopy-groups claim verified against GroupManager → tier 2
  // 4. JWT + capability token claim verified against TokenRegistry → tier 3
  // → { tier, claims, peerId: url }

  // Outbound: build auth headers for a fetch call to peerUrl
  async buildHeaders(peerUrl)
  // vault.get('a2a-token:${peerUrl}') → { Authorization: 'Bearer ...' } or {}

  // Token management
  async storeToken(peerUrl, token)
  async getToken(peerUrl)               // → string | null
}
```

### `src/a2a/A2ATransport.js`

HTTP server (receive A2A tasks) + HTTP client (send to A2A agents).

```js
class A2ATransport extends Transport {
  constructor({ agent, port?, baseUrl? })

  async connect()
  // Starts HTTP server if port provided:
  //   GET  /.well-known/agent.json  → AgentCardBuilder.build(agent)
  //   POST /tasks/send              → handleInboundTask
  //   POST /tasks/sendSubscribe     → handleInboundStreamTask
  //   GET  /tasks/:id               → task status from StateManager
  //   POST /tasks/:id/cancel        → handleInboundCancel
  // useSecurityLayer(new A2ATLSLayer(...)) called in agent startup

  // Called by RoutingStrategy for A2A peers:
  async _put(to, envelope)
  // to = peer URL. Translate envelope._p → A2A HTTP call:
  //   RQ → POST /tasks/send (await result → _receive(RS envelope))
  //   RQ+streaming → POST /tasks/sendSubscribe (SSE → _receive(ST/SE envelopes))
  //   OW → POST /tasks/send (fire-and-forget)
  //   CX → POST /tasks/:id/cancel

  // Server handlers
  async handleInboundTask(req, res)
  // A2AAuth.validateInbound → PolicyEngine.checkA2AInbound → run handler → respond

  async handleInboundStreamTask(req, res)
  // Like handleInboundTask but response is SSE stream; each yield → SSE event
}
```

### `src/a2a/AgentCardBuilder.js`

```js
class AgentCardBuilder {
  constructor({ agent })

  build(requestTier = 0)
  // → A2A agent card JSON object filtered to requestTier:
  // {
  //   name, description, url, version,
  //   capabilities: { streaming, pushNotifications, stateTransitionHistory },
  //   defaultInputModes, defaultOutputModes,
  //   skills: [ filtered SkillCard[] ],
  //   authentication: { schemes: ['Bearer'] },
  //   x-canopy: { version, pubKey, nknAddr, relayUrl, groups, trustTiers }
  // }
  // Private skills excluded; trustTiers map built from visibility values
}
```

### `src/a2a/a2aDiscover.js`

```js
async function discoverA2A(agent, url)
// 1. GET {url}/.well-known/agent.json
// 2. Validate required fields
// 3. Parse x-canopy if present
// 4. Build A2A peer record → PeerGraph.upsert
// 5. If x-canopy.pubKey + nknAddr/relayUrl:
//    → attempt native hello upgrade (transparent)
// Card cached: re-fetched only after agent.config.a2aCardFreshness seconds
```

### `src/a2a/a2aTaskSend.js`

```js
async function sendA2ATask(agent, peerUrl, skillId, parts, opts = {})
// 1. Auto-wrap payload to Parts if not already
// 2. Build A2A message { role: 'user', parts }
// 3. A2ATransport._put with RQ envelope → POST /tasks/send
// 4. Wait for completed/failed/input-required
// 5. On input-required: emit on Task, await RI → POST /tasks/:id/send
// 6. Return Task
```

### `src/a2a/a2aTaskSubscribe.js`

```js
async function sendA2AStreamTask(agent, peerUrl, skillId, parts, opts = {})
// 1-3. Same as a2aTaskSend
// 4. A2ATransport._put → POST /tasks/sendSubscribe → SSE response
// 5. Parse SSE events → ST/SE envelopes → _receive() → Task.emit('stream-chunk')
// 6. On lastChunk: true → close Task
```

---

## Group I — Storage (data sources)

**Depends on: A, B. Fully independent of protocol and A2A.**

### `src/storage/DataSource.js`

```js
class DataSource {
  async read(path)              // → Buffer | string | null
  async write(path, data)       // → void
  async delete(path)            // → void
  async list(prefix)            // → string[]
  async query(filter)           // → object[] (optional)
}
```

### `src/storage/MemorySource.js`

```js
class MemorySource extends DataSource {
  constructor()   // Map<path, data>
  // All 5 methods implemented with in-memory Map. No persistence.
}
```

### `src/storage/IndexedDBSource.js` (browser)

```js
class IndexedDBSource extends DataSource {
  constructor({ dbName, storeName = 'data' })
}
```

### `src/storage/FileSystemSource.js` (Node.js)

```js
class FileSystemSource extends DataSource {
  constructor({ root })   // all paths resolve under root
}
```

### `src/storage/SolidPodSource.js`

```js
class SolidPodSource extends DataSource {
  constructor({ podUrl, credential })   // credential = vault key for OIDC token
  // @inrupt/solid-client is a peer dependency
}
```

### `src/storage/SolidVault.js`

```js
class SolidVault extends Vault {
  constructor({ podUrl, credential })
  // Reads/writes /vault/{key}.enc on SolidPod
  // Encrypts values with nacl.secretbox before upload (key derived from OIDC token + salt)
}
```

### `src/storage/StorageManager.js`

```js
class StorageManager {
  constructor({ sources: SourceConfig[], dataSourcePolicy, agentId, skillId? })

  async read(label, path)       // DataSourcePolicy check → DataSource.read
  async write(label, path, data)
  async delete(label, path)
  async list(label, prefix)
  async query(label, filter)

  getSource(label)              // → DataSource | null
}
```

---

## Group J — Identity advanced

**Depends on: A, B, C, E.**

### `src/identity/KeyRotation.js`

```js
class KeyRotation {
  static async buildProof(oldIdentity, newPubKey, gracePeriodSeconds = 604800)
  // → KeyRotationProof (signed by old private key)

  static verify(proof, oldPubKey)    // → boolean

  static async broadcast(proof, agent)
  // sendOneWay to all reachable peers in PeerGraph

  static applyToRegistry(proof, trustRegistry)
  // Update TrustRegistry: oldPubKey → newPubKey mapping
}
```

---

## Group K — `@canopy/relay`

**Depends on: A, F (RelayTransport client side). Fully separate package.**

### `src/WsServerTransport.js`

```js
class WsServerTransport {
  constructor({ port, agent })
  // WebSocket server. Map<agentId, WebSocket>.
  // Reads _to on inbound envelopes → forward to registered socket.
  // Optional offline queue per peer (configurable TTL, default 5 min).

  async start()
  async stop()
  getConnectedPeers()    // → string[] (agentIds currently connected)

  // WebRTC signaling: forwarded as plain envelope OW messages (no special handling)
}
```

### `src/RelayAgent.js`

```js
class RelayAgent extends Agent {
  constructor({ port, name, policy, identity? })
  // policy.mode: 'accept_all' | 'group_only' | 'whitelist'

  async start()
  // Calls super.start() + WsServerTransport.start()
  // Registers built-in skills:
  //   'relay-info' — returns relay capabilities + connected peer count
  //   'relay-peer-list' — returns connected peer addresses (if policy allows)
  // Optional: acts as GroupManager admin if config.groups.admin = true
}
```

---

## Group L — `@canopy/react-native`

**Depends on: A (Vault, Transport bases). Separate package.**

### `src/transport/MdnsTransport.js`

```js
class MdnsTransport extends Transport {
  constructor({ hostname?, port?, identity })
  // react-native-zeroconf. Advertises _canopy._tcp.
  // On discovery: connects via WebSocket to discovered host:port → hello

  async connect()   // start advertising + scanning
  async _put(to, envelope)  // ws.send to connected peer's WS socket
}
```

### `src/transport/BleTransport.js`

```js
class BleTransport extends Transport {
  constructor({ identity, advertise = true, scan = true })
  // react-native-ble-plx.
  // On scan: reads NKN/WS addresses from BLE characteristic → promotes to higher transport
  // MTU-level chunking inside _put()/_receive() for any-size payload.
  // Full bidirectional transport (not just bootstrap).

  async connect()
  async _put(to, envelope)   // BLE GATT write, auto-chunked at MTU boundary
}
```

### `src/storage/AsyncStorageAdapter.js`

```js
class AsyncStorageAdapter {
  // Drop-in StorageBackend for AgentCache / PeerGraph on React Native.
  // Wraps @react-native-async-storage/async-storage.
  async get(key)
  async set(key, value)
  async delete(key)
  async keys()
}
```

---

## `src/security/SecurityLayer.js`

Wraps every `_put()` and `_receive()` on native transports. Lives in Group A/C boundary — implement with Group C (needs AgentIdentity).

```js
class SecurityLayer {
  constructor({ identity, trustRegistry, stateManager })

  // Called by Transport before _put:
  async encrypt(envelope, recipientPubKey)
  // HI: just add _sig (sign canonical JSON of plaintext envelope)
  // Others: nacl.box encrypt payload → replace envelope.payload with ciphertext; add _sig
  // ST/SE/BT: nacl.secretbox with session key; add _sig

  // Called by Transport._receive before dispatch:
  async decryptAndVerify(rawEnvelope, senderPubKey)
  // 1. Check _ts within replay window (±2 min)
  // 2. Check StateManager.isDuplicate(_id)
  // 3. Verify _sig (Ed25519)
  // 4. HI: return as-is (plaintext)
  // 5. Others: nacl.box decrypt payload
  // 6. ST/SE/BT: nacl.secretbox decrypt with session key
  // → decrypted envelope or throw SecurityError
}
```

---

## YAML agent file — complete reference

The canonical format for a single agent. Multi-agent file format is a YAML array of these.

```yaml
version: "1.0"

agent:
  id:        alice-home               # unique slug (not an address)
  blueprint: household-agent          # named preset; see Blueprint section
  label:     "Home assistant"         # display name

  # ── A2A HTTP server (optional) ──────────────────────────────────────
  a2a:
    enabled:   true
    url:       https://relay.example.com/agents/alice-home  # public base URL
    serveHttp: true               # start HTTP server
    httpPort:  3000               # 0 = disable HTTP server (proxy/TLS termination only)
    allowInsecure: false          # allow HTTP for dev; default false
    auth:
      scheme:   bearer
      # Option A: static shared secret (dev/testing)
      secret: vault:a2a-shared-secret
      # Option B: external JWT issuer (production)
      issuer:   https://auth.example.com
      jwks_uri: https://auth.example.com/.well-known/jwks.json
      audience: https://relay.example.com/agents/alice-home

  # ── Native transport connections ────────────────────────────────────
  connections:
    nkn:
      address: abc123.nkn          # deterministically derived from pubKey if omitted
    mqtt:
      broker:  wss://broker.hivemq.com:8884/mqtt
      address: a3f9d2b071c8        # MQTT topic prefix derived from pubKey
    relay:
      url: wss://relay.example.com
    mdns:
      hostname: alice-home.local
      port: 0                      # 0 = auto
    ble:
      advertise: true
      scan:      true

  # ── Groups ──────────────────────────────────────────────────────────
  groups:
    - id:          home
      adminPubKey: <ed25519-pubkey>
      proof:       <signed-token>    # stored in vault, vault:group-proof:home is also valid
    - id:          neighborhood
      adminPubKey: <ed25519-pubkey>
      proof:       vault:group-proof:neighborhood

  # ── Known peers ─────────────────────────────────────────────────────
  peers:
    - id:     relay-01
      pubKey: "<ed25519-pubkey>"
      connections:
        relay: { url: "wss://relay.example.com" }
        nkn:   { address: "xyz.nkn" }
    - url:    "https://summariser.example.com"   # A2A peer — card fetched on startup
      label:  "Summarisation service"

  # ── Skills ──────────────────────────────────────────────────────────
  skills:
    summarise:
      description: "Returns a short summary of any text input."
      inputModes:  [text/plain, application/json]
      outputModes: [text/plain]
      tags:        [nlp, text]
      streaming:   false              # false | unidirectional | bidirectional
      visibility:  authenticated      # public | authenticated | group:<id> | token:<skill> | private
      policy:      group:home         # always | on-request | negotiated | group:<id> | token | never
      enabled:     true
      token:
        delegation:
          allowed:              true
          maxDepth:             1
          maxChainAgeSeconds:   3600
          requireIssuerTier:    1

    live-feed:
      description: "Streams real-time events on a topic."
      outputModes: [application/json]
      streaming:   unidirectional
      visibility:  public
      policy:      always

    voice-channel:
      description: "Bidirectional audio channel."
      streaming:   bidirectional      # native only — A2A callers get error
      visibility:  group:home
      policy:      group:home

    admin-reset:
      visibility:  private
      policy:      never

    # Built-in overrides (optional — all built-ins are enabled by default)
    subscribe:
      visibility: authenticated
      policy:     on-request
    session-open:
      enabled: false                  # disable sessions entirely

  # ── Policy (global defaults for non-skill protocol actions) ─────────
  policy:
    ping:       always
    messaging:  on-request
    streaming:  negotiated
    taskAccept: on-request
    transportFilter:
      default:    [rendezvous, relay, nkn, mqtt, mdns, ble]
      group:home: [rendezvous, relay, mdns, ble]

  # ── Resources ───────────────────────────────────────────────────────
  resources:
    maxConnections:  50
    maxPendingTasks: 10
    perGroup:
      home:
        maxPeers:        20
        maxPendingTasks: 5
      neighborhood:
        maxPeers:        3
        maxPendingTasks: 1

  # ── Discovery ────────────────────────────────────────────────────────
  discovery:
    discoverable:         true
    acceptIntroductions:  from-trusted    # always | from-trusted | never
    acceptHelloFromTier0: true
    gossip:
      enabled:          false
      interval:         3600             # seconds
      maxPeersPerRound: 5
      minTrustTier:     1
    ping:
      interval:         300              # seconds
      timeout:          5000             # ms
      failuresBeforeUnreachable: 3
    capRefreshTtl:      3600
    peerCleanup:
      unreachableAfterDays:  30
      expiredProofGraceDays:  7
      maxGraphSize:          1000
    a2aCardFreshness:   3600            # re-fetch A2A card after this many seconds

  # ── Storage / vault ─────────────────────────────────────────────────
  vault:
    backend: indexeddb                  # memory | local-storage | indexeddb | node-fs | keytar | solid-pod
    # solid-pod options:
    # url: https://alice.solidpod.example/vault/
    # credential: vault:solid-pod-token

  storage:
    sources:
      - label:      private
        type:       solid-pod
        url:        https://alice.solidpod.example/data/
        credential: vault:solid-pod-token
        access:
          agents:       [alice-home]
          skills:       [summarise, search]
          groups:       []

      - label:      app
        type:       indexeddb
        name:       myapp-db
        access:
          agents: [alice-home]
          skills: []                    # empty = all skills of allowed agents

      - label:      local
        type:       filesystem          # Node.js only
        root:       /home/alice/.agent-data/

  # ── Hooks ────────────────────────────────────────────────────────────
  hooks:
    onTask:    [log-locally]
    onMessage: [log-locally]

  # ── Key rotation (populated by SDK during rotation flow) ─────────────
  keyRotation:
    gracePeriodSeconds: 604800
    # oldPubKey + proof stored in vault after rotation
```

---

## Roadmap — phased implementation

Each phase has explicit entry and exit criteria. Phases 4+5 are parallelisable.

---

### Phase 1 — Transport foundation + security

**Goal**: Two agents can exchange encrypted, signed envelopes using InternalTransport.

**Group(s)**: A (all), B (VaultMemory only), security/SecurityLayer.js

**Deliverables**:
- `Envelope.js` — mkEnvelope factory, canonicalize
- `Transport.js` — base class, four primitives, pending map, _receive dispatch
- `InternalTransport.js` — EventEmitter bus, no network
- `AgentIdentity.js` — generate/restore keypair from vault, sign, box, secretbox
- `Vault.js` + `VaultMemory.js`
- `SecurityLayer.js` — wrap/unwrap, HI signed-only, others nacl.box, ST nacl.secretbox
- `Mnemonic.js`
- `Parts.js`

**Exit criteria**:
```js
const bus = new InternalBus();
const a = new Agent({ transport: new InternalTransport(bus, 'a') });
const b = new Agent({ transport: new InternalTransport(bus, 'b') });
await a.start(); await b.start();
// hello completes automatically
const result = await a.call('b', 'echo', [DataPart({ msg: 'hello' })]);
assert(Parts.data(result.artifacts[0].parts).msg === 'hello');
// Relay sees only ciphertext (verify SecurityLayer is always active)
```

---

### Phase 2 — Agent layer + NKN/MQTT + basic protocol

**Goal**: Browser + Node agents exchange tasks over NKN or MQTT.

**Group(s)**: C (Agent, AgentFile, Blueprint, SkillRegistry, defineSkill, AgentConfig), D (hello, ping, messaging, skillDiscovery, taskExchange, Task), E (PolicyEngine, TrustRegistry — minimal), F (NknTransport, MqttTransport), G (RoutingStrategy — basic, no PeerGraph yet; FallbackTable)

**Deliverables**:
- `Agent.js` — createNew, start, stop, call, message, register
- `AgentFile.js` — parse YAML, resolve blueprint
- `Blueprint.js` + `BlueprintRegistry.js` — built-in blueprints
- `SkillRegistry.js` + `defineSkill.js`
- `AgentConfig.js` — layered config
- `hello.js`, `ping.js`, `messaging.js`, `skillDiscovery.js`
- `taskExchange.js` + `Task.js` — RQ/RS + IR/RI/CX codes
- `PolicyEngine.js` — Layers 1–3 (TrustRegistry, visibility, policy gates)
- `TrustRegistry.js`
- `NknTransport.js`, `MqttTransport.js`
- `RoutingStrategy.js` — basic (no PeerGraph; just transport priority + fallback)
- `FallbackTable.js`

**Exit criteria**:
```js
// browser agent ↔ node agent via NKN
const agent = await Agent.fromYaml(yamlStr);
await agent.start();
const task = await agent.call('other-agent-nkn-addr', 'summarise',
  [TextPart('Long article...')]);
const res = await task.done();
// 200ms P99 round-trip NKN; 500ms P99 MQTT
```

---

### Phase 3 — State + streaming + routing

**Goal**: 1 MB stream over NKN. Sessions. Full RoutingStrategy + PeerGraph.

**Group(s)**: D (streaming, session, pubSub, fileSharing), E (GroupManager, CapabilityToken, TokenRegistry — full permissions), G (PeerGraph, PeerDiscovery, PingScheduler, GossipProtocol — complete)

**Deliverables**:
- `StateManager.js` — dedup, task registry, stream registry, session registry
- `streaming.js` — ST/SE, nacl.secretbox per chunk, both modes, bidirectional
- `session.js` — built-in skill handlers
- `pubSub.js` — PB envelopes + subscribe built-in skill
- `fileSharing.js` — FilePart + BulkTransfer (BT/AK)
- Full `PolicyEngine.js` — all four layers + group peer caps
- `GroupManager.js` — issuance, verification, expiry
- `CapabilityToken.js` + `TokenRegistry.js`
- `PeerGraph.js` — full peer records, both types, query API
- `PeerDiscovery.js`, `PingScheduler.js`, `GossipProtocol.js`
- Full `RoutingStrategy.js` — uses PeerGraph

**Exit criteria**:
- 1 MB chunked stream over NKN in < 30 seconds
- Session open → N messages → close, all state clean in StateManager
- Group proof issued → peer advances to Tier 2 → group-scoped skill becomes callable
- Capability token issued → peer advances to Tier 3 → token-gated skill callable

---

### Phase 4 — Relay + rendezvous

**Goal**: Browser agents exchange messages through relay; establish direct WebRTC channel.

**Group(s)**: F (RelayTransport, RendezvousTransport), K (WsServerTransport, RelayAgent)

**Deliverables** (K — new package `@canopy/relay`):
- `WsServerTransport.js` — WebSocket server, envelope routing by `_to`, offline queue
- `RelayAgent.js` — subclass of Agent, starts WsServer, registers relay skills

**Deliverables** (F — in `@canopy/core`):
- `RelayTransport.js` — WS client → relay
- `RendezvousTransport.js` — WebRTC DataChannel + signaling over RelayTransport

**Exit criteria**:
```js
// On relay server
const relay = new RelayAgent({ port: 8080 });
await relay.start();

// Browser agent A (no NKN configured)
const a = await Agent.fromYaml(yamlWithRelayUrl);
await a.start();  // connects to relay via WSS

// Browser agent B (same relay)
const b = await Agent.fromYaml(yamlWithRelayUrl);
await b.start();

const result = await a.call(b.pubKey, 'echo', [DataPart({ msg: 'hello' })]);
// Rendezvous: after DataChannel opens, relay is out of the path
// Verify: subsequent calls show 0 bytes through relay WS
```

---

### Phase 5 — React Native (parallel with Phase 4)

**Goal**: RN app discovers desktop agent via mDNS; completes a task exchange.

**Group(s)**: L (MdnsTransport, BleTransport, KeychainVault, AsyncStorageAdapter)

**Deliverables** (new package `@canopy/react-native`):
- `KeychainVault.js`
- `AsyncStorageAdapter.js`
- `MdnsTransport.js` — react-native-zeroconf + WS
- `BleTransport.js` — react-native-ble-plx + MTU chunking

**Exit criteria**:
```js
// RN app
import { MdnsTransport, KeychainVault } from '@canopy/react-native';
const agent = await Agent.createNew({
  vault: new KeychainVault(),
  transports: [new MdnsTransport({ hostname: 'rn-agent.local' })]
});
await agent.start();
// RN agent discovers desktop agent via mDNS automatically (no manual address entry)
const task = await agent.call(desktopPubKey, 'echo', [DataPart({ msg: 'from RN' })]);
const res = await task.done();
```

---

### Phase 6 — A2A layer

**Goal**: SDK agent can interact as both A2A server and A2A client with any A2A-compliant agent.

**Group(s)**: H (all of A2A layer)

**Deliverables**:
- `A2ATLSLayer.js` — TLS security layer for A2ATransport
- `A2AAuth.js` — JWT validation, outbound token management
- `A2ATransport.js` — HTTP server + client, SSE streaming
- `AgentCardBuilder.js` — A2A agent card from SkillRegistry
- `a2aDiscover.js` — card fetch + PeerGraph upsert + hello upgrade
- `a2aTaskSend.js`, `a2aTaskSubscribe.js` — A2A protocol handlers
- Updated `RoutingStrategy.js` — A2A peer type check

**Exit criteria**:
- `agent.call('https://external-a2a-agent.example.com', 'summarise', [TextPart('...')])` completes
- External A2A client calls this agent's `POST /tasks/send` → skill handler fires → response returned
- SSE streaming works both directions
- `x-canopy` agent auto-upgrades to native when card contains `pubKey` + `nknAddr`

---

### Phase 7 — Storage + identity persistence

**Goal**: Agent file + peer graph + vault backed by SolidPod. Restore on new device from mnemonic.

**Group(s)**: I (SolidPodSource, SolidVault, full storage layer), J (KeyRotation), B (SolidVault)

**Deliverables**:
- `SolidPodSource.js` — DataSource on LDP
- `SolidVault.js` — Vault on SolidPod
- Vault backends: `VaultIndexedDB.js`, `VaultNodeFs.js`, `VaultKeytar.js` (if not done in Phase 1)
- `KeyRotation.js` — build proof, broadcast, apply to TrustRegistry
- `StorageManager.js` — DataSourcePolicy enforcement
- `Agent.restoreFromSolidPod()` — download peer graph + group proofs + tokens
- `PeerGraph` SolidPod sync (debounced write on change)

**Exit criteria**:
```js
// Device A — first run
const { agent, mnemonic } = await Agent.createNew({ vault: { backend: 'solid-pod', ... } });
// ... use agent, build up peer graph, hold group proofs ...

// Device B — recovery
const agent = await Agent.restoreFromMnemonic(mnemonic, { vault: { backend: 'keytar' } });
await agent.restoreFromSolidPod('https://alice.solidpod.example/');
// peer graph, group proofs, capability tokens all restored
// agent resumes with full context; no peer relationships lost
```

---

## Module file map (complete)

```
@canopy/core
  src/
    Agent.js
    AgentFile.js
    Envelope.js
    Parts.js

    identity/
      AgentIdentity.js
      Mnemonic.js
      Vault.js
      VaultMemory.js
      VaultLocalStorage.js
      VaultIndexedDB.js
      VaultNodeFs.js
      VaultKeytar.js
      KeyRotation.js

    security/
      SecurityLayer.js

    transport/
      Transport.js
      InternalTransport.js
      LocalTransport.js
      NknTransport.js
      MqttTransport.js
      RelayTransport.js
      RendezvousTransport.js

    skills/
      SkillRegistry.js
      defineSkill.js

    config/
      AgentConfig.js
      ConfigCapability.js       # skill handler for remote config

    policy/
      PolicyEngine.js

    permissions/
      TrustRegistry.js
      GroupManager.js
      CapabilityToken.js
      TokenRegistry.js
      DataSourcePolicy.js

    routing/
      RoutingStrategy.js
      FallbackTable.js

    state/
      StateManager.js

    protocol/
      hello.js
      ping.js
      messaging.js
      skillDiscovery.js
      taskExchange.js
      Task.js
      streaming.js
      session.js
      pubSub.js
      fileSharing.js

    discovery/
      PeerGraph.js
      PeerDiscovery.js
      GossipProtocol.js
      PingScheduler.js

    storage/
      DataSource.js
      MemorySource.js
      IndexedDBSource.js
      FileSystemSource.js
      SolidPodSource.js
      SolidVault.js
      StorageManager.js

    a2a/
      A2ATLSLayer.js
      A2AAuth.js
      A2ATransport.js
      AgentCardBuilder.js
      a2aDiscover.js
      a2aTaskSend.js
      a2aTaskSubscribe.js

    blueprint/
      Blueprint.js
      BlueprintRegistry.js

  index.js          # public API re-exports

@canopy/relay
  src/
    WsServerTransport.js
    RelayAgent.js
  index.js

@canopy/react-native
  src/
    transport/
      MdnsTransport.js
      BleTransport.js
    identity/
      KeychainVault.js
    storage/
      AsyncStorageAdapter.js
  index.js
```

---

## Dependency graph (simplified)

```
Parts.js                    ← no deps
Envelope.js                 ← no deps
Mnemonic.js                 ← no deps (@scure/bip39 peer dep)
Vault.js                    ← no deps (abstract)
VaultMemory.js              ← Vault
AgentIdentity.js            ← Vault, tweetnacl
SecurityLayer.js            ← AgentIdentity, StateManager (dedup)
Transport.js                ← Envelope, SecurityLayer
InternalTransport.js        ← Transport
[Other transports]          ← Transport

SkillRegistry.js            ← defineSkill
AgentConfig.js              ← (reads from AgentFile output)
PolicyEngine.js             ← TrustRegistry, GroupManager, TokenRegistry, AgentConfig, SkillRegistry
StateManager.js             ← (no deps)
Task.js                     ← EventEmitter
taskExchange.js             ← Transport, PolicyEngine, StateManager, Task, Parts
streaming.js                ← Transport, StateManager, AgentIdentity (session key)
[Other protocol handlers]   ← Transport, StateManager, PolicyEngine, Parts

PeerGraph.js                ← StorageBackend
RoutingStrategy.js          ← PeerGraph, FallbackTable, AgentConfig
PeerDiscovery.js            ← PeerGraph, GossipProtocol, PingScheduler

A2ATransport.js             ← Transport, A2ATLSLayer, A2AAuth, AgentCardBuilder
AgentCardBuilder.js         ← SkillRegistry, AgentConfig, AgentIdentity
a2aDiscover.js              ← PeerGraph, A2ATransport

Agent.js                    ← all of the above
```

---

## Interface contracts for parallel teams

These are the boundaries. Each team only needs the interface, not the implementation details of the other side.

### Transport ↔ SecurityLayer

```js
// Transport calls:
securityLayer.encrypt(envelope, recipientPubKey)  // → encryptedEnvelope
securityLayer.decryptAndVerify(rawEnvelope, senderPubKey)  // → decryptedEnvelope | throws

// A2ATransport calls:
a2aTLSLayer.wrapOutbound(peerUrl, requestInit)   // → requestInit with headers
a2aTLSLayer.validateInbound(req)                 // → { tier, claims, peerId }
```

### Agent ↔ RoutingStrategy

```js
// Agent calls:
routingStrategy.selectTransport(peerId, opts)    // → Transport
routingStrategy.onTransportFailure(peerId, transport)
```

### PolicyEngine ↔ protocol handlers

```js
// Every protocol handler calls before invoking skill:
await policyEngine.checkInbound({ peerPubKey, skillId })  // throws PolicyDeniedError or returns { tier }
```

### PeerGraph ↔ everything that needs peer info

```js
// Read-only access to peer records (RoutingStrategy, SkillDiscovery, etc.):
peerGraph.get(pubKeyOrUrl)     // → PeerRecord | null
peerGraph.canHandle(opts)      // → PeerRecord[] sorted by preference
peerGraph.withSkill(skillId, opts)

// Write access (hello.js, PeerDiscovery, a2aDiscover.js, etc.):
peerGraph.upsert(record)
peerGraph.setReachable(id, bool)
peerGraph.updateTier(pubKey, tier)
```

### Vault ↔ everything that needs secrets

```js
// Standard 5-method interface (Group A defines, Group B implements, all consumers use):
vault.get(key)   vault.set(key, value)   vault.delete(key)   vault.has(key)   vault.list()
```

---

## Phone app integration (`apps/mesh-demo`) — Group DD

**Added 2026-04-23.** After the core SDK reached feature-completeness
through Group BB, the phone app (`apps/mesh-demo`) still wires only
the Groups M-R / U feature set. This chapter documents how the app
closes the gap to `examples/mesh-demo` (the Node demo that exercises
all eleven phases) without rewriting the app.

See `CODING-PLAN.md § Group DD` for the green-commit sub-phases.

### Goal

Parity with `examples/mesh-demo` on device:

1. Phases 1-6 (hello, gossip, hop, forget) — already working.
2. Phase 9 (oracle bridge selection) — enable.
3. Phase 10 / 10b (rendezvous + fallback) — enable, visible via UI badge.
4. Phase 11 (blind relay-forward) — enable by default for the app's group.
5. Origin-verified indicator on received messages (Group Z UX).

### Strategy — update, not rewrite

The app's architecture is sound: `createMeshAgent` factory, React
context wrapping a single long-lived agent, hooks over PeerGraph,
three screens (Setup / Peers / Message), AsyncStorage settings, full
vitest suite. None of that needs replacing.

Gaps are:

| Area | Fix |
|---|---|
| Agent hook-ups | Add `enableReachabilityOracle` + `enableSealedForwardFor` + `registerCapabilitiesSkill` calls in `agent.js`. |
| WebRTC rendezvous | Add `react-native-webrtc` dep; new `loadRendezvousRtcLib` helper in `@canopy/react-native`; opt-in `rendezvous: true` flag on `createMeshAgent`. |
| Message UI | Render a checkmark next to messages with `ctx.originVerified === true`. |
| Peer UI | Light up the existing `🔗` icon when a DataChannel is active for that peer. |
| Boot | Restore `App.js` from `App.js.bak` (currently in native-module-test mode). |

### Scope cuts (deferred)

- **Sealed-forward UI.** Content privacy is silent by design
  (`Design-v3/blind-forward.md § 10`). Not exposed in the UI.
- **Streaming / InputRequired / end-to-end cancel** through hops.
  Bridge-level tunnel work is Group CC scope; the phone app will
  benefit from it transparently once CC lands.
- **iOS dev build.** Android-first. iOS pod wiring is a follow-up
  once Android is stable.

### Required new dependency

```json
// apps/mesh-demo/package.json
{
  "dependencies": {
    "react-native-webrtc": "^124.0.5"
  }
}
```

`react-native-webrtc` has native modules — the app cannot run on
Expo Go once this is in the dependency graph. A dev build is required
(`npx expo run:android` or `eas build --profile development`).

The existing `createMeshAgent` stays Expo-Go-friendly because
`loadRendezvousRtcLib` guards the `require('react-native-webrtc')`
call inside a `try/catch` and returns `null` when the native module
is missing. Agents in Expo Go still boot; they just don't get
rendezvous.

### New files

- `packages/react-native/src/transport/rendezvousRtcLib.js` — the
  optional-dep loader.
- `apps/mesh-demo/src/hooks/useRendezvousState.js` — subscribes to
  agent's rendezvous-upgraded / -downgraded / -failed events.

### Modified files

- `packages/react-native/src/createMeshAgent.js` — add `rendezvous`
  opt-in.
- `packages/react-native/src/index.js` — export `loadRendezvousRtcLib`.
- `apps/mesh-demo/App.js` — restored to real app entry.
- `apps/mesh-demo/src/agent.js` — three new `enable*` / register calls,
  read `ctx.originVerified`, pass into messageStore.
- `apps/mesh-demo/src/store/messages.js` — extend record with
  `originVerified`.
- `apps/mesh-demo/src/screens/MessageScreen.js` — verified-origin
  indicator.
- `apps/mesh-demo/src/hooks/usePeers.js` / `PeersScreen.js` — merge
  in rendezvous state.
- `apps/mesh-demo/package.json` — add `react-native-webrtc`.
- `apps/mesh-demo/README.md` — smoke-test recipe + Expo Go caveat.
- `TODO-GENERAL.md` — mark phone-rendezvous item shipped.

### Tests

- Reuse + extend the existing `apps/mesh-demo/test/**` vitest suite.
- `receiveMessage.test.js` — adds originVerified-true case.
- `agentSetup.test.js` — confirms new opt-ins are wired.
- New `packages/react-native/test/rendezvousRtcLib.test.js` — unit
  tests for the loader (null / injected globals / react-native-webrtc
  mock).
- On-device smoke test — documented in `CODING-PLAN.md § DD3`.

### Risk register

| Risk | Mitigation |
|---|---|
| App regresses on Expo Go after Phase 2 | Phase 1 entirely JS; Phase 2 guards native `require` with try/catch so Expo Go keeps booting. |
| react-native-webrtc Android build fails | Fall back to pinned known-good version; document minimum NDK / Gradle versions in the README. |
| Rendezvous connect stalls on real carrier NAT | Documented limitation; falls back to relay automatically. Future work (custom STUN/TURN research) tracked in `TODO-GENERAL.md`. |
| Changes break the working app without a rollback path | Each DD sub-phase lands as its own commit; a failed one is `git revert`-able. Last-known-good is `c4f40a7`. |
| Stale backup directories (`apps/mesh-demo (Copy)` etc.) get caught in a commit | Explicitly excluded from Group DD commits; user decides their fate separately. |

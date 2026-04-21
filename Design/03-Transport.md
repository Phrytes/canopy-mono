# Transport Layer

---

## Design principle

The transport layer has one job: get an envelope from agent A to agent B. Everything above it — interaction semantics, protocol logic, policies — is transport-agnostic. Adding a new transport requires implementing one method (`_put`); all four primitives, security, and dispatch come for free from the base class.

---

## The four primitives

The previous design had two conceptual primitives (`send`, `respond`) and a separate PatternHandler class implementing patterns on top. This was an unnecessary split. The patterns ARE the primitives — from the caller's perspective, `sendAck` is atomic, not "send + wait for respond".

The PatternHandler class is eliminated. Its logic lives in the Transport base class as default implementations:

```js
class Transport extends Emitter {

  // ── Identity ──────────────────────────────────────────────────
  get address() {}      // this agent's address on this transport

  // ── Lifecycle ─────────────────────────────────────────────────
  async connect()    {}
  async disconnect() {}

  // ── THE FOUR PRIMITIVES ───────────────────────────────────────
  // Default implementations use envelope emulation.
  // Subclasses may override for native transport optimizations.

  async sendOneWay(to, payload) {
    await this._put(to, mkEnvelope(OW, payload, this.address, to));
  }

  async sendAck(to, payload, timeout = 10_000) {
    const env = mkEnvelope(AS, payload, this.address, to);
    return this._awaitReply(env._id, timeout, () => this._put(to, env));
  }

  async request(to, payload, timeout = 30_000) {
    const env = mkEnvelope(RQ, payload, this.address, to);
    return this._awaitReply(env._id, timeout, () => this._put(to, env));
  }

  async respond(to, replyToId, payload) {
    await this._put(to, mkEnvelope(RS, payload, this.address, to, { _re: replyToId }));
  }

  // ── WIRE PRIMITIVE ────────────────────────────────────────────
  // Only this needs implementing in a subclass.
  // SecurityLayer wraps this before anything hits the wire.
  async _put(to, envelope) { throw new Error('not implemented'); }

  // ── INBOUND ───────────────────────────────────────────────────
  // Called by subclass when a raw envelope arrives.
  _receive(from, envelope) { /* dispatch by _p code — see below */ }
}
```

The pending-reply map (previously in PatternHandler) lives in the base class, owned by the transport instance.

---

## Envelope

Every message, regardless of pattern or transport, is wrapped in this envelope:

```js
{
  _v:     1,              // schema version
  _p:     'RQ',           // pattern code (see table below)
  _id:    'uuid-v4',      // unique message ID — dedup + correlation
  _re:    'uuid-v4',      // reply-to ID — present on RS, AK; null otherwise
  _from:  'agentId',      // sender public key (or NKN address derived from it)
  _to:    'agentId',      // intended recipient — relay reads this for routing
  _topic: 'string',       // pub-sub topic — present on PB only; null otherwise
  _ts:    1234567890,     // unix timestamp ms — replay window check
  _sig:   'base64',       // Ed25519 signature (see Security)
  payload: <ciphertext>   // nacl.box encrypted (see Security)
}
```

### Pattern codes

| Code | Name | Direction | Description |
|------|------|-----------|-------------|
| `HI` | Hello | ↔ | Agent card exchange on connect. **Signed, not encrypted** (see Security). |
| `OW` | One-Way | → | Fire and forget. No response expected. |
| `AS` | Ack-Send | → | Sender wants delivery confirmation. |
| `AK` | Acknowledge | ← | Delivery confirmed. Empty payload. |
| `RQ` | Request | → | Sender wants a response with a result. |
| `RS` | Response | ← | Result reply to a request. |
| `PB` | Publish | → | Pub-sub broadcast to a topic. |
| `ST` | Stream-chunk | → | One chunk in an open stream. Encrypted with session key. |
| `SE` | Stream-end | → | Final chunk / close signal for a stream. |
| `BT` | Bulk-chunk | → | One chunk in a bulk transfer. Encrypted with session key. |

### Inbound dispatch

```
_p = HI          → emit 'hello'     { from, card }  (plaintext — hello handler stores pubKey)
_p = OW          → emit 'message'   { from, payload }
_p = AS          → emit 'message'   { from, payload }  +  auto-respond AK
_p = AK / RS     → settle pending promise (looked up by _re)
_p = RQ          → emit 'request'   { from, payload, reply(payload) }
_p = PB          → emit 'publish'   { topic, from, payload }
_p = ST / SE     → emit 'stream'    { streamId, seq, payload, done }  (secretbox decrypted)
_p = BT          → emit 'bulk'      { transferId, seq, total, payload }  (secretbox decrypted)
```

---

## Security layer

SecurityLayer wraps `_put` on every transport. It is not optional.

### Two security modes

Not all message types use the same security treatment. The mode is determined by the `_p` code before sending:

| Message type | Payload | Signature |
|-------------|---------|-----------|
| `hello` (`HI`) | Plaintext | Ed25519 signed |
| All others | `nacl.box` encrypted | Ed25519 signed |

**`hello` is signed but not encrypted.** The hello payload is an agent card — public key, public capabilities, transport addresses — information that is inherently public. Encrypting it would create a bootstrapping problem: `nacl.box` requires the recipient's public key, which is only known after a successful hello. Signing is sufficient: the receiver can verify the sender is who they claim to be, and the payload cannot be tampered with in transit.

After a successful hello exchange, both parties hold each other's public keys. All subsequent messages use full `nacl.box` encryption.

### Outbound (before `_put`)

For `hello`:
1. **Sign envelope**: `Ed25519.sign(privKey, _id + _from + _to + _ts + sha256(payload))` — adds `_sig`
2. Send signed envelope with plaintext payload

For all other messages:
1. **Encrypt payload**: `nacl.box(plainPayload, nonce, recipientPubKey, senderPrivKey)` — replaces `payload` with ciphertext
2. **Sign envelope**: `Ed25519.sign(privKey, _id + _from + _to + _ts + sha256(ciphertext))` — adds `_sig`
3. Send encrypted, signed envelope

### Inbound (before dispatch)

For `hello`:
1. **Verify signature**: reject if `_sig` does not verify against `_from` public key
2. **Check timestamp**: reject if `_ts` is outside ±5 minute window
3. Store sender's public key in PeerGraph; advance to Tier 0

For all other messages:
1. **Verify signature**: reject if `_sig` does not verify against sender's known public key
2. **Check timestamp**: reject if `_ts` is outside ±5 minute window
3. **Check dedup**: reject if `_id` is in the dedup cache (StateManager, TTL 5 min)
4. **Decrypt payload**: `nacl.box.open(...)` — fail loudly if key mismatch or tampered

### Session keys for streaming

Per-chunk `nacl.box` is expensive for high-throughput streams: each box call performs a Diffie-Hellman and adds ~40 bytes overhead. For streaming and bulk transfer, a precomputed session key is used instead.

**Setup** (once, at stream open):
```js
// Both sides have each other's Ed25519 keys from hello.
// nacl.box.before() computes the X25519 shared secret (libsodium handles key conversion).
const sessionKey = nacl.box.before(peerPubKey, myPrivKey);  // 32-byte shared secret
// Both sides derive the same key — no extra message needed.
```

**Per chunk** (ST / BT envelope):
```js
// Nonce is deterministic: no storage, no coordination needed.
const nonce = buildNonce(streamId, seqNumber);
// streamId: 16 bytes (first 16 bytes of stream UUID)
// seqNumber: 8 bytes (uint64 big-endian)
// Total: 24 bytes — exactly nacl.secretbox nonce length

const encrypted = nacl.secretbox(chunkPayload, nonce, sessionKey);
```

**Decryption**:
```js
const plain = nacl.secretbox.open(encrypted, buildNonce(streamId, seq), sessionKey);
if (!plain) throw new Error('stream chunk tampered or wrong key');
```

`nacl.secretbox` is a symmetric authenticated cipher (XSalsa20-Poly1305). It is faster than `nacl.box` and still provides integrity protection per chunk. The shared session key is never transmitted — it is independently derived on both sides from the keypairs already exchanged in `hello`.

Non-streaming messages (OW, AS, RQ, RS, PB) continue to use per-message `nacl.box`. The overhead is negligible for request-response interactions.

### What the relay sees

The relay reads `_from` and `_to` for routing — these are plaintext by necessity. Everything else, including `payload`, is ciphertext. The relay routes sealed boxes it cannot open.

```
Relay sees:    _from, _to, _id, _ts, _p  →  enough to route
Relay cannot:  payload (encrypted), _sig content (just bytes)
Hello payload: plaintext but signed — relay sees agent card, not private data
```

This is an accepted metadata risk: the relay knows who talks to whom, not what they say. Channel TLS (WSS) prevents a wire eavesdropper from seeing even the metadata.

### Identity

Every agent has one Ed25519 keypair. The public key is the agent's true identity. All other addresses (NKN, MQTT topic, relay address) are transport-level aliases that change freely. The private key lives in the Vault, never exported.

NKN addresses are derived deterministically from the public key, so there is no separate NKN identity to manage.

---

## Transport implementations

### InternalTransport
In-process EventEmitter bus. Zero network. Used for tests and same-device multi-agent. Two instances share a `Bus` object; messages are delivered synchronously.

```js
const bus = new InternalBus();
const t1  = new InternalTransport(bus, 'agent-a');
const t2  = new InternalTransport(bus, 'agent-b');
```

### NknTransport
Uses `nkn.Client` from CDN or npm. Pure JS. Works in browser, Node, React Native.
- `_put`: `client.send(to, JSON.stringify(envelope), { noReply: true })`
- RTCDataChannel retry logic retained (poll until open, 200ms interval, 12s deadline)
- Seed persistence for stable address

### MqttTransport
Uses `mqtt` library over WSS. Pure JS. Works in browser, Node, React Native.
- `_put`: `client.publish('canopy/agent/{to}', JSON.stringify(envelope), { qos: 1 })`
- `sendAck` can override to use QoS 1 natively (guaranteed delivery by broker)
- Native pub-sub: `client.subscribe(topic)` / `client.publish(topic, data)`

### RelayTransport (client → relay)
WebSocket client connecting to a relay server URL. Pure JS — works in browser, Node.js, React Native.
- `_put`: `ws.send(JSON.stringify(envelope))`
- Relay reads `_to` field and routes to the right peer
- Reconnects automatically on disconnect
- Always in path — relay sees routing metadata (`_from`, `_to`) but not payload (E2E encrypted)

### RendezvousTransport (WebRTC DataChannel)
Uses the browser-native `RTCPeerConnection` API. No external dependency. Pure JS for browser and Node.js; React Native requires `react-native-webrtc` (deferred post-PoC).
- Signaling: sends `webrtc-offer`, `webrtc-answer`, `webrtc-ice` payloads as OW messages through whatever transport is currently available (typically RelayTransport)
- Once DataChannel opens: `_put` sends directly over the channel — relay is out of the path
- Falls back to RelayTransport if DataChannel fails to open

### MdnsTransport (React Native)
Uses `react-native-zeroconf`. Advertises `_canopy._tcp` service. On peer discovery, opens a WebSocket connection to found peer.
- Automatically degrades gracefully if plugin unavailable
- Same envelope format as RelayTransport once connected

### BleTransport (React Native)
Uses `react-native-ble-plx`. A full bidirectional transport — not just for bootstrap. The primary use case is devices with no internet connection: BLE works peer-to-peer without WiFi, a router, or any infrastructure.

**GATT layout**:
- Custom service UUID (fixed, defined by the SDK)
- TX characteristic (notify): peripheral notifies central of inbound data
- RX characteristic (write with response): central writes outbound data to peripheral

Both devices advertise and scan simultaneously, allowing either side to initiate.

**MTU and chunking**: BLE packet size is negotiated per connection (20–517 bytes depending on device and BLE version). `BleTransport._put()` splits the serialised envelope into MTU-sized chunks, each tagged with a sequence number and a total count, and writes them in order. The receiver reassembles before passing to `_receive()`. This chunking happens inside the transport layer — nothing above it sees it.

```
Envelope (e.g. 1200 bytes, MTU 244 bytes) → 5 BLE write operations → reassembled envelope
```

**Bootstrap mode still supported**: If a higher-bandwidth transport is available (mDNS, NKN), BleTransport can exchange addresses and hand off. But this is now optional — BLE can carry all traffic if needed.

**Bandwidth**: BLE 5.0 achieves roughly 100–300 kbps in practice. Messaging and small tasks work well. Large file transfers are slow but functional (BulkTransfer still works, just takes longer). Streaming is supported but not recommended for high-throughput data over BLE.

**Range**: ~10m typical indoors, up to 100m line-of-sight outdoors. Suitable for same-room or same-building scenarios without internet.

---

## Transport support matrix

| Pattern | Internal | NKN | MQTT | Rendezvous | Relay | mDNS | BLE |
|---------|----------|-----|------|------------|-------|------|-----|
| sendOneWay | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| sendAck | ✓ | ✓ | ✓ (QoS 1) | ✓ | ✓ | ✓ | ✓ |
| request | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| respond | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| pub-sub | ✓ | emulated | native | emulated | emulated | emulated | emulated |
| streaming | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (slow) |
| bulk transfer | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (slow) |

BLE supports all patterns via MTU-level chunking inside the transport. "slow" means functional but bandwidth-limited (~100–300 kbps). For large transfers over BLE, expect longer wall-clock time, not failure.

All patterns have envelope-based fallback implementations in the base class. Native optimizations are optional overrides.

---

## Routing strategy

When an agent has multiple transports and a peer has addresses on multiple transports, RoutingStrategy selects the best path:

**Default priority order**: Internal > Local > mDNS > Rendezvous > Relay > NKN > MQTT > BLE

- mDNS before Rendezvous: LAN WiFi is local and fast; Rendezvous requires internet for signaling
- Rendezvous before Relay: both require internet, but Rendezvous is direct P2P once established
- NKN/MQTT before BLE: higher bandwidth when internet is available
- BLE last: always works (no internet needed), but slowest — used when everything else is unavailable

RoutingStrategy also considers:
- Whether this transport has `canDo` for the required pattern
- Last known latency per transport per peer (from FallbackTable)
- Whether the transport is currently connected

```js
agent.request(peerId, 'echo', { text: 'hi' }, {
  prefer: ['request-response'],          // required pattern
  transports: ['nkn', 'mqtt', 'ws'],     // optional override
});
```

If a send fails on the primary transport, RoutingStrategy tries the next in the fallback chain automatically.

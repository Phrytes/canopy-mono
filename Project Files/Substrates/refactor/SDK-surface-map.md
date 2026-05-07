# SDK surface map (2026-05-04)

> Reference for substrate refactor audits. What the SDK exposes; what substrates should compose against.
>
> Scope: `@canopy/core`, `@canopy/relay`, `@canopy/pod-client`, `@canopy/react-native`.
> All file paths absolute; line numbers refer to the canonical entry point of each symbol.
>
> For each symbol the convention is:
> - **Symbol** — one-line purpose. _file:line_. key methods / exported names.

## @canopy/core

Package root: `/home/frits/expotest/nkn-test/packages/core/`.
`package.json` `main: src/index.js`, `exports: { ".": "./src/index.js" }`. Single subpath. Public API surface is the exhaustive re-export list in `/home/frits/expotest/nkn-test/packages/core/src/index.js`.

### Envelope / Parts / Emitter (foundation)

- **`P`** — frozen pattern-code dictionary. `/home/frits/expotest/nkn-test/packages/core/src/Envelope.js:11`. Codes: `HI`, `OW`, `AS`, `AK`, `RQ`, `RS`, `PB`, `ST`, `SE`, `BT`, `IR`, `RI`, `CX`. Anything sent on the wire is wrapped in this envelope.
- **`REPLY_CODES`** — set of codes that resolve a pending outbound promise (`AK`, `RS`). _Envelope.js:28_.
- **`mkEnvelope(p, from, to, payload, opts?)`** — envelope factory. Stamps `_v: 1`, `_id`, `_ts`. `_sig` is null on construction; SecurityLayer fills it. _Envelope.js:43_.
- **`canonicalize(envelope)`** — sorted-key JSON stringification of the envelope minus `_sig`. Used for signature input. _Envelope.js:62_.
- **`isEnvelope(obj)`** — type guard. _Envelope.js:70_.
- **`genId()`** — UUID v4 (crypto.randomUUID; falls back to crypto.getRandomValues; last resort Math.random). Exported via `Envelope.js`. _Envelope.js:91_.
- **`TextPart(text)` / `DataPart(data)` / `FilePart({ mimeType, name?, data?, url? })` / `ImagePart({ mimeType, data })`** — typed part constructors (A2A-compatible payload format). `/home/frits/expotest/nkn-test/packages/core/src/Parts.js:11-26`.
- **`Parts`** — utility class with statics `Parts.text(parts)`, `Parts.data(parts)` (DataPart merge), `Parts.files(parts)`, `Parts.images(parts)`, `Parts.wrap(value)` (auto-wrap string/object/Uint8Array), `Parts.artifact(name, parts)`, `Parts.isValid(parts)`. _Parts.js:30_.
- **`Emitter`** — tiny in-house EventEmitter, no deps. `on/off/once/emit/removeAllListeners`. `/home/frits/expotest/nkn-test/packages/core/src/Emitter.js:5`. **Substrates should use this, not Node's `events`.**

### Identity & Vault

The `Vault` is the canonical secure key/value abstraction. Anything that needs to persist secrets, tokens, group proofs, identity caches, OAuth bundles, or peer trust records should accept a `Vault` rather than rolling its own storage. Conventional key namespaces are documented at the top of `Vault.js`.

- **`Vault`** — abstract base class. `/home/frits/expotest/nkn-test/packages/core/src/identity/Vault.js:14`. Methods: `get(key)`, `set(key, value)`, `delete(key)`, `has(key)`, `list()`. All async, all return strings or null/boolean.
- **`VaultMemory`** — in-process Map-backed Vault. _identity/VaultMemory.js:7_. Tests + ephemeral agents.
- **`VaultLocalStorage`** — browser localStorage Vault, namespaced under `prefix` (default `'dwag:'`). _identity/VaultLocalStorage.js:13_.
- **`VaultIndexedDB`** — browser IndexedDB Vault with optional AES-GCM encryption. _identity/VaultIndexedDB.js:12_.
- **`VaultNodeFs`** — Node.js AES-256-GCM-encrypted JSON file vault (passphrase optional; falls back to plaintext JSON for dev). _identity/VaultNodeFs.js_ (124 lines).
- **`OAuthVault`** — typed OAuth-token storage on top of any Vault. `/home/frits/expotest/nkn-test/packages/core/src/identity/OAuthVault.js:41`. Public: `registerRefreshFn(service, fn)`, `storeTokens(service, accountId, bundle)`, `getTokens(service, accountId?)`, proactive (60s leeway) + reactive (401-retry) refresh. Multi-account via `oauth:<service>:<accountId>` keys.
- **`makeAuthorizedFetch({ vault, service, accountId? })`** — wraps `fetch` to attach a Bearer token from the OAuthVault, retrying once on 401. _OAuthVault.js_ (exported alongside `OAuthVault`).
- **`AgentIdentity`** — Ed25519 keypair + nacl.box encryption (Curve25519 via ed2curve). Single 32-byte seed drives both signing and encryption. `/home/frits/expotest/nkn-test/packages/core/src/identity/AgentIdentity.js:21`.
  - Static factories: `AgentIdentity.generate(vault)` _:38_, `AgentIdentity.restore(vault)` _:45_, `AgentIdentity.restoreWithPrevious(vault)` (Group FF grace) _:62_, `AgentIdentity.fromMnemonic(mnemonic, vault)` _:85_, `AgentIdentity.rotate(vault, opts)` _:105_.
  - Instance: `pubKey` (b64url string), `pubKeyBytes`, `boxPubKeyBytes`, `vault`, `getMnemonic()`, `sign(data)`, `box(plaintext, recipientPubKey)`, `unbox(ciphertext, nonce, senderPubKey)`, `deriveSessionKey(peerPubKey)`.
  - Statics: `AgentIdentity.verify(data, sig, pubKey)`, `AgentIdentity.secretbox/secretunbox(...)`.
- **`KeyRotation`** — Ed25519 identity-rotation proofs. `/home/frits/expotest/nkn-test/packages/core/src/identity/KeyRotation.js:23`. Statics: `buildProof`, `verify`, `broadcast`, `applyToRegistry`, plus migration helpers used by `Agent.rotateIdentity`.
- **`Bootstrap`** — root identity secret (Track B). 32-byte secret; derives BIP-39 mnemonic, per-resource HKDF keys, and a stable bootstrap pubkey. `/home/frits/expotest/nkn-test/packages/core/src/identity/Bootstrap.js:49`. Factories: `Bootstrap.create()`, `Bootstrap.fromSeed(bytes)`, `Bootstrap.fromMnemonic(phrase)`. Methods: `deriveResourceKey(path)`, `bootstrapKeyFingerprint()`, `onKeyRotated(cb)`.
- **`IdentityPodStore`** — on-pod side of the identity-pod schema. `/home/frits/expotest/nkn-test/packages/core/src/identity/IdentityPodStore.js`. Walks `/canopy/`, encrypts each resource (XSalsa20-Poly1305 envelope, per-resource HKDF), signs `manifest.ttl`, and appends to `auth-log/YYYY-MM.enc`. Public surface includes `init()`, `writeResource(path, record)`, `readResource(path)`, `listResources(prefix)`, etc. NOTE: v1 stores per-resource records as JSON inside the encryption envelope (not Turtle); manifest still real Turtle.
- **`IdentitySync`** — bidirectional sync engine between an `IdentityPodStore` and a local `Vault`. `/home/frits/expotest/nkn-test/packages/core/src/identity/IdentitySync.js:45`. Public methods: `start()`, `stop()`, `now({ priority?, resources? })`, `onForeground()`. 5-min default polling + on-demand security-priority refresh. Cache shape `identity-cache:<resourcePath>` in vault.
- **`migrateVaultToPod(vault, podStore, opts?)`** — Track B/B5 one-shot device-identity migration to a fresh pod; idempotent (vault flag `'identity-migration:migrated-at'`). _identity/migrateVaultToPod.js_.
- **`CloudBackup`** — passphrase-encrypted off-device backup of bootstrap secret + recovery hints. `/home/frits/expotest/nkn-test/packages/core/src/identity/CloudBackup.js`. argon2id (`m=64MB, t=3, p=1`) + nacl.secretbox; envelope shape documented at file head.
- **`CloudAdapter`** — abstract cloud-storage interface (`put`, `get`, `delete`, `list`). `/home/frits/expotest/nkn-test/packages/core/src/identity/CloudAdapter.js:26`. v1 ships `MemoryAdapter` only (tests). Real adapters (Dropbox/Google Drive/iCloud/S3) deferred per Q-C.5.
- **`Mnemonic`** helpers: `generateMnemonic()`, `mnemonicToSeed(words)`, `seedToMnemonic(seed)`, `validateMnemonic(words)`. `/home/frits/expotest/nkn-test/packages/core/src/identity/Mnemonic.js`. Uses `@scure/bip39`, 256-bit / 24-word.

### Security primitives

- **`SecurityLayer`** — nacl.box encryption + Ed25519 signatures applied on every outbound and verified on every inbound non-A2A envelope. `/home/frits/expotest/nkn-test/packages/core/src/security/SecurityLayer.js:50`. Inbound check order: replay window (±10 min), dedup (10 min), HI auto-register, Ed25519 verify, decrypt. Public methods: `encrypt(envelope)`, `decryptAndVerify(rawEnvelope)`, `registerPeer(addr, pubKey)`, `unregisterPeer(addr)`, `getPeerKey(addr)`, `swapIdentity`, `setInlineProof`, `registerSelfRotation`, `attachGroupManager`. **Substrates should never roll their own envelope encryption — wire this in via `Agent`.**
- **`SecurityError`** + **`SEC`** — typed error code constants (`MISSING_SIG`, `REPLAY_WINDOW`, `DUPLICATE`, `UNKNOWN_RECIPIENT`, `UNKNOWN_SENDER`, `BAD_SIG`, `DECRYPT_FAILED`). _SecurityLayer.js:30_.
- **`signReachabilityClaim(identity, opts)` / `verifyReachabilityClaim(claim, expectedIssuer, lastSeenSeq, limits)` / `createMemorySeqStore()` / `CLAIM_VERSION` / `DEFAULT_VERIFY_LIMITS`** — Group T signed-reachability primitives. `/home/frits/expotest/nkn-test/packages/core/src/security/reachabilityClaim.js`. Signed body shape `{v, i, p, t, s}` (v1, issuer pubkey, sorted peer pubkey list, ttlMs, monotonic sequence). Receiver-anchors TTL — clock skew structurally irrelevant.
- **`signOrigin(identity, { target, skill, parts, ts? })` / `verifyOrigin(...)` / `ORIGIN_SIG_VERSION` / `DEFAULT_ORIGIN_WINDOW_MS`** — Group Z verified-origin attribution. Signs the invocation intent (target/skill/parts/ts), not the envelope. `/home/frits/expotest/nkn-test/packages/core/src/security/originSignature.js:41`.
- **`packSealed({ identity, recipientPubKey, skill, parts, origin, originSig, originTs, extras? })` / `openSealed({ identity, sender, sealed, nonce })` / `SEALED_VERSION`** — Group BB blind-forward seal/open. Inner skill invocation packed with `nacl.box` to the final hop; intermediate bridges see only opaque bytes. `/home/frits/expotest/nkn-test/packages/core/src/security/sealedForward.js`.
- **`generateTunnelKey()` / `sealTunnelOW(K, innerOW)` / `openTunnelOW(K, sealed, nonce)`** — symmetric AEAD (XSalsa20-Poly1305) for in-tunnel OWs (Group CC3b). `/home/frits/expotest/nkn-test/packages/core/src/security/tunnelSeal.js`. Per-session 32-byte key, ~100× cheaper than per-OW packSealed; tunnel TTL = 10 min.

### Transport

The `Transport` base class is the integration point for any wire protocol. Anything that wants to send envelopes must extend it (or wrap an instance).

- **`Transport`** — abstract base. `/home/frits/expotest/nkn-test/packages/core/src/transport/Transport.js:20`. Subclasses implement `connect()`, `disconnect()`, and `_put(to, envelope)`. The base provides the four wire primitives `sendOneWay(to, payload)` (OW), `sendAck(to, payload, timeout?)` (AS, awaits AK), `request(to, payload, timeout?)` (RQ, awaits RS), `respond(to, replyToId, payload)` (RS), `sendHello(to, payload)` (HI). Reply codes (AK/RS) auto-resolve pending promises by `_id`. AS envelopes are auto-ACK'd at transport level. `useSecurityLayer(layer)` wires SecurityLayer in/out. `setReceiveHandler(fn)` is called by Agent. `canReach(peerAddress)` — override in transports where reachability is per-peer (default `true`, `RelayTransport` returns `connected`, `RendezvousTransport` returns "open data channel for peer", `OfflineTransport` returns `false`). `forgetPeer(address)` clears per-peer caches.
- **`InternalBus`** — shared in-process EventEmitter bus (extends `Emitter`). _transport/InternalTransport.js:17_.
- **`InternalTransport`** — in-process bus transport for tests + same-process agents. _InternalTransport.js:19_. Constructor `new InternalTransport(bus, address, opts?)`.
- **`RelayTransport`** — WebSocket relay client (`ws://` / `wss://`). `/home/frits/expotest/nkn-test/packages/core/src/transport/RelayTransport.js:21`. Auto-reconnect with exponential backoff, max 30s. Wire protocol matches `WsServerTransport`. `canReach` ↔ `connected`. `connected` getter. Lazy-loads `ws` package in Node, uses `globalThis.WebSocket` in browsers.
- **`MqttTransport`** — MQTT broker transport. `/home/frits/expotest/nkn-test/packages/core/src/transport/MqttTransport.js:27`. Subscribes to `canopy/<addr>/in`. Address derived from first 12 bytes of pubKey (24-hex). Lazy `mqtt` peer dep.
- **`NknTransport`** — NKN network transport. `/home/frits/expotest/nkn-test/packages/core/src/transport/NknTransport.js:18`. Wraps `nkn-sdk`, deterministic NKN addr from Ed25519 seed. 90s connect timeout with seedless retry.
- **`LocalTransport`** — localhost WebSocket transport (port or Unix socket). `/home/frits/expotest/nkn-test/packages/core/src/transport/LocalTransport.js:16`. Same wire protocol as RelayTransport so it works with `WsServerTransport`. No auto-reconnect.
- **`RendezvousTransport`** — WebRTC DataChannel transport with relay-as-signaller. `/home/frits/expotest/nkn-test/packages/core/src/transport/RendezvousTransport.js:60`. Browser-native; Node needs `node-datachannel`/`wrtc`; React Native needs `react-native-webrtc`. Static `RendezvousTransport.isSupported()` guard. Methods: `connectToPeer(peerPubKey, timeout?)`, `hasOpenChannelTo(peer)`. Emits `peer-connected` / `peer-disconnected` (consumed by `Agent.enableRendezvous`).
- **`OfflineTransport`** — no-op fallback transport. `/home/frits/expotest/nkn-test/packages/core/src/transport/OfflineTransport.js:14`. `canReach` returns `false`; `_put` throws `Agent is offline`. Used as the safe primary when no network is available; secondary transports take over once they connect.

**Per-transport constructor cheat:**
| Transport | Required opts | Optional opts |
|---|---|---|
| `InternalTransport` | `bus, address` | `identity` |
| `RelayTransport` | `relayUrl, identity` | — |
| `LocalTransport` | `identity, port|socketPath|url` | — |
| `MqttTransport` | `brokerUrl, identity` | `mqttOpts` |
| `NknTransport` | `identity` | `identifier, nknLib, warnAfter, connectTimeout` |
| `RendezvousTransport` | `signalingTransport, identity` | `rtcLib, iceServers` |
| `OfflineTransport` | `identity` | — |
| `BleTransport` (RN) | `identity` | `advertise, scan` |
| `MdnsTransport` (RN) | `identity, hostname` | — |
| `WsServerTransport` (relay) | `address` | `port, offlineQueueTtl` |
| `A2ATransport` | `agent` | `port, baseUrl, a2aTLSLayer` |

### Agent class

- **`Agent`** — the developer-facing class. `/home/frits/expotest/nkn-test/packages/core/src/Agent.js:48`. Extends `Emitter`.
  - Constructor opts: `identity`, `transport` (primary), `security?`, `policyEngine?`, `trustRegistry?`, `tokenRegistry?`, `peers?` (PeerGraph), `storage?` (StorageManager), `config?` (AgentConfig), `routing?` (RoutingStrategy), `maxTaskTtl?`, `pubSubHistory?`, `skills?`, `label?`. `transport` is required.
  - Static factories: `Agent.createNew({ transport, vault?, label?, ...rest })` _:1000_, `Agent.restore({ transport, vault, ...rest })` _:1017_, `Agent.restoreFromMnemonic(mnemonic, opts)` _:1035_, `Agent.fromPlainObject(obj, opts)` _:1061_, `Agent.fromJson(json, opts)` _:1104_, `Agent.fromYaml(yaml, opts)` _:1119_.
  - Identity / accessors: `address`, `pubKey`, `label`, `identity`, `security`, `skills`, `stateManager`, `policyEngine`, `trustRegistry`, `tokenRegistry`, `transport`, `peers`, `storage`, `config`, `routing`, `discovery`, `helloGate`, `transportNames`, `maxTaskTtl`, `pubSubHistory`.
  - Multi-transport: `addTransport(name, transport)` _:153_, `removeTransport(name)` _:169_, `getTransport(name)` _:183_, `transportFor(peerId, opts?)` _:276_, `routeFor(peerId, opts?)` _:293_, `reachabilityFor(peerId, opts?)` _:319_ (returns `{name, transport, tier, latencyEstimate?}` — uses RoutingStrategy).
  - Peers: `addPeer(address, pubKey)` _:199_, `forget(pubKeyOrAddress)` _:212_.
  - Skills: `register(id, handler, opts?)` _:230_ (delegates to `defineSkill` + SkillRegistry).
  - Lifecycle: `start()` _:237_, `stop()` _:257_.
  - Calls: `hello(peerAddress, timeout?)` _:334_, `call(peerId, skillId, input?, opts?)` _:364_ (returns Task), `invoke(peerId, skillId, input?, opts?)` _:379_ (awaits Task → Parts[]), `invokeWithHop(peerId, skillId, input?, opts?)` _:399_ (hop-aware Promise), `callWithHop(peerId, skillId, input?, opts?)` _:420_ (hop-aware Task), `message(peerId, parts)` _:826_ (OW), `introduce(peerId, card)` _:840_, `discoverA2A(url, opts?)` _:854_, `discoverSkills(peerId, timeout?)` _:909_, `publish(topic, parts)` _:917_, `clearPubSubHistory(topic?)` _:926_.
  - Tokens: `issueCapabilityToken({ subject, skill, expiresIn?, constraints?, parentToken? })` _:870_, `issueA2ACapabilityToken(opts)` _:884_ (returns JWT), `storeA2AToken(peerUrl, token)` _:899_.
  - Opt-in features (idempotent registrations): `enableRelayForward({ policy? })` _:500_, `enableTunnelForward({ policy? })` _:524_, `enableReachabilityOracle({ ttlMs?, refreshBeforeMs?, maxPeers?, seqStore? })` _:550_, `enableRendezvous({ signalingTransport, rtcLib?, iceServers?, auto? })` _:585_, `upgradeToRendezvous(peerPubKey, timeout?)` _:644_, `isRendezvousActive(peerPubKey)` _:657_, `enableSealedForwardFor(groupId, opts?)` _:683_, `disableSealedForwardFor(groupId)` _:693_, `getSealedForwardConfig(groupId)` _:702_, `setHelloGate(fn)` _:720_, `startDiscovery({ pingIntervalMs?, gossipIntervalMs?, maxGossipPeers? })` _:741_, `enableAutoHello({ pullPeers?, helloTimeout? })` _:777_, `rotateIdentity({ gracePeriodSeconds?, broadcast? })` _:449_.
  - Export: `agent.export({ callerPubKey?, tier? })` _:947_ — returns `{ pubKey, address, label, skills[], transports[] }` filtered to caller.
  - Events:
    - `'start'` `{address}` — agent started.
    - `'stop'` — agent stopped.
    - `'peer'` `{address, pubKey, label, ack, capabilities}` — inbound HI received.
    - `'peer-forgotten'` `pubKey` — `agent.forget(...)` completed.
    - `'peer-rotated'` `{oldPubKey, newPubKey, from, inGrace, via, issuedAt, gracePeriod}` — peer rotated identity.
    - `'self-rotated'` `{oldPubKey, newPubKey, graceUntil, proof}` — `agent.rotateIdentity()` completed.
    - `'rendezvous-upgraded'` `{peer}` / `'rendezvous-downgraded'` `{peer, reason}` / `'rendezvous-failed'` `{peer, error}`.
    - `'auto-hello-error'` `{peer, error}`.
    - `'error'`, `'security-error'`.
    - `'envelope'` — unhandled envelope falls through here.
    - `'message'` `{from, parts}` — inbound `messaging.handleMessage`.
    - `'publish'` `{from, topic, parts}` — inbound PB or pub OW.
    - `'file-received'` `{from, filePart, transferId?}`.
    - `'key-rotation-rejected'` `{reason, from, ...}`.
    - `'session-open'` / `'session-message'` / `'session-close'` (when `registerSessionSkills(agent)` is called).
    - `'push'` `{data, foreground}` — emitted by RN's `MobilePushBridge`.

### Skills

- **`defineSkill(id, handler, opts?)`** — validate + normalise a skill definition. Fills defaults so consumers never null-check. `/home/frits/expotest/nkn-test/packages/core/src/skills/defineSkill.js:47`.
  - **opts**: `description`, `inputModes` (default `['application/json']`), `outputModes`, `tags`, `streaming` (default `false`), `visibility` (`'public'|'authenticated'|'trusted'|'private'` or `{ groups: [...], default: 'hidden'|'visible' }`, default `'authenticated'`), `policy` (`'on-request'|'always-allow'|'requires-token'|'never'`, default `'on-request'`), `posture` (`'always'|'negotiable'`, default `'always'`), `humanInTheLoop` (`'never'|'either'|'required'`, default `'never'`), `requiredRole` (`{ group, role }`), `enabled` (default `true`).
  - **Handler signature**: `async ({ parts, from, taskId, envelope, agent, originFrom?, originVerified?, signal? }) → Part[]|any` or `async function*` for streaming. `signal` is an `AbortSignal` from the TTL-expiry watchdog.
  - **Throw `new Task.InputRequired(parts)`** to pause and ask the caller for more input; resumed via `task.send(parts)`.
- **`normaliseVisibility(v)`** — turn a visibility into `{kind:'tier', tier}` or `{kind:'groups', groups, default}`. _defineSkill.js:118_.
- **`SkillRegistry`** — id-keyed Map of skills, last-write-wins. `/home/frits/expotest/nkn-test/packages/core/src/skills/SkillRegistry.js:10`. Methods: `register(idOrDef, handler?, opts?)`, `get(id)`, `all()`, `forTier(tier)`, `forCaller({ tier?, checkGroup?, callerPubKey? })`, `getByPosture({ posture?, humanInTheLoop? })`, `has(id)`, `size`.
- **`registerRelayForward(agent, opts?)`** — registers `relay-forward` skill (cooperative one-shot hop). _skills/relayForward.js:29_. Drives `invokeWithHop`.
- **`registerRelayReceiveSealed(agent, opts?)`** — registers `relay-receive-sealed` skill (Group BB inbound). _skills/relayReceiveSealed.js:23_.
- **`registerReachablePeersSkill(agent, opts?)`** — registers `reachable-peers` skill (Group T producer). _skills/reachablePeers.js:33_. Resolution chain: explicit arg → `agent.config.get('oracle.<key>')` → built-in defaults (5 min TTL, 60 s refresh-before, 256 max peers).
- **`registerCapabilitiesSkill(agent, opts?)`** — registers `get-capabilities` skill (Group AA3 feature-flag report). _skills/capabilities.js:26_.
- **`registerTunnelOpen(agent, opts?)`** — registers `tunnel-open` skill (Group CC bridge entry). Returns the `TunnelSessions` instance. _skills/tunnelOpen.js:37_.
- **`registerTunnelOw(agent)`** — registers `tunnel-ow` (paired with `tunnel-open`). _skills/tunnelOw.js_.
- **`registerTunnelReceiveSealed(agent, opts?)`** — Carol's entry for sealed tunnels (Group CC3b). _skills/tunnelReceiveSealed.js_.
- **`TunnelSessions`** — in-memory session table for hop-aware tunnels (Bob side). _skills/tunnelSessions.js_. `DEFAULT_TTL_MS = 10 min`, sweep interval 60 s.

### Protocols

- **pubSub** — peer-to-peer topic broadcast over `OW{type:'subscribe'|'unsubscribe'|'publish', topic, parts}` envelopes (and `PB` for inbound publishes). `/home/frits/expotest/nkn-test/packages/core/src/protocol/pubSub.js`. Exports: `subscribe(agent, publisherAddress, topic, callback)` _:22_ — registers an `agent.on('publish')` listener for that publisher+topic AND sends the subscribe OW. `unsubscribe(agent, publisherAddress, topic)` _:39_. `publish(agent, topic, partsOrValue)` _:51_ — fans out to local subscriber set; respects `agent.pubSubHistory`. `handlePubSub(agent, envelope)` _:80_ — Agent dispatch hook. Native-to-native only; A2A peers use the `subscribe` skill.
- **`SkillsPubSub`** — pattern-aware skill-advertisement layer on top of pubSub. `/home/frits/expotest/nkn-test/packages/core/src/protocol/SkillsPubSub.js:124`. Constructor `({ agent, skillRegistry? })`. Topic format: `skills:<group>:<posture>:<audience>:<skillId>` (5 segments, `*` wildcard per segment). Methods: `topicFor(skillId, opts?)`, `broadcastSkill(skillId, opts?)`, `broadcastAll(opts?)`, `subscribeToSkills(filter?, handler)`, `followPublisher(publisherAddress, topic)`, `republishOnSkillChange({ intervalMs?, group?, filter? })`, `destroy()`.
  - **`buildTopic({ group?, posture, audience, skillId })`** — exported as `buildSkillTopic`. _SkillsPubSub.js:58_.
  - **`audienceFromHumanInTheLoop(hitl)`** — `'never'→'machine'`, `'required'→'human'`, `'either'→'either'`. _SkillsPubSub.js:38_.
- **taskExchange** — RQ/RS task lifecycle + streaming + IR/RI + cancel + TTL. `/home/frits/expotest/nkn-test/packages/core/src/protocol/taskExchange.js`. Exports: `callSkill(agent, peerId, skillId, parts, opts?)` _:69_ (returns Task), `handleTaskRequest(agent, envelope)`, `handleTaskOneWay(agent, envelope)`. Handles capability-token attachment via `agent.tokenRegistry`, FallbackTable success/failure reporting, sealed-tunnel decryption, origin-sig verification.
- **`Task`** — A2A-compatible task state machine. `/home/frits/expotest/nkn-test/packages/core/src/protocol/Task.js:29`. Extends `Emitter`. States: `submitted → working → completed | failed | cancelled | expired`, plus `working ↔ input-required`. API: `task.done()` (Promise<{state, parts, error?}>), `task.stream()` (async generator of Part[]), `task.cancel()`, `task.send(parts)` (reply to IR). `Task.InputRequired` static — throw from a handler to enter the IR state.
- **messaging** — `sendMessage(agent, peerId, parts, opts?)` (tries AS/AK first, falls back to OW; `requireAck` to throw on no-ack) _protocol/messaging.js:19_; `handleMessage(agent, envelope)` emits `'message'` _:38_.
- **hello** — `sendHello(agent, peerAddress, timeout?)` _protocol/hello.js:33_, `handleHello(agent, envelope)` _:84_. HI carries `{pubKey, label, ack, capabilities}`. Honors `agent.helloGate`. Stores capabilities on the PeerGraph record. Bidirectional handshake via `peer` event.
- **ping** — `ping(agent, peerId, timeout?)` returns latency ms or null. _protocol/ping.js:14_. Uses AS/AK round-trip.
- **session** — three native-only stateful-channel skills. _protocol/session.js_. `handleSessionOpen`, `handleSessionMessage`, `handleSessionClose` exported. `registerSessionSkills(agent)` _:83_ to install all three. Apps listen on `session-open`/`session-message`/`session-close` events.
- **streaming** — `streamOut(agent, peerId, taskId, generator, signal?)` (drives async-generator → ST/SE OW) _protocol/streaming.js:29_; `handleStreamChunk(agent, envelope)` _:59_; `streamBidi(agent, peerId, taskId, handler)` _:90_ (two parallel OW streams; native only).
- **fileSharing** — `sendFile(agent, peerId, filePart, opts?)` (auto-routes inline OW vs chunked BT depending on size; threshold 64 KB) _protocol/fileSharing.js:38_; `bulkTransferSend(agent, peerId, transferId|null, base64Data, meta?)` _:70_; `handleBulkChunk(agent, envelope)` _:99_. Receiver buffers in StateManager and emits `file-received`.
- **skillDiscovery** — `requestSkills(agent, peerId, timeout?)` _protocol/skillDiscovery.js:20_; `handleSkillDiscovery(agent, envelope)` _:32_. RQ/RS; responder filters via TrustRegistry tier + `SkillRegistry.forCaller`.
- **`LiveSyncSkill`** — one-way source → target sync engine with onConflict callback + idempotent applied-ids state in vault. `/home/frits/expotest/nkn-test/packages/core/src/protocol/LiveSyncSkill.js:58`. Constructor `({ name, source, target, vault, onChange?, onConflict?, pollIntervalMs? })`. Adapter shapes documented in the file head: source has `listChanges({cursor, limit}) → {events, nextCursor}` + `fetchPayload(eventId)`; target has `write(uri, content, opts)`, `read(uri)`, `exists(uri)`, optional `delete(uri)`. Methods: `start()`, `stop()`, `runOnce()` (in-flight coalesce), `stats`, `lastError`, `isRunning`. Use case: Google Docs → Solid pod migration.
- **keyRotation** — `KeyRotation` (identity package, see Identity) plus inbound handler `handleKeyRotationOW(agent, envelope)` (always-on, lives in `protocol/keyRotation.js`). Receives peer rotation broadcasts and migrates SecurityLayer + PeerGraph + TrustRegistry, emitting `peer-rotated`.

### Permissions

- **`TrustRegistry`** — vault-backed peer trust tier persistence. `/home/frits/expotest/nkn-test/packages/core/src/permissions/TrustRegistry.js:22`. Constructor takes a `Vault`. Methods: `setTier(pubKey, tier)`, `getTier(pubKey)` (default `'authenticated'`), `getRecord(pubKey)`, `addGroup`/`removeGroup(pubKey, groupId)`, `addTokenGrant(pubKey, tokenId)`, `all()`. Vault keys `trust:<pubKey>`.
- **`TIER_LEVEL`** — frozen map `{public:0, authenticated:1, trusted:2, private:3}`. _TrustRegistry.js:15_.
- **`PolicyEngine`** — single inbound permission entry-point. Called by `handleTaskRequest` before invoking a skill. `/home/frits/expotest/nkn-test/packages/core/src/permissions/PolicyEngine.js:27`. Constructor `({ trustRegistry, skillRegistry, agentPubKey?, groupManager? })`. Methods: `checkInbound({ peerPubKey, skillId, action?, token?, agentPubKey? })` → `{tier, allowed:true}` or throws `PolicyDeniedError`; `checkOutbound({peerId, skillId})` (Phase 1 = always allow). Throws `PolicyDeniedError` with `code` ∈ `NOT_FOUND|DISABLED|INSUFFICIENT_TIER|POLICY_NEVER|NO_GROUP_MANAGER|INVALID_REQUIRED_ROLE|NOT_A_MEMBER|INSUFFICIENT_ROLE|NO_TOKEN|INVALID_TOKEN`.
- **`CapabilityToken`** — Ed25519-signed skill-call grant. `/home/frits/expotest/nkn-test/packages/core/src/permissions/CapabilityToken.js:28`. Wire shape `{id, issuer, subject, agentId, skill|'*', constraints?, issuedAt, expiresAt, parentId?, sig}`. Statics: `CapabilityToken.issue(identity, opts)`, `CapabilityToken.verify(token, expectedAgentId?)`, `CapabilityToken.verifyChain(tokens)`, `CapabilityToken.fromJSON(obj)`, `CapabilityToken.issueJWT(identity, opts)` (for A2A).
- **`PodCapabilityToken`** — Ed25519-signed pod-resource grant (read/write/delete on path prefixes). `/home/frits/expotest/nkn-test/packages/core/src/permissions/PodCapabilityToken.js:52`. Scope syntax `pod.<read|write|delete|*>:<path-prefix>` with prefix-strict path matching (trailing slash = container scope, no slash = exact resource). Statics: `PodCapabilityToken.issue(identity, { subject, pod, scopes, expiresIn?, constraints?, parentId? })`, `verify(token, expectedPod?)`, `verifyChain(tokens)`, `matchesScope(grantedScope, requiredScope)`, `fromJSON(obj)`.
- **`TokenRegistry`** — vault-backed storage for HELD CapabilityTokens (tokens we received). `/home/frits/expotest/nkn-test/packages/core/src/permissions/TokenRegistry.js:13`. Methods: `store(token)`, `get(agentId, skill)` (latest non-expired non-revoked match), `revoke(tokenId)`, `isRevoked(tokenId)`, `cleanup()`. Vault keys `token:<id>` + `revoked:<id>`.
- **`GroupManager`** — Ed25519-signed group membership proofs with roles. `/home/frits/expotest/nkn-test/packages/core/src/permissions/GroupManager.js:30`. Constructor `({ identity, vault })`. Admin: `issueProof(memberPubKey, groupId, { role?, expiresIn? })`, `setRole(memberPubKey, groupId, newRole, opts?)` (atomic), `revokeProof(memberPubKey, groupId)`, `getRole(memberPubKey, groupId)`, `listMembersByRole(groupId, role)`. Member: `storeProof(proof)`, `getProof(groupId)`, `hasValidProof(pubKey, groupId)`, `verifyProof(proof)`, `canChangeRole(actor, target, groupId)`, `listGroups()`. Vault keys `group-proof:<id>`, `group-admin:<id>`.
- **`verifyGroupProof(proof, expectedAdminPubKey)`** — pure function GroupProof verifier (no Vault state required; relay uses this). `/home/frits/expotest/nkn-test/packages/core/src/permissions/groupProofVerify.js:33`.
- **`DataSourcePolicy`** — gates per-skill / per-agent access to named data sources. `/home/frits/expotest/nkn-test/packages/core/src/permissions/DataSourcePolicy.js:24`. `checkAccess({ sourceLabel, skillId?, agentId? })` throws `DataSourceAccessDeniedError` on denial.
- **`Roles`** module (re-exports the `ROLES` constants implicitly through GroupManager). Standard role hierarchy: admin (100) > coordinator (80) > member (60) > observer (40) > external (20). `/home/frits/expotest/nkn-test/packages/core/src/permissions/Roles.js`. App-side custom-role registration via `registerCustomRole(roleId, rank)` (not directly re-exported; consumed by `GroupManager`).

### Routing & reachability

- **`RoutingStrategy`** — selects the best transport per peer + action. `/home/frits/expotest/nkn-test/packages/core/src/routing/RoutingStrategy.js:26`. Constructor `({ transports, peerGraph?, fallbackTable?, config? })`. Priority: `internal > local > mdns > rendezvous > relay > nkn > mqtt > ble > a2a`. Looks up `PeerGraph` for type ('a2a' isolates to a2a; 'native'/'hybrid' picks among the natives), respects per-peer preferred transport (set by rendezvous-upgrade hook), respects `canReach()` per transport, applies `transportFilter`, applies pattern filter (`streaming|bulk|bidi`). Methods: `selectTransport(peerId, opts?)` → `{name, transport}|null`, `tierFor(peerId, opts?)` → `{name, transport, tier, latencyEstimate?}|null`, `addTransport(name, transport)`, `setPreferredTransport(peerId, name)`, `clearPreferredTransport(peerId)`, `onTransportFailure(peerId, transport)` (marks degraded). Properties: `fallbackTable`, `peerGraph`.
- **`TRANSPORT_PRIORITY`** — exported priority array. _RoutingStrategy.js:22_.
- **`FallbackTable`** — per-(peer, transport) latency + degraded-state. `/home/frits/expotest/nkn-test/packages/core/src/routing/FallbackTable.js:13`. Methods:
  - `record(peerId, transportName, latencyMs, patternSupport?)` _:25_ — capture a successful measurement; `patternSupport` is `{streaming?:bool, bulk?:bool, bidi?:bool}`.
  - `getBest(peerId, filter?, candidates?)` _:44_ — lowest-latency healthy transport satisfying the filter, sorted healthy-first then latency-asc.
  - `markDegraded(peerId, transportName, until?)` _:83_ — default 30 s degrade window.
  - `isDegraded(peerId, transportName)` _:96_, `getAll(peerId)` _:106_, `clear(peerId)` _:119_.
- **Reachability tier classification**:
  - **`ReachabilityTier`** default export bundle. _routing/ReachabilityTier.js:158_.
  - **`TIERS`** = `{DIRECT:'direct', MESH:'mesh', HOP:'hop'}`. _:26_.
  - **`tierForTransport(transport)`** — class-name or routing-name → tier. _:88_.
  - **`tierForRouteVia(via)`** — detects peer-as-relay hops. _:127_.
  - **`compareTiers(a, b)`** — direct < mesh < hop. _:150_.
- **`ReachabilityOracle`** — push-side wrapper around signed reachability claims. `/home/frits/expotest/nkn-test/packages/core/src/routing/ReachabilityOracle.js:44`. Subscribes/publishes on the `reachability:oracle` pubsub topic. Methods: `start()`, `stop()`, `notifyTransportChange()`, `bridgeFor(peerId)`, `entriesFor(issuer)`. TTL 5 min default; heartbeat every 60 s; per-issuer monotonic-sequence replay guard.
- **`ORACLE_TOPIC`** = `'reachability:oracle'` (re-exported as `REACHABILITY_ORACLE_TOPIC`).
- **`invokeWithHop(agent, target, skillId, parts, opts?)`** — Promise<Parts[]> facade over `callWithHop` (direct → bridge → tunnel-or-one-shot). _routing/invokeWithHop.js:22_. Re-exports `callWithHop` _:31_.
- Internal helpers (not directly exported but referenced):
  - `routing/callWithHop.js` — Task-returning hop-aware caller; chooses between sealed-tunnel mode (when `enableSealedForwardFor(group)` is set), tunnel-aware (`tunnel-open` skill on bridge) or one-shot (`relay-forward` skill).
  - `routing/hopTunnel.js` — driver for tunnel-mode (`tunnel-open` + `tunnel-ow` flow on Bob; locally-managed Task on Alice).
  - `routing/hopBridges.js` — picks a bridge peer: oracle entries → PeerGraph direct peers → probe-retry.
  - `routing/hopOneShot.js` — relay-forward driver for non-tunnel peers.

### Discovery

- **`PeerGraph`** — registry of known peers with indexed queries + events. Extends `Emitter`. `/home/frits/expotest/nkn-test/packages/core/src/discovery/PeerGraph.js:40`. Constructor `({ storageBackend? })` — backend is anything with `get/set/delete/list` (Vault-compatible); falls back to in-memory Map.
  - Methods: `upsert(record)` _:62_ (merge semantics: array fields union, nested objects shallow-merge, `lastSeen` preserved), `get(id)` _:94_, `all()` _:101_, `remove(id)` _:110_, `clear()` _:122_.
  - Filtered queries: `withSkill(skillId, opts?)` _:131_, `inGroup(groupId)` _:141_, `reachable()` _:147_, `fastest(n)` _:156_, `a2aAgents()` _:169_, `withCapabilities({skill?, streaming?})` _:182_.
  - Events: `'added'`, `'removed'`, `'cleared'`.
  - PeerRecord fields: `pubKey`/`url`, `type` (`'native'|'a2a'|'hybrid'`), `label`, `reachable`, `lastSeen`, `groups`, `tier`, `skills`, `discoverable`, `transports` (Record<name, config>), `latency` (Record<transport, ms>), `capabilities`, `knownPeers*` (oracle, atomically replaced — never spread-merged), `via` (hop bridge pubkey), `hops`.
- **`PeerDiscovery`** — coordinates peer acquisition. `/home/frits/expotest/nkn-test/packages/core/src/discovery/PeerDiscovery.js:17`. Wires `PingScheduler` + `GossipProtocol`. Entry points: `discoverByQR(payload)`, `discoverByUrl(httpsUrl)`, `discoverByIntroduction(card, from?)`, `discoverByGroupBootstrap(memberList, adminPubKey)`. Started via `agent.startDiscovery()`.
- **`GossipProtocol`** — periodic peer-list exchange with random tier-1+ peers. `/home/frits/expotest/nkn-test/packages/core/src/discovery/GossipProtocol.js:16`.
- **`PingScheduler`** — exponential-backoff ping loop populating PeerGraph reachability + latency. `/home/frits/expotest/nkn-test/packages/core/src/discovery/PingScheduler.js:11`.
- **`pullPeerList(agent, directPeerPubKey, opts?)`** — invoke `peer-list` on a direct peer and merge results as indirect (hops:1) entries. Idempotent. `/home/frits/expotest/nkn-test/packages/core/src/discovery/pullPeerList.js:19`.

### A2A layer (Group H)

- **`A2ATransport`** — HTTP server (inbound A2A tasks) + HTTP client (outbound). `/home/frits/expotest/nkn-test/packages/core/src/a2a/A2ATransport.js:26`. Endpoints `GET /.well-known/agent.json`, `POST /tasks/send`, `POST /tasks/sendSubscribe` (SSE), `POST /tasks/:id/cancel`, `GET /tasks/:id`. Wired with `useSecurityLayer(new A2ATLSLayer(...))` — no nacl.box.
- **`A2ATLSLayer`** — pass-through SecurityLayer for A2ATransport. `/home/frits/expotest/nkn-test/packages/core/src/a2a/A2ATLSLayer.js:10`.
- **`A2AAuth`** — JWT validation for inbound A2A requests. `/home/frits/expotest/nkn-test/packages/core/src/a2a/A2AAuth.js:14`. Constructor `({ vault, groupManager?, tokenRegistry? })`. `validateInbound(req)` → `{tier:0..3, claims, peerId}`.
- **`AgentCardBuilder`** — builds an A2A-spec agent card JSON. `/home/frits/expotest/nkn-test/packages/core/src/a2a/AgentCardBuilder.js:21`.
- **`discoverA2A(agent, url, opts?)`** — fetch `/.well-known/agent.json`, build A2A peer record, upsert into PeerGraph. `/home/frits/expotest/nkn-test/packages/core/src/a2a/a2aDiscover.js:21`.
- **`sendA2ATask(...)` / `sendA2AStreamTask(...)`** — HTTP-client task drivers. `/home/frits/expotest/nkn-test/packages/core/src/a2a/a2aTaskSend.js`, `a2aTaskSubscribe.js`.

### Storage

The `DataSource` is the abstract for read/write/list/query/delete on string-keyed paths; **substrates that need persistence should implement DataSource (or one of its concrete subclasses) rather than wrapping `fs` / IndexedDB / `localStorage` directly.** The `MergeContract` is the abstraction for federated read merges; substrates needing per-field merge semantics across N pods compose a contract rather than building one.

- **`DataSource`** — abstract storage backend. `/home/frits/expotest/nkn-test/packages/core/src/storage/DataSource.js:8`. Methods: `read(path)` → Buffer|string|null, `write(path, data)`, `delete(path)`, `list(prefix)`, `query(filter)`. All async.
- **`MemorySource`** — in-memory. _storage/MemorySource.js:7_.
- **`IndexedDBSource`** — browser. _storage/IndexedDBSource.js:11_.
- **`FileSystemSource`** — Node.js. _storage/FileSystemSource.js_. Lazy `node:fs/promises`.
- **`SolidPodSource`** — DataSource backed by a Solid Pod (LDP), wraps `@inrupt/solid-client`. `/home/frits/expotest/nkn-test/packages/core/src/storage/SolidPodSource.js`. Diverges slightly: `read(uri)` returns `{content, contentType, lastModified, etag, size}` (rich metadata for conflict detection). Throws code-bearing Errors (`NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `CONFLICT`, `RATE_LIMITED`, `SERVER_ERROR`, `NETWORK_ERROR`, `INVALID_ARGUMENT`, `HTTP_ERROR`). `pod-client` maps these onto `PodClientError`.
- **`SolidVault`** — Solid OIDC session manager (despite the name, NOT a `Vault`). `/home/frits/expotest/nkn-test/packages/core/src/storage/SolidVault.js`. Wraps `@inrupt/solid-client-authn-node`'s Session. API: `new SolidVault({ webid, oidcIssuer, redirectUrl?, vault })`; `login({ clientId, clientSecret, refreshToken? })`, `isAuthenticated()`, `getAuthenticatedFetch()`, `refresh()`, `podRoot` getter, `logout()`. 60s leeway proactive refresh. EventEmitter — emits `auth-state`. Uses a user-supplied `Vault` for token persistence (`solid-oidc:<webid>:*`).
- **`StorageManager`** — policy-gated multi-source manager. `/home/frits/expotest/nkn-test/packages/core/src/storage/StorageManager.js:15`. Constructor `({ sources, policy? })`. Methods: `read(label, path, ctx?)`, `write(label, path, data, ctx?)`, `delete(label, path, ctx?)`, `list(label, prefix?, ctx?)`, `query(label, filter?, ctx?)`, `getSource(label)`, `addSource(label, source)`, `removeSource(label)`, `labels`. Always passes `ctx` (skillId, agentId) to the policy.
- **`PodExporter`** — serialise a Solid pod into a portable, optionally encrypted, deterministic archive ("DWLDP\\0v1" magic, 8-byte header, JSON header, framed entries; optional nacl.secretbox encryption). `/home/frits/expotest/nkn-test/packages/core/src/storage/PodExporter.js`. Track C/C3.
- **`PodImporter`** — restore a PodExporter archive into a (possibly different) pod. `/home/frits/expotest/nkn-test/packages/core/src/storage/PodImporter.js`. v1 limitations: no ACL re-establishment, implicit container creation.
- **`MergeContracts`** — pure-function merge contracts for federated reads. `/home/frits/expotest/nkn-test/packages/core/src/storage/MergeContracts/index.js`. Each contract: `merge(versions, opts?) → mergedValue` where `Version = { value, timestamp, sourceId }`.
  - **`setUnionWithDedupe(versions, opts?)`** — array union with `defaultItemHash` (stable JSON-stringify) or custom `opts.itemHash`.
  - **`appendOnlyEventLog(versions, opts?)`** — chronological merge of per-event-timestamped arrays; deterministic tie-break.
  - **`lastWriteWins(versions)`** — picks highest `timestamp`; tie-break: lex-largest `sourceId`.
  - **`MergeContracts`** map (`{setUnionWithDedupe, appendOnlyEventLog, lastWriteWins}`) for dynamic dispatch.
- **`FederatedReader`** — orchestrate parallel reads of one path across N member pods, then merge via a `MergeContract`. `/home/frits/expotest/nkn-test/packages/core/src/storage/FederatedReader.js:73`. Constructor `({ pods: [{client, sourceId}], failurePolicy?: 'partial-success-with-flag'|'fail-on-any'|'best-effort' })`. Method `read(path, contract, opts?)` → `{merged, failures: [{sourceId, error}]}`. `FederatedReadError` on `fail-on-any`. The PodClient interface consumed: `{ read(uri) → {content, lastModified, etag?, contentType?, size?} }`.
- **`PodStorageConvention`** (not directly re-exported; consumed by pod-client). `/home/frits/expotest/nkn-test/packages/core/src/storage/PodStorageConvention.js`. `writeWithConvention(podSource, externalStore, uri, content, opts?)` / `readWithConvention(podSource, externalStore, uri)`. Default threshold 1 MB; small writes inline, big writes upload to `externalStore` + write a reference manifest. Default `externalStore = NoneStore` throws `EXTERNAL_STORE_NOT_CONFIGURED`. Adapter interface documented in `external-stores/index.js` (`put`, `get`, `delete`, `exists`).
- **`NoneStore`** — default no-op ExternalStore that throws on every call (`code: 'EXTERNAL_STORE_NOT_CONFIGURED'`). _storage/external-stores/NoneStore.js:25_.

**`ExternalStore` interface** (duck-typed; documented in `core/src/storage/external-stores/index.js`):
```
put(blob: Uint8Array|Buffer|string, opts: { contentType, hash? }): Promise<string>  // returns URI
get(uri: string): Promise<Uint8Array>
delete(uri: string): Promise<void>
exists(uri: string): Promise<boolean>
```
Substrates that need to ship S3, IPFS, or Drive adapters implement this and pass the instance to `writeWithConvention(...)`.

### State manager

- **`StateManager`** — runtime registries for tasks, streams, and sessions. `/home/frits/expotest/nkn-test/packages/core/src/state/StateManager.js:15`. Three Maps with TTL eviction (tasks 30 min, streams 10 min, sessions 10 min). Methods: `createTask(taskId, task)`, `getTask(taskId)`, `deleteTask(taskId)`, `openStream(streamId, {taskId, peerId, sessionKey?})`, `getStream(streamId)`, `closeStream(streamId)`, `openSession(sessionId, {state?, peerId})`, `getSession(sessionId)`, `closeSession(sessionId)`. **Substrates that need ephemeral runtime state per task/stream/session should use this rather than rolling their own.**

### Config

- **`AgentConfig`** — layered runtime configuration. `/home/frits/expotest/nkn-test/packages/core/src/config/AgentConfig.js`. Layers (low → high): defaults → blueprint → file → developer overrides → runtime `set()`. Constructor `({ blueprint?, file?, overrides? })`. Methods: `get(path)`, `set(path, value)` (emits `'changed'`), `reset(path?)`, `on('changed', cb)`. Sections: `resources`, `discovery`, `policy` (`allowRelayFor`, `allowTunnelFor`, `transportFilter`, `taskAccept`, ...), `a2a`, `oracle`, `dataSources`, ...

### Hello gates (security/helloGates.js)

- **`tokenGate(secret)`** — pre-shared-secret gate; checks `envelope.payload.authToken === secret`. `/home/frits/expotest/nkn-test/packages/core/src/security/helloGates.js:23`.
- **`groupGate(groupIds, groupManager)`** — accept if `envelope.payload.authToken` is a valid GroupProof for any of `groupIds`. _:42_.
- **`anyOf(...gates)`** — composition; first accept wins. _:71_.

Note: `helloGates.js` is not currently re-exported through `core/src/index.js` — consumers import via the absolute subpath `'@canopy/core/src/security/helloGates.js'` (or rebuild their own). **Gap noted**.

---

## @canopy/relay

Package root: `/home/frits/expotest/nkn-test/packages/relay/`.
`package.json` `main: index.js`. Single `.` export. Bin `canopy-relay`. Public API surface in `/home/frits/expotest/nkn-test/packages/relay/index.js` (3 exports).

### startRelay (server)

- **`startRelay(opts?)`** — HTTP(S) + WebSocket relay broker. `/home/frits/expotest/nkn-test/packages/relay/src/server.js:100`. Returns `{ httpServer, wss, port, tls, stop }`. Opts: `port` (default 8787), `host`, `tlsCert`, `tlsKey` (TLS auto-enabled if both supplied), `serveStaticDir`, `indexFile`, `queueTtlMs` (default 5 min), `queueCap` (default 50), `log`, `multiRecipientQueue`, `multiRecipientQueueOpts`, `acceptedGroups` (Q-E.2 group-gating), `roleRanks`. Wire protocol documented at file head — `register`/`registered`/`send`/`message`/`error` core, `peer-list` request+broadcast, `multi-request`/`multi-deliver`/`multi-response-from-target`/`multi-response` for fan-out/in (E2b).
- **`getLanIp()`** — discover the local LAN IP for serving over the network. _server.js_ (re-exported through `index.js`).

### RelayAgent

- **`RelayAgent`** — Agent that also operates a WebSocket relay server. `/home/frits/expotest/nkn-test/packages/relay/src/RelayAgent.js:18`. Extends `Agent`. Static factory `RelayAgent.create({ port?, label?, policy?, identity?, vault?, offlineQueueTtl? })`. Built-in skills: `relay-info` (returns `{connectedPeers, mode, offlineQueue}`), `relay-peer-list`. Lifecycle wraps `WsServerTransport.start/stop`.

### WsServerTransport

- **`WsServerTransport`** — server-side `Transport` for the relay. `/home/frits/expotest/nkn-test/packages/relay/src/WsServerTransport.js:25`. Routes by `_to`: self → `_receive`, connected peer → forward, offline → buffer in queue (`offlineQueueTtl`, default 5 min). Methods: `start()`, `stop()`, `getConnectedPeers()`, `port` getter. Forwards WebRTC signaling envelopes as-is.

### GroupAuthVerifier

- **`GroupAuthVerifier`** — gates relay connections by group membership (Q-E.2). `/home/frits/expotest/nkn-test/packages/relay/src/GroupAuthVerifier.js:39`. Constructor `({ acceptedGroups?, roleRanks? })`. Verifies the GroupProof in the first `register` message via `verifyGroupProof` from core. Open-mode (default) when `acceptedGroups` is empty. Default rank table mirrors `core/src/permissions/Roles.js`.

### MultiRecipientQueue + queueStores

- **`MultiRecipientQueue`** — fan-out / fan-in orchestrator (E2b). `/home/frits/expotest/nkn-test/packages/relay/src/MultiRecipientQueue.js:18`. Constructor `({ store?, defaultTimeoutMs?, pollIntervalMs? })` — `defaultTimeoutMs=10000`, `pollIntervalMs=50`. Methods:
  - `fanOut({callerPubKey, targets, payload, timeoutMs?, dispatch})` _:53_ → Promise<`{id, responses, partial}`>. `dispatch(target, payload, ctx)` is the relay-supplied per-target wire-frame builder (`ctx.id` for fan-in correlation). Empty `targets` → `{id: null, responses: [], partial: false}`.
  - `addResponse(id, fromPubKey, response)` _:92_ — call from the relay wire handler when a target replies.
  - `resumeOpen()` _:101_ — count of still-open requests on restart.
  - `close()` _:106_ — clears pending timers + closes store.
  - Default store: `MemoryQueueStore`.
- **`QueueStore`** — abstract durable storage. `/home/frits/expotest/nkn-test/packages/relay/src/queueStores/QueueStore.js:28`. Methods: `putRequest(req)`, `getRequest(id)`, `listOpen()`, `addResponse(id, fromPubKey, response)`, `closeRequest(id)`, `delete(id)`, `close()`.
- **`MemoryQueueStore`** — in-process. _queueStores/MemoryQueueStore.js:11_.
- **`SqliteQueueStore`** — `better-sqlite3`-backed (sync internally, async surface). _queueStores/SqliteQueueStore.js_. Default path `./relay-queue.sqlite`; pass `:memory:` for tests.

The two QueueStore concretes are NOT re-exported through `index.js` — they are imported by file path inside the relay package. **Gap noted** for substrate authors who want to reuse the abstraction.

### Wire protocol summary

Documented at the head of `server.js` (lines 8-30). Substrates that build alternate signalling/relay servers should match this protocol so the same `RelayTransport` + `LocalTransport` clients work.

```
Client → Relay : { type:'register',     address:<pubKey>, groupProof? }
Relay  → Client: { type:'registered' }
Client → Relay : { type:'send',         to:<addr>, envelope:{...} }
Relay  → Client: { type:'message',      envelope:{...} }
Client → Relay : { type:'peer-list' }                                   // request
Relay  → Client: { type:'peer-list',    peers:[...] }                    // response + broadcast
Client → Relay : { type:'multi-request', targets:[...], payload:{...}, timeoutMs? }
Relay  → Target: { type:'multi-deliver', id, from:<callerPubKey>, payload }
Target → Relay : { type:'multi-response-from-target', id, response }
Relay  → Client: { type:'multi-response', id, responses:[...], partial:bool }
Relay  → Client: { type:'error',        message:<reason> }
```

WebRTC signalling envelopes (`rtc-offer`, `rtc-answer`, `rtc-ice`, `rtc-close`) traverse as ordinary `send`/`message` envelopes whose `payload.type` matches — no special wire handling.

---

## @canopy/pod-client

Package root: `/home/frits/expotest/nkn-test/packages/pod-client/`.
`package.json` `main: src/index.js`. Single `.` export. Public API in `/home/frits/expotest/nkn-test/packages/pod-client/src/index.js`.

### PodClient

- **`PodClient`** — high-level pod read/write/list/append/patch/delete on top of `SolidPodSource` and an `Auth` impl. `/home/frits/expotest/nkn-test/packages/pod-client/src/PodClient.js:70`. Extends `Emitter`. Constructor `({ podRoot, auth, options?, tombstoneStore?, podSourceFactory? })`.
  - **No auto-sync.** SDK is on-demand by design; pod is source of truth; no background mirror.
  - Read/write API: `read(uri, { decode? })` _:220_ → `{content, contentType, lastModified, etag, size}`; `write(uri, content, { contentType?, ifMatch?, force?, conflictPolicy? })` _:310_ — emits `'conflict'` event on 412 with a `ConflictResolver`; `append(uri, line, { retries? })` _:468_ — read-modify-write retry loop; `patch(uri, { add?, remove?, applyFn? })` _:534_ — n3-style RDF patch via Inrupt's dataset API; `delete(uri, opts?)` / `deleteCompletely(uri, opts?)` _:625_ — pod + tombstone clear; `deleteLocal(uri)` _:675_ — tombstone only, pod untouched; `clearTombstone(uri)` _:691_; `list(containerUri, { recursive?, filter?, includeTombstoned? })` _:254_; `createContainer(uri)` _:610_; `close()` _:697_; `disconnect()` alias.
  - Events: `'conflict'` (with `ConflictResolver` payload).
  - `_etagMap` (per-resource `etag, lastModified` cache; auto-attached as `If-Match` on writes).
  - `tombstoneStore` getter.
- **`Auth`** — abstract auth contract. `/home/frits/expotest/nkn-test/packages/pod-client/src/Auth/Auth.js:28`. Methods: `getAuthHeaders(uri, method) → Headers`, `identity() → string`, optional `refresh()`, `close()`.
- **`CapabilityAuth`** — token-based pod auth for apps. `/home/frits/expotest/nkn-test/packages/pod-client/src/Auth/CapabilityAuth.js:28`. Wraps a `PodCapabilityToken`; verifies signature + expiry on construction. v1 only `mode: 'pod-direct'`.
- **`SolidOidcAuth`** — OIDC-session auth for the user's agent. `/home/frits/expotest/nkn-test/packages/pod-client/src/Auth/SolidOidcAuth.js:17`. Wraps a `SolidVault`; exposes `getAuthenticatedFetch()` (DPoP-aware). `getAuthHeaders` throws — Solid OIDC requires session-bound fetch.

### ConflictResolver

- **`ConflictResolver`** — payload helper for `'conflict'` event. `/home/frits/expotest/nkn-test/packages/pod-client/src/ConflictResolver.js:27`. Listener calls `event.resolveWith(content)` (re-write `force:true` with merged content) or `event.cancelWrite()` (throw `ConflictError`). No listener / no decision within `options.conflictListenerTimeout` (default 30s) → fall through to `opts.conflictPolicy` (`'reject'` default per Q-A.4 / `'lww'` / `'remote-wins'`).

### Tombstones

The TombstoneStore exists so that `PodClient.list()` can hide URIs the user marked deleted-locally, and so any app-level sync can skip them. **Per-device exception path** within whatever the app chose to sync.

- **`TombstoneStore`** — abstract. `/home/frits/expotest/nkn-test/packages/pod-client/src/TombstoneStore.js:16`. Methods: `add(uri, {at?})`, `has(uri)`, `remove(uri)`, `list()`, `close()`. Shape `uri → {at: number}`.
- **`MemoryTombstones`** — Map-backed. `/home/frits/expotest/nkn-test/packages/pod-client/src/tombstones/MemoryTombstones.js:14`.
- **`IndexedDBTombstones`** — browser. _tombstones/IndexedDBTombstones.js_.
- **`AsyncStorageTombstones`** — RN. _tombstones/AsyncStorageTombstones.js_.
- **`FileTombstones`** — Node.js. _tombstones/FileTombstones.js_.

### Errors taxonomy

- **`PodClientError`** (base, `code/uri/cause/retryable`), **`AuthError`** (`UNAUTHORIZED`), **`CapabilityError`** (`FORBIDDEN`), **`NotFoundError`** (`NOT_FOUND`), **`ConflictError`** (`CONFLICT`), **`NetworkError`**, **`PolicyError`**, **`MalformedResourceError`**, **`EncryptionError`**, **`ConventionError`**. `/home/frits/expotest/nkn-test/packages/pod-client/src/Errors.js:23-`.
- **`mapSourceCode(code, { uri?, cause?, message? })`** — translate raw `.code` from core's storage layer into typed subclass. _Errors.js_.

### IdentityPodStore (lives in core, not pod-client)

`IdentityPodStore` is in `@canopy/core` (see Identity section) — pod-client does NOT re-export it. The wiring on RN goes core's `IdentityPodStore` ← (caller-supplied) `PodClient` from pod-client; `react-native`'s `IdentityWiring` deliberately doesn't import pod-client (decoupling).

### Auxiliary (write paths, conventions)

- **`writeWithConvention` / `readWithConvention`** — small=inline, big=referenced. Live in `@canopy/core` (`storage/PodStorageConvention.js`). Pod-client maps the convention's errors onto `ConventionError`.
- **Reference-manifest helpers** — `hashContent`, `parseReferenceManifest`, `serializeReferenceManifest` (in `core/src/storage/reference-manifest.js`, internal).

---

## @canopy/react-native

Package root: `/home/frits/expotest/nkn-test/packages/react-native/`.
`package.json` `main: index.js`. **Multiple subpath exports** (this package is the only one with non-trivial exports map):

| Subpath | File |
|---|---|
| `.` | `./index.js` |
| `./metro-preset` | `./metro-preset.cjs` |
| `./platform/polyfills` | `./src/platform/polyfills.rn.js` (RN) or `./src/platform/polyfills.js` (default) |
| `./platform/service-factory` | `./src/platform/service-factory.js` |
| `./platform/shims/node-builtins` | `./src/platform/shims/node-builtins.js` |
| `./platform/shims/path` | `./src/platform/shims/path.js` |
| `./platform/shims/util` | `./src/platform/shims/util.js` |
| `./platform/shims/ws` | `./src/platform/shims/ws.js` |

Public API surface in `/home/frits/expotest/nkn-test/packages/react-native/index.js` (10 exports). Note: `ExpoNotificationsAdapter` is INTENTIONALLY not re-exported — it imports `expo-notifications` at module-load and apps without push shouldn't be forced to install the peer dep. Use the absolute subpath `'@canopy/react-native/src/transport/pushAdapters/ExpoNotificationsAdapter.js'`.

### Polyfills

- **`./platform/polyfills` subpath** — auto-resolves `polyfills.rn.js` on RN bundlers, `polyfills.js` (no-op) on Node/web. Apps must import this BEFORE any other `@canopy` substrate. RN polyfill installs:
  1. `crypto.getRandomValues` via `react-native-get-random-values` (peer dep) — required by `@noble/hashes` via `@scure/bip39` via core's `Mnemonic`.
  2. `globalThis.Buffer` via `buffer` (peer dep).
  3. `Blob.prototype.arrayBuffer` + `Blob.prototype.text` (missing on RN).
  4. `Blob` constructor patched to accept ArrayBuffer parts (text-only; binary caveat in `BRING-UP-NOTES.md` TRAP 13).

### Adapters

- **`KeychainVault`** — `Vault` backed by `react-native-keychain`. `/home/frits/expotest/nkn-test/packages/react-native/src/identity/KeychainVault.js:12`. Constructor `({ service? = 'canopy' })`. Implements full `Vault` surface; `list()` is via a self-maintained `__manifest__` entry (keychain has no native list).
- **`AsyncStorageAdapter`** — `StorageBackend` for `PeerGraph` / caches on RN. `/home/frits/expotest/nkn-test/packages/react-native/src/storage/AsyncStorageAdapter.js:11`. Wraps `@react-native-async-storage/async-storage`. Methods: `get/set/delete/keys` with prefix namespacing. Drop-in for browser localStorage / IndexedDB backends.
- **`MdnsTransport`** — local-network peer discovery + TCP data channel. `/home/frits/expotest/nkn-test/packages/react-native/src/transport/MdnsTransport.js:45`. Delegates to a custom Kotlin `MdnsModule` native module (no npm peer deps; built into the Android app). Tiebreaker: lex-lower pubKey initiates. Static `MdnsTransport.isAvailable()`.
- **`BleTransport`** + **`SERVICE_UUID`** + **`CHARACTERISTIC_UUID`** — bidirectional BLE transport. `/home/frits/expotest/nkn-test/packages/react-native/src/transport/BleTransport.js:48`. Central mode (scan) via `react-native-ble-plx`; peripheral mode (advertise) via custom Kotlin `BlePeripheralModule`. MTU chunking (default 20 bytes; 4-byte BE total-length header). Constructor `({ identity, advertise?, scan? })` — both modes default true.

### Push (device-side, receive)

- **`MobilePushBridge`** — wakes a local `Agent` when a push notification arrives. `/home/frits/expotest/nkn-test/packages/react-native/src/transport/MobilePushBridge.js:41`. Constructor `({ agent, adapter })`. Methods: `register(opts?) → {token, platform}`, `unregister()`, `token`, `platform`. Routes notifications: when payload `data.skillId` matches a registered skill on the agent, runs `skill.handler({parts, from, envelope: null})` directly (local-only — no network round-trip); always emits `'push'` event on the agent.
  - **2026-05-04 update**: self-invocation path was previously calling `agent.invoke(self, ...)` which routed out via the agent's transport and back, wastefully. Now calls the skill handler directly. 16 unit tests pass; real-device end-to-end test scheduled separately.
- **`PushAdapter`** — abstract adapter contract. `/home/frits/expotest/nkn-test/packages/react-native/src/transport/pushAdapters/PushAdapter.js:22`. Methods: `register(opts?) → {token, platform}` (throws `code: 'PUSH_PERMISSION_DENIED'` on user denial), `onNotification(handler) → unsubscribe`, `unregister()`.
- **`ExpoNotificationsAdapter`** — concrete; wraps `expo-notifications`. NOT re-exported from `index.js` (load via subpath as noted). v1 default for Expo apps.

### Push (relay-side, send) — added 2026-05-04

- **`PushSender`** — abstract base for outbound push delivery. `/home/frits/expotest/nkn-test/packages/relay/src/push/PushSender.js`. Method: `send(token, payload, opts?) → Promise<{ok, error?}>`. Best-effort, never throws. Pairs with `MobilePushBridge`'s receive half.
- **`ExpoPushSender`** — concrete `PushSender` calling Expo's HTTP push API (`https://exp.host/--/api/v2/push/send`). `/home/frits/expotest/nkn-test/packages/relay/src/push/ExpoPushSender.js`. Constructor `({fetch?, accessToken?, endpoint?})`. Sends data-only pushes by default (`_contentAvailable: true`) for silent agent wake-up. Accepts both Expo push tokens and direct APNs/FCM tokens proxied via Expo.
- **`PushTokenRegistry`** — relay-side address ↔ token map. `/home/frits/expotest/nkn-test/packages/relay/src/push/PushTokenRegistry.js`. Methods: `register(address, {token, platform})`, `unregister(address)`, `get(address)`, `markPushed(address, when?)`, `size()`, `clear()`. In-memory v0; persistence is a future swap to a `PushTokenStore` interface mirroring `QueueStore`.
- **`startRelay({pushSender, pushTokenRegistry?, pushThrottleMs?})`** — opt-in push wake. When `pushSender` is set, the relay accepts `register-push-token` / `unregister-push-token` envelopes (require prior `register`) and fires `pushSender.send()` on offline-`send` and on E2b multi-deliver-to-disconnected. Per-recipient throttle (default 30s). Backward compatible: when `pushSender` is unset, `register-push-token` returns an error and no wake fires.

### metro-preset / service-factory convention

- **`./metro-preset` subpath** → `metro-preset.cjs` — Metro configuration helper that wires `*.rn.js` resolution + alias map for the platform shims. Apps consuming `@canopy/react-native` adopt this via their `metro.config.js`.
- **`./platform/service-factory` subpath** → `selectPlatform({ rn, default })` + `isReactNative()` + `_resetPlatformCache()`. `/home/frits/expotest/nkn-test/packages/react-native/src/platform/service-factory.js:42`. Use this when Metro's `*.js`/`*.rn.js` auto-resolution doesn't fit (dynamic runtime decision, both impls must be statically analysable). Detection via `navigator.product === 'ReactNative'`, cached.
- **Shims** — Node-builtin polyfills bundled for RN (no Metro magic required, import via subpath):
  - `./platform/shims/node-builtins` — minimal `node:*` placeholders.
  - `./platform/shims/path` — POSIX path subset.
  - `./platform/shims/util` — `inherits`, `format`, `promisify` subset.
  - `./platform/shims/ws` — RN `ws` stub (RN has native WebSocket, the `ws` package is Node-only).

### Platform helpers

- **`requestMeshPermissions()`** — request runtime perms (BLE + location) before native transports init. `/home/frits/expotest/nkn-test/packages/react-native/src/permissions.js:21`. Android-aware; iOS short-circuits (`{ble:true, location:true}`) — Info.plist usage strings are the actual contract.
- **`createMeshAgent(opts?)`** — opinionated factory bundling permissions, `KeychainVault`, identity restore-or-generate, BLE/mDNS/Relay/Offline transports, `RoutingStrategy`, `PeerGraph` (AsyncStorage-backed), `AgentConfig` with `policy.allowRelayFor: 'authenticated'`, automatic peer-event PeerGraph upserts, optional Track-B identity-pod sync (`opts.pod`), optional WebRTC rendezvous (`opts.rendezvous`). `/home/frits/expotest/nkn-test/packages/react-native/src/createMeshAgent.js:69`. Returns a started `Agent`. Deliberately does NOT register app skills, install peer-discovered handlers (use `agent.enableAutoHello()`), enable relay-forward (`agent.enableRelayForward()`), or start discovery (`agent.startDiscovery()`).
- **`attachIdentityToAgent(agent, podOpts)`** — wires Bootstrap + IdentityPodStore + IdentitySync onto an existing agent, including RN `AppState 'active'` → `sync.onForeground()`. `/home/frits/expotest/nkn-test/packages/react-native/src/identity/IdentityWiring.js`. Returns `{ bootstrap, podStore, sync, dispose }` — `dispose` is wired into `agent.stop()` teardown. Caller passes a `PodClient` (decoupled from `@canopy/pod-client` peer dep).
- **`loadRendezvousRtcLib()`** — internal helper to lazy-load `react-native-webrtc`. `/home/frits/expotest/nkn-test/packages/react-native/src/transport/rendezvousRtcLib.js`. NOT re-exported (used only inside `createMeshAgent`).

---

## Composition guidance — "if a substrate is doing X, it should use Y"

This table is the single most-load-bearing artifact in this document. Substrate auditors should grep their package for the concern in the left column; if found, the substrate is most likely duplicating SDK functionality and should be rewritten to compose against the right column instead.

| Substrate concern | Use this from the SDK |
|---|---|
| Sending a one-way message peer-to-peer | `agent.transport.sendOneWay(peer, payload)` (auto-encrypted via SecurityLayer) — or `agent.message(peer, parts)` for the `{type:'message', parts}` convention |
| Sending an acknowledged message | `agent.transport.sendAck(peer, payload, timeout?)` (transport auto-AKs at receive side) — or `sendMessage(agent, peer, parts, {requireAck:true})` from `protocol/messaging.js` |
| Request/response (ad-hoc, no skill) | `agent.transport.request(peer, payload, timeout?)` + `transport.respond(peer, replyToId, payload)` |
| Calling a skill on a peer | `agent.invoke(peerId, skillId, input?, opts?)` (Promise<Parts[]>) or `agent.call(peerId, skillId, input?, opts?)` (Task) |
| Calling a skill via a hop bridge | `agent.invokeWithHop(...)` / `agent.callWithHop(...)` (drives `relay-forward` or `tunnel-open`) |
| Defining a skill | `defineSkill(id, handler, opts)` and `agent.register(id, handler, opts)` — not a custom dispatcher table |
| Filtering skills by caller (group/tier visibility) | `agent.skills.forCaller({ tier, callerPubKey, checkGroup })` — already wired to `GroupManager.hasValidProof` inside `Agent.export` and `handleSkillDiscovery` |
| Topic-based pubsub (one-to-many) | `subscribe(agent, publisherAddr, topic, cb)` / `publish(agent, topic, parts)` from `core/protocol/pubSub.js` — peer-to-peer; subscriber registers to a known publisher. Native-only |
| Pattern-aware skill advertisement | `new SkillsPubSub({agent}).broadcastSkill(...)` / `subscribeToSkills(filter, handler)` — wildcard `skills:<group>:<posture>:<audience>:<skillId>` topics |
| Streaming output from a skill | Make the handler an `async function*` and yield `Part[]`; outbound machinery is in `protocol/streaming.js`. Manual stream: `streamOut(agent, peer, taskId, generator, signal?)` |
| Bidirectional native streams | `streamBidi(agent, peer, taskId?, handler)` (parallel OW streams, not for A2A) |
| Sending a file (auto inline-vs-bulk) | `sendFile(agent, peer, filePart, {threshold?})` from `protocol/fileSharing.js` |
| Chunked bulk transfer with AKs | `bulkTransferSend(agent, peer, transferId|null, base64, meta?)` |
| Stateful named native channel | `registerSessionSkills(agent)` + `agent.invoke(peer, 'session-open' | 'session-message' | 'session-close', ...)` and listen for `session-*` events |
| One-way data sync source → target | `new LiveSyncSkill({ name, source, target, vault, onConflict, pollIntervalMs })` — adapter shapes documented; idempotent applied-ids state in vault |
| Hello / handshake with a peer | `agent.hello(peerAddress, timeout?)` — bidirectional, registers SecurityLayer keys, populates PeerGraph automatically |
| Bouncing/refusing inbound hellos | `agent.setHelloGate(fn)` plus ready-made gates `tokenGate(secret)`, `groupGate(groupIds, gm)`, `anyOf(...)` from `core/src/security/helloGates.js` |
| Discovering an A2A peer by URL | `agent.discoverA2A(url, opts?)` (fetches `/.well-known/agent.json`, upserts PeerGraph) — or `discoverA2A(...)` standalone |
| Fetching a peer's skill list | `agent.discoverSkills(peerId, timeout?)` — wraps `requestSkills(...)` |
| Peer-list gossip / pull | `agent.startDiscovery({ pingIntervalMs?, gossipIntervalMs?, maxGossipPeers? })` — wires `PingScheduler` + `GossipProtocol`. For one-shot pull: `pullPeerList(agent, directPeerPubKey)` |
| Auto-hello on peer-discovered events | `agent.enableAutoHello({ pullPeers?, helloTimeout? })` |
| Latency/round-trip measurement | `ping(agent, peerId, timeout?)` |
| Persisting per-peer record graph | `new PeerGraph({ storageBackend? })`; backend = anything Vault-shaped (Vault, AsyncStorageAdapter, etc.) |
| Persisting secrets / keys / proofs / OAuth tokens / OIDC sessions | A `Vault` impl. **NEVER** roll your own keystore. Adapters: `VaultMemory`, `VaultLocalStorage`, `VaultIndexedDB`, `VaultNodeFs`, `KeychainVault` (RN). On top: `OAuthVault`, `SolidVault` |
| Generating an Ed25519 identity from a mnemonic | `AgentIdentity.fromMnemonic(mnemonic, vault)` or `AgentIdentity.generate(vault)`; mnemonic helpers `generateMnemonic / mnemonicToSeed / seedToMnemonic / validateMnemonic` |
| Rotating an Ed25519 identity | `agent.rotateIdentity({ gracePeriodSeconds?, broadcast? })` — handles vault dual-key blob, signed proof, broadcast, SecurityLayer dual-decrypt grace |
| Encrypting/signing arbitrary envelopes | Wire a `SecurityLayer` into the `Transport` via `transport.useSecurityLayer(layer)`. Don't reach for `nacl` directly. For symmetric AEAD inside an established session use `tunnelSeal`'s `generateTunnelKey` / `sealTunnelOW` / `openTunnelOW` |
| Signing an "I sent this skill call" claim | `signOrigin(identity, {target, skill, parts})` + `verifyOrigin(...)` |
| Sealing a skill invocation through a blind hop | `packSealed({...})` / `openSealed({...})` |
| Issuing a skill-call grant to an app/peer | `CapabilityToken.issue(identity, {subject, skill?, expiresIn?, constraints?, parentId?})` — OR via `agent.issueCapabilityToken(...)`. JWT variant for A2A: `CapabilityToken.issueJWT(...)` / `agent.issueA2ACapabilityToken(...)` |
| Issuing pod-resource grants to apps | `PodCapabilityToken.issue(identity, {subject, pod, scopes, expiresIn?})` — scope syntax `pod.read|write|delete|*:<path>` with prefix-strict matching |
| Storing tokens received from other agents | `new TokenRegistry(vault)`; `agent.tokenRegistry` is auto-consulted on outbound calls in `taskExchange.callSkill` |
| Inbound permission gating | `new PolicyEngine({trustRegistry, skillRegistry, agentPubKey, groupManager?})` — substitutes for any per-skill `if (!allowed) throw` you might build by hand |
| Maintaining peer trust tiers | `new TrustRegistry(vault)` — `agent.trustRegistry` is consulted by PolicyEngine, skillDiscovery, GossipProtocol |
| Group membership management (issue, verify, role-change, member-listing) | `new GroupManager({identity, vault})`. For pure verification (no vault): `verifyGroupProof(proof, expectedAdminPubKey)` |
| Gating data-source access by skill/agent | `new DataSourcePolicy(config)` and `new StorageManager({sources, policy})` |
| Storing app data in named, policy-gated sources | `new StorageManager({sources: {...}, policy})` instead of holding Maps/files directly. `sources` are `DataSource` instances |
| Reading/writing arbitrary app blobs | A `DataSource` impl: `MemorySource`, `FileSystemSource`, `IndexedDBSource`, `SolidPodSource` — substrates that need persistence should subclass `DataSource` rather than wrapping `fs` / `localStorage` directly |
| Pod-aware app storage (Solid) | `@canopy/pod-client`'s `PodClient` (read/write/list/append/patch/delete/createContainer + tombstones). DON'T use `SolidPodSource` directly from app code — pod-client gives you typed errors, conflict events, etagged auto-If-Match, RDF patch helpers |
| Solid OIDC session management | `SolidVault` (lives in `core`, despite the name it's an OIDC session manager; uses a user-supplied `Vault` for token persistence) |
| Auth on outgoing pod requests | `Auth` impl from `@canopy/pod-client`: `CapabilityAuth({token})` for apps; `SolidOidcAuth({vault: solidVault})` for the user's agent |
| Per-resource conflict detection (etag/lastModified) | `PodClient` does this automatically; listen `'conflict'` and use `ConflictResolver.resolveWith(merged)` / `cancelWrite()`. For per-call policy: `write(uri, content, {conflictPolicy: 'reject'|'lww'|'remote-wins'})` |
| Per-device "I deleted this locally" markers | `PodClient.deleteLocal(uri)` + `clearTombstone(uri)` + `list({includeTombstoned:true})`. Backend: a `TombstoneStore` (`MemoryTombstones`/`IndexedDBTombstones`/`AsyncStorageTombstones`/`FileTombstones`) |
| Federated read across N member pods + merge | `new FederatedReader({ pods: [{client, sourceId}], failurePolicy? })` + a `MergeContract` (`setUnionWithDedupe`, `appendOnlyEventLog`, `lastWriteWins`) |
| Custom per-field merge contract | Implement `(versions, opts?) → mergedValue` as a pure function. Add to `MergeContracts` map for dynamic dispatch. Same shape as the three built-ins |
| Small-vs-big content offload (1 MB threshold) | `writeWithConvention(podSource, externalStore, uri, content, opts?)` / `readWithConvention(...)`. Provide an `ExternalStore` adapter (interface in `core/src/storage/external-stores/index.js`) — `NoneStore` is the default and throws |
| Backing up a pod | `PodExporter` (writes a portable, optionally-encrypted, deterministic archive); restore with `PodImporter` (no ACL re-establishment in v1) |
| Identity-as-pod-content sync | `IdentityPodStore` + `IdentitySync` (wired through `attachIdentityToAgent` on RN). One-shot vault → pod migration: `migrateVaultToPod(vault, podStore)` |
| Encrypted off-device backup of bootstrap secret | `new CloudBackup({ bootstrap, adapter, passphrase })` + a `CloudAdapter` impl |
| Tracking ephemeral runtime state per-task / per-stream / per-session | `agent.stateManager` (an instance of `StateManager`) — methods `createTask/getTask/openStream/getStream/openSession/getSession`, with TTL eviction |
| Picking the best transport per peer | `agent.transportFor(peerId)` / `agent.routeFor(peerId)` / `agent.reachabilityFor(peerId)` — internally consults `RoutingStrategy` + `FallbackTable` + `PeerGraph` |
| Building a multi-transport agent | `new RoutingStrategy({ transports, peerGraph, fallbackTable })` + `new FallbackTable()` — register transports via `Agent.addTransport(name, t)` |
| Inferring "how direct/indirect is this peer" | `tierForTransport(transport)` / `tierForRouteVia(via)` / `compareTiers(a, b)` (`direct < mesh < hop`) |
| Push-side reachability gossip | `new ReachabilityOracle({agent})` + `oracle.start()`. Topic `reachability:oracle`; per-issuer monotonic-sequence replay guard |
| Cooperative one-shot relay-forward | `agent.enableRelayForward({policy?})` — registers the `relay-forward` skill |
| Long-lived bidirectional bridged tunnel | `agent.enableTunnelForward({policy?})` — registers `tunnel-open` + `tunnel-ow` |
| Blind-forward (bridge can't read content) | `agent.enableSealedForwardFor(groupId)` + `registerRelayReceiveSealed(agent)` on the receiver |
| Reachability oracle producer skill | `agent.enableReachabilityOracle()` (registers `reachable-peers`) |
| Capability self-report | `registerCapabilitiesSkill(agent)` (registers `get-capabilities`) |
| WebRTC upgrade after relay handshake | `agent.enableRendezvous({signalingTransport: relay, rtcLib?, auto?})` + `agent.upgradeToRendezvous(peerPubKey)` — use the `RendezvousTransport.isSupported()` guard before instantiating in environments without WebRTC |
| Layered runtime config with file/blueprint/overrides | `new AgentConfig({ blueprint?, file?, overrides? })`. `cfg.get('policy.allowRelayFor')` / `cfg.set(...)` / `cfg.on('changed', ...)` |
| Tiny in-house EventEmitter | `Emitter` from `@canopy/core` — works in browser, Node, and RN (Node's `events` does NOT, on RN-Hermes minus polyfill) |
| Building a new transport | Subclass `Transport`, implement `connect()`/`disconnect()`/`_put(to, envelope)`. Inherit OW/AS/RQ/HI primitives + auto-AK + reply-promise resolution. Override `canReach(peerId)` if reachability is per-peer. Don't bypass SecurityLayer |
| Building a new vault | Subclass `Vault` (5 methods). Persist values as strings. Use the documented key namespace (`agent-privkey`, `token:*`, `group-proof:*`, `a2a-token:*`, `solid-pod-token`, `solid-oidc:*`, `oauth:*`, `identity-cache:*`, `trust:*`) |
| Building a new data source | Subclass `DataSource` (5 methods). Forward-slash paths; treat as opaque keys |
| Building a new merge contract | A pure `(versions, opts?) → mergedValue` function. Add to the `MergeContracts` map for dynamic dispatch |
| Building a new queue store (relay) | Subclass `QueueStore` from `@canopy/relay/src/queueStores/QueueStore.js` (not currently re-exported — file-path import). 6 methods: `putRequest/getRequest/listOpen/addResponse/closeRequest/delete` plus optional `close` |
| Validating a relay client's group proof | `verifyGroupProof(proof, expectedAdminPubKey)` from `@canopy/core` — pure function, no Vault required (this is what `GroupAuthVerifier` uses internally) |
| Wiring push notifications on RN | `new MobilePushBridge({agent, adapter})` + a `PushAdapter` impl (`ExpoNotificationsAdapter` for v1). Notifications with `data.skillId` auto-invoke the skill on the local agent |
| Bootstrapping a RN mesh-capable agent | `createMeshAgent({...})` — bundles permissions + KeychainVault + identity + BLE/mDNS/Relay/Offline + RoutingStrategy + AsyncStorage-backed PeerGraph + AgentConfig + peer-event PeerGraph upserts. Don't roll your own |
| RN polyfills (random, Buffer, Blob) | Import `@canopy/react-native/platform/polyfills` BEFORE any other `@canopy` substrate |
| Picking between Node and RN service impls | `selectPlatform({ rn: () => require('./X.rn.js'), default: () => require('./X.js') })` from `./platform/service-factory` — only when Metro's `*.rn.js` auto-resolution doesn't fit |
| Metro config wiring | Adopt `@canopy/react-native/metro-preset` |

---

## Known gaps & half-built primitives

Documented honestly so substrate auditors don't assume coverage:

- **`MobilePushBridge` end-to-end coverage** — implemented but the DD4 rendezvous-on-phone path through it has 3 untried code paths per `~/.claude/.../session_group_dd_phone_integration.md`. The bridge's `register/unregister/dispatch` methods themselves are clean; it's the integration with rendezvous + skill invocation that needs verification.
- **`helloGates` not re-exported** — `tokenGate`, `groupGate`, `anyOf` exist in `core/src/security/helloGates.js` but are not in `core/src/index.js`'s public API. Consumers currently import via the absolute file path. If a substrate is rolling its own hello gating, point it at this module.
- **Relay `QueueStore` implementations not re-exported** — `MemoryQueueStore` and `SqliteQueueStore` are file-path imports inside `@canopy/relay`. A substrate that wants to plug a Redis or Postgres queue store has the abstract `QueueStore` to subclass, but consuming the concretes is currently undocumented.
- **`ExpoNotificationsAdapter` deliberately not re-exported** — apps must use the absolute subpath `'@canopy/react-native/src/transport/pushAdapters/ExpoNotificationsAdapter.js'` to avoid forcing `expo-notifications` peer dep on push-free apps.
- **`PodClient` `'agent-proxy'` capability mode** — reserved in the API but not implemented in v1 (only `'pod-direct'`).
- **`PodImporter` ACL re-establishment** — explicitly out of scope in v1; resource bytes only.
- **`IdentityPodStore` v1 record format** — schema specifies Turtle for decrypted records but v1 stores them as plain JSON inside the encryption envelope. Manifest is real Turtle. Auth-log is JSON-LD Lines. Migration to Turtle does not require re-encrypting existing resources.
- **`migrateVaultToPod` v1 scope** — ONLY device records. All other vault namespaces (group-proof, peer:*, app-permission:*, oauth:*, solid-oidc:*, identity-cache:*) are skipped with explicit reason.
- **`CloudAdapter` concretes** — only `MemoryAdapter` ships in v1. Real adapters (Dropbox/Google Drive/iCloud/S3) deferred per Q-C.5.
- **`A2AAuth` JWT signature verification** — by default trusts TLS + token issuer. For production, configure issuer + JWKS URI for actual signature verification.
- **Inrupt OIDC browser/RN flows** — `SolidVault` uses `@inrupt/solid-client-authn-node` (Node-only). Browser/RN redirect-based flows are out of scope for A2; planned in Track B with `@inrupt/solid-client-authn-browser`.
- **Capability-token migration to Inrupt stack** — per `~/.claude/.../project_capability_tokens_to_inrupt.md`, the bespoke `CapabilityToken` / `PodCapabilityToken` share UX is expected to migrate to the Inrupt stack. Substrates building new permission flows should be aware that this surface may shift.

---

## Appendix — file-path index for fast lookup

Sorted alphabetically by symbol. Auditors can grep this section to find the canonical home of any SDK primitive.

| Symbol | File |
|---|---|
| `A2AAuth` | `packages/core/src/a2a/A2AAuth.js` |
| `A2ATLSLayer` | `packages/core/src/a2a/A2ATLSLayer.js` |
| `A2ATransport` | `packages/core/src/a2a/A2ATransport.js` |
| `Agent` | `packages/core/src/Agent.js` |
| `AgentCardBuilder` | `packages/core/src/a2a/AgentCardBuilder.js` |
| `AgentConfig` | `packages/core/src/config/AgentConfig.js` |
| `AgentIdentity` | `packages/core/src/identity/AgentIdentity.js` |
| `appendOnlyEventLog` | `packages/core/src/storage/MergeContracts/appendOnlyEventLog.js` |
| `AsyncStorageAdapter` | `packages/react-native/src/storage/AsyncStorageAdapter.js` |
| `AsyncStorageTombstones` | `packages/pod-client/src/tombstones/AsyncStorageTombstones.js` |
| `attachIdentityToAgent` | `packages/react-native/src/identity/IdentityWiring.js` |
| `Auth` | `packages/pod-client/src/Auth/Auth.js` |
| `BleTransport` | `packages/react-native/src/transport/BleTransport.js` |
| `Bootstrap` | `packages/core/src/identity/Bootstrap.js` |
| `CapabilityAuth` | `packages/pod-client/src/Auth/CapabilityAuth.js` |
| `CapabilityToken` | `packages/core/src/permissions/CapabilityToken.js` |
| `CloudAdapter` / `MemoryAdapter` | `packages/core/src/identity/CloudAdapter.js` |
| `CloudBackup` | `packages/core/src/identity/CloudBackup.js` |
| `ConflictResolver` | `packages/pod-client/src/ConflictResolver.js` |
| `createMeshAgent` | `packages/react-native/src/createMeshAgent.js` |
| `DataSource` | `packages/core/src/storage/DataSource.js` |
| `DataSourcePolicy` | `packages/core/src/permissions/DataSourcePolicy.js` |
| `defineSkill` / `normaliseVisibility` | `packages/core/src/skills/defineSkill.js` |
| `discoverA2A` | `packages/core/src/a2a/a2aDiscover.js` |
| `Emitter` | `packages/core/src/Emitter.js` |
| envelope (`P, mkEnvelope, canonicalize, isEnvelope, genId, REPLY_CODES`) | `packages/core/src/Envelope.js` |
| `ExpoNotificationsAdapter` | `packages/react-native/src/transport/pushAdapters/ExpoNotificationsAdapter.js` |
| `ExternalStore` interface / `NoneStore` | `packages/core/src/storage/external-stores/` |
| `FallbackTable` | `packages/core/src/routing/FallbackTable.js` |
| `FederatedReader` | `packages/core/src/storage/FederatedReader.js` |
| `FilePart`/`TextPart`/`DataPart`/`ImagePart`/`Parts` | `packages/core/src/Parts.js` |
| `FileSystemSource` | `packages/core/src/storage/FileSystemSource.js` |
| `FileTombstones` | `packages/pod-client/src/tombstones/FileTombstones.js` |
| `GossipProtocol` | `packages/core/src/discovery/GossipProtocol.js` |
| `GroupAuthVerifier` | `packages/relay/src/GroupAuthVerifier.js` |
| `GroupManager` | `packages/core/src/permissions/GroupManager.js` |
| hello (`sendHello, handleHello`) | `packages/core/src/protocol/hello.js` |
| `helloGates` (`tokenGate, groupGate, anyOf`) | `packages/core/src/security/helloGates.js` |
| `IdentityPodStore` | `packages/core/src/identity/IdentityPodStore.js` |
| `IdentitySync` | `packages/core/src/identity/IdentitySync.js` |
| `IndexedDBSource` | `packages/core/src/storage/IndexedDBSource.js` |
| `IndexedDBTombstones` | `packages/pod-client/src/tombstones/IndexedDBTombstones.js` |
| `InternalBus` / `InternalTransport` | `packages/core/src/transport/InternalTransport.js` |
| `invokeWithHop` / `callWithHop` | `packages/core/src/routing/invokeWithHop.js` |
| `KeychainVault` | `packages/react-native/src/identity/KeychainVault.js` |
| `KeyRotation` | `packages/core/src/identity/KeyRotation.js` |
| `lastWriteWins` | `packages/core/src/storage/MergeContracts/lastWriteWins.js` |
| `LiveSyncSkill` | `packages/core/src/protocol/LiveSyncSkill.js` |
| `LocalTransport` | `packages/core/src/transport/LocalTransport.js` |
| `mapSourceCode` + error classes | `packages/pod-client/src/Errors.js` |
| `MdnsTransport` | `packages/react-native/src/transport/MdnsTransport.js` |
| `MemoryQueueStore` | `packages/relay/src/queueStores/MemoryQueueStore.js` |
| `MemorySource` | `packages/core/src/storage/MemorySource.js` |
| `MemoryTombstones` | `packages/pod-client/src/tombstones/MemoryTombstones.js` |
| `MergeContracts` map | `packages/core/src/storage/MergeContracts/index.js` |
| messaging (`sendMessage, handleMessage`) | `packages/core/src/protocol/messaging.js` |
| `migrateVaultToPod` | `packages/core/src/identity/migrateVaultToPod.js` |
| Mnemonic helpers | `packages/core/src/identity/Mnemonic.js` |
| `MobilePushBridge` | `packages/react-native/src/transport/MobilePushBridge.js` |
| `MqttTransport` | `packages/core/src/transport/MqttTransport.js` |
| `MultiRecipientQueue` | `packages/relay/src/MultiRecipientQueue.js` |
| `NknTransport` | `packages/core/src/transport/NknTransport.js` |
| `OAuthVault` / `makeAuthorizedFetch` | `packages/core/src/identity/OAuthVault.js` |
| `OfflineTransport` | `packages/core/src/transport/OfflineTransport.js` |
| origin signature (`signOrigin, verifyOrigin`) | `packages/core/src/security/originSignature.js` |
| `PeerDiscovery` | `packages/core/src/discovery/PeerDiscovery.js` |
| `PeerGraph` | `packages/core/src/discovery/PeerGraph.js` |
| `ping` | `packages/core/src/protocol/ping.js` |
| `PingScheduler` | `packages/core/src/discovery/PingScheduler.js` |
| `PodCapabilityToken` | `packages/core/src/permissions/PodCapabilityToken.js` |
| `PodClient` | `packages/pod-client/src/PodClient.js` |
| `PodExporter` / `PodImporter` | `packages/core/src/storage/PodExporter.js` `PodImporter.js` |
| `PodStorageConvention` (`writeWithConvention, readWithConvention`) | `packages/core/src/storage/PodStorageConvention.js` |
| `PolicyEngine` | `packages/core/src/permissions/PolicyEngine.js` |
| `pubSub` (`subscribe, unsubscribe, publish, handlePubSub`) | `packages/core/src/protocol/pubSub.js` |
| `pullPeerList` | `packages/core/src/discovery/pullPeerList.js` |
| `PushAdapter` | `packages/react-native/src/transport/pushAdapters/PushAdapter.js` |
| `QueueStore` | `packages/relay/src/queueStores/QueueStore.js` |
| reachability claim (`signReachabilityClaim, verifyReachabilityClaim, createMemorySeqStore`) | `packages/core/src/security/reachabilityClaim.js` |
| `ReachabilityOracle` | `packages/core/src/routing/ReachabilityOracle.js` |
| `ReachabilityTier` (`TIERS, tierForTransport, tierForRouteVia, compareTiers`) | `packages/core/src/routing/ReachabilityTier.js` |
| `RelayAgent` | `packages/relay/src/RelayAgent.js` |
| `RelayTransport` | `packages/core/src/transport/RelayTransport.js` |
| `RendezvousTransport` | `packages/core/src/transport/RendezvousTransport.js` |
| `requestMeshPermissions` | `packages/react-native/src/permissions.js` |
| `Roles` | `packages/core/src/permissions/Roles.js` |
| `RoutingStrategy` / `TRANSPORT_PRIORITY` | `packages/core/src/routing/RoutingStrategy.js` |
| sealed forward (`packSealed, openSealed, SEALED_VERSION`) | `packages/core/src/security/sealedForward.js` |
| `SecurityLayer` / `SecurityError` / `SEC` | `packages/core/src/security/SecurityLayer.js` |
| service-factory (`selectPlatform, isReactNative`) | `packages/react-native/src/platform/service-factory.js` |
| session protocol | `packages/core/src/protocol/session.js` |
| `setUnionWithDedupe` | `packages/core/src/storage/MergeContracts/setUnionWithDedupe.js` |
| skill discovery (`requestSkills, handleSkillDiscovery`) | `packages/core/src/protocol/skillDiscovery.js` |
| `SkillRegistry` | `packages/core/src/skills/SkillRegistry.js` |
| `SkillsPubSub` (`buildTopic, audienceFromHumanInTheLoop`) | `packages/core/src/protocol/SkillsPubSub.js` |
| `SolidOidcAuth` | `packages/pod-client/src/Auth/SolidOidcAuth.js` |
| `SolidPodSource` | `packages/core/src/storage/SolidPodSource.js` |
| `SolidVault` | `packages/core/src/storage/SolidVault.js` |
| `SqliteQueueStore` | `packages/relay/src/queueStores/SqliteQueueStore.js` |
| `startRelay` / `getLanIp` | `packages/relay/src/server.js` |
| `StateManager` | `packages/core/src/state/StateManager.js` |
| `StorageManager` | `packages/core/src/storage/StorageManager.js` |
| streaming (`streamOut, handleStreamChunk, streamBidi`) | `packages/core/src/protocol/streaming.js` |
| `Task` / `Task.InputRequired` | `packages/core/src/protocol/Task.js` |
| task exchange (`callSkill, handleTaskRequest, handleTaskOneWay`) | `packages/core/src/protocol/taskExchange.js` |
| `TIER_LEVEL` / `TrustRegistry` | `packages/core/src/permissions/TrustRegistry.js` |
| `TokenRegistry` | `packages/core/src/permissions/TokenRegistry.js` |
| `TombstoneStore` | `packages/pod-client/src/TombstoneStore.js` |
| `Transport` (base) | `packages/core/src/transport/Transport.js` |
| tunnel skills (`registerTunnelOpen, registerTunnelOw, registerTunnelReceiveSealed, TunnelSessions`) | `packages/core/src/skills/tunnel*.js` |
| tunnel seal (`generateTunnelKey, sealTunnelOW, openTunnelOW`) | `packages/core/src/security/tunnelSeal.js` |
| `Vault` (abstract) | `packages/core/src/identity/Vault.js` |
| `VaultIndexedDB` | `packages/core/src/identity/VaultIndexedDB.js` |
| `VaultLocalStorage` | `packages/core/src/identity/VaultLocalStorage.js` |
| `VaultMemory` | `packages/core/src/identity/VaultMemory.js` |
| `VaultNodeFs` | `packages/core/src/identity/VaultNodeFs.js` |
| `verifyGroupProof` | `packages/core/src/permissions/groupProofVerify.js` |
| `WsServerTransport` | `packages/relay/src/WsServerTransport.js` |

# Identity Persistence, Key Recovery, and Solid Pod

---

## The identity problem

An agent's Ed25519 keypair is its identity. Every group proof, capability token, and peer relationship is anchored to it. If the device is lost and no backup exists, the identity is gone — a new keypair means a new identity, and every peer relationship must be rebuilt from scratch.

This document describes:
1. **Mnemonic seed recovery** — portable identity backup with no external service required
2. **Key rotation** — planned keypair change without losing identity continuity
3. **Solid Pod** as the primary user-owned backend for vault, agent file, peer graph, and data
4. **Consequences for other parts of the design** where SolidPod changes or simplifies things

---

## Mnemonic seed recovery

Every Ed25519 keypair is generated from a 32-byte seed. That seed can be encoded as a BIP39 24-word mnemonic — a sequence of common English words that is human-readable and writable.

```
correct horse battery staple ... (24 words)
          ↓ deterministic derivation
  32-byte seed
          ↓
  Ed25519 keypair  →  stable pubKey  →  NKN address, agent identity
```

**On first run**, the SDK generates the keypair from a random seed and presents the mnemonic once:

```js
const { agent, mnemonic } = await Agent.createNew({
  id:        'alice-home',
  blueprint: 'household-agent',
  vault:     { backend: 'indexeddb' }
});

// mnemonic: "abandon ability able about above absent absorb abstract..."
// The user writes this down. The SDK does not store it again.
// The private key is stored in the vault (encrypted). The mnemonic is the recovery path.
```

**Recovery on a new device**:

```js
const agent = await Agent.restoreFromMnemonic('abandon ability able ...', {
  id:        'alice-home',
  blueprint: 'household-agent',
  vault:     { backend: 'keytar' }   // better vault on new device
});
// Same keypair, same NKN address, same identity
// Peer graph and group proofs recovered separately (from SolidPod, or re-established via hello)
```

The mnemonic is the lowest common denominator — it requires nothing but pen and paper, and works even if every online service is unavailable.

---

## Key rotation

Key rotation is the planned replacement of a keypair: the old private key has been exposed, is suspected compromised, or the user simply wants to cycle it as policy. The new keypair has a different public key, but the agent's identity continuity is preserved by a signed rotation proof.

### Rotation proof

```js
{
  _type:      "key-rotation",
  agentId:    "alice-home",
  oldPubKey:  "<old-ed25519-pubkey>",
  newPubKey:  "<new-ed25519-pubkey>",
  issuedAt:   timestamp,
  gracePeriodSeconds: 604800,    // 7 days — old key stays valid this long
  sig:        "<Ed25519 sig by OLD private key>"
}
```

The proof is signed by the old key. Any peer that trusted the old key can verify it and update their TrustRegistry to map the agent's identity to the new key.

### Rotation flow

The core mechanism is entirely peer-to-peer. SolidPod is not required.

```
1. User initiates rotation (generates new keypair + new mnemonic)
2. Agent signs rotation proof with old private key
3. Broadcast rotation proof to all currently reachable known peers via sendOneWay
4. Grace period begins: both old and new keys are accepted for inbound messages
5. GroupManager notifies all group admins → they re-issue group proofs for new key
6. Capability token issuers are notified → re-issue tokens for new key
7. After grace period: old key is rejected
```

Peers who were offline during the broadcast will receive the proof the next time they reconnect and exchange a hello or any message — the rotation proof can also be re-sent on hello when both peers are back online.

### What about new peers after rotation?

A peer that was never part of the network before the rotation has no way to verify the chain without a third-party publication (they never held the old key, so the rotation proof doesn't help them). This is an accepted limitation for the PoC. Options for the future:
- Gossip rotation proofs alongside peer-list sharing
- Publish a rotation history to a SolidPod or any public URL the user controls
- Use a DID document that maps agent identity to the current key

For now: new peers simply trust the current public key from the hello exchange and build their relationship from there, same as any first contact.

### Rotation is not emergency key compromise response

Key rotation as designed here is a _planned_ operation. If a key is actively compromised and the attacker is already impersonating the agent, no in-band broadcast will outrun the attacker. Emergency compromise handling requires revocation infrastructure (see `Design/11-Revocation-Note.md`) and is out of scope for the PoC.

---

## Solid Pod

[Solid](https://solidproject.org/) is a W3C-based specification for personal data storage. A Solid Pod is an HTTP server that the user owns or controls (self-hosted, or via a provider like inrupt.com or solidcommunity.net). It implements:

- **LDP (Linked Data Platform)**: resources are files at URLs; containers are directories
- **WebID-OIDC**: authentication via the user's WebID — a URL that resolves to an RDF profile containing their public key
- **Access control**: fine-grained per-resource ACLs controlled by the user

A SolidPod is the ideal persistent backend for this project's values: user-owned, decentralized, no developer-controlled server in the data path.

### What the SolidPod backs

#### 1. Vault (private key + tokens)

```
Pod path: /vault/   (private container — owner-only ACL)
  agent-key.enc         encrypted Ed25519 private key seed
  tokens/
    <tokenId>.json      held capability tokens (encrypted)
  group-proofs/
    <groupId>.json      signed group membership proofs
```

The private key seed is encrypted with a key derived from the user's Solid OIDC token + a local salt (PBKDF2). The pod provider sees only ciphertext. Recovery requires both the pod access AND the local salt (or the mnemonic as fallback).

#### 2. Agent file

```
Pod path: /agent/home.yaml   (private or public depending on user preference)
```

The agent file can be loaded directly from the pod:

```js
const agent = await Agent.fromSolidPod('https://alice.solidpod.example/', {
  credential: 'vault:solid-pod-token'
});
// Loads /agent/<id>.yaml automatically (or /agent/default.yaml if one agent)
```

If the user makes the agent file public on the pod, it also serves as a **discovery endpoint**: other agents can fetch it to get Alice's public capabilities and transport addresses — no QR code or manual address sharing needed.

#### 3. PeerGraph backup

```
Pod path: /agent/peer-graph.json   (private)
```

The PeerGraph is serialised and synced to the pod on change (debounced — not every interaction, only on significant updates like new peer added, tier change). On a new device, after mnemonic recovery, the peer graph is fetched from the pod and the agent resumes with its full network context.

#### 4. Data sources (app data)

SolidPod is also a fully capable `DataSource` for application data, as described in `07-Storage.md`:

```yaml
storage:
  sources:
    - label:      private
      type:       solid-pod
      url:        https://alice.solidpod.example/data/
      credential: vault:solid-pod-token
```

### SolidPodSource implementation

`SolidPodSource` implements the standard `DataSource` interface (read/write/delete/list/query). Authentication uses the `@inrupt/solid-client-authn-browser` (browser) or `@inrupt/solid-client-authn-node` (Node.js) libraries for WebID-OIDC.

```js
class SolidPodSource extends DataSource {
  constructor({ url, credential }) { ... }

  async read(path)         // GET pod_url/path
  async write(path, data)  // PUT pod_url/path
  async delete(path)       // DELETE pod_url/path
  async list(prefix)       // GET pod_url/prefix (LDP container listing)
  async query(filter)      // iterate + filter (no native query; scan + filter client-side)
}
```

`SolidVault` extends `Vault` with the same interface:

```js
class SolidVault extends Vault {
  async get(key)           // reads /vault/{key}.enc, decrypts
  async set(key, value)    // encrypts, writes /vault/{key}.enc
  async delete(key)        // DELETE /vault/{key}.enc
  async has(key)           // HEAD /vault/{key}.enc
  async list()             // LDP container listing of /vault/
}
```

### Bootstrapping: chicken-and-egg

To access the pod, the agent needs a Solid OIDC token. To store the OIDC token, it needs the vault. On first device, the vault is local (IndexedDB or keytar). The pod token is stored in the local vault. Once stored, the agent can also mirror the vault to the pod.

On a new device after recovery:
1. Enter mnemonic → restore keypair → local vault created
2. Log into Solid provider → receive OIDC token
3. Store OIDC token in local vault
4. Fetch vault backup from pod → restore group proofs, capability tokens
5. Fetch peer-graph.json → restore peer network

```js
const agent = await Agent.restoreFromMnemonic(mnemonic, {
  vault: { backend: 'keytar' }
});

const solidToken = await solidAuth.login('https://alice.solidpod.example/');
agent.vault.set('solid-pod-token', solidToken);

await agent.restoreFromSolidPod('https://alice.solidpod.example/');
// Downloads peer-graph, group-proofs, tokens from pod
// Agent is now fully restored
```

### Consequences for other parts of the design

**`07-Storage.md`**: `SolidPodSource` is no longer "planned" — it is a first-class implementation in `@canopy/core`. `SolidVault` is the recommended vault backend for users who want multi-device and backup.

**`09-Discovery.md` — agent file as discovery endpoint**: If the user makes their pod agent file public, any agent that knows their pod URL can fetch their card without a QR code or prior contact. This adds a new discovery route: "Pod URL sharing" — simpler than QR in contexts where a URL is easier to exchange (email, bio link, etc.).

**`08-Permissions.md` — token and group proof persistence**: Capability tokens received from other agents and group membership proofs are backed up to the pod vault. Device loss does not invalidate trust relationships.

**`02-Architecture.md` — module map**: `SolidPodSource` and `SolidVault` are added to `storage/` in `@canopy/core`. The `@inrupt` auth libraries are peer dependencies (not bundled — they are large and not needed by apps that don't use SolidPod).

**Key rotation → group proofs**: Phase 7 key rotation depends on Phase 6 GroupManager being complete. After rotation, GroupManager sends rotation-triggered re-issuance requests to all group admins. Admins that are offline at rotation time will re-issue when they next receive a message signed by the new key and complete the next hello exchange.

### Pod providers and self-hosting

| Option | Hosting | Notes |
|--------|---------|-------|
| inrupt.com | Hosted (inrupt) | Free tier available; WebID-OIDC built in |
| solidcommunity.net | Hosted (community) | Free, community-run |
| Self-hosted CSS | Self-hosted | Community Solid Server (`@solid/community-server`); Docker image available |
| Self-hosted NSS | Self-hosted | Node Solid Server (older, battle-tested) |

The SDK is provider-agnostic — any Solid-compliant pod works. The credential is whatever OIDC token the provider issues.

---

## Platform summary (updated)

| Platform | Primary vault | Multi-device recovery | Agent file |
|----------|--------------|----------------------|------------|
| Browser | IndexedDB (encrypted) | SolidPod + mnemonic fallback | Pod URL or local file |
| Node.js | VaultNodeFs or VaultKeytar | SolidPod + mnemonic fallback | Filesystem path |
| React Native | KeychainVault | SolidPod + mnemonic fallback | Pod URL or bundled |
| All (future) | SolidVault primary | SolidPod (seamless) | Pod URL |

---

## Module additions

```
storage/
  SolidPodSource.js    DataSource implementation. LDP read/write/list via
                       @inrupt/solid-client. WebID-OIDC auth injected.
  SolidVault.js        Vault implementation backed by SolidPod /vault/ container.
                       Encrypts values before upload; decrypts on read.
                       Extends Vault base class.

identity/
  Mnemonic.js          BIP39 mnemonic ↔ 32-byte seed conversion.
                       generateMnemonic() → string (24 words)
                       mnemonicToSeed(mnemonic) → Uint8Array
                       Thin wrapper over @scure/bip39 (audited, zero-dependency).

  KeyRotation.js       buildRotationProof(oldKeypair, newPubKey, gracePeriodSeconds)
                       verifyRotationProof(proof, oldPubKey)
                       applyRotationToRegistry(proof, trustRegistry)
                       broadcastRotationProof(proof, agent)   → sends to all known peers
                       // Optional future: publishToSolidPod(proof, solidPodSource)
```

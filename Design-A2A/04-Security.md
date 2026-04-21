# Security

The security model is dual: **nacl.box** for native peers, **TLS** for A2A peers. The distinction is driven by what both sides understand — the developer does not choose.

---

## Two security paths

```
Peer type   Encryption          Authentication        Module
──────────  ──────────────────  ────────────────────  ──────────────────
Native      nacl.box (E2E)      Ed25519 signature     SecurityLayer.js
A2A         TLS (transport)     Bearer JWT            A2AAuth.js
```

These paths are mutually exclusive per message: a message either goes through `SecurityLayer` (native) or through `A2ATransport` with `A2AAuth` (HTTP). `RoutingStrategy` picks based on peer type.

---

## Native path — unchanged from `Design/03-Transport.md`

Key points for reference:

- `HI` (hello): **Ed25519 signed, not encrypted**. Hello payload is inherently public.
- All other envelopes: **nacl.box encrypted + Ed25519 signed**.
- Stream chunks: **nacl.secretbox** with session key from `nacl.box.before(peerPubKey, myPrivKey)`. Nonce = `streamId (16 bytes) ‖ seqNumber (8 bytes)`.
- SecurityLayer is always active — not optional.

---

## A2A path

### Transport security

A2A uses HTTPS. The SDK does not add its own encryption layer — TLS is the contract.

- `A2ATransport` enforces HTTPS for all outbound requests. HTTP is rejected unless `agent.a2a.allowInsecure: true` (development only).
- A2A peers are trusted at the TLS/CA-chain level. No nacl.box.

### Bearer token authentication

**Inbound** (`A2AAuth.validateInbound`)

```
Authorization header absent   → trust tier 0
Valid JWT                      → trust tier 1 (base authenticated)
JWT + x-canopy-groups claim  → tier 2 (verified against GroupManager)
JWT + capability token claim   → tier 3 (verified against TokenRegistry)
```

JWT config in agent file:

```yaml
a2a:
  auth:
    scheme: bearer
    # Option A: static shared secret (dev/testing)
    secret: vault:a2a-shared-secret

    # Option B: JWT validation (production)
    issuer:   https://auth.example.com
    jwks_uri: https://auth.example.com/.well-known/jwks.json
    audience: https://relay.example.com/agents/alice-home
```

Group membership via JWT: the JWT may include `x-canopy-groups: ["home"]`. `A2AAuth` cross-checks against the local `GroupManager` — the group must exist in the agent's group list with a valid `adminPubKey`. The JWT claim alone does not grant group membership.

**Outbound** (`A2AAuth.buildHeaders`)

```
1. Look up 'a2a-token:<peerUrl>' in Vault
2. If found and not expired: attach as Authorization: Bearer <token>
3. If not found: send unauthenticated (tier 0 access on their side)
   → use agent.storeA2AToken(peerUrl, token) to configure
```

---

## Trust tier for A2A peers

A2A peers have no Ed25519 keypair by default. Trust is established through auth, not cryptographic identity.

```
Tier 0  — No token. Public skills only.
Tier 1  — Valid Bearer JWT. Authenticated skills accessible.
Tier 2  — JWT includes x-canopy-groups, verified against GroupManager.
Tier 3  — JWT includes capability token claim, verified against TokenRegistry.
```

### Upgrading A2A peers to native

If a remote card has `x-canopy.pubKey` and a native transport address, the SDK can upgrade the relationship to native:

```
1. On first A2A contact, store x-canopy.pubKey + nknAddr/relayUrl
2. Attempt native hello via the best available transport
3. If hello succeeds: re-record peer as { type: 'native', pubKey, ... }
4. All future calls route via native path (E2E encrypted, lower latency)
5. A2A path remains as fallback if native becomes unreachable
```

Upgrade is automatic and transparent. `agent.call()` does not change.

---

## `A2AAuth.js` interface

```js
// Inbound: validate request, return trust context
const trust = await A2AAuth.validateInbound(req, agent);
// → { tier: 0|1|2|3, claims: object|null, peerId: url }

// Outbound: build auth headers for a fetch request
const headers = await A2AAuth.buildHeaders(peerUrl, agent);
// → { 'Authorization': 'Bearer ...' } or {}

// Token management
await A2AAuth.storeToken(peerUrl, token, vault);
const token = await A2AAuth.getToken(peerUrl, vault);  // string | null
```

---

## Security boundaries

```
┌──────────────────────────────────────────────────┐
│  Native peer communication                       │
│                                                  │
│  E2E encrypted: nacl.box or nacl.secretbox       │
│  Relay sees only ciphertext                      │
│  Identity: Ed25519 pubKey, unforgeable           │
│  Trust: cryptographic group proofs + tokens      │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│  A2A peer communication                          │
│                                                  │
│  TLS in transit only                             │
│  TLS-terminating relay/CDN sees plaintext        │
│  Identity: URL + Bearer JWT                      │
│  Trust: JWT claims, externally issued            │
└──────────────────────────────────────────────────┘
```

A2A security is weaker than native at the transport layer. This is an inherent property of the A2A protocol. For sensitive payloads exchanged with A2A peers, encrypt the content at the application layer (e.g. encrypt the value inside a DataPart before handing it to the skill). The `x-canopy.pubKey` field in the agent card enables upgrading the relationship to a native connection over which full nacl.box encryption applies — see `08-Discovery.md` for the upgrade path.

---

## Threat model

| Threat | Mitigation |
|--------|-----------|
| Forged or replayed JWT from A2A caller | Short JWT expiry (max 1 hour); `iat`/`exp` validated by A2AAuth |
| MITM on A2A HTTP path | HTTPS enforced; `allowInsecure` off by default |
| Remote agent card spoofed at `/.well-known/` | Card fetched over TLS; `x-canopy.pubKey` pinnable in PeerGraph |
| Skill called at higher tier than caller has | PolicyEngine runs before handler; returns `failed` with `policy-denied` error Part |
| A2A token in Vault leaked | Vault is the existing security boundary (same as private key); no new attack surface |
| Native peer impersonation | Ed25519 signature on every envelope; SecurityLayer rejects anything it cannot verify |

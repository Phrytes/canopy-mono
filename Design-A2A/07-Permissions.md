# Permissions

The permission model from `Design/08-Permissions.md` applies to both native and A2A peers. This document summarises the model and explains how each layer applies in the A2A context.

Read `Design/08-Permissions.md` for the full specification. This document covers what changes or needs clarification for A2A peers.

---

## Four-layer model

```
Layer 1: Trust tiers       — who is this peer?
Layer 2: Skill visibility  — what can they discover?
Layer 3: Policy gates      — what can they invoke?
Layer 4: Capability tokens — temporary, specific, delegatable grants
```

---

## Layer 1: Trust tiers

| Tier | Who | Native | A2A |
|------|-----|--------|-----|
| 0 | Unknown | First contact, no hello yet | No Bearer token |
| 1 | Verified | pubKey in TrustRegistry after hello | Valid Bearer JWT |
| 2 | Group member | Valid Ed25519 group proof | Local trust assignment by admin (see below), or JWT with `x-canopy-groups` verified against GroupManager |
| 3 | Token holder | Valid capability token | JWT carrying capability token claim, verified against TokenRegistry |

### Local trust assignment for A2A peers

A2A peers cannot participate in Ed25519 group proofs. Trust tier 2 can still be granted to an A2A peer by a local admin decision — no credential is issued to the peer:

```js
// Admin assigns an A2A peer to group 'home' (local record only)
await agent.peers.assignTrust('https://other.example.com', {
  tier: 2,
  groups: ['home'],
  note: 'trusted home automation partner'
});
```

This creates a local PeerGraph entry:
```js
{ type: 'a2a', url: '...', localTrust: { tier: 2, groups: ['home'] } }
```

Inbound requests from this URL are then treated as tier 2 without requiring any JWT claim. The trust is uni-directional and local — the A2A peer is not aware of it.

---

## Layer 2: Skill visibility (gradual reveal)

What a peer can discover depends on their tier. The agent card and skill discovery responses are filtered before sending:

| Visibility | Revealed to |
|-----------|------------|
| `public` | Everyone — tier 0 and above |
| `authenticated` | Tier 1+ (verified peers) |
| `group:<id>` | Tier 2 members of that group |
| `token:<skillId>` | Tier 3 holders of a valid token for that skill |
| `private` | Never revealed externally |

**For A2A peers**: the `/.well-known/agent.json` agent card is served at the lowest trust tier (0 — no Bearer token). The `x-canopy.trustTiers` block in the card tells A2A agents which skills become available as their trust tier increases, so they can request authentication before trying skills they cannot see.

---

## Layer 3: Policy gates

Once a peer can see a skill, policy determines whether they can invoke it:

| Policy | Meaning |
|--------|---------|
| `always` | Any peer that can see this skill can invoke it |
| `on-request` | Tier 1+ required; accepted on first contact |
| `negotiated` | Multi-turn `input-required` flow required before full invocation |
| `group:<id>` | Must be Tier 2 member of this group |
| `token` | Must hold a valid capability token |
| `never` | Cannot be invoked externally |

Policy runs before the skill handler is called. For A2A peers, the check happens in `A2AAuth` before `A2ATransport` dispatches to the handler. A denied task transitions to `failed: { code: 'policy-denied' }`.

---

## Layer 4: Capability tokens

A signed, time-bounded grant for a specific skill. Issued by the skill owner to a specific peer. Works for both native and A2A peers.

**Token structure:**
```js
{
  _type:      'capability-token',
  issuer:     '<issuerPubKey>',
  subject:    '<subjectPubKey>',    // native: Ed25519 pubKey; A2A: not applicable (see below)
  skill:      'summarise',
  agentId:    'alice-home',
  constraints: {
    maxCalls:  10,
    notBefore: timestamp,
    context:   { topic: 'work' }
  },
  issuedAt:   timestamp,
  expiresAt:  timestamp,
  sig:        '<Ed25519 sig by issuer>'
}
```

**For A2A peers**: the token is issued as a signed JWT (our own issuer key). The A2A peer presents it in their Bearer header. `A2AAuth` verifies the JWT signature against our public key, checks expiry and constraints, and maps to tier 3.

```js
// Issue a capability token for an A2A peer
const jwt = await agent.issueA2ACapabilityToken({
  skill:      'summarise',
  expiresAt:  Date.now() + 3600_000,
  constraints: { maxCalls: 5 }
});
// Send this JWT out-of-band to the A2A peer
// They then include it as: Authorization: Bearer <jwt>
```

**Delegation** works identically for native and A2A. Delegation limits are set per-skill:

```yaml
skills:
  summarise:
    token:
      delegation:
        allowed:              true
        maxDepth:             1       # no re-delegation
        maxChainAgeSeconds:   3600
        requireIssuerTier:    1
```

**For native peers**, see `Design/08-Permissions.md` for the full delegation and issuance API.

---

## Skill visibility filtering — summary for A2A context

When `A2ATransport` receives an inbound task:

```
1. A2AAuth → trust tier (0, 1, 2, or 3)
2. Resolve skill id → check visibility against tier
   - tier 0 and skill.visibility !== 'public'   → failed: policy-denied (not even visible)
   - tier 1 and skill.visibility === 'group:*'  → failed: policy-denied
   - etc.
3. Check policy gate against tier
4. If all pass → invoke handler
```

When serving `/.well-known/agent.json`:
- Skills with `visibility: 'private'` are excluded
- Skills with `visibility: 'group:*'` or `visibility: 'token:*'` are included in the card
  but listed under `x-canopy.trustTiers["2"]` or `["3"]` so A2A agents know what tier is needed
- The `skills[]` array in the card always shows the skill — the trustTiers map indicates access level

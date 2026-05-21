# Permissions

---

## What already exists (and where it falls short)

The current design has the skeleton of a permission system:

- **Trust tiers** (Safety.txt): unknown / verified peer / group member
- **Capability visibility**: `public`, `group:<id>`, `private` fields on each capability
- **Group proofs with expiry**: signed membership tokens, time-bounded, revocable
- **Policy values** on actions: `always`, `on-request`, `negotiated`, `never`
- **Resource limits** per group (max pending tasks, max connections)

What's missing:

- **Temporary capability tokens** — granting a specific agent access to a specific capability for a limited time, without adding them to a group
- **Data source access control** — which agents and which capabilities can access which storage sources
- **Gradual capability reveal** — unknown agents should only see public capabilities; more become visible as trust increases (after verification, group join, or token grant)
- **Multi-agent permissions within one app** — developer-instantiated agents with different permission sets, each with different data source access
- **Developer authority ceiling** — explicit rule about what the developer can and cannot grant vs. what the user controls

---

## Existing models worth knowing

**RBAC (Role-Based Access Control)**
Permissions attached to roles/blueprints. Simple, what the current blueprint system approximates. Too coarse for fine-grained capability-level control.

**ABAC (Attribute-Based Access Control)**
Permissions evaluated against attributes: who is asking, what they are asking for, in what context, at what time. More flexible than RBAC. Good for policies like "only group:home members can call summarise, and only during working hours".

**Object Capabilities (ocaps)**
A peer that holds a reference to a capability _is_ authorized to use it. No separate ACL. Passing the token is the authorization. Unforgeable references enforce the permission. This matches the "capability token" idea closely.

**UCAN (User Controlled Authorization Networks)**
Used by IPFS, Fission, Bluesky. JWT-like tokens with:
- **Delegation chains**: A grants B a subset of what A has; B can sub-delegate to C
- **Attenuation**: you can only grant what you have, with equal or tighter constraints
- **Expiry**: every token has an `exp` field
- **Capability semantics**: tokens describe _what_ is allowed, not just who the bearer is

This is the closest existing model to what this project needs. The proposal below borrows from UCAN but simplifies it for the PoC.

**Verifiable Credentials (W3C VC)**
Signed claims about a subject, verified against an issuer's DID/public key. Group proofs in this project are essentially a minimal VC implementation already.

---

## Proposed permission model

Four interlocking layers. Each layer adds precision; the layers compose.

```
Layer 1: Trust tiers        — who is this peer at all?
Layer 2: Capability visibility — what can they discover about me?
Layer 3: Policy gates        — what can they ask me to do?
Layer 4: Capability tokens   — temporary, specific, delegatable grants
+ cross-cutting: Data source access control
+ cross-cutting: Multi-agent authority within app
```

---

### Layer 1: Trust tiers (extended)

| Tier | Who | How established |
|------|-----|-----------------|
| 0 | Unknown | First contact, no prior relationship |
| 1 | Verified peer | Public key is in local registry (via accepted hello or manual add) |
| 2 | Group member | Valid, unexpired, unrevoked group proof for a shared group |
| 3 | Token holder | Holds a valid capability token issued by this agent |

Tier 3 is new. It does not require group membership — it is a direct, specific grant. Tier 3 is additive: a peer can simultaneously be Tier 1 + Tier 3 for capability X.

---

### Layer 2: Capability visibility (gradual reveal)

What a peer can _discover_ about an agent depends on their tier. The agent card sent in `hello` and `capDiscovery` responses is filtered before sending:

| Visibility tag | Revealed to |
|----------------|-------------|
| `public` | Everyone, including Tier 0 (unknown) |
| `authenticated` | Tier 1+ (verified peers) |
| `group:<id>` | Tier 2 members of that group |
| `token:<capName>` | Tier 3 holders of a valid token for that capability |
| `private` | Never revealed externally |

A peer at Tier 0 sends a capDiscovery request and gets back only `public` capabilities. After they verify and reach Tier 1, they can re-request and see `authenticated` ones too. After joining a group, group-scoped capabilities appear.

This means capability discovery is **not a one-time event** — it is re-queried as trust evolves.

---

### Layer 3: Policy gates

Once a peer can _see_ a capability, policy gates determine whether they can _invoke_ it:

| Policy | Meaning |
|--------|---------|
| `always` | Any peer that can see this capability can invoke it |
| `on-request` | Peer must be Tier 1+; invoke on first contact accepted |
| `negotiated` | Requires explicit negotiation protocol before invocation |
| `group:<id>` | Must be Tier 2 member of this group |
| `token` | Must hold a valid capability token |
| `never` | Cannot be invoked externally (internal only) |

Policies are set at the blueprint level and can be overridden per-capability in the agent file or at runtime.

---

### Layer 4: Capability tokens

A capability token is a signed, time-bounded grant for a specific capability. It is the "temporary key" design — this is what the existing group proof expiry system _partially_ covers, but only for group membership. Capability tokens grant access to a specific action without group membership.

**Token structure:**

```js
{
  _type:       "capability-token",
  issuer:      "<issuerPubKey>",      // who grants this
  subject:     "<subjectPubKey>",     // who receives this
  capability:  "summarise",           // which capability on which agent
  agentId:     "alice-home",          // which agent's capability
  constraints: {                      // optional tightening conditions
    maxCalls:  10,
    notBefore: timestamp,
    context:   { topic: "work" }      // arbitrary match conditions
  },
  issuedAt:    timestamp,
  expiresAt:   timestamp,             // required — tokens always expire
  sig:         "<Ed25519 sig by issuer>"
}
```

**Delegation:**
If B received a token for capability X from A, B can issue a _sub-token_ to C. The sub-token must be equal or more restrictive (shorter expiry, fewer calls, tighter context). B cannot grant more than B has. This is the attenuation principle from UCAN. The receiving agent walks the delegation chain to verify the root issuer is the capability owner.

Delegation can be restricted per-capability in the agent file:

```yaml
capabilities:
  summarise:
    token:
      delegation:
        allowed:                    true   # false = tokens for this cap are non-delegatable
        maxDepth:                   1      # max sub-delegation hops (1 = direct grant only, no re-delegation)
        maxChainAgeSeconds:         3600   # entire chain must not be older than this at time of use
        requireIssuerTier:          1      # sub-delegating peer must be at least Tier 1 with us
        requireIssuerRecentVerifiedSeconds: 3600  # issuer's trust must have been confirmed within this window
```

Defaults if not specified: `allowed: true`, `maxDepth: 3`, no age or tier requirement. The capability owner (the agent whose capability it is) sets these limits — a sub-delegator cannot relax them.

**Issuance in code:**

```js
// Agent A grants Agent B access to 'summarise' for 1 hour
const token = await agentA.issueCapabilityToken({
  subject:    agentB.publicKey,
  capability: 'summarise',
  expiresAt:  Date.now() + 3600_000,
  constraints: { maxCalls: 5 }
});

// B stores the token and presents it when calling A
await agentB.call(agentA.id, 'summarise', { text: '...' }, { token });
```

**Token lifecycle:**
- Tokens are stored in the holder's vault
- Expired tokens are ignored (receiver-side expiry check is enforced)
- Revocation: issuer publishes a signed revocation envelope; receivers cache revocations locally
- Same revocation mechanism as group proof revocation

---

### Data source access control

Data sources currently have no access control — any capability handler in the app can read any source. This needs to change when multiple agents or untrusted capabilities are involved.

Declaration in agent file:

```yaml
storage:
  sources:
    - label:   private
      type:    solid-pod
      url:     https://alice.solidpod.example/
      access:
        agents:       [alice-home]        # only this agent
        capabilities: [summarise, search] # only these capabilities
        groups:       []                  # no group-based access
        # tokens: accepted if issued by alice-home for this source (future)

    - label:   app
      type:    indexeddb
      name:    myapp-db
      access:
        agents: [alice-home, alice-work]  # both agents can use this
        capabilities: []                  # empty = all capabilities of allowed agents
```

At runtime, when a capability handler calls `agent.storage.get('private', path)`, the runtime checks:
1. Is the calling agent in the `access.agents` list?
2. Is the calling capability in the `access.capabilities` list (if non-empty)?
3. If either check fails → throw, do not read

This prevents a compromised or malicious capability from reading a data source it was not granted access to.

---

### Multi-agent permissions within one app

When a developer instantiates multiple agents in the same app, each has its own blueprint, permissions, and data source access. They are separate identities.

```js
// Developer creates two agents with different authority
const publicAgent = new Agent({
  id:        'app-public',
  blueprint: 'public-facing',     // public caps, no data source access
});

const dataAgent = new Agent({
  id:        'app-data',
  blueprint: 'data-worker',       // private caps, has 'private' source access
  // policy: group:work-team for all inbound
});
```

Inter-agent communication within the same app uses `InternalTransport`. The PolicyEngine still applies — a Tier 0 peer being `app-public` cannot invoke capabilities on `app-data` unless `app-data`'s policy allows it.

The developer can explicitly grant one in-app agent a capability token from another:

```js
const token = await dataAgent.issueCapabilityToken({
  subject:    publicAgent.publicKey,
  capability: 'fetchSummary',
  expiresAt:  Date.now() + 86400_000,
});
publicAgent.vault.set('token:dataAgent:fetchSummary', token);
```

---

### Developer authority ceiling

Clear rule: **the user file is the permission ceiling. The developer can only restrict, never expand.**

| Action | Developer allowed? |
|--------|--------------------|
| Add app-defined capabilities | Yes — these are new, user file says nothing about them |
| Restrict a capability's visibility | Yes |
| Expand a capability's visibility beyond user file | No |
| Add a transport the user didn't define | No (unless user policy allows) |
| Issue capability tokens on behalf of a user agent | Only if user explicitly enabled this in policy |
| Register new blueprints | Yes — these are additive presets |
| Override user's group memberships | No |

The agent runtime enforces this at load time: user file policies are applied first, developer overrides are applied on top but capped to the user's maximums.

---

### Policy composition example

An agent with these declarations:

```yaml
capabilities:
  summarise:
    visibility: authenticated   # Tier 1+ can see it
    policy:     group:home      # but only Tier 2 home members or token holders can call it

  live-feed:
    visibility: public          # everyone can see it
    policy:     negotiated      # but must negotiate before subscribing

  admin-reset:
    visibility: private         # nobody outside sees it
    policy:     never
```

Flow for an unknown peer:
1. Sends capDiscovery → receives only `live-feed` (the only `public` cap)
2. They verify → become Tier 1 → re-query → still only `live-feed` (`summarise` needs `authenticated` but they're Tier 1 now... wait, `authenticated` means Tier 1+ → so now they also see `summarise`)
3. They try to call `summarise` → rejected (policy is `group:home`, they're Tier 1 only)
4. They request to join group `home` (via negotiation + proof from admin) → become Tier 2
5. Now `summarise` is callable
6. Alternatively: agent issues them a capability token for `summarise` → becomes Tier 3 → callable without group membership

---

### Module additions

```
permissions/
  PermissionSystem.js    Orchestrates all four layers. Single entry point
                         for "can peer X do action Y on capability Z?"
  TrustRegistry.js       Maps peerPubKey → current trust tier + proofs held
  CapabilityVisibility.js Filters capability list for a given peer tier
  PolicyGate.js           Evaluates Layer 3 policy for an inbound action
  CapabilityToken.js      Token format, issuance (sign), verification
  TokenRegistry.js        Stores held tokens (in vault) + revocation cache
  DataSourcePolicy.js     Enforces agent + capability access rules on storage
```

`PolicyEngine.js` in the current design is absorbed into `PermissionSystem.js`. The new system is a superset.

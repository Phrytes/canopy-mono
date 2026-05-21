# Discovery

Discovery routes for native peers are unchanged from `Design/09-Discovery.md`. This document covers how A2A peer discovery integrates with the existing model, and how the PeerGraph handles both peer types.

Read `Design/09-Discovery.md` first.

---

## Discovery routes — updated for two peer types

All eight native discovery routes still work and converge on a `hello` exchange. A2A peer discovery is an additional route that converges on an agent card fetch instead.

| Route | How | Peer type |
|-------|-----|-----------|
| Static address | Address in agent file `peers:` block | Native (hello) |
| QR / manual entry | User scans QR or enters address | Native (hello) or A2A (card fetch if URL given) |
| Contact forwarding | Agent A forwards Agent B's card to Agent C | Native (hello) |
| Group bootstrap | Admin shares member list on group join | Native (hello) |
| Task-triggered | Accepting a task from an unknown sender | Native (hello) or A2A (card from caller) |
| LAN (mDNS) | Automatic broadcast | Native only |
| BLE | Address exchange → promote to higher transport | Native only |
| Gossip | Background peer-list sharing | Native only |
| **A2A URL** | `GET {url}/.well-known/agent.json` | A2A only |

### A2A URL discovery

Triggered when:
1. `agent.call('https://...')` is called with a URL not yet in PeerGraph
2. `agent.discoverA2A('https://...')` is called explicitly
3. QR code or manual entry contains an HTTPS URL

```
1. Fetch GET {url}/.well-known/agent.json
2. Validate required fields (name, url, skills[])
3. Parse x-canopy block if present
4. Store as A2A peer record in PeerGraph
5. If x-canopy.pubKey + native transport address present:
   → optionally attempt hello upgrade (see below)
```

Card fetch is cached: re-fetched only when `lastFetched` is older than 1 hour (configurable via `agent.config.a2aCardFreshness`).

---

## PeerGraph — two peer record types

Both record types share the same storage and query API. The `type` field distinguishes them.

### Native peer record
```js
{
  type:         'native',
  pubKey:       '<ed25519-base64url>',
  id:           'alice-home',
  label:        'Alice Home Assistant',
  trustTier:    1,
  groups:       ['home'],
  skills:       [{ id, name, inputModes, outputModes, streaming }],
  transports:   {
    nkn:      { address: 'abc123.nkn' },
    relay:    { url: 'wss://relay.example.com' },
    mdns:     { host: '192.168.1.5', port: 3001 },
  },
  reachable:    true,
  lastSeen:     1712345678000,
  latency:      { nkn: 120, relay: 45 },   // ms, last measured
}
```

### A2A peer record
```js
{
  type:         'a2a',
  url:          'https://other.example.com',
  name:         'Other Agent',
  description:  'Does things.',
  skills:       [{ id, name, inputModes, outputModes, streaming }],
  authScheme:   'Bearer',
  pubKey:       '<ed25519-base64url>',  // set only if x-canopy.pubKey present
  nknAddr:      'xyz.nkn',              // set only if x-canopy.nknAddr present
  localTrust:   { tier: 2, groups: ['home'] },  // set only if manually assigned
  lastFetched:  1712345678000,
  reachable:    true,
}
```

---

## PeerGraph query API — extended

```js
// Native peer queries (unchanged from Design/09-Discovery.md)
agent.peers.withSkill('summarise')         // native peers with this skill
agent.peers.inGroup('home')                // native peers in this group
agent.peers.fastest(3)                     // top 3 by latency
agent.peers.reachable()                    // all currently reachable native peers

// A2A peer queries (new)
agent.peers.a2aAgents()                    // all A2A peer records
agent.peers.withSkill('summarise', { includeA2A: true })  // native + A2A

// Cross-type queries
agent.peers.canHandle({ skill: 'summarise', streaming: false })
// → returns best peer regardless of type; A2A peers included by default
// → prefers native (lower latency, E2E encrypted) when both available

agent.peers.canHandle({ skill: 'chat', mode: 'session' })
// → native only (session mode not available for A2A)

agent.peers.canHandle({ skill: 'live-feed', streaming: 'bidirectional' })
// → native only (bidirectional streaming not available for A2A)
```

`canHandle` respects the `mode` and `streaming` fields on the skill definition. A skill declared `streaming: 'bidirectional'` automatically excludes A2A peers from results.

---

## Upgrading A2A peers to native

When an A2A peer's card has `x-canopy.pubKey` and at least one native transport address:

```
1. Store A2A peer record with pubKey + transport addresses
2. Attempt hello on the best available transport
3. If hello succeeds:
   - Re-record peer as { type: 'native', pubKey, ... }
   - Future calls route via native (E2E encrypted, lower latency)
   - A2A path (HTTP) kept as fallback
4. If hello fails:
   - Keep as A2A record, retry hello on next interaction
```

Upgrade is automatic and transparent. `agent.call()` continues to work unchanged.

---

## Agent file — static peer declarations

Both native and A2A peers can be declared in the agent file for automatic discovery at startup:

```yaml
peers:
  # Native peer — hello sent on startup
  - id:      relay-01
    pubKey:  "<ed25519-pubkey>"
    connections:
      nkn:   { address: "abc123.nkn" }
      relay: { url: "wss://relay.example.com" }

  # A2A peer — card fetched on startup
  - url:     "https://summariser.example.com"
    label:   "Summarisation service"

discovery:
  acceptIntroductions:  from-trusted   # 'always' | 'from-trusted' | 'never'
  gossip:               true
  mdns:                 true

  # Peer graph limits
  maxPeers:             1000
  unreachableAfterDays: 30
  perGroup:
    home:
      maxPeers: 50
```

---

## Gossip

Gossip is native-only. The gossip protocol (background peer-list exchange) from `Design/09-Discovery.md` does not include A2A peers — A2A agent URLs are not spread through gossip. The intent is to not expose A2A endpoints to the wider native network without explicit intent.

If an agent wants to share an A2A peer with another native agent, it uses contact forwarding explicitly:

```js
await agent.introduce(nativePeerId, {
  type: 'a2a',
  url:  'https://other.example.com',
  name: 'Other Agent'
});
```

# Agent Card

The agent card is the A2A discovery document served at `GET /.well-known/agent.json`. It is built directly from the agent's skill registry — no separate mapping step, because skills and A2A skill metadata are the same concept.

---

## Agent card format

```json
{
  "name": "Alice Home Assistant",
  "description": "Personal home agent for Alice.",
  "url": "https://relay.example.com/agents/alice-home",
  "version": "1.0.0",

  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "stateTransitionHistory": false
  },

  "defaultInputModes":  ["application/json"],
  "defaultOutputModes": ["application/json"],

  "skills": [
    {
      "id":          "summarise",
      "name":        "Summarise text",
      "description": "Returns a short summary of an input text.",
      "tags":        ["nlp", "text"],
      "inputModes":  ["text/plain", "application/json"],
      "outputModes": ["text/plain"],
      "examples": [
        {
          "input":  { "parts": [{ "type": "TextPart", "text": "Long article..." }] },
          "output": { "artifacts": [{ "name": "summary", "parts": [{ "type": "TextPart", "text": "Short summary." }] }] }
        }
      ]
    },
    {
      "id":          "live-feed",
      "name":        "Live event feed",
      "description": "Streams real-time events as they occur.",
      "tags":        ["stream", "events"],
      "inputModes":  ["application/json"],
      "outputModes": ["application/json"],
      "streaming":   true
    }
  ],

  "authentication": {
    "schemes": ["Bearer"]
  },

  "x-canopy": {
    "version":  "1",
    "pubKey":   "<ed25519-public-key-base64url>",
    "nknAddr":  "abc123.nkn",
    "relayUrl": "wss://relay.example.com",
    "groups": [
      { "id": "home", "adminPubKey": "<pubkey>" }
    ],
    "trustTiers": {
      "0": ["summarise"],
      "1": ["summarise", "live-feed"]
    }
  }
}
```

### Field sources

| Field | Source |
|-------|--------|
| `name` | `agent.label` (falls back to `agent.id`) |
| `url` | `agent.a2a.url` |
| `skills[]` | `agent.skills` — only skills with `visibility !== 'private'` |
| `skills[].id` | `skill.id` (same as the skill name by default) |
| `skills[].streaming` | `skill.streaming === true` |
| `x-canopy.pubKey` | `AgentIdentity.publicKey` (base64url) |
| `x-canopy.trustTiers` | Derived from `skill.visibility`: `public` → tier 0, `authenticated` → tier 1, `group:*` → tier 2 |

Skills with `visibility: 'private'` are never included in the card.

---

## Agent file YAML — complete reference

The `capabilities:` block from `Design/04-AgentFile.md` is renamed to `skills:`. All other sections are unchanged. This is a complete example of the agent file format.

```yaml
version: "1.0"

agent:
  id:        alice-home          # user-facing slug — not a network address
  blueprint: household-agent     # named preset (see Design/04-AgentFile.md)
  label:     "Home assistant"

  # ── A2A HTTP server (new) ──────────────────────────────────────────
  a2a:
    enabled:   true
    url:       https://relay.example.com/agents/alice-home  # public HTTP URL
    serveHttp: true
    httpPort:  3000
    auth:
      scheme:   bearer
      # Option A: static shared secret
      # secret: vault:a2a-shared-secret
      # Option B: JWT validation
      issuer:   https://auth.example.com
      jwks_uri: https://auth.example.com/.well-known/jwks.json
      audience: https://relay.example.com/agents/alice-home

  # ── Native transport addresses ────────────────────────────────────
  connections:
    nkn:
      address: abc123.nkn        # deterministically derived from Ed25519 pubKey
    mqtt:
      broker:  wss://broker.hivemq.com:8884/mqtt
      address: a3f9d2b071c8
    relay:
      url: wss://relay.example.com   # used by both RelayTransport + RendezvousTransport
    # mdns and ble are added automatically by the runtime when available

  # ── Group memberships ─────────────────────────────────────────────
  groups:
    - id:          home
      adminPubKey: <ed25519-pubkey>
      proof:       <signed-token>
    - id:          neighborhood
      adminPubKey: <ed25519-pubkey>
      proof:       <signed-token>

  # ── Known peers (discovered at startup) ──────────────────────────
  peers:
    # Native peer — hello sent on startup
    - id:      relay-01
      pubKey:  "<ed25519-pubkey>"
      connections:
        relay: { url: "wss://relay.example.com" }
    # A2A peer — card fetched on startup
    - url:     "https://summariser.example.com"
      label:   "Summarisation service"

  # ── Policy ────────────────────────────────────────────────────────
  policy:
    ping:       always
    streaming:  negotiated
    taskAccept: negotiated
    transportFilter:
      default:        [rendezvous, relay, nkn, mqtt, mdns, ble]
      group:home:     [rendezvous, relay, mdns, ble]
      # peer:<pubKey>: [ble]

  # ── Skills (replaces 'capabilities:') ─────────────────────────────
  skills:
    summarise:
      # A2A metadata — exposed in agent card:
      description: "Returns a short summary of any text input."
      inputModes:  [text/plain, application/json]
      outputModes: [text/plain]
      tags:        [nlp, text]
      # Access control — internal, not in card:
      visibility:  public
      policy:      on-request

    live-feed:
      description: "Streams real-time events as they occur."
      inputModes:  [application/json]
      outputModes: [application/json]
      streaming:   unidirectional
      tags:        [stream, events]
      visibility:  public
      policy:      negotiated

    voice-channel:
      description: "Bidirectional audio channel."
      streaming:   bidirectional   # native only — excluded from A2A card
      visibility:  authenticated
      policy:      negotiated

    admin-reset:
      visibility:  private         # never appears in agent card
      policy:      never

    # Built-in skills can be disabled here:
    # session-open:
    #   enabled: false

  # ── Resource limits ───────────────────────────────────────────────
  resources:
    maxPendingTasks: 5
    maxConnections:  20
    bulkTransferThreshold: 262144   # bytes — above this, use Acknowledged BT
    perGroup:
      home:
        maxPendingTasks: 5
      neighborhood:
        maxPendingTasks: 1
        maxConnections:  5

  # ── Storage ───────────────────────────────────────────────────────
  storage:
    sources:
      - label:      private
        type:       solid-pod
        url:        https://alice.solidpod.example
        credential: vault:solid-pod-token
      - label:      app
        type:       indexeddb
        name:       myapp-db

  # ── Vault ─────────────────────────────────────────────────────────
  vault:
    backend: local-storage    # or: indexeddb | node-fs | solid-pod | keychain

  # ── Discovery ─────────────────────────────────────────────────────
  discovery:
    acceptIntroductions: from-trusted
    gossip:              true
    mdns:                true
    a2aCardFreshness:    3600    # seconds before re-fetching an A2A agent card

  # ── Lifecycle hooks ───────────────────────────────────────────────
  hooks:
    onTask:    [log-locally]
    onConnect: [notify-user]
```

**Skill field defaults when omitted:**

| Field | Default |
|-------|---------|
| `description` | `""` |
| `inputModes` | `["application/json"]` |
| `outputModes` | `["application/json"]` |
| `tags` | `[]` |
| `streaming` | `false` |
| `visibility` | `"authenticated"` |
| `policy` | `"on-request"` |

---

## `x-canopy` extension block

This block allows a native agent to recognise that an A2A agent also speaks the native protocol. An A2A agent that does not understand `x-canopy` ignores it — the core A2A fields are always sufficient.

```
x-canopy.version      Protocol version. Currently "1".
x-canopy.pubKey       Ed25519 public key (base64url).
                        Presence signals: this agent supports native transport.
                        Allows nacl.box encryption after card-based discovery.
x-canopy.nknAddr      NKN address (omitted if not configured).
x-canopy.relayUrl     WebSocket relay URL (omitted if not configured).
x-canopy.groups       Group memberships: [{ id, adminPubKey }].
                        Allows native peers to verify group membership.
x-canopy.trustTiers   Map of trust tier → skill id list.
                        Tells native peers which skills become available
                        as trust tier increases, without requiring a separate
                        skill-discovery request.
```

---

## `AgentCardBuilder.js`

Called internally by `A2ATransport` — not directly by developers.

```js
// Build our card to serve at /.well-known/agent.json
const card = AgentCardBuilder.build(agent);

// Fetch and parse a remote card (used by a2aDiscover.js)
const card = await AgentCardBuilder.fetch('https://other-agent.example.com');

// Convert a card to a PeerGraph record
const record = AgentCardBuilder.toPeerRecord(card);
// → { type: 'a2a', url, name, description, skills[], authScheme,
//     pubKey?  (set if x-canopy.pubKey present),
//     nknAddr?, relayUrl?, lastFetched }
```

When building our card, `AgentCardBuilder` applies visibility rules to decide which skills to include and at which trust tier:

```
visibility: 'public'        → include; add to trustTiers["0"]
visibility: 'authenticated' → include; add to trustTiers["1"]
visibility: 'group:<id>'    → include; add to trustTiers["2"]
visibility: 'private'       → exclude entirely
```

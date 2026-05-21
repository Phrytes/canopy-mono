# Skills

Skills replace capabilities throughout the SDK. The concept is identical — a named thing an agent can do, with a handler and access-control metadata. The change: each skill also carries A2A metadata, creating a 1-to-1 relationship between a skill definition and an entry in an A2A agent card.

---

## Skill definition

```js
defineSkill('summarise', handler, {
  // ── A2A metadata (exposed in agent card) ──────────────────────
  description:  'Returns a short summary of any text input.',
  inputModes:   ['text/plain', 'application/json'],
  outputModes:  ['text/plain'],
  tags:         ['nlp', 'text'],
  streaming:    false,

  // ── Access control (internal — not in agent card) ─────────────
  visibility:   'group:home',     // public | authenticated | group:<id> | token:<skill> | private
  policy:       'on-request',     // always | on-request | negotiated | group:<id> | token | never
})
```

`defineSkill(id, handler, opts)` returns a skill object. The handler signature is unchanged from `Design/`: `(payload, context) => result` where `context` carries `{ peer, agent, token? }`.

Payload is a plain object for native peers (backwards compatible with all existing patterns), or Parts for A2A peers. See `02-Parts.md`.

### Three registration styles (unchanged from `Design/`)

```js
// Style 1: inline
agent.register('summarise', handler, opts);

// Style 2: defineSkill
const summarise = defineSkill('summarise', handler, opts);
new Agent({ skills: [summarise] });

// Style 3: TypeScript decorator
@skill({ visibility: 'group:home' })
async summarise(payload, ctx) { ... }
```

All three call the same internal `_registerSkill()`. The external API rename is `defineCapability` → `defineSkill`, `agent.capabilities` → `agent.skills`.

### Skill field defaults

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

## Agent card

The agent card (`/.well-known/agent.json`) is built automatically from the skill registry by `AgentCardBuilder.js`. It follows the A2A spec exactly, with an `x-canopy` extension block.

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
      "description": "Returns a short summary of any text input.",
      "tags":        ["nlp", "text"],
      "inputModes":  ["text/plain", "application/json"],
      "outputModes": ["text/plain"]
    }
  ],

  "authentication": { "schemes": ["Bearer"] },

  "x-canopy": {
    "version":    "1",
    "pubKey":     "<ed25519-base64url>",
    "nknAddr":    "abc123.nkn",
    "relayUrl":   "wss://relay.example.com",
    "groups":     [{ "id": "home", "adminPubKey": "<pubkey>" }],
    "trustTiers": {
      "0": [],
      "1": ["summarise"]
    }
  }
}
```

### Visibility → agent card filtering

| Visibility | Included in card | trustTiers entry |
|-----------|-----------------|-----------------|
| `public` | Yes | `"0"` |
| `authenticated` | Yes | `"1"` |
| `group:<id>` | Yes | `"2"` |
| `token:<skill>` | Yes | `"3"` |
| `private` | Never | — |

Skills in the card with tier > 0 are visible to any A2A agent reading the card, but the `x-canopy.trustTiers` map tells native agents (and our own SDK) what tier is required to invoke them. A2A callers without sufficient auth receive a policy-denied error.

The `x-canopy` block is how native agents recognise each other after A2A discovery. An A2A agent that doesn't understand it ignores it. See `03-A2ATransport.md`.

---

## Agent file YAML

`capabilities:` is renamed to `skills:`. A2A metadata and access-control live at the same level per skill. A new `a2a:` config block is added for the HTTP server.

```yaml
version: "1.0"

agent:
  id:        alice-home
  blueprint: household-agent
  label:     "Home assistant"

  # ── A2A HTTP server ────────────────────────────────────────────────
  a2a:
    enabled:   true
    url:       https://relay.example.com/agents/alice-home
    serveHttp: true
    httpPort:  3000
    auth:
      scheme:   bearer
      issuer:   https://auth.example.com
      jwks_uri: https://auth.example.com/.well-known/jwks.json
      audience: https://relay.example.com/agents/alice-home

  # ── Native transport addresses (unchanged) ────────────────────────
  connections:
    nkn:
      address: abc123.nkn
    mqtt:
      broker:  wss://broker.hivemq.com:8884/mqtt
      address: a3f9d2b071c8
    relay:
      url: wss://relay.example.com

  groups:
    - id:          home
      adminPubKey: <ed25519-pubkey>
      proof:       <signed-token>

  # ── Known peers (native and A2A) ──────────────────────────────────
  peers:
    - id:     relay-01
      pubKey: "<ed25519-pubkey>"
      connections:
        relay: { url: "wss://relay.example.com" }
    - url:    "https://summariser.example.com"   # A2A peer — card fetched on startup
      label:  "Summarisation service"

  # ── Skills (renamed from capabilities:) ───────────────────────────
  skills:
    summarise:
      description: "Returns a short summary of any text input."
      inputModes:  [text/plain, application/json]
      outputModes: [text/plain]
      tags:        [nlp, text]
      visibility:  authenticated
      policy:      on-request

    live-feed:
      description: "Streams real-time events on a topic."
      outputModes: [application/json]
      streaming:   true
      visibility:  public
      policy:      negotiated

    admin-reset:
      visibility:  private
      policy:      never

  # ── Policy (unchanged) ────────────────────────────────────────────
  policy:
    ping:       always
    messaging:  on-request
    streaming:  negotiated
    taskAccept: negotiated
    transportFilter:
      default:    [rendezvous, relay, nkn, mqtt, mdns, ble]
      group:home: [rendezvous, relay, mdns, ble]

  # ── Resources, storage, vault, hooks (unchanged) ──────────────────
  resources:
    maxPendingTasks: 5
    maxConnections:  20

  storage:
    sources:
      - label: private
        type:  solid-pod
        url:   https://alice.solidpod.example
        credential: vault:solid-pod-token

  vault:
    backend: local-storage

  hooks:
    onTask: [log-locally]
```

The only changes from `Design/04-AgentFile.md` are:
- `capabilities:` → `skills:` (with A2A metadata added per skill)
- New `a2a:` config block
- `peers:` block accepts both native records and A2A URL records

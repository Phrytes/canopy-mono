# Agent File Format

The agent file is a portable, user-owned YAML (or JSON) file that defines one or more agents. Apps read this file to hydrate agents at startup. The user controls what is in it.

The file is **encrypted at rest**. The vault section holds references to secrets, not the secrets themselves. The file is safe to share (e.g. across devices) because private keys are never included.

---

## Single agent

```yaml
version: "1.0"

agent:
  id:        alice-home          # user-facing slug — not an address
  blueprint: household-agent     # named preset (see blueprints below)
  label:     "Home assistant"

  connections:
    nkn:
      address: abc123.nkn        # derived from keypair — stable
    mqtt:
      broker:  wss://broker.hivemq.com:8884/mqtt
      address: a3f9d2b071c8
    relay:
      url: wss://relay.example.com   # relay agent address
    # mdns and ble are added automatically by the runtime when available

  groups:
    - id:          home
      adminPubKey: <ed25519-pubkey>
      proof:       <signed-token>
    - id:          neighborhood
      adminPubKey: <ed25519-pubkey>
      proof:       <signed-token>

  policy:
    ping:       always
    messaging:  on-request
    streaming:  negotiated
    taskAccept: negotiated
    transportFilter:
      # Which transports are allowed when communicating with peers.
      # Omit a group/peer entry to use the default. Empty list = no restriction.
      default:        [rendezvous, relay, nkn, mqtt, mdns, ble]
      group:home:     [rendezvous, relay, mdns, ble]   # no NKN/MQTT for home group
      # peer:<pubKey>: [ble]                           # BLE-only for a specific peer

  resources:
    maxPendingTasks: 5
    maxConnections:  20
    perGroup:
      home:
        maxPendingTasks: 5
      neighborhood:
        maxPendingTasks: 1
        maxConnections:  5

  capabilities:
    # App-defined capabilities declared here.
    # Handlers are registered in code; the file declares visibility + policy.
    live-feed:
      visibility: public
      policy:     negotiated
    summarise:
      visibility: "group:home"
      policy:     on-request

  storage:
    sources:
      - label:      private
        type:       solid-pod
        url:        https://alice.solidpod.example
        credential: vault:solid-pod-token
      - label:      app
        type:       indexeddb
        name:       myapp-db

  hooks:
    onTask:    [log-locally]
    onMessage: [log-locally]

vault:
  # References to secrets in the device vault — never the secrets themselves.
  # The runtime resolves these at load time using the platform vault API.
  solid-pod-token: vault:solid-pod-token
  home-db-key:     vault:home-db-key
```

---

## Multiple agents + blueprints in one file

```yaml
version: "1.0"

blueprints:
  household-agent:
    policy:
      ping:       always
      messaging:  on-request
      taskAccept: negotiated
    resources:
      maxPendingTasks: 5
    hooks:
      onTask: [log-locally]

  work-agent:
    extends: household-agent     # inherits all above
    policy:
      taskAccept: on-request     # overrides negotiated
    resources:
      maxPendingTasks: 10        # overrides 5

agents:
  - id:        alice-home
    blueprint: household-agent
    label:     "Home assistant"
    connections:
      nkn:  { address: abc123.nkn }
      mqtt: { broker: wss://broker.hivemq.com:8884/mqtt, address: a3f9d2b0 }
      relay:   { url: wss://relay.example.com }
    groups:
      - id: home
        adminPubKey: <pubkey>
        proof: <token>

  - id:        alice-work
    blueprint: work-agent
    label:     "Work agent"
    connections:
      nkn:  { address: def456.nkn }
    groups:
      - id: work-team
        adminPubKey: <pubkey>
        proof: <token>
```

---

## Blueprint inheritance

Blueprints are named, shareable presets. They support inheritance with overrides. Apps can ship built-in blueprints; users can define their own.

Resolution rules:
- Capability lists **merge** up the chain (child adds to parent)
- Scalar fields (`policy`, `resources`, `hooks`) **override** (child wins over parent)
- Circular inheritance is rejected at parse time

```yaml
blueprints:
  base:
    policy: { ping: always, messaging: on-request }
    resources: { maxPendingTasks: 3 }

  advanced:
    extends: base
    policy:
      taskAccept: negotiated   # adds; ping + messaging inherited
    resources:
      maxPendingTasks: 10      # overrides 3
```

---

## Policy values

| Value | Meaning |
|-------|---------|
| `always` | Accept without any check |
| `on-request` | Accept from verified peers; reject unknown |
| `negotiated` | Requires explicit negotiation before accepting |
| `group:<id>` | Only accept from members of this group |
| `never` | Always reject |

Policies can be set globally per action type and overridden per capability.

---

## Connections

The `connections` block declares where this agent can be reached. Transport addresses are separate from identity (the public key is identity; addresses are routing hints).

```yaml
connections:
  nkn:
    address: <64-hex or name.64-hex>

  mqtt:
    broker:  wss://broker.example.com:8884/mqtt
    address: <16-hex>

  relay:
    url: wss://relay.example.com   # used by both RelayTransport and RendezvousTransport
                                   # (rendezvous signals through relay, then goes direct P2P)

  # Added automatically by runtime, not stored in file:
  # mdns: { hostname: agent-id.local }
  # ble:  { localName: <first 20 chars of agentId> }
```

---

## Export / import

`agent.export()` produces a JSON snapshot of the agent object without private keys or resolved credentials. It can be used to:
- Share an agent definition with another device
- Back up the agent configuration (vault items backed up separately)
- Import into a new app or runtime

`Agent.from(json)` reconstructs an agent from an export. If the export includes transport addresses, those are restored. Private key is loaded from the vault at connect time.

Vault references in the file (`vault:solid-pod-token`) are resolved at runtime using the platform vault — they are never included in exports.

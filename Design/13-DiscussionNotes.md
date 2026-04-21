# Discussion Notes — Design Decisions

Answers to open questions from session 2026-04-15. Some of these result in design changes; those are noted explicitly and will be applied to the relevant docs after review.

---

## A2A: full compatibility sketch

### What A2A actually specifies

A2A (Agent-to-Agent, Google open protocol) defines:

| Component | What it is |
|-----------|-----------|
| **Agent Card** | JSON file at `{agentUrl}/.well-known/agent.json` — describes skills, auth, streaming support |
| **Tasks API** | HTTP endpoints: `POST /tasks/send`, `GET /tasks/{id}`, `POST /tasks/{id}/cancel`, `POST /tasks/sendSubscribe` (streaming) |
| **Message format** | Messages with typed Parts: `TextPart`, `DataPart`, `FilePart`, `ImagePart` |
| **Task lifecycle** | `submitted → working → completed | failed | canceled` |
| **Artifacts** | Named outputs from a completed task (e.g. a file, a summary, a data object) |
| **Authentication** | Standard HTTP auth: JWT bearer tokens, OAuth2, API keys — delegated to the agent's choice |
| **Streaming** | Server-Sent Events (SSE) for incremental task output |
| **Push notifications** | Optional webhook for async task completion notification |

### Mapping our design onto A2A

| Our concept | A2A equivalent | Alignment |
|-------------|---------------|-----------|
| Capability | Skill (in agent card) | Close — skills have `name`, `description`, `inputModes`, `outputModes` |
| Agent file (exported) | Agent Card | Close — agent card has `name`, `description`, `url`, `capabilities`, `skills` |
| Task offer/accept/done | Task lifecycle | Very close — both have the same state machine |
| Task payload | Message with Parts | Gap — our payloads are arbitrary JSON; A2A uses typed Parts |
| Capability result | Task artifact | Gap — we return plain JSON; A2A names and types the output |
| `hello` exchange | Not in A2A | We have this, A2A doesn't — A2A relies on HTTPS + agent card URL |
| Group membership | Not in A2A | Our extension |
| Capability tokens | Not in A2A | Our extension |
| Trust tiers | Not in A2A | Our extension |
| NKN/MQTT/BLE transport | Not in A2A | Our extension |
| E2E nacl.box encryption | Not in A2A (TLS only) | Our extension |

### What full A2A alignment would look like

"Full alignment" means: an agent that speaks our protocol could exchange tasks with any standard A2A agent (Claude, Gemini, LangChain agents, etc.) without a special adapter in between.

That requires:

**1. Adopt A2A agent card format** (with extension fields)

```json
{
  "name": "Alice Home Agent",
  "description": "Personal home assistant",
  "url": "https://relay.example.com/agents/alice-home",
  "version": "1.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false
  },
  "skills": [
    {
      "id": "summarise",
      "name": "Summarise text",
      "description": "...",
      "inputModes": ["text"],
      "outputModes": ["text"]
    }
  ],
  "authentication": {
    "schemes": ["bearer"]
  },

  "x-canopy": {
    "publicKey": "<ed25519-pubkey>",
    "transports": {
      "nkn":  { "address": "abc123.nkn" },
      "mqtt": { "broker": "wss://...", "address": "a3f9d2b0" },
      "ble":  { "advertise": true }
    },
    "groups": [...],
    "trustTiers": true
  }
}
```

The `x-canopy` extension block carries everything A2A doesn't have. Standard A2A agents ignore it. Our agents use it.

**2. Adopt A2A's task/message/Parts format for task payloads**

Instead of arbitrary JSON in task payloads, use A2A's typed Parts:

```js
// Task submission (aligned with A2A)
{
  id:      "task-uuid",
  message: {
    role: "user",
    parts: [
      { type: "text", text: "Please summarise this document." },
      { type: "file", file: { mimeType: "text/plain", data: "<base64>" } }
    ]
  }
}

// Task result (aligned with A2A)
{
  id:     "task-uuid",
  status: { state: "completed" },
  artifacts: [
    { name: "summary", parts: [{ type: "text", text: "The document covers..." }] }
  ]
}
```

This requires changing `taskExchange.js` to use this format rather than plain JSON. Non-breaking for our system; enables A2A interop.

**3. A2A transport** over HTTP/SSE for external A2A agents

An `A2ATransport` that:
- Starts an HTTP server (via Express or bare Node.js `http`)
- Exposes `POST /tasks/send`, `GET /tasks/{id}`, etc.
- Translates inbound A2A tasks to our internal envelope format
- Translates outgoing tasks to A2A format when calling external A2A agents
- Serves `GET /.well-known/agent.json` with the aligned agent card

**4. Authentication bridge**

A2A uses HTTP auth (JWT, API key). Our system uses Ed25519 identity. For the A2A transport:
- Inbound A2A requests authenticate via JWT/API key (standard A2A)
- Our system maps authenticated A2A caller to a trust tier (initially Tier 0 or Tier 1)
- Our E2E encryption is not applied on the A2A HTTP path — TLS handles it there
- Calls going out over our native transports (NKN, BLE) still use nacl.box

This means E2E encryption applies on native transports only, not the A2A HTTP path. That is consistent with A2A's own security model — it relies on TLS.

### The hard challenges

**Challenge 1: Two security models**

Our security model (Ed25519 + nacl.box) is incompatible with A2A's (TLS + JWT). When an A2A agent calls us over HTTP, we can't verify their identity cryptographically the way we do with `hello`. We accept their JWT and trust the HTTP auth. When we call an A2A agent, we have no pubKey to encrypt to — we rely on TLS.

Mitigation: accept that A2A transport = TLS security, native transports = nacl.box security. Document this explicitly. A2A transport is for interoperability with the broader ecosystem; native transports are for the full trust model.

**Challenge 2: Discovery mismatch**

A2A discovers agents by URL (`/.well-known/agent.json`). Our system discovers agents by pubKey + gossip + mDNS. An A2A agent has no concept of our hello exchange.

Mitigation: for agents reachable over HTTP, serve the agent card at the well-known URL. For agents only reachable over BLE/NKN, A2A interop is not available — they are off the A2A network by design. The relay can act as an HTTP gateway for agents that don't have a public URL.

**Challenge 3: Streaming model difference**

A2A uses SSE for streaming. We use our ST/SE envelope pattern. Over HTTP they must be SSE. Over NKN/BLE they are our envelope chunks.

Mitigation: `A2ATransport` converts our streaming events to SSE when talking to A2A agents, and converts incoming SSE to our envelope stream. Same data, different wire format.

**Challenge 4: No equivalent of groups, tokens, trust tiers in A2A**

All of our permission model is invisible to A2A agents. They can call our capabilities if our policy allows anonymous/bearer-auth calls; otherwise they're Tier 0 and see only public capabilities.

This is acceptable — A2A agents are effectively external peers with no group membership.

### Summary: recommended alignment strategy

| Layer | Action |
|-------|--------|
| Agent card format | Adopt A2A format + `x-canopy` extension block |
| Task/message format | Adopt A2A Parts format for task payloads |
| Skills | Map our capabilities to A2A skills in the agent card |
| A2A HTTP transport | Add `A2ATransport` for external interop |
| Security on HTTP | Accept TLS-only for A2A path; nacl.box for native transports |
| Discovery | Serve `/.well-known/agent.json` when HTTP transport is active |
| Our extensions | Groups, tokens, trust tiers remain in `x-canopy` block |

---

## Using the A2A SDK packages

The official/community A2A packages (`@google/a2a`, `a2a-js` etc.) implement the HTTP protocol layer. The question is whether to use them as the foundation for `A2ATransport` or implement the HTTP protocol ourselves.

**Arguments for using the packages:**
- Don't implement the HTTP spec from scratch
- Stay automatically compatible as A2A spec evolves
- Their packages handle edge cases (SSE reconnect, task polling, error codes)

**Arguments for implementing ourselves:**
- A2A is a straightforward HTTP API — the spec fits in a few pages. The HTTP calls are simple POST/GET with JSON bodies and SSE responses. Implementing it ourselves is maybe 200 lines.
- The A2A ecosystem packages are young (Google released A2A early 2025). Their APIs are not yet stable.
- Using their package means taking a dependency on their HTTP framework choices (which may conflict with our relay's existing HTTP setup)
- Our `A2ATransport` needs to fit cleanly into our `Transport` base class. Wrapping someone else's framework around that is often harder than writing the HTTP calls directly.

**Recommended approach:** implement the A2A HTTP protocol in `A2ATransport` ourselves, referencing the spec directly. It's a bounded, well-specified surface. Revisit if the spec becomes significantly more complex. Keep the door open to swapping in an official package later without changing anything else (the `A2ATransport` is behind the `Transport` interface).

---

## WebRTC/WsClient → Rendezvous/Relay renaming

Yes — "rendezvous" and "relay" are the right terms. They already match the terminology in `05-Relay.md`. The two modes of the relay agent correspond directly to the two transport classes on the client side:

| Mode | Client transport | What it does |
|------|-----------------|-------------|
| Rendezvous | `RendezvousTransport` (currently `WebRtcTransport`) | Signals through relay, then goes direct P2P via WebRTC DataChannel. Relay steps aside. |
| Relay | `RelayTransport` (currently `WsTransport`) | Permanently connected through relay. Relay always in path. |

**Do agents get different addresses for both?**

No — both use the same relay URL. The agent card lists one relay URL under `connections.relay`. Both `RendezvousTransport` and `RelayTransport` connect to that URL. The relay supports both modes simultaneously:
- When two agents both support WebRTC, the relay facilitates the SDP/ICE signaling and steps aside
- When one or both don't support WebRTC, the relay stays in the path

The agent doesn't need separate addresses. The relay negotiates which mode to use during connection setup.

**Proposed rename:**
- `WebRtcTransport.js` → `RendezvousTransport.js`
- `WsTransport.js` → `RelayTransport.js`
- `connections.ws` in agent file → `connections.relay`

This makes the naming consistent across the relay agent design (05-Relay.md) and the client transport implementations.

---

## Local transport plan

`LocalTransport` handles same-machine, different-process communication. It uses a localhost WebSocket (or Unix domain socket on Linux/macOS for slightly lower overhead). This is already in the design but the details are worth spelling out.

**Use cases:**
- A browser tab (agent A) talking to a local Node.js relay running on the same laptop
- A desktop app (agent A) talking to a local IoT agent daemon (agent B) on the same machine
- Development: two Node.js agents on the same machine for integration testing without needing network

**How it works:**

One agent acts as the server (starts a WebSocket on `localhost:PORT`), the other connects as client. The port can be fixed (configured in agent file) or discovered via a local lock file (e.g. `~/.canopy/local-socket`).

```yaml
connections:
  local:
    port: 7473          # fixed port on localhost
    # or:
    socket: /tmp/canopy-alice.sock   # Unix domain socket (Linux/macOS)
```

**Mobile caveat:** iOS and Android sandbox apps from talking to each other via localhost. `LocalTransport` is desktop/server only. On mobile, use mDNS for same-device discovery if needed (connecting to `127.0.0.1` from mDNS works when both agents are on the same device).

**Security:** `LocalTransport` still goes through `SecurityLayer` — envelopes are signed and encrypted. Even though it never leaves the machine, this keeps the security model uniform and means LocalTransport code is identical to any other transport implementation.

---

## Updated routing priority

New order with the author's corrections applied:

```
Internal > Local > mDNS > Rendezvous(WebRTC) > Relay(WS) > NKN > MQTT > BLE
```

Rationale:
- `Rendezvous` above `Relay`: both need internet; Rendezvous is direct P2P once established, Relay always has a hop
- `NKN` and `MQTT` below Relay: NKN/MQTT are internet-dependent but may have higher latency or broker dependency; the relay is a known server with predictable performance
- `BLE` last: local and works without internet, but slowest bandwidth — use when nothing else works

**Per-peer transport filtering:**

The agent should be able to configure, per peer or per group, which transports are acceptable:

```yaml
policy:
  transportFilter:
    default:      [rendezvous, relay, nkn, mqtt, ble]   # all allowed by default
    group:home:   [rendezvous, relay, mdns, ble]         # no NKN/MQTT for home group
    peer:<pubKey>: [ble]                                 # BLE only for this specific peer
```

`RoutingStrategy` checks this filter before ranking. If a transport is not in the allowed list for this peer, it is skipped regardless of availability. This gives the developer and user control over which paths are used for sensitive or constrained peers.

---

## Capability registration API

Two styles, both supported, mapping to the same internal representation:

**Style 1: `agent.register()` — inline, minimal**
```js
import { Agent } from '@canopy/core';

const agent = new Agent({ id: 'home-agent' });

agent.register('summarise', async ({ text }) => {
  return { summary: text.slice(0, 100) };
}, { visibility: 'group:home', policy: 'on-request' });

agent.registerStream('live-feed', async function* ({ topic }) {
  for await (const event of events(topic)) yield event;
}, { visibility: 'public', policy: 'negotiated' });

await agent.start();
```

**Style 2: `defineCapability()` — composable, testable, importable**
```js
import { defineCapability, defineStream, Agent } from '@canopy/core';

export const summarise = defineCapability('summarise',
  async ({ text }) => ({ summary: text.slice(0, 100) }),
  { visibility: 'group:home', policy: 'on-request' }
);

export const liveFeed = defineStream('live-feed',
  async function* ({ topic }) {
    for await (const event of events(topic)) yield event;
  },
  { visibility: 'public', policy: 'negotiated' }
);

const agent = new Agent({ id: 'home-agent', capabilities: [summarise, liveFeed] });
await agent.start();
```

**Style 3: TypeScript decorators (optional layer)**
```ts
import { Agent, capability, stream } from '@canopy/core';

class HomeAgent extends Agent {
  @capability({ visibility: 'group:home', policy: 'on-request' })
  async summarise({ text }: { text: string }) {
    return { summary: text.slice(0, 100) };
  }

  @stream({ visibility: 'public', policy: 'negotiated' })
  async *liveFeed({ topic }: { topic: string }) {
    for await (const event of this.events(topic)) yield event;
  }
}
```

`defineCapability` returns a plain object `{ name, handler, options }`. `agent.register()` does the same. The decorator unpacks the method and calls `register()` internally. All three are thin wrappers over the same underlying registry.

---

## A2A task format alignment

In A2A, a task is a single commitment — not a sequence of capability calls from the outside. The agent internally decides how to fulfill it. The caller sees only the lifecycle and the output.

**Current task in our design:**
```js
// Offer
{ taskId, capability: 'summarise', payload: { text: '...' } }
// Result
{ taskId, status: 'completed', result: { summary: '...' } }
```

**A2A-aligned task:**
```js
// Submission
{
  id: "task-uuid",
  message: {
    role: "user",
    parts: [
      { type: "text", text: "Please summarise this." },
      { type: "data", data: { extra: "context" } }
    ]
  }
}

// Incremental update (streaming / working state)
{
  id: "task-uuid",
  status: { state: "working" },
  message: { role: "agent", parts: [{ type: "text", text: "Processing..." }] }
}

// Completion
{
  id: "task-uuid",
  status: { state: "completed" },
  artifacts: [
    { name: "summary", parts: [{ type: "text", text: "The document covers..." }] }
  ]
}
```

**How skills map to capabilities:**

In A2A, skills are declared in the agent card and describe what kinds of tasks the agent can handle. A capability in our system maps 1:1 to a skill:

```json
"skills": [
  {
    "id": "summarise",
    "name": "Summarise text",
    "description": "Returns a concise summary of the provided text",
    "tags": ["text", "nlp"],
    "inputModes": ["text"],
    "outputModes": ["text"]
  }
]
```

The skill `id` matches our capability name. When an A2A task arrives targeting skill `summarise`, our router maps it to the `summarise` capability handler.

**What changes in `taskExchange.js`:**
- Task payloads become A2A `message` objects with `parts` instead of plain JSON
- Task results become A2A `artifacts`
- Status values align: `pending → submitted`, `working → working`, `completed → completed`, `failed → failed`
- Streaming task updates use the same ST/SE envelope internally; translated to SSE when going over `A2ATransport`

A convenience wrapper means capability handlers don't need to know about Parts directly:

```js
// Handler still receives unwrapped input for simple text tasks:
agent.register('summarise', async ({ text }) => {
  return { summary: text.slice(0, 100) };
});
// Framework extracts text from Parts, wraps result in an artifact automatically.

// For full A2A control, handler receives raw message:
agent.register('summarise', async (message) => {
  const textPart = message.parts.find(p => p.type === 'text');
  return { artifacts: [{ name: 'summary', parts: [{ type: 'text', text: '...' }] }] };
}, { rawA2A: true });
```

---

## Decisions to apply to existing docs

The following changes flow from this discussion. To be applied after review:

1. **Rename** `WebRtcTransport` → `RendezvousTransport`, `WsTransport` → `RelayTransport`, `connections.ws` → `connections.relay` across all docs
2. **Update routing priority** to `Internal > Local > mDNS > Rendezvous > Relay > NKN > MQTT > BLE`
3. **Add `A2ATransport`** to the module map (`@canopy/core`), add Phase for A2A integration to roadmap
4. **Adopt A2A agent card format** with `x-canopy` extension block (update `04-AgentFile.md`)
5. **Adopt A2A Parts format** for task payloads (update `taskExchange` in protocol docs)
6. **Add transport filter policy** to agent file format and `RoutingStrategy`
7. **Add capability registration API** (`defineCapability`, `defineStream`, `agent.register`) to `02-Architecture.md` and `12-CodePlan.md`
8. **A2A transport implemented from scratch**, not via external A2A packages, behind the `Transport` interface

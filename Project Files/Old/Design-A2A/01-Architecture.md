# Architecture (A2A-first)

The layer model and module structure from `Design/02-Architecture.md` apply unchanged. This document shows only the additions and the updated module map.

---

## Updated layer diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         APPLICATION                             │
│           developer code + user agent file                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                        AGENT LAYER                              │
│                                                                 │
│  Agent          identity · skill registry · peer registry      │
│  AgentFile      load + parse YAML/JSON agent definition        │
│  Blueprint      named skill + policy preset                    │
│  SkillRegistry  skill definitions + access control metadata    │  ← replaces CapabilityRegistry
│  Parts          typed payload primitives (TextPart etc.)       │  ← new
│  Task           A2A state machine: submitted→working→done      │  ← updated
│  GroupManager   cryptographic group membership                 │
│  RoutingStrategy  pick best transport per peer per action      │
│  PolicyEngine   gate inbound tasks per trust tier              │
│  StateManager   task state + stream state + dedup cache        │
└──────────┬──────────────────────────────────┬───────────────────┘
           │                                  │
┌──────────▼──────────────────────────────────▼──────────────────┐
│                      PROTOCOL LAYER                             │
│                                                                 │
│  Native protocol (envelope-based):                             │
│  hello · ping · skillDiscovery · taskExchange                  │
│  session · streaming · fileSharing · pubSub                    │
│                                                                 │
│  A2A protocol (HTTP-based):                                    │  ← new
│  a2aDiscover · a2aTaskSend · a2aTaskSubscribe                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                     TRANSPORT LAYER                             │
│  Transport base class                                           │
│  ├── SecurityLayer (dual mode — see 04-Security.md)            │
│  └── Transports:                                               │
└──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────────────┘
       │      │      │      │      │      │      │
  Internal  Local   NKN  MQTT  Rendezvous Relay mDNS  BLE   A2A
                                                             (HTTP)
```

---

## Updated module map

Additions and changes only. Everything not listed is unchanged from `Design/02-Architecture.md`.

```
@canopy/core
  src/

    parts/                                                  ← new package
      Parts.js
        Typed Part constructors and helpers.
        TextPart(text)       → { type: 'TextPart', text }
        DataPart(data)       → { type: 'DataPart', data }
        FilePart(opts)       → { type: 'FilePart', mimeType, name, data|url }
        ImagePart(opts)      → { type: 'ImagePart', mimeType, data }
        Parts.text(parts)    → extracts first TextPart text, or null
        Parts.data(parts)    → merges all DataPart.data objects, or null
        Parts.files(parts)   → FilePart[] array
        Parts.images(parts)  → ImagePart[] array
        Parts.wrap(value)    → auto-wrap: string → TextPart, object → DataPart
        Parts.artifact(name, parts) → { name, parts }

    a2a/                                                    ← new package
      A2ATransport.js
        HTTP server + client implementing the A2A tasks API.
        Server side: Express (or bare node:http) on a configurable path.
          GET  /.well-known/agent.json   → serves AgentCard
          POST /tasks/send               → inbound task
          POST /tasks/sendSubscribe      → inbound streaming task (SSE)
          GET  /tasks/:id                → task status poll
          POST /tasks/:id/cancel         → task cancel
        Client side: sends tasks to remote A2A agents via fetch().
        Since Parts are the native format, A2ATransport only wraps/unwraps
        the HTTP task envelope — no semantic translation of payload.

      AgentCardBuilder.js
        Builds the A2A agent.json from the agent's skill registry +
        x-canopy extension block. Called by A2ATransport.
        Also fetches + parses a remote agent's card.

      A2AAuth.js
        Handles A2A authentication on both sides.
        Inbound: validates JWT bearer tokens, maps to trust tier.
        Outbound: attaches bearer token when calling A2A agents.
        Token storage: tokens held in Vault under 'a2a-token:<peerUrl>'.

    protocol/
      a2aDiscover.js                                        ← new
        Fetches and parses /.well-known/agent.json from a URL.
        Stores result in PeerGraph as an A2A peer record.
        Used for first contact with A2A agents (instead of hello.js).

      a2aTaskSend.js                                        ← new
        Sends a task to an A2A agent and waits for the result.
        Builds HTTP task envelope from Parts, calls A2ATransport.
        Maps A2A task lifecycle events to our Task state machine.

      a2aTaskSubscribe.js                                   ← new
        Sends a streaming task via SSE. Receives TaskStatusUpdate events,
        emits each artifact's Parts as a stream-chunk event on the Task.

      taskExchange.js                                       ← updated
        Implements the A2A task state machine over native envelopes.
        States: submitted → working → completed | failed | cancelled
                        ↘ input-required → (waiting) → working
        Offer/accept is removed as a developer-visible concept.
        PolicyEngine check happens immediately on receipt; if denied,
        task transitions directly to 'failed' with a policy-error artifact.
        input-required: handler yields an InputRequired signal; transport
        sends a native IR envelope; caller sends reply Parts; task resumes.
        Bidirectional streaming: manages two interleaved ST streams on the
        same session key; each side independently yields and closes.

      fileSharing.js                                        ← updated
        Unified file transfer. For A2A peers or small files: FilePart
        (inline base64 or URL). For native peers above threshold: Acknowledged
        BulkTransfer (BT envelopes with per-chunk AK). Selection is automatic
        based on peer type and file size. Developer always passes a FilePart.

      skillDiscovery.js                                     ← replaces capDiscovery.js
        Request/response for a peer's skill list.
        Returns skill id + inputModes + outputModes for each skill
        visible at the caller's trust tier.

    routing/
      RoutingStrategy.js                                    ← updated
        Gains awareness of peer type (native vs a2a).
        For A2A peers: always routes to A2ATransport.
        For native peers: existing priority order unchanged.

    discovery/
      PeerGraph.js                                          ← updated
        Two peer record types:

        Native peer:
          { type: 'native', pubKey, id, label, trustTier,
            skills, transports, reachable, lastSeen, ... }

        A2A peer:
          { type: 'a2a', url, name, description, skills,
            authScheme, lastFetched, reachable }

        Query API extended:
          agent.peers.a2aAgents()          → A2A peer records
          agent.peers.withSkill('summarise')  → native or A2A
          agent.peers.canHandle(taskSpec)     → best peer for a task

    state/
      Task.js                                               ← updated
        A2A task state machine.
        States: submitted | working | completed | failed | cancelled
                input-required
        Events: 'state', 'chunk', 'input-required', 'done'
        task.send(parts)    → send reply to input-required (caller side)
        task.cancel()       → transition to cancelled
        task.stream()       → async iterable of Parts chunks

    Agent.js                                                ← updated
      defineSkill() replaces defineCapability().
      agent.skills (not agent.capabilities).
      agent.call(peerId, skillId, parts, opts)
        Unchanged for native peers.
        If peerId is a URL resolving to an A2A peer, routes via A2ATransport.
      agent.callA2A(url, skillId, parts, opts)
        Explicit A2A call (discovers card if not cached).
      agent.send(peerId, parts, opts)
        One-way message (TextPart or DataPart). Convenience wrapper over
        a fire-and-forget task.
```

---

## Updated agent object shape

The core shape from `Design/02-Architecture.md` is unchanged. Fields that change:

```js
{
  // 'capabilities' is now 'skills'
  skills: {
    'summarise': {
      id:          'summarise',
      description: 'Returns a short summary.',
      inputModes:  ['text/plain'],
      outputModes: ['text/plain'],
      tags:        ['nlp'],
      streaming:   false,
      visibility:  'group:home',    // access control — not in agent card
      policy:      'on-request',    // access control — not in agent card
      handler:     async (parts, ctx) => [...],
    }
  },

  a2a: {
    enabled:   true,
    url:       "https://relay.example.com/agents/alice-home",
    serveHttp: true,
    httpPort:  3000,
    auth: {
      scheme:   "bearer",
      // issuer, jwks_uri, audience — standard JWT config
    },
  }
}
```

---

## Routing with A2A peers

```
Peer type = native  → priority: Internal > Local > mDNS > Rendezvous > Relay > NKN > MQTT > BLE
Peer type = a2a     → always: A2ATransport (HTTP)
```

When `agent.call(peerId, skillId, parts)` is called:
1. Look up peer in PeerGraph
2. If `type === 'a2a'`: use A2ATransport
3. If `type === 'native'`: use existing routing priority
4. If peer not in PeerGraph and peerId looks like a URL: attempt A2A discovery
5. If A2A discovery fails or peerId is not a URL: attempt native hello

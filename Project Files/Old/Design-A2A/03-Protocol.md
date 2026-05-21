# Protocol

This document covers the task model, the Parts format, streaming, negotiation via `input-required`, and how the same model is carried over A2A (HTTP/SSE) and native (encrypted envelopes) transports.

---

## Core principle

All interactions are **tasks**. A task has a state machine, carries typed Parts as input and output, and is identified by a UUID. Whether the task runs over HTTP or NKN, the state machine and payload format are identical. The transport is invisible to skill handlers and to callers.

---

## Task state machine

```
          ┌─────────────────────────────────────────┐
          │                                         │
submitted → working → completed                    │
                    ↘ failed                       │
                    ↘ cancelled                    │
                    ↘ input-required → (reply) ────┘
                                        working
```

| State | Meaning |
|-------|---------|
| `submitted` | Task received; PolicyEngine check pending (immediate) |
| `working` | Accepted and executing |
| `completed` | Handler returned; artifacts available |
| `failed` | Handler threw, or policy denied, or transport error |
| `cancelled` | Cancelled by caller (`task.cancel()`) or handler |
| `input-required` | Handler needs more input; waiting for caller reply |

PolicyEngine runs during `submitted`. If the policy denies the task, it transitions directly to `failed` with a `DataPart` error artifact — the skill handler is never invoked.

---

## Parts format

Parts are the universal payload atom used in task input, task output (artifacts), stream chunks, and messages. Every Part has a `type` field.

### TextPart
```json
{ "type": "TextPart", "text": "Hello, world!" }
```
For human-readable text: prompts, responses, status messages.

### DataPart
```json
{ "type": "DataPart", "data": { "key": "value", "count": 42 } }
```
For structured data between agents. `data` is any JSON-serialisable object. This is the default Part type for agent-to-agent calls passing structured payloads.

### FilePart
```json
{
  "type":     "FilePart",
  "mimeType": "application/pdf",
  "name":     "document.pdf",
  "data":     "<base64-encoded-content>"
}
```
Inline file content. For large files, `data` may be replaced by `url` (pre-uploaded resource). The SDK accepts both.

### ImagePart
```json
{
  "type":     "ImagePart",
  "mimeType": "image/png",
  "data":     "<base64-encoded-content>"
}
```

### Convenience helpers (`Parts.js`)

```js
import { TextPart, DataPart, FilePart, Parts } from '@canopy/core';

// Constructors
TextPart('Hello')                    // → { type: 'TextPart', text: 'Hello' }
DataPart({ count: 42 })              // → { type: 'DataPart', data: { count: 42 } }

// Extraction
Parts.text(parts)                    // first TextPart.text or null
Parts.data(parts)                    // merged DataPart.data fields or null
Parts.files(parts)                   // FilePart[] array
Parts.images(parts)                  // ImagePart[] array

// Auto-wrap (for convenience when returning from handlers)
Parts.wrap('hello')                  // → [TextPart('hello')]
Parts.wrap({ count: 42 })            // → [DataPart({ count: 42 })]
Parts.wrap([TextPart('a'), ...])      // → passes through unchanged

// Build an artifact
Parts.artifact('summary', parts)     // → { name: 'summary', parts }
```

---

## Skill handler signature

Every skill handler receives `parts[]` and a `context` object. It returns `parts[]` (or a value that `Parts.wrap` can coerce).

```js
async function handler(parts, context) {
  // parts: Part[]  — the task input
  // context: { peer, agent, task, trust }

  const text = Parts.text(parts);    // convenience extraction
  const data = Parts.data(parts);

  // Return Parts directly, or a coercible value:
  return [TextPart(`Summary: ${text.slice(0, 100)}`)];
  // OR: return 'Summary: ...'   → auto-wrapped to [TextPart]
  // OR: return { result: 42 }   → auto-wrapped to [DataPart]
}
```

Handlers do not know whether the caller is A2A or native. The Parts arrive and depart in the same format regardless.

---

## Streaming

Two streaming modes. Declare which one a skill uses in its definition.

### Unidirectional streaming — `streaming: 'unidirectional'`

Server pushes chunks to client. Client cannot send mid-stream (use `input-required` for control signals). **A2A compatible.**

Handler is an async generator that yields `parts[]`:

```js
async function* handler(parts, context) {
  const { topic } = Parts.data(parts);

  for await (const event of subscribeToEvents(topic)) {
    yield [DataPart(event)];         // each yield → one stream chunk
  }
  // generator return → task completes
}
```

**Over A2A (HTTP/SSE)**: each `yield` becomes a `TaskStatusUpdate` SSE event:
```
data: {"id":"task-uuid","state":"working",
       "artifact":{"name":"chunk","parts":[...],"lastChunk":false}}

data: {"id":"task-uuid","state":"completed",
       "artifact":{"name":"chunk","parts":[...],"lastChunk":true}}
```

**Over native**: each `yield` becomes an ST envelope (nacl.secretbox encrypted). Final yield or return sends an SE envelope.

Caller:
```js
const task = await agent.call(peerId, 'live-feed', [DataPart({ topic: 'weather' })]);
for await (const parts of task.stream()) {
  console.log(Parts.data(parts));
}
```

---

### Bidirectional streaming — `streaming: 'bidirectional'`

Both sides push chunks to each other simultaneously over the same channel. **Native transport only.** An A2A caller attempting a bidirectional skill receives `failed: { code: 'requires-native-transport' }`.

Handler receives an async iterable of incoming chunks *and* yields outgoing chunks simultaneously. The SDK manages the two interleaved ST streams over the same native session:

```js
async function* handler(parts, { stream }) {
  // stream.incoming: async iterable of Parts[] sent by the caller mid-stream

  yield [DataPart({ status: 'connected' })];   // send to caller

  for await (const incomingParts of stream.incoming) {
    const msg = Parts.data(incomingParts);
    yield [DataPart({ echo: msg })];            // reply to each incoming chunk
  }
}
```

Caller:
```js
const task = await agent.call(peerId, 'voice-channel',
  [DataPart({ room: 'main' })]);

// Send chunks to the handler while receiving chunks from it:
task.send([DataPart({ audio: '...' })]);        // push to handler
for await (const parts of task.stream()) {
  playAudio(Parts.data(parts).audio);           // receive from handler
}
```

**Over native**: two interleaved ST/SE streams on the same session key. Each side independently yields chunks and closes its own stream. The session closes when both sides have sent SE.

**Skill declaration**:
```js
defineSkill('voice-channel', handler, {
  description: 'Bidirectional audio channel.',
  streaming:   'bidirectional',  // native only — A2A callers get clear error
  visibility:  'authenticated',
})
```

---

### Streaming mode summary

| Mode | `streaming` value | A2A | Native | Use case |
|------|------------------|-----|--------|----------|
| Off | `false` (default) | ✓ | ✓ | Request/response |
| Unidirectional | `'unidirectional'` | ✓ SSE | ✓ ST envelopes | Live feed, events, LLM output |
| Bidirectional | `'bidirectional'` | ✗ | ✓ dual ST | Audio, video, interactive sessions |

`streaming: true` in skill definitions is treated as `'unidirectional'` (backwards compatible).

---

## Negotiation via `input-required`

`input-required` replaces the old `negotiation.js` pre-task offer/accept. Negotiation now happens mid-task, with context, through the standard task state machine.

A skill handler that needs more information transitions the task to `input-required` by yielding an `InputRequired` signal. The task pauses. The caller sends reply Parts. The task resumes.

### Handler side

```js
async function* handler(parts, { task }) {
  const data = Parts.data(parts);

  if (!data.format) {
    // Ask the caller for more information
    const reply = yield task.requireInput([
      TextPart('What output format do you want? (bullets or prose)')
    ]);
    // reply is the Parts[] sent back by the caller
    data.format = Parts.text(reply);
  }

  const summary = await summarise(data.text, data.format);
  return [TextPart(summary)];
}
```

`task.requireInput(parts)` is a special yield value recognised by the SDK. It transitions the task to `input-required`, sends the Parts to the caller as a `message`, and suspends the generator until the caller replies.

For non-generator handlers, throw `context.task.InputRequired(parts)`:

```js
async function handler(parts, { task }) {
  if (!Parts.data(parts)?.format) {
    throw task.InputRequired([TextPart('What format?')]);
  }
  // ...
}
```

Non-generator handlers that throw `InputRequired` cannot resume — the next caller message starts a new invocation with the combined original + reply Parts. Use the generator form for handlers that need to maintain state across rounds.

### Caller side

```js
const task = await agent.call(peerId, 'summarise', [
  DataPart({ text: 'Long article...' })
]);

task.on('input-required', async (questionParts) => {
  console.log(Parts.text(questionParts));  // "What format?"
  await task.send([TextPart('bullets')]);  // resume the task
});

const result = await task.done();          // wait for completion
console.log(Parts.text(result.artifacts[0].parts));
```

**Over A2A**: `input-required` is a native A2A state. The caller calls `POST /tasks/:id/send` with the reply message.

**Over native**: the transport sends a native IR envelope. The caller's task object emits `input-required`, and `task.send()` sends a native reply envelope.

Multiple `input-required` rounds are supported. The generator pauses at each `yield task.requireInput(...)`.

---

## Discovery

### Native peers
1. Get peer's address (NKN, relay URL, mDNS, etc.)
2. Send HI envelope → receive HI reply with skill list
3. Store as `{ type: 'native', pubKey, skills, ... }` in PeerGraph

### A2A peers
1. Have the peer's base URL (out-of-band)
2. `GET {url}/.well-known/agent.json`
3. Parse skills from card
4. Store as `{ type: 'a2a', url, skills, ... }` in PeerGraph

When `agent.call()` is given an unknown peer ID:
- If it looks like a URL → attempt A2A discovery first, then native hello
- Otherwise → native hello only

---

## How the same task model works over both transports

The following table shows what each state transition looks like on the wire. The developer's code (handler + caller) is identical in both columns.

| Task event | A2A wire (HTTP) | Native wire (envelope) |
|-----------|-----------------|----------------------|
| Task submitted | `POST /tasks/send` | RQ envelope `_p: 'RQ'` |
| Policy check | Before HTTP response body | Before sending RS envelope |
| Task working | `{ state: 'working' }` in response | AK envelope |
| Stream chunk | SSE `TaskStatusUpdate` `lastChunk: false` | ST envelope (nacl.secretbox) |
| Input required | `{ state: 'input-required', message: ... }` | IR envelope |
| Caller reply | `POST /tasks/:id/send` | RI envelope |
| Completed | `{ state: 'completed', artifacts: [...] }` | RS envelope with Parts payload |
| Failed | `{ state: 'failed', error: ... }` | RS envelope with error DataPart |
| Cancelled | `{ state: 'cancelled' }` | OW envelope `_p: 'CX'` |

The native IR and RI envelope codes are new additions to the envelope spec for `input-required` support.

---

## File transfer

Two modes. The SDK selects automatically based on peer type and file size.

### FilePart — A2A compatible

Used for A2A peers and small files with native peers (below a configurable threshold, default 256 KB). The file is either inline (base64) or referenced by URL:

```json
{ "type": "FilePart", "mimeType": "application/pdf", "name": "doc.pdf",
  "data": "<base64>" }

{ "type": "FilePart", "mimeType": "application/pdf", "name": "doc.pdf",
  "url": "https://storage.example.com/doc.pdf" }
```

Skill declaration:
```js
defineSkill('upload', handler, {
  inputModes:  ['application/octet-stream', 'application/pdf'],
  outputModes: ['application/json'],
})
// Callers pass a FilePart. A2A and native both work.
```

---

### Acknowledged BulkTransfer — native only

For large files between native peers (above the threshold). Chunked transfer with per-chunk ACKs. Provides flow control and resume-on-failure — useful on unreliable transports (NKN, BLE).

```
Sender splits file into chunks (default 64 KB each)
For each chunk:
  → send BT envelope { _bid, _seq, _total, data }
  ← receive AK envelope for that chunk
After all chunks:
  → send BT envelope { _bid, _seq: _total, _final: true }
Receiver reassembles in StateManager, delivers complete buffer
```

The developer does not invoke this protocol directly. It is triggered by the SDK when:
- Peer type is `native`
- File size exceeds the threshold

From the developer's perspective, a FilePart goes in, the skill handler receives the reassembled content — the BT/AK envelope exchange is invisible:

```js
// Caller (any peer type — SDK picks FilePart vs BT automatically):
await agent.call(peerId, 'upload', [
  FilePart({ mimeType: 'application/pdf', name: 'doc.pdf', data: fileBuffer })
]);

// Handler (receives fully assembled FilePart regardless of how it was sent):
async function handler(parts) {
  const [file] = Parts.files(parts);
  // file.data is the complete buffer
}
```

---

### File transfer mode summary

| Condition | Wire protocol | A2A compatible |
|-----------|--------------|----------------|
| A2A peer, any size | FilePart (inline or URL) | ✓ |
| Native peer, < 256 KB | FilePart (inline) | — |
| Native peer, ≥ 256 KB | Acknowledged BulkTransfer | Native only |

The threshold is configurable: `agent.config.bulkTransferThreshold` (bytes).

---

## Built-in skills

The SDK registers a set of built-in skills automatically at agent startup. These appear in the agent card alongside developer-defined skills. Each can be disabled in agent config.

| Skill id | Mode | A2A | Description |
|----------|------|-----|-------------|
| `subscribe` | streaming: unidirectional | ✓ | Pub-sub: stream events on a topic until cancelled |
| `session-open` | — | ✗ native only | Open a bidirectional session channel |
| `session-message` | — | ✗ native only | Send a message on an open session |
| `session-close` | — | ✗ native only | Close a session |
| `file` | — | ✓ | File transfer (FilePart or BT, auto-selected) |

Built-in skills that require native transport (`session-*`) appear in the agent card with `x-canopy.requiresNative: true`. An A2A caller that calls them receives `failed: { code: 'requires-native-transport' }` with a message explaining why.

Disable a built-in skill:
```yaml
skills:
  session-open:
    enabled: false
  subscribe:
    visibility: private   # or just turn off entirely
```

---

## Skill discovery

`skillDiscovery.js` handles explicit skill list requests between native peers.

```
Caller sends RQ with { _p: 'SD' }
Receiver returns skill list filtered by caller's trust tier:
  [{ id, name, description, inputModes, outputModes, streaming, tags }]
  (visibility and policy fields are never returned — they are internal)
```

For A2A peers, skill discovery is the agent card fetch — no separate request needed.

# Interaction Patterns

All interaction patterns from `Design/` remain. What changes: the task model is now primary and A2A-compatible, negotiation is replaced by `input-required`, streaming has two explicit modes, and all payloads are Parts. Plain objects still work for native-to-native.

Read `Design/` for the full base spec. This document covers what changes or needs clarification in v3.

---

## Task model — the unifying primitive

All patterns sit on top of the A2A task state machine. The four envelope primitives (sendOneWay, sendAck, request, respond) are still the wire layer, but callers and handlers work with `task` objects, not raw envelopes.

```
submitted → working → completed
                    ↘ failed
                    ↘ cancelled
                    ↘ input-required → (caller replies) → working
```

The task state machine is identical over A2A (HTTP) and native (envelopes). Handlers and callers do not know which transport is carrying their task.

Three new envelope codes support the task model:

| Code | Name | Direction | Description |
|------|------|-----------|-------------|
| `IR` | Input-Required | ← | Handler needs more input. Carries question Parts. |
| `RI` | Reply-Input | → | Caller's reply to an IR. Carries answer Parts. |
| `CX` | Cancel | → | Caller cancels an in-progress task. |

All existing codes (`HI`, `OW`, `AS`, `AK`, `RQ`, `RS`, `PB`, `ST`, `SE`, `BT`) are unchanged.

---

## Task exchange — primary pattern

`taskExchange.js` handles `RQ`/`RS` exchange. The developer API is `agent.call()` on the caller side and a skill handler on the receiver side. Unchanged except:
- Payloads are `parts[]` (or auto-wrapped plain objects — see `02-Parts.md`)
- The A2A task state machine governs the lifecycle
- IR/RI/CX are available on all transports

```js
// Caller
const task = await agent.call(peerId, 'summarise', [DataPart({ text: '...' })]);
const result = await task.done();
const summary = Parts.text(result.artifacts[0].parts);

// Handler
defineSkill('summarise', async (parts, ctx) => {
  const { text } = Parts.data(parts);
  return [TextPart(`Summary: ${text.slice(0, 200)}`)];
});
```

**A2A mapping**: `POST /tasks/send` → `{ state: 'completed', artifacts: [...] }`.

---

## Negotiation via `input-required`

`negotiation.js` (offer/accept pre-task flow) is removed. Negotiation now happens mid-task through the standard state machine. A handler that needs more information transitions the task to `input-required`.

```js
// Handler (generator form — state is preserved across rounds)
async function* handler(parts, { task }) {
  const data = Parts.data(parts);

  if (!data.format) {
    const reply = yield task.requireInput([
      TextPart('What output format? (bullets or prose)')
    ]);
    data.format = Parts.text(reply);
  }

  return [TextPart(await summarise(data.text, data.format))];
}

// Handler (non-generator form — handler restarts with combined Parts on reply)
async function handler(parts, { task }) {
  const data = Parts.data(parts);
  if (!data.format) throw task.InputRequired([TextPart('What format?')]);
  return [TextPart(await summarise(data.text, data.format))];
}
```

```js
// Caller
const task = await agent.call(peerId, 'summarise', [DataPart({ text: '...' })]);

task.on('input-required', async (questionParts) => {
  const answer = await promptUser(Parts.text(questionParts));
  await task.send([TextPart(answer)]);
});

const result = await task.done();
```

**A2A mapping**: `input-required` is a native A2A task state. No adapter needed.

**Native mapping**: IR envelope (agent → caller), RI envelope (caller → agent). Same developer API.

---

## Streaming

Two modes, declared at skill definition time. The value of `streaming:` in `defineSkill` opts in.

### Unidirectional — `streaming: 'unidirectional'`

Server pushes chunks to client. Client cannot send mid-stream (use `input-required` for control signals). A2A compatible.

```js
// Handler: async generator, each yield → one chunk
defineSkill('live-feed', async function* (parts, ctx) {
  const { topic } = Parts.data(parts);
  for await (const event of subscribeToEvents(topic)) {
    yield [DataPart(event)];
  }
}, { streaming: 'unidirectional', visibility: 'authenticated' });

// Caller
const task = await agent.call(peerId, 'live-feed', [DataPart({ topic: 'price' })]);
for await (const parts of task.stream()) {
  console.log(Parts.data(parts));
}
```

**Over A2A**: each yield → SSE `TaskStatusUpdate` event.
**Over native**: each yield → ST envelope (nacl.secretbox). Generator return → SE envelope.

### Bidirectional — `streaming: 'bidirectional'`

Both sides push chunks simultaneously. Native transport only. An A2A caller gets `failed: { code: 'requires-native-transport' }`.

```js
// Handler
defineSkill('voice-channel', async function* (parts, { stream }) {
  yield [DataPart({ status: 'connected' })];
  for await (const inParts of stream.incoming) {
    yield [DataPart({ echo: Parts.data(inParts) })];
  }
}, { streaming: 'bidirectional' });

// Caller
const task = await agent.call(peerId, 'voice-channel', [DataPart({ room: 'main' })]);
task.send([DataPart({ audio: '...' })]);
for await (const parts of task.stream()) {
  playAudio(Parts.data(parts).audio);
}
```

**Over native**: two interleaved ST/SE streams, one per direction, on the same session key. Each side sends SE independently.

### Streaming mode summary

| Mode | `streaming` value | A2A | Native | Use case |
|------|------------------|-----|--------|----------|
| Off | `false` (default) | ✓ | ✓ | Request/response |
| Unidirectional | `'unidirectional'` | ✓ SSE | ✓ ST envelopes | Live feed, LLM output |
| Bidirectional | `'bidirectional'` | ✗ | ✓ dual ST | Audio, interactive sessions |

`streaming: true` is treated as `'unidirectional'` for backwards compatibility.

---

## Messaging

`messaging.js` carries OW (one-way) envelopes — fire and forget. Unchanged. Available on all native transports and, via `sendOneWay`, on A2A peers (task submitted, response ignored).

```js
await agent.message(peerId, [TextPart('Hello')]);
// or plain object: auto-wrapped to [DataPart({...})] for A2A peers
```

Messaging remains a first-class pattern. For structured interactions, task exchange is preferred because it has delivery confirmation and result collection.

---

## File sharing

Two modes. SDK selects automatically based on peer type and file size.

```js
// Same call for any peer — SDK picks the wire protocol:
await agent.call(peerId, 'upload', [
  FilePart({ mimeType: 'application/pdf', name: 'doc.pdf', data: fileBuffer })
]);

// Handler receives fully assembled FilePart regardless of wire protocol:
async function handler(parts) {
  const [file] = Parts.files(parts);
  // file.data is the complete buffer
}
```

| Condition | Wire protocol | A2A compatible |
|-----------|--------------|----------------|
| A2A peer, any size | FilePart (inline or URL) | ✓ |
| Native peer, < 256 KB | FilePart inline | — |
| Native peer, ≥ 256 KB | Acknowledged BulkTransfer (BT/AK) | Native only |

`BulkTransfer` provides chunked transfer with per-chunk ACKs and resume-on-failure. It is invisible to skill handlers and callers.

---

## Pub-sub

`pubSub.js` continues to handle PB envelopes for native peers. For A2A peers, pub-sub is the built-in `subscribe` skill (streaming task).

```js
// Native: publish
await agent.publish(topic, [DataPart(event)]);

// Native: subscribe (PB envelopes)
agent.subscribe(topic, (parts) => console.log(Parts.data(parts)));

// A2A or native via task API: subscribe skill
const task = await agent.call(peerId, 'subscribe', [DataPart({ topic: 'events' })]);
for await (const parts of task.stream()) {
  console.log(Parts.data(parts));
}
```

The `subscribe` skill wraps the native pub-sub mechanism and exposes it over the task/streaming model. It is A2A compatible.

---

## Session

Sessions remain native-only. They are exposed as built-in skills so they appear in the agent card with a clear native-only flag.

```js
// Open a session
const session = await agent.call(peerId, 'session-open',
  [DataPart({ label: 'interactive' })]);

// Send on an open session
await agent.call(peerId, 'session-message',
  [DataPart({ sessionId: session.id, text: 'Hello' })]);

// Close
await agent.call(peerId, 'session-close',
  [DataPart({ sessionId: session.id })]);
```

An A2A caller attempting `session-open` receives `failed: { code: 'requires-native-transport' }`.

---

## Built-in skills

The SDK registers these automatically at startup. They appear in the agent card alongside developer-defined skills.

| Skill id | `streaming` | A2A | Description |
|----------|-------------|-----|-------------|
| `subscribe` | `'unidirectional'` | ✓ | Stream events on a topic until cancelled |
| `file` | `false` | ✓ | File transfer (FilePart or BT, auto-selected) |
| `session-open` | `false` | ✗ | Open a bidirectional session channel |
| `session-message` | `false` | ✗ | Send a message on an open session |
| `session-close` | `false` | ✗ | Close a session |

Disable or restrict a built-in:
```yaml
skills:
  session-open:
    enabled: false
  subscribe:
    visibility: authenticated
```

---

## A2A compatibility summary

| Pattern | A2A compatible | Notes |
|---------|---------------|-------|
| Task exchange | ✓ | Core A2A model |
| Unidirectional streaming | ✓ | SSE on A2A, ST envelopes on native |
| Bidirectional streaming | ✗ | Native only — clear error for A2A callers |
| `input-required` negotiation | ✓ | Native A2A state |
| File transfer (FilePart) | ✓ | Inline or URL |
| File transfer (BulkTransfer) | ✗ | Native only — auto-selected by SDK |
| Pub-sub via `subscribe` skill | ✓ | SSE stream |
| Sessions | ✗ | Native only |
| Messaging (OW) | Partial | No reply, no delivery confirmation |

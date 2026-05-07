# Developer Guide

Quick-start for building an agent with this SDK. All interactions are tasks. All payloads are typed Parts. Whether the caller is an A2A agent over HTTP or a native agent over NKN, the code is the same.

---

## Installation

```bash
npm install @canopy/core
```

---

## Define skills

```js
import { defineSkill, TextPart, DataPart, Parts } from '@canopy/core';

const summarise = defineSkill('summarise',
  async (parts, { peer }) => {
    const text = Parts.text(parts) ?? Parts.data(parts)?.text;
    return [TextPart(`Summary: ${text.slice(0, 200)}...`)];
  },
  {
    description: 'Returns a short summary of any text input.',
    inputModes:  ['text/plain', 'application/json'],
    outputModes: ['text/plain'],
    tags:        ['nlp'],
    visibility:  'public',
    policy:      'on-request',
  }
);
```

`defineSkill(id, handler, opts)` returns a skill definition object. The handler signature is always `(parts, context) → parts | coercible-value`.

The `opts` object combines A2A card metadata and our access-control metadata. Only `visibility` and `policy` are internal — everything else goes into the agent card.

---

## Create and start an agent

```js
import { Agent } from '@canopy/core';

const agent = new Agent({
  id:    'my-agent',
  label: 'My Agent',

  a2a: {
    enabled:   true,
    url:       'https://relay.example.com/agents/my-agent',
    serveHttp: true,
    httpPort:  3000,
  },

  connections: {
    nkn:   { address: 'abc123.nkn' },
    relay: { url: 'wss://relay.example.com' },
  },

  skills: [summarise],
});

await agent.start();
// Serves A2A card at http://localhost:3000/.well-known/agent.json
// Connects to NKN and relay transports
```

---

## Call any peer — native or A2A, same API

```js
// Native peer (identified by pubKey or id):
const task = await agent.call('peer-pubkey', 'summarise',
  [TextPart('Long article text...')]);

// A2A peer (identified by URL — card fetched automatically):
const task = await agent.call('https://other.example.com', 'summarise',
  [TextPart('Long article text...')]);

// Wait for result:
const result = await task.done();
console.log(Parts.text(result.artifacts[0].parts));
```

`agent.call()` returns a `Task` object immediately. `task.done()` waits for `completed` or throws on `failed`. The routing (native vs A2A, which transport) is invisible.

---

## Unidirectional streaming skill (A2A compatible)

Server pushes chunks to client. Works over both A2A (SSE) and native (ST envelopes).

```js
const liveFeed = defineSkill('live-feed',
  async function* (parts) {
    const { topic } = Parts.data(parts);
    for await (const event of subscribeToEvents(topic)) {
      yield [DataPart(event)];
    }
  },
  {
    description:  'Streams real-time events as they occur.',
    outputModes:  ['application/json'],
    streaming:    'unidirectional',
    visibility:   'public',
    policy:       'negotiated',
  }
);
```

```js
const task = await agent.call(peerId, 'live-feed', [DataPart({ topic: 'weather' })]);
for await (const parts of task.stream()) {
  console.log(Parts.data(parts));
}
```

---

## Bidirectional streaming skill (native only)

Both sides push chunks simultaneously. Only available to native peers — A2A callers receive a clear error.

```js
const voiceChannel = defineSkill('voice-channel',
  async function* (parts, { stream }) {
    yield [DataPart({ status: 'connected' })];

    for await (const incomingParts of stream.incoming) {
      const { audio } = Parts.data(incomingParts);
      yield [DataPart({ audio: processAudio(audio) })];
    }
  },
  {
    description: 'Bidirectional audio channel.',
    streaming:   'bidirectional',   // native only
    visibility:  'authenticated',
  }
);
```

```js
const task = await agent.call(peerId, 'voice-channel', [DataPart({ room: 'main' })]);

task.send([DataPart({ audio: captureAudio() })]);   // push to handler
for await (const parts of task.stream()) {
  playAudio(Parts.data(parts).audio);               // receive from handler
}
```

---

## File transfer

```js
// Sending a file — SDK picks FilePart (A2A) or Acknowledged BT (native, large files):
await agent.call(peerId, 'upload', [
  FilePart({ mimeType: 'application/pdf', name: 'report.pdf', data: fileBuffer })
]);

// Receiving a file in a skill handler — always receives assembled FilePart:
const uploadSkill = defineSkill('upload',
  async (parts) => {
    const [file] = Parts.files(parts);
    await saveFile(file.name, file.data);
    return [DataPart({ saved: true })];
  },
  { inputModes: ['application/pdf', 'application/octet-stream'] }
);
```

For A2A peers: file is inline base64 or a URL reference.
For native peers with files > 256 KB: SDK uses Acknowledged BulkTransfer (chunked + per-chunk ACKs) automatically. The handler receives identical Parts either way.

---

## Negotiation via `input-required`

A skill that needs clarification from the caller:

```js
const generate = defineSkill('generate',
  async function* (parts, { task }) {
    const data = Parts.data(parts) ?? {};

    if (!data.format) {
      // Pause and ask the caller a question
      const reply = yield task.requireInput([
        TextPart('What output format? (bullets / prose / json)')
      ]);
      data.format = Parts.text(reply);
    }

    const output = await generateContent(data.topic, data.format);
    return [TextPart(output)];
  },
  { description: 'Generates content in a specified format.', visibility: 'public' }
);
```

Caller handling `input-required`:

```js
const task = await agent.call(peerId, 'generate',
  [DataPart({ topic: 'climate change' })]);

task.on('input-required', async (questionParts) => {
  console.log(Parts.text(questionParts));  // "What output format?"
  await task.send([TextPart('prose')]);     // resume the task
});

const result = await task.done();
```

Over A2A: native A2A `input-required` state + `POST /tasks/:id/send`.
Over native: IR/RI envelope pair.
Same handler, same caller code.

---

## Load agent from file

```yaml
# agent.yaml
version: "1.0"
agent:
  id: my-agent
  label: My Agent
  a2a:
    enabled: true
    url: https://relay.example.com/agents/my-agent
    serveHttp: true
    httpPort: 3000
  connections:
    nkn:
      address: abc123.nkn
    relay:
      url: wss://relay.example.com
  skills:
    summarise:
      description: "Short summary of text input."
      inputModes: [text/plain]
      outputModes: [text/plain]
      visibility: public
      policy: on-request
    live-feed:
      description: "Real-time event stream."
      streaming: true
      visibility: public
      policy: negotiated
```

```js
const agent = await Agent.fromFile('./agent.yaml', {
  skills: [summarise, liveFeed],   // handlers registered here, metadata from YAML
});
await agent.start();
```

---

## Peer discovery

```js
// All known A2A peers
const a2aPeers = agent.peers.a2aAgents();

// Peers that have a specific skill (native or A2A)
const workers = agent.peers.withSkill('summarise');

// Best peer for a task spec (picks native over A2A if available)
const best = agent.peers.canHandle({ skill: 'summarise', streaming: false });

// Discover an A2A agent by URL (fetches card, stores in PeerGraph)
const record = await agent.discoverA2A('https://new-agent.example.com');
```

---

## Authentication for outbound A2A calls

```js
// Store a token — used automatically for all calls to this URL
await agent.storeA2AToken('https://other.example.com', 'eyJhbGci...');

// Calls now include: Authorization: Bearer eyJhbGci...
const task = await agent.call('https://other.example.com', 'summarise',
  [TextPart('...')]);
```

---

## Parts convenience — you rarely need to be explicit

For the common case of structured data, plain objects and strings auto-wrap:

```js
// These are equivalent:
await agent.call(peerId, 'summarise', [DataPart({ text: 'article' })]);
await agent.call(peerId, 'summarise', { text: 'article' });   // auto-wrapped

// Handler can also return plain values:
return 'Short summary.';          // → [TextPart('Short summary.')]
return { summary: 'Short...' };   // → [DataPart({ summary: 'Short...' })]
return [TextPart('Short...')];    // explicit, no wrapping
```

Use explicit Parts when you need to mix types (text + file), send a file, or need the `mimeType` field.

---

## What the developer never has to think about

- Whether a peer is native or A2A — `agent.call()` handles both
- nacl.box vs TLS — `RoutingStrategy` picks the right security path
- SSE vs envelope streaming — same `yield` in the handler, same `for await` on the caller
- `input-required` over HTTP vs envelope — same `task.requireInput()` / `task.send()` API
- Agent card serving — `A2ATransport` builds and serves it from the skill registry automatically
- Parts wrapping — pass plain objects or strings unless you need fine-grained control

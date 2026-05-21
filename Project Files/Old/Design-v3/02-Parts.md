# Parts

Parts are a typed payload layer that sits on top of the transport primitives. They are not a replacement for the existing payload model — plain objects continue to work for native-to-native interactions. Parts are the format A2A uses, so they become the preferred format when A2A compatibility matters.

---

## Why Parts

The existing transport system carries arbitrary JSON payloads. This works well for native agents that share a common understanding of payload shape. It creates a problem for A2A compatibility: A2A requires typed Parts, so every A2A interaction needs a translation step.

The solution is to make Parts available as a first-class option throughout the SDK, used natively in all interaction patterns when desired. When a developer uses Parts, the payload is already in the format A2A expects — no adapter needed. When a developer uses plain objects, the SDK auto-wraps them for A2A peers.

---

## Part types

```js
// TextPart — human-readable text
{ type: 'TextPart', text: 'Hello, world!' }

// DataPart — structured JSON (the default for agent-to-agent)
{ type: 'DataPart', data: { key: 'value', count: 42 } }

// FilePart — binary file with mime type
{ type: 'FilePart', mimeType: 'application/pdf', name: 'doc.pdf',
  data: '<base64>' }          // inline content
  // OR url: 'https://...'   // pre-uploaded reference

// ImagePart — image with mime type
{ type: 'ImagePart', mimeType: 'image/png', data: '<base64>' }
```

---

## `Parts.js` — utility module

```js
import { TextPart, DataPart, FilePart, ImagePart, Parts } from '@canopy/core';

// Constructors
TextPart('Hello')                   // → { type: 'TextPart', text: 'Hello' }
DataPart({ count: 42 })             // → { type: 'DataPart', data: { count: 42 } }

// Extraction helpers
Parts.text(parts)                   // first TextPart.text or null
Parts.data(parts)                   // merged DataPart.data fields or null
Parts.files(parts)                  // FilePart[] array
Parts.images(parts)                 // ImagePart[] array

// Auto-wrap (plain object/string → Part[])
Parts.wrap('hello')                 // → [TextPart('hello')]
Parts.wrap({ count: 42 })           // → [DataPart({ count: 42 })]
Parts.wrap([TextPart('a'), ...])     // → passes through unchanged
```

---

## Parts in interaction patterns

Parts can be used with all existing interaction patterns. The patterns themselves do not change — they carry whatever payload is given.

### Messaging

```js
// Native peer — plain object still works
await agent.message(peerId, { text: 'Hello' });

// Native peer — Parts also work
await agent.message(peerId, [TextPart('Hello')]);

// A2A peer — SDK auto-wraps to Parts if plain object given
await agent.message(a2aUrl, { text: 'Hello' });
// → internally: [DataPart({ text: 'Hello' })]
```

### Task exchange

```js
// Handler — receives whatever was sent (plain object or Parts)
agent.register('summarise', async (payload, ctx) => {
  // native caller sent plain object:
  if (!Array.isArray(payload)) {
    return { summary: payload.text.slice(0, 200) };
  }
  // A2A caller sent Parts:
  const text = Parts.text(payload) ?? Parts.data(payload)?.text;
  return [TextPart(`Summary: ${text.slice(0, 200)}`)];
});
```

The handler can work with either format. For new skills intended for both native and A2A callers, returning Parts is preferred — native agents receive them as-is, A2A agents receive them natively.

### Streaming

```js
// Streaming handler — yield plain values or Parts
agent.registerStream('live-feed', async function* (payload, ctx) {
  for await (const event of subscribeToEvents(payload.topic)) {
    yield [DataPart(event)];   // Parts preferred for A2A compatibility
    // OR: yield event;         // plain object, native peers only
  }
});
```

### File sharing

FilePart is the natural way to send files through the existing fileSharing pattern:

```js
await agent.sendFile(peerId, FilePart({
  mimeType: 'application/pdf',
  name:     'report.pdf',
  data:     fileBuffer
}));
```

For native peers with large files, the existing BulkTransfer mechanism handles chunking inside the transport layer. FilePart carries the assembled content. For A2A peers, the FilePart is sent inline in the task payload.

---

## Auto-wrap rules (when calling A2A peers)

When `agent.call()` targets an A2A peer, the payload is automatically wrapped to Parts if it is not already:

| Payload type | Auto-wrapped to |
|-------------|-----------------|
| `string` | `[TextPart(string)]` |
| `object` | `[DataPart(object)]` |
| `Part[]` | passed through unchanged |
| `Buffer` | `[FilePart({ data: base64(buffer) })]` |

Return values from skill handlers are unwrapped symmetrically when delivering to native callers, so native callers always receive what they expect regardless of what the handler returned.

---

## Parts do not change the transport layer

Parts are a payload format. The envelope's `payload` field carries them like any other object. SecurityLayer encrypts the Parts-containing payload with nacl.box exactly as it would any other payload. The transport layer has no awareness of Parts.

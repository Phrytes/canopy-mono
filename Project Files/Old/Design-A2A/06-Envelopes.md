# Envelopes and Transport Primitives

The transport layer is unchanged from `Design/03-Transport.md` — all transport implementations (NKN, MQTT, Relay, Rendezvous, mDNS, BLE, Internal, Local) work without modification. This document covers only the additions needed for the A2A-first task model: new envelope codes and the mapping between task states and transport primitives.

Read `Design/03-Transport.md` first. This document builds on it.

---

## The four primitives — still the foundation

The same four primitives carry all traffic. The task model sits above them and maps onto them automatically.

```js
sendOneWay(to, payload)           // OW — fire and forget
sendAck(to, payload, timeout)     // AS + AK — delivery confirmation
request(to, payload, timeout)     // RQ + RS — request/response
respond(to, replyToId, payload)   // RS — reply to a request
```

Skill handlers and callers never call these directly. `Agent.call()` and `A2ATransport` invoke them internally. The developer API is always task-based.

---

## Envelope format

Unchanged from `Design/03-Transport.md`, with three new pattern codes:

```js
{
  _v:     1,           // schema version
  _p:     'RQ',        // pattern code (see table below)
  _id:    'uuid-v4',   // unique message ID — dedup + correlation
  _re:    'uuid-v4',   // reply-to ID — present on RS, AK, RI; null otherwise
  _from:  'agentId',   // sender public key (or NKN address derived from it)
  _to:    'agentId',   // intended recipient
  _topic: 'string',    // pub-sub topic (PB only); null otherwise
  _ts:    1234567890,  // unix timestamp ms — replay window check
  _sig:   'base64',    // Ed25519 signature
  payload: <object>    // nacl.box ciphertext (plaintext for HI only)
}
```

---

## Pattern codes

| Code | Name | Direction | Description |
|------|------|-----------|-------------|
| `HI` | Hello | ↔ | Agent card exchange on connect. Signed, not encrypted. |
| `OW` | One-Way | → | Fire and forget. No response expected. |
| `AS` | Ack-Send | → | Sender wants delivery confirmation. |
| `AK` | Acknowledge | ← | Delivery confirmed. Empty payload. |
| `RQ` | Request | → | Sender wants a response with a result. |
| `RS` | Response | ← | Result reply to a request. |
| `PB` | Publish | → | Pub-sub broadcast to a topic. |
| `ST` | Stream-chunk | → | One chunk in an open stream. nacl.secretbox encrypted. |
| `SE` | Stream-end | → | Final chunk / stream close signal. |
| `BT` | Bulk-chunk | → | One chunk in an acknowledged bulk transfer. nacl.secretbox encrypted. |
| `IR` | Input-Required | ← | **New.** Handler needs more input. Carries question Parts. |
| `RI` | Reply-Input | → | **New.** Caller's reply to an IR. Carries answer Parts. |
| `CX` | Cancel | → | **New.** Caller cancels an in-progress task. |

---

## Task state → envelope mapping

The task state machine runs on top of the envelope layer. Each state transition maps to one or more envelope exchanges.

```
State transition          Native envelopes                       A2A HTTP
─────────────────────────────────────────────────────────────────────────────
Task submitted            RQ (caller → agent)                    POST /tasks/send
Policy check              (internal, no envelope)                (before HTTP response)
Task working              AK (agent → caller)                    { state: 'working' } in body
Unidirectional chunk      ST (agent → caller, secretbox)         SSE TaskStatusUpdate lastChunk:false
Final chunk / complete    SE + RS (agent → caller)               SSE TaskStatusUpdate lastChunk:true
                                                                 + final { state: 'completed' }
Bidirectional chunk       ST both directions simultaneously       (not supported over A2A)
Input-required pause      IR (agent → caller)                    { state: 'input-required', message: ... }
Caller reply              RI (caller → agent, re: IR._id)        POST /tasks/:id/send
Task resume               AK (agent → caller)                    { state: 'working' }
Task completed            RS (agent → caller)                    { state: 'completed', artifacts: [...] }
Task failed               RS with error DataPart                 { state: 'failed', error: {...} }
Task cancelled            CX (caller → agent)                    POST /tasks/:id/cancel
```

### IR and RI details

`IR` (Input-Required):
```js
{
  _p:      'IR',
  _re:     '<original RQ _id>',   // correlation with the task
  payload: { parts: [...] }       // the question Parts
}
```

`RI` (Reply-Input):
```js
{
  _p:      'RI',
  _re:     '<IR _id>',            // reply to the specific IR
  payload: { parts: [...] }       // the answer Parts
}
```

The task handler receives `RI.payload.parts` as the reply from `yield task.requireInput(...)`. Multiple IR/RI rounds are supported on the same task.

### CX details

`CX` (Cancel):
```js
{
  _p:      'CX',
  _re:     '<original RQ _id>',   // which task to cancel
  payload: {}
}
```

The receiving agent transitions the task to `cancelled`, cleans up the handler (generator `.return()` called), and does not send RS.

---

## Payload format inside envelopes

With the A2A-first model, all task payloads carry Parts arrays. The envelope `payload` field contains:

```js
// For RQ (task submitted):
{ taskId: 'uuid', skillId: 'summarise', parts: [...] }

// For RS (task completed):
{ taskId: 'uuid', state: 'completed', artifacts: [{ name, parts }] }

// For RS (task failed):
{ taskId: 'uuid', state: 'failed', error: { code, message, parts } }

// For ST (stream chunk):
{ taskId: 'uuid', seq: 42, parts: [...], final: false }

// For SE (stream end — final chunk or standalone close):
{ taskId: 'uuid', seq: 43, parts: [...], final: true }

// For IR (input required):
{ taskId: 'uuid', parts: [...] }   // question Parts

// For RI (reply input):
{ taskId: 'uuid', parts: [...] }   // answer Parts

// For HI (hello) — plaintext, not encrypted:
{ pubKey, skills, label, connections }
```

Non-task envelopes (OW, AS, PB) carry their original payloads unchanged. Parts are only present in task-related codes.

---

## Bidirectional streaming — envelope detail

Two interleaved ST/SE streams, one per direction, sharing the same session key (derived from `nacl.box.before(peerPubKey, myPrivKey)` established at hello).

Each direction uses a distinct `streamId` (a UUID generated at stream open). The nonce for each chunk is `streamId_16bytes ‖ seqNumber_8bytes` — the same scheme as unidirectional, applied per direction independently.

```
caller → agent: ST { taskId, streamId: 'caller-stream-id', seq: 0, parts: [...] }
agent → caller: ST { taskId, streamId: 'agent-stream-id',  seq: 0, parts: [...] }
caller → agent: ST { taskId, streamId: 'caller-stream-id', seq: 1, parts: [...] }
...
caller → agent: SE { taskId, streamId: 'caller-stream-id', seq: N, final: true }
agent → caller: SE { taskId, streamId: 'agent-stream-id',  seq: M, final: true }
```

The task completes when both SE envelopes have been received (or either side cancels with CX).

---

## Transport support matrix (updated)

| Pattern | Internal | NKN | MQTT | Rendezvous | Relay | mDNS | BLE | A2A (HTTP) |
|---------|----------|-----|------|------------|-------|------|-----|------------|
| Task (RQ/RS) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Unidirectional stream | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ slow | ✓ SSE |
| Bidirectional stream | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ slow | ✗ |
| Input-required (IR/RI) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ native A2A |
| Cancel (CX) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| File (BT) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ slow | FilePart only |
| Hello (HI) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | card fetch |
| Pub-sub (PB) | ✓ | emulated | native | emulated | emulated | emulated | emulated | streaming task |
| sendOneWay (OW) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | task with no reply |

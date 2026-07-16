# @onderling/protocol

State-machine substrate. Multi-step processes (negotiation,
propose-subtask, calendar accept) modelled as state machines over
items, with state persisted on the pseudo-pod.

> Standardisation Phase **52.13** — direction-only. V0 ships **one
> canonical consumer** (`propose-subtask`) so the API gets shaped
> against a real load-bearing case before opening to other apps.

---

## Quick start

```js
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import {
  createProtocolOrchestrator,
  PROPOSE_SUBTASK,
} from '@onderling/protocol';

const pseudoPod = createPseudoPod({
  backend:  createMemoryBackend(),
  mode:     'standalone',
  deviceId: 'laptop-anne',
});

const protocol = createProtocolOrchestrator({
  pseudoPod,
  deviceId: 'laptop-anne',
});
protocol.registerProtocol(PROPOSE_SUBTASK);

const instance = await protocol.start('propose-subtask', {
  proposer:     'agent://anne',
  assignee:     'agent://bob',
  parentTaskId: 'task-paint-fence',
  body:         'please pick up the paint first',
});
// instance.state === 'proposed'

await protocol.step(instance.instanceId, 'accept', {
  actor:     'agent://bob',
  subtaskId: 'task-buy-paint',
});
// state → 'accepted'

protocol.subscribe(instance.instanceId, (event) => {
  console.log('transition:', event.from, '→', event.instance.state);
});
```

---

## Defining a protocol

```js
import { defineProtocol } from '@onderling/protocol';

const NEGOTIATE = defineProtocol({
  id:      'negotiate',
  name:    'Two-party negotiation',
  initial: 'open',
  states:  ['open', 'agreed', 'rejected', 'withdrawn'],
  validators: {
    initial: (ctx) => typeof ctx?.subject === 'string',
  },
  transitions: [
    { from: 'open', event: 'agree',    to: 'agreed' },
    { from: 'open', event: 'reject',   to: 'rejected' },
    { from: 'open', event: 'withdraw', to: 'withdrawn',
      guard: (ctx, payload) => payload?.actor === ctx.initiator },
  ],
});
```

A protocol definition is **pure data** — no I/O, no side effects.
The orchestrator interprets it at runtime.

### Transitions

```text
{ from, event, to, guard?, reducer? }

from     — source state name (must be in `states`)
event    — event tag (free string)
to       — target state name (must be in `states`)
guard    — (context, payload?) => boolean
           pre-condition. False → transition rejected (GUARD_REJECTED).
reducer  — (context, payload?) => newContext (sync or async)
           pure(-ish) function producing the next context. Absent ⇒
           context carries over unchanged.
```

---

## Persistence

Each instance is stored as a JSON resource on the pseudo-pod at:

```text
pseudo-pod://<deviceId>/protocols/<protocolId>/<instanceId>
```

Survives orchestrator restart. A new orchestrator over the same
pseudo-pod reads the existing state via `read(instanceId)`.

Instance shape:

```json
{
  "protocolId": "propose-subtask",
  "instanceId": "abc123",
  "state":      "proposed",
  "context":    { … },
  "startedAt":  "2026-05-11T10:00:00Z",
  "updatedAt":  "2026-05-11T10:00:00Z",
  "history": [
    { "at": "…", "event": "accept", "from": "proposed", "to": "accepted" }
  ]
}
```

---

## API

```text
defineProtocol(def)                        → ProtocolDef (frozen)
findTransition(def, state, event)          → TransitionDef | null

createProtocolOrchestrator({ pseudoPod, deviceId, now?, makeId? })

orch.registerProtocol(def)
orch.start(protocolId, context = {})       → instance
orch.step(instanceId, event, payload?)     → instance (next)
orch.read(instanceId, protocolId?)         → instance | null
orch.subscribe(instanceId, cb)             → unsubscribe
```

### Error codes

| code | meaning |
|---|---|
| `INVALID_ARGUMENT`         | missing / malformed input                       |
| `UNKNOWN_PROTOCOL`         | protocol id not registered                      |
| `INSTANCE_NOT_FOUND`       | read/step against a missing instance            |
| `NO_TRANSITION`            | (state, event) doesn't match any transition     |
| `GUARD_REJECTED`           | transition guard returned false                 |
| `INVALID_INITIAL_CONTEXT`  | `validators.initial` rejected the start context |

---

## Canonical first consumer — `propose-subtask`

| State | Reachable from | Via event |
|---|---|---|
| proposed     | (initial) | — |
| accepted     | proposed  | `accept`   (guard: actor == assignee) |
| declined     | proposed  | `decline`  (guard: actor == assignee) |
| withdrawn    | proposed  | `withdraw` (guard: actor == proposer) |
| expired      | proposed  | `expire`   (TTL timer) |

Required initial context:

```js
{
  proposer:     '<agent-uri>',
  assignee:     '<agent-uri>',
  parentTaskId: '<task-id>',
  body:         '<the proposal text>',
}
```

---

## What V0 deliberately does not do

- **Cross-actor coordination.** A protocol instance lives on **one
  device**; the substrate persists state locally. Apps that need
  distributed state coordinate via `notify-envelope` events that
  drive `step` calls on each participant's local instance.
- **TTL timers.** `expire` is a regular event — apps wire their own
  timer that fires `step(id, 'expire')` when the TTL elapses.
- **Concurrent step protection.** V0 has no per-instance lock;
  concurrent `step` calls race on the pseudo-pod write. Apps that
  need atomicity wrap calls in a single async chain.
- **Visualisation / debug tooling.** Listing instances + drawing
  the state graph is the consuming app's job.
- **Branching transitions** (when multiple transitions match a
  single `(state, event)` pair). V0 picks the first match in
  declaration order — declare more-specific guards first.

---

## Files

```
packages/protocol/
├── index.js
├── src/
│   ├── defineProtocol.js     — pure declarative definition
│   ├── orchestrator.js       — createProtocolOrchestrator()
│   └── protocols/
│       └── propose-subtask.js — canonical first consumer
└── test/                      — 34 tests
```

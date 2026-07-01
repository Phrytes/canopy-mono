# @canopy/notifier

> **Layer: substrate.** Composes the `@canopy/core` SDK. Substrates MUST NOT reinvent SDK primitives (transports, vaults, auth, merge contracts, push, skill registries, identity, emitters, ULID); when the SDK *almost* fits, extend it additively rather than forking. See [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md). **Cross-substrate contract:** the push channel MUST compose `relay.ExpoPushSender` + `relay.PushTokenRegistry` (Phase 0 push send-half) and the chat channel MUST compose L1c chat-agent's `MessagingBridge` interface — do NOT redefine either.

Daily digest scheduler + per-event nudges + push integration.
Channel-pluggable; time-source pluggable for tests.

This is **L1f** in the substrate-first plan
(`Project Files/Substrates/L1f-notifier.md`).  Generalised from
H2's scheduler + nudge skills; designed by reading H2 V2 + H4
specs side-by-side.

---

## Quick start

```js
import { Notifier, PushChannel, InMemoryScheduleStore } from '@canopy/notifier';
// Channels for chat are L1c MessagingBridge instances — pass directly.
import { InMemoryBridge } from '@canopy/chat-agent';
// Push channel composes any relay.PushSender concrete.
import { ExpoPushSender } from '@canopy/relay';

const notifier = new Notifier({
  channels: {
    chat: chatAgent.bridge,                                       // any MessagingBridge
    push: new PushChannel({ pushSender: new ExpoPushSender() }),
  },
  store: new InMemoryScheduleStore(),
});

await notifier.start();

// Recurring daily digest (chat)
await notifier.schedule({
  id:         'household-digest',
  cadence:    { kind: 'daily', timeLocal: '20:00', tz: 'Europe/Amsterdam' },
  recipients: ['chat-anne', 'chat-bob'],     // each gets their own digest
  channel:    'chat',
  builder:    async (recipient) => ({ text: await composeDigestFor(recipient) }),
});

// Wire item-store events → notifier (subscribe targets a foreign emitter).
notifier.subscribe(itemStore, 'item-added', (item) => {
  notifier.scheduleOnce({
    triggerAt: Date.now() + 60 * 60 * 1000,    // 1 hour later
    recipient: item.addedByChatId,
    channel:   'chat',
    builder:   async () => ({ text: `Hey, did you finish ${item.text} yet?` }),
    cancelKey: `nudge-${item.id}`,
  });
});

notifier.subscribe(itemStore, 'item-completed', (item) => {
  notifier.cancel(`nudge-${item.id}`);
});

// Self-events (own emitter surface)
notifier.on('fired', ({jobId, recipient}) => { ... });

await notifier.stop();
```

---

## API surface

### `Notifier`

```ts
new Notifier({
  channels:        Record<string, Channel>,
  store?:          ScheduleStore,         // default InMemoryScheduleStore
  retryDelaysMs?:  number[],              // default [] (no retries)
  now?:            () => number,          // test seam
  setTimeoutFn?:   typeof setTimeout,     // test seam
  clearTimeoutFn?: typeof clearTimeout,   // test seam
})

await notifier.start()                     // re-arms timers from store
await notifier.stop()                      // clears timers + subscribers

await notifier.schedule({id, cadence, recipients[], channel, builder})  → jobId
await notifier.scheduleOnce({triggerAt, recipient, channel, builder, cancelKey?})  → jobId
await notifier.scheduleBefore({dueAt, leadMs, recipient, channel, builder, cancelKey?})  → jobId
await notifier.cancel(keyOrJobId)
await notifier.listJobs()                  // diagnostics

notifier.on(eventName, handler)            // own events ('fired' / 'error') — core.Emitter
notifier.subscribe(emitter, name, handler) // bridge events from a foreign emitter
                                           // (auto-cleaned on stop())
```

### Cadence shapes

```ts
{ kind: 'interval', intervalMs: 60_000 }
{ kind: 'hourly' }
{ kind: 'daily',  timeLocal: '20:00', tz: 'Europe/Amsterdam' }
```

### scheduleBefore — deadline / lend-return reminders

`scheduleBefore({ dueAt, leadMs, ... })` is sugar over
`scheduleOnce` for the common "fire X time before a target moment"
pattern (lend / borrow returns, RSVP nags, deadline reminders).
It computes `triggerAt = dueAt - leadMs` and delegates.

Idiomatic `cancelKey` shape is `'due:<itemId>'` so cancellation on
"mark returned" is a one-liner regardless of how many reminders
were scheduled:

```js
await notifier.scheduleBefore({
  dueAt:      item.dueAt,                  // ms epoch
  leadMs:     24 * 60 * 60 * 1000,         // 24 hours before
  recipient:  member.pushToken,
  channel:    'push',
  builder:    async () => ({ text: `Return ${item.text} tomorrow` }),
  cancelKey:  `due:${item.id}`,
});

// later, when the borrower marks the item returned:
await notifier.cancel(`due:${item.id}`);
```

If `dueAt - leadMs` is in the past the job fires on the next
arm pass (matches `scheduleOnce` semantics). Apps that want
different past-handling should compute their own `triggerAt`
and call `scheduleOnce` directly.

### Channel interface

A channel **IS** an `@canopy/chat-agent` `MessagingBridge` — the
same interface chat-agent already exposes for chat platforms:

```ts
interface MessagingBridge {
  id:        string;
  start():   Promise<void>;                                       // unused by notifier
  stop():    Promise<void>;                                       // unused by notifier
  onMessage(handler): void;                                       // unused by notifier
  sendReply(args: { chatId, text, buttons?, replyTo? }): Promise<void>;
}
```

The substrate ships only the non-chat channels:

- `NoopChannel` — accepts everything, sends nothing. Tests + "do nothing right now".
- `PushChannel` — wakes a recipient device via any `relay.PushSender` concrete (default: `ExpoPushSender`). The `chatId` is interpreted as a device push token; the payload follows `MobilePushBridge`'s `{skillId, parts}` convention so digest → push → wake-and-process is coherent end-to-end.

Chat-shaped channels are L1c bridges (`TelegramBridge`,
`InMemoryBridge`, …) — apps pass them directly into
`notifier.channels`. There is no `ChatChannel` adapter (the rename
was the layering violation the audit flagged).

### Boundaries

Notifier is **application-layer** scheduling — typed `Job` records,
cadence semantics, builder closures that read pod state at fire-time.
It is **not** a transport-layer queue. The relay's per-peer offline
buffer (`packages/relay/src/server.js`) is transport-layer — opaque
envelopes, ~5 min TTL, "if the peer reconnects soon, deliver these."
If a `PushChannel` delivery can't land because the relay is briefly
disconnected, the relay's queue handles it. If the recipient is
offline for hours and the next daily digest fires, notifier creates
a fresh job. The two are complementary.

### Events

`Notifier` extends `core.Emitter`.  Self-events use plain
`notifier.on(eventName, handler)`; foreign-emitter subscriptions use
`notifier.subscribe(emitter, eventName, handler)` (and are
auto-removed on `stop()`).

| Event | Payload | When |
|---|---|---|
| `fired` | `{jobId, kind, recipient}` | each successful delivery |
| `error` | `{jobId, error, recipient?}` | channel error, unknown channel, or builder error |

---

## Architecture

```
schedule / scheduleOnce
            │
            ▼
       ┌────────────┐
       │ ScheduleStore │ ← persists Job records (in-mem default)
       └────────────┘
            │
            ▼
       arm setTimeout
            │
       ┌────▼─────┐
       │   fire    │ ← runner: looks up job, calls builder, delivers
       └───┬───────┘
           │
           ▼
       channel.sendReply → external delivery
           │
           ▼
       (recurring) re-arm next; (once) remove + done
```

Time source pluggable via constructor (defaults to `Date.now` /
`setTimeout`).  Tests typically use a fake time source +
controllable `advance()` helper.

---

## V0 simplifications

- **No retries by default.**  Pass `retryDelaysMs: [1000, 5000, 30_000]` if you want them.  Per-channel retry semantics + nested fake-timer testing is finicky; V0 prefers explicit failure to silent retry.
- **`InMemoryScheduleStore` is the default store.**  Restart loses pending jobs unless apps wire `PodScheduleStore` (`./stores/pod`) — that's the restart-survival path and ships in this package.
- **Daily cadence is TZ-aware** when `cadence.tz` is set (uses `nextDailyFireInTz`); otherwise runtime-local.
- **`PushChannel` is shipped** (post-Phase 6, 2026-05-04) over `relay.PushSender`. Apps wire `ExpoPushSender` (or any `PushSender` concrete) themselves.
- **No batching / coalescing.**  Multiple nudges within seconds of each other all fire separately.

---

## Pattern source

Generalised from `apps/household/src/scheduler/{Scheduler.js,
NudgeTimer.js, DailyDigest.js}` and
`apps/household/src/skills/{nudgeCompletion,composeDigest}.js`.

When `apps/household` migrates to consume substrates (Phase C),
the existing scheduler retires.

---

## See also

- `Project Files/Substrates/L1f-notifier.md` — substrate sketch.
- `@canopy/chat-agent` — supplies the `MessagingBridge` typedef + `InMemoryBridge` test fake. Apps pass any bridge directly as a notifier channel.
- `@canopy/relay` — supplies `PushSender` (abstract) + `ExpoPushSender` (concrete) for `PushChannel`.
- `@canopy/item-store` — emits `item-added` etc. that notifier subscribes to.
- `Project Files/Substrates/apps/H2-household.md` — primary consumer (digest + nudge).
- `Project Files/Substrates/apps/H4-tasks.md` — secondary consumer (deadline reminders, stalled-claim nudges).

# L1f (notifier) — digest + nudge + push

> **Refactored 2026-05-04 (Phase 6).** The pre-refactor V0
> `Channel` interface + `ChatChannel` + `RecordingChannel` + private
> `ulid()` were all deleted as duplicates of L1c's `MessagingBridge` /
> `InMemoryBridge` + `core.genId`. The substrate now: (a) aliases
> `Channel` to L1c's `MessagingBridge` (apps pass their bridge
> directly into `notifier.channels` — `TelegramBridge`,
> `InMemoryBridge`, `PushChannel`, etc.); (b) ships a real
> `PushChannel` over `relay.PushSender` (Phase 0 push send-half is
> what made this real instead of a stub); (c) replaced
> `notifier.on(emitter, name, handler)` overload with a clean
> `notifier.subscribe(emitter, name, handler)` distinct from
> `Emitter.on`. SDK barrel got an additive `genId` re-export.

| | |
|---|---|
| **Package** | `@canopy/notifier` (v0.4.0 post-refactor) |
| **Status** | shipped — Phase 6 of substrate refactor |
| **Driven by** | H2 (household V2) primary; H4 (tasks V0) secondary |
| **Pattern source** | `apps/household/src/skills/{nudgeCompletion,composeDigest}.js` + scheduler patterns from H2's plan |
| **RN variant?** | **No** — substrate is platform-agnostic. Push send-half lives in `@canopy/relay` (`ExpoPushSender`); receive-half lives in `@canopy/react-native` (`MobilePushBridge`). Notifier composes the send-half via `PushChannel`, never imports the RN module directly. |
| **Channel surface** | `MessagingBridge` from `@canopy/chat-agent` — alias `Channel` re-exports it. |

---

## What it is

A substrate for **scheduled and event-triggered notifications**:
daily digest at a configurable cadence, per-event nudges
(e.g. "what got done?" 1 hour after item add), and push integration
(when E2c — the Track E push relay — lands).

Apps configure cadence, message templates, and which events
trigger nudges; the substrate handles scheduling, delivery
attempts, and retry logic.

---

## Consumer specs driving the design

- **Primary: H2 (household V2).**  Daily digest at 20:00 local, configurable per household (Q-H2.7).  Per-activity nudge 1 hour after last add (configurable).  Bot DMs each member separately.
- **Secondary: H4 (tasks V0).**  Deadline reminders ("task X due tomorrow"), stalled-claim nudge ("you claimed task Y N days ago, still planning to do it?").  Same scheduler primitives.

H5 (matchmaking notifications when someone responds to your
request) and H8 (witness wake when a presence challenge arrives)
are tertiary consumers — both fit the same scheduler/dispatcher
shape.

---

## Public API shape (post-Phase 6)

```ts
import { Notifier, PushChannel, NoopChannel } from '@canopy/notifier';
import { InMemoryBridge }                     from '@canopy/chat-agent';
import { ExpoPushSender }                     from '@canopy/relay';

const notifier = new Notifier({
  channels: {
    // Chat channels are L1c MessagingBridge instances — pass directly.
    chat:  chatAgent.bridge,                          // TelegramBridge / InMemoryBridge / …
    // Push channel composes any relay.PushSender concrete.
    push:  new PushChannel({ pushSender: new ExpoPushSender() }),
    // No-op for tests / "do nothing here right now".
    silent: new NoopChannel(),
  },
  store: ...,    // optional ScheduleStore for persistence (PodScheduleStore for prod)
});

// Schedule a recurring job (digest)
await notifier.schedule({
  id:        'household-digest',
  cadence:   {kind: 'daily', timeLocal: '20:00', tz: 'Europe/Amsterdam'},
  recipients: [...chatIds],     // opaque to notifier; channel interprets
  channel:   'chat',
  builder:   async (recipient) => ({text: '...', buttons: [...]}),
});

// Schedule a one-shot nudge tied to an event
await notifier.scheduleOnce({
  triggerAt: timestamp,
  recipient: chatId,            // for chat channel; would be a push token for 'push'
  channel:   'chat',
  builder:   async () => ({text: '...'}),
  cancelKey: `item-nudge-${itemId}`,
});

// Cancel a scheduled job
await notifier.cancel(cancelKey);

// React to events from other substrates (e.g. itemStore from L1b)
notifier.subscribe(itemStore, 'item-added', (item) => {
  notifier.scheduleOnce({
    triggerAt: Date.now() + 60 * 60 * 1000,
    recipient: item.addedBy,
    channel:   'chat',
    builder:   async () => ({text: `Hey, did you finish ${item.text} yet?`}),
    cancelKey: `nudge-${item.id}`,
  });
});

// Cancel nudges when items complete
notifier.subscribe(itemStore, 'item-completed', (item) => {
  notifier.cancel(`nudge-${item.id}`);
});

// Self-events (own emitter surface)
notifier.on('fired', ({jobId, recipient}) => { ... });
notifier.on('error', ({jobId, error})     => { ... });
```

**`recipient` semantics.** The recipient string is opaque to the
notifier — the **channel** interprets it. `MessagingBridge`
implementations (TelegramBridge, InMemoryBridge) interpret it as
`chatId`; `PushChannel` interprets it as a device push token; future
`EmailChannel` would interpret it as an email address. webid →
identifier resolution is the consuming **app's** responsibility,
typically via L1h identity-resolver — the notifier itself never does
this resolution.

---

## Scheduler internals

- **In-process job table** with TTL eviction; persisted to pod via
  `scheduleStore` so a restart doesn't lose jobs.
- **Time source pluggable** for testing (default: `Date.now`).
- **Delivery attempts retry** with exponential backoff if the
  channel reports a transient failure.
- **No CPU-heavy primitives** — substrate is small (~500 LOC); no
  cron-library dependency, just a self-contained scheduler.

---

## Channels (post-Phase 6)

A channel **IS** an `@canopy/chat-agent` `MessagingBridge` (the
notifier's `Channel` typedef is a type alias for it). The substrate
itself ships only the non-chat channels:

- **`NoopChannel`** — accepts everything, sends nothing. Tests + "do nothing right now" scenarios.
- **`PushChannel`** — wakes a device via any `relay.PushSender` concrete (default: `relay.ExpoPushSender`). Payload follows `MobilePushBridge`'s convention (`{skillId, parts}`) so digest → push → wake-and-process is coherent end-to-end. The `recipient` argument is interpreted as a **device push token** (whatever `MobilePushBridge.register()` returned). webid → token resolution is the app's job.

Chat-shaped channels are L1c bridges (`TelegramBridge`, `InMemoryBridge`, etc.) — apps pass them directly. There is no `ChatChannel` adapter anymore; the rename was the entire reason the audit flagged this as a layering violation.

Future channels (V1+):
- Email (via SMTP or SES).
- Webhook.
- In-app banner (apps with their own UI surface).

Each future channel is just another `MessagingBridge` implementation.

---

## Dependencies

- **`@canopy/core`** — `Emitter` (notifier extends it; replaces Node's `events`), `genId` (jobId for `scheduleOnce`).
- **`@canopy/chat-agent`** — `MessagingBridge` typedef (the `Channel` alias). Type-only at runtime; tests pull `InMemoryBridge` as the canonical chat-channel test fake. Listed in `package.json` as devDependency (not runtime dep — apps inject the bridge).

### Optional integration (composed at the app layer)

- **`@canopy/relay`'s `PushSender`** — `PushChannel` accepts any `PushSender` concrete (`ExpoPushSender` is the v0 default). The substrate doesn't import relay directly; apps wire it.
- **`@canopy/pod-client`** — for `PodScheduleStore` (ships in `./stores/pod`). Apps pass a duck-typed `PodClient` instance; substrate works without it (default `InMemoryScheduleStore`).
- **L1h (identity-resolver)** — for webid → recipient-identifier resolution (chatId / push token / email). Notifier never imports L1h; apps thread the resolution before calling `notifier.schedule`.

### Boundaries (NOT dependencies, but worth noting)

- **`@canopy/relay`'s offline queue** is transport-layer (per-peer, ~5 min TTL, opaque envelopes). Notifier is application-layer (typed `Job` records, cadence semantics). Idempotent push delivery at the (jobId, fireAt) tuple is the channel implementer's responsibility when the boundaries meet.

---

## RN variant

**No.** The notifier is platform-agnostic; it has no `index.rn.js`.

Push in the SDK is now a clean two-substrate split:
- **Send-half** lives in `@canopy/relay` (`ExpoPushSender` + `PushTokenRegistry`). Notifier composes this through `PushChannel`.
- **Receive-half** lives in `@canopy/react-native` (`MobilePushBridge` + `PushAdapter` + `ExpoNotificationsAdapter`). Apps wire this on the device.

Notifier never imports either. The wire-shape contract — `{skillId, parts}` payload → `MobilePushBridge` → skill dispatch — is documented in `PushChannel.js` and `MobilePushBridge.js` so the two halves stay coherent.

---

## Open questions

1. **Time-zone handling.**  Daily-digest at "20:00 local" — local to whom?  Lean: local to each recipient member based on their stored TZ preference; no preference → falls back to household's default TZ.
2. **Schedule persistence shape.**  Pod-stored vs local-only?  If pod-stored, multiple processes risk double-firing.  Lean: pod-stored with a "claim lock" — first agent to claim the job runs it.
3. **Cancellation semantics.**  When an item is removed (not completed), do its associated nudges cancel?  Lean: yes — implement via L1b's `item-removed` event.
4. **Digest content building.**  H2 wants a markdown summary of open items; H4 wants a "claimed-but-not-done" list.  These are app-level builder functions; substrate doesn't need to know their content.  Confirmed pattern: `builder` callback.
5. **Digest delivery failure.**  If a member's chat session is offline, does the digest queue or drop?  Lean: queue with a 24-hour TTL; if not delivered within 24h, drop and log.

---

## Pattern sources

- **`apps/household/src/skills/{nudgeCompletion,composeDigest}.js`** — current logic patterns.
- **`apps/household/src/agent/Scheduler.js`** (if it exists) — scheduler internals.
- H2 v2's **Q-H2.7** lock — cadence default.

---

## Out of scope for V0

- Real push (E2c dependency).
- Email channel.
- Webhook channel.
- Cross-channel routing ("try chat first, fall back to email").
- Notification batching (multiple nudges within N minutes coalesced).
- User-facing "do not disturb" / quiet hours config.

These are all V1+ once a real consumer demands them.

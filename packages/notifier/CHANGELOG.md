# Changelog — @canopy/notifier

Versioning per `Project Files/Substrates/policies.md`.

## [0.4.0] — 2026-05-04

Phase 6 of the substrate-vs-SDK refactor (per `Project Files/Substrates/refactor/L1f-notifier-refactor.md`).
Aligns L1f with L1c chat-agent's `MessagingBridge`, deletes duplicated
SDK primitives, and ships a real `PushChannel` over `relay.PushSender`.

### Breaking

- **`Channel` is now an alias for `MessagingBridge`** from
  `@canopy/chat-agent`. Channel implementations must expose
  `id`, `sendReply({chatId, text, buttons?, replyTo?})`, and the
  inbound `start`/`stop`/`onMessage` lifecycle (no-ops are fine for
  send-only channels). Notifier internals now call
  `channel.sendReply({chatId: <recipient>, ...})` instead of
  `channel.deliver({recipient, ...})`.
- **`ChatChannel` deleted.** Apps pass any `MessagingBridge` instance
  directly: `channels: { chat: chatAgent.bridge }` or any
  `TelegramBridge` / `InMemoryBridge`.
- **`RecordingChannel` deleted.** Tests use `InMemoryBridge` from
  `@canopy/chat-agent` (same shape: outbox + clearOutbox).
- **`notifier.on(emitter, name, handler)` overload removed.** Use
  `notifier.subscribe(emitter, name, handler)` for foreign-emitter
  subscriptions; plain `notifier.on(name, handler)` is the own-event
  surface (`'fired'`, `'error'`).
- **`jobId` format changed** from 26-char Crockford ULID to UUID v4
  (via `core.genId`). No code in notifier or any consumer parses
  jobId; downstream is unaffected.
- **`./channels/chat` subpath export removed.** New subpath:
  `./channels` (exports `NoopChannel` + `PushChannel`).

### Added

- **`PushChannel`** at `./channels` — wakes a recipient device via
  any `relay.PushSender` concrete (default: `ExpoPushSender`).
  Payload shape follows `MobilePushBridge`'s `{skillId, parts}`
  convention so digest → push → wake-and-process is coherent
  end-to-end. The `chatId` field is the device push token; webid →
  token resolution is the consuming app's job.
- **`subscribe(emitter, name, handler)`** — clean foreign-emitter
  bridge with auto-cleanup on `stop()`. 8 new `PushChannel` tests
  (40 total notifier tests pass).

### Changed

- **`Notifier extends core.Emitter`** (was already aligned in Phase 2;
  this release removes the brittle `on()` overload that needed Node's
  `events.EventEmitter` to disambiguate).
- **`@canopy/core` becomes the only runtime dep.** `@canopy/chat-agent`
  is a devDependency for tests (`InMemoryBridge`); the runtime alias
  uses jsdoc only, so apps don't pull chat-agent transitively.

### SDK additive change shipped along the way

- **`core.genId` is now barrel-exported** from `@canopy/core` (was
  only available via the internal `Envelope.js` subpath). Substrates +
  apps can now `import { genId } from '@canopy/core'` directly.

## [0.3.0] — 2026-05-02

Closes Task #14 (pod-backed scheduleStore — was deferred at L1f V0
pending Track A maturity; Track A is now real).

### Added

- **`PodScheduleStore`** at `./stores/pod` — implements the
  `ScheduleStore` interface against a pod URI.  Persists jobs to a
  single JSON blob; lazy-loads on first call; mutations flush the
  whole blob.
- **Builder restoration** via constructor `builderResolver(persisted) → builder`
  — apps reconstruct the non-serialisable `builder` closure on load,
  typically by dispatching on `metadata.kind`.  Without a resolver,
  jobs load with a stub builder (useful for tests).
- 17 Vitest tests covering construction, first-use flush behaviour,
  restore from prior data, builder-resolver round-trip, lazy load,
  concurrent-load coalescing, corrupt-JSON tolerance, and full
  write-then-fresh-read recovery.

### Notes for consumers

- Single-writer model.  Two `PodScheduleStore` instances writing the
  same URI race; layer locking on top if you need multi-writer.
- Every `put` / `remove` / `removeByCancelKey` writes the full blob.
  Fine at household scale (tens to low hundreds of jobs); not tuned
  for thousands.

## [0.2.0] — 2026-05-02

First rule-of-two pull on L1f from a real consumer (household app's DailyDigest).

### Added

- **`nextDailyFireInTz(nowMs, tz, atLocal)`** — TZ-aware "next fire in IANA timezone" math.  Pure, no deps; uses Intl.DateTimeFormat.  Ported from `apps/household/src/scheduler/DailyDigest.js` (the H2 V0 implementation).
- **Daily cadence with `tz`** — `Notifier`'s `daily` cadence now honours `cadence.tz` (defaults to runtime-local when absent).  Callers passing IANA timezones (`'Europe/Amsterdam'`, etc.) get proper next-fire computation across DST boundaries.

### Tests

5 new tests for `nextDailyFireInTz` (Europe/Amsterdam, UTC, America/New_York, malformed input).  10 existing Notifier tests continue to pass.  Total: 15.

### Driven by

`apps/household/src/scheduler/DailyDigest.js` demanded TZ-aware cadence (Q-H2.7: digest at 20:00 Europe/Amsterdam).  V0 didn't ship this; substrate adopted it as the rule-of-two pulled.

### Known gaps (deferred to V1)

- Notifier's "channel + recipient + builder" abstraction is over-kill for household's "just fire onFire" use case.  V1 may add `scheduleCallback({triggerAt, callback, cancelKey?})` as a lighter-weight primitive.  Until then, household's NudgeTimer + Scheduler stay self-hosted (consume only the TZ helper, not the full Notifier).

## [0.1.0] — 2026-05-02

Initial release.  L1f substrate (Phase B step 3 of the substrate-first plan; paired with L1c).

### Added

- **`Notifier`** core class — `schedule` (recurring) / `scheduleOnce` (one-shot) / `cancel` / `listJobs`.
- **Generic external-emitter subscription** via `notifier.on(emitter, eventName, handler)` — auto-cleaned on `stop()`.
- **Channel-pluggable delivery** — `ChatChannel`, `NoopChannel`, `RecordingChannel` ship.
- **`InMemoryScheduleStore`** — Map-backed; lost on restart.
- **Time source pluggable** for tests (`now`, `setTimeoutFn`, `clearTimeoutFn`).
- Cadence shapes: `interval`, `hourly`, `daily` (runtime-local TZ).
- Events: `fired`, `error`.

### Tests

10 Vitest tests covering: scheduleOnce + cadence + cancel + event hook + channel error + multi-recipient recurring fire.

### Pattern source

Generalised from `apps/household/src/scheduler/*` and `apps/household/src/skills/{nudgeCompletion,composeDigest}.js`.

### Known gaps (V1+)

- **Pod-backed scheduleStore** (Task #14) — for restart-survival.
- **Push channel** — needs Track E2c (push relay).
- **TZ-aware daily cadence** — currently runtime-local only.
- **Retry policies** — implementation present but defaults to `[]` (no retries) due to fake-timer-test complexity.  Set `retryDelaysMs` to enable.
- **Batching / coalescing** — multiple nudges within seconds all fire separately.

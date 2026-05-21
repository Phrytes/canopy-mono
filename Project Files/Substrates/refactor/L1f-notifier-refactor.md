# L1f (notifier) — substrate-vs-SDK refactor plan

| | |
|---|---|
| **Severity** | medium |
| **Audited** | 2026-05-04 |

## Executive summary

`@canopy/notifier` is a clean, well-tested ~500-LOC scheduler for daily
digests + one-shot nudges, channel-pluggable, with an `InMemoryScheduleStore`
and a freshly-shipped `PodScheduleStore`. **It does not commit any of the
critical SDK-bypass sins L1e committed** — it does not roll its own pod write
path, it does not reinvent transports, identity, or security, and the
`PodScheduleStore` (`packages/notifier/src/stores/PodScheduleStore.js:48-58`)
correctly accepts a duck-typed `pod-client` `PodClient` rather than reaching
into Inrupt or `SolidPodSource` directly. The `PodClient` shape it consumes
(`read(uri,{decode}) → {content,…}`, `write(uri,content,{contentType})`) is
exactly the one documented in the SDK surface map line 331.

What L1f *does* duplicate is at the periphery and is mechanical, not
architectural: (a) its own `Emitter` (Node's `events.EventEmitter`) instead
of core's `Emitter` — the SDK explicitly calls this out as a "use ours" rule
(SDK-surface-map.md line 26, 495); (b) a private `ulid()` re-impl that
shadows core's `genId()`; (c) a hand-rolled `setTimeout`/`clearTimeout`
scheduler that overlaps with `StateManager`'s TTL eviction model; (d) a
`Channel` interface that is a near-isomorphic rename of L1c's
`MessagingBridge` (creating an unnecessary adapter layer between the two
substrates that are explicitly designed to compose); and most importantly
(e) **the "push channel" is a documented stub** — the substrate sketch
(L1f-notifier.md:9, 110) and CHANGELOG.md:80 both list "push channel" as
V1+, while `MobilePushBridge` already exists in `@canopy/react-native`
and is exactly the wake-side primitive notifier is supposed to compose
with.

The headline finding is that **L1f's "channels" is a duplicate of L1c's
`MessagingBridge` shape**, and the substrate's currently-shipping `ChatChannel`
forces every consumer to build a 4-line lambda adapter
(`packages/notifier/src/channels/ChatChannel.js:19-29`) just to convert one
field-naming convention to another. Folding `Channel` into the existing
`MessagingBridge` (or vice versa) eliminates the adapter, eliminates the
`RecordingChannel` ⇄ `InMemoryBridge` duplication, and keeps the substrates
genuinely composable. Combined with the `Emitter` swap, ULID reuse, and a
small explicit doc-and-typing of the `MobilePushBridge` integration path,
this is a medium-severity refactor: roughly two days of work, breaks the
public API in well-bounded ways, no fundamental rewrite needed.

## Findings

### Finding 1 — `Channel` interface duplicates `MessagingBridge` (rename, not new abstraction) [medium]

**File(s):**
- `/home/frits/expotest/nkn-test/packages/notifier/src/types.js:7-23`
- `/home/frits/expotest/nkn-test/packages/notifier/src/channels/ChatChannel.js:15-30`
- `/home/frits/expotest/nkn-test/packages/chat-agent/src/types.js:6-32`

**SDK primitive that should serve this:** the L1c `MessagingBridge` interface
(`packages/chat-agent/src/types.js:6-23`). L1c is the substrate that already
abstracts "post text+buttons to a chat surface", and is L1f's primary delivery
target by design (L1f-notifier.md:106-108, "Chat channel — adapter that calls
`chatAgent.bridge.sendReply`"). When two substrates that explicitly compose
expose two near-identical interfaces under different field names, one of them
is a rename, not an abstraction.

**Evidence:**

L1f's `Channel` typedef at `packages/notifier/src/types.js:7-23`:
```js
/**
 * @typedef {object} Channel
 * @property {string} id
 * @property {(args: ChannelDeliverArgs) => Promise<void>} deliver
 */
/**
 * @typedef {object} ChannelDeliverArgs
 * @property {string} recipient
 * @property {string} text
 * @property {Array<{id: string, label: string}>} [buttons]
 * @property {object} [meta]
 */
```

L1c's `MessagingBridge` typedef at `packages/chat-agent/src/types.js:10-32`:
```js
/**
 * @typedef {object} MessagingBridge
 * @property {string} id
 * @property {(args: SendReplyArgs) => Promise<void>} sendReply
 *   Outbound — the chat agent calls this to post a reply.
 */
/**
 * @typedef {object} SendReplyArgs
 * @property {string}            chatId
 * @property {string}            [replyTo]
 * @property {string}            text
 * @property {Array<Button>}     [buttons]
 */
```

The shapes are isomorphic: `id` ↔ `id`, `deliver` ↔ `sendReply`, `recipient`
↔ `chatId`, `text`/`buttons` identical, `meta` ↔ `replyTo`+passthrough.
`ChatChannel` (`channels/ChatChannel.js:27-29`) exists *only* to translate
one to the other:

```js
async deliver({ recipient, text, buttons, meta }) {
  await this.#send(recipient, text, { buttons, ...(meta ? { meta } : {}) });
}
```

And the `RecordingChannel` (`channels/ChatChannel.js:44-53`) and
`InMemoryBridge` (`packages/chat-agent/src/bridges/InMemoryBridge.js:8-58`)
are the same test fake under different names — both record outbound calls
to a buffer.

**Impact:**

1. Every app composing notifier+chat-agent writes a 4-line lambda adapter,
   despite the two substrates being explicitly designed to compose
   (L1f-notifier.md:106-108).
2. Two test fakes do the same job (`RecordingChannel`, `InMemoryBridge`),
   doubling test surface and creating drift risk.
3. The "what's an opaque recipient string" semantics differ (L1c's `chatId`
   is platform-scoped chat id; L1f's `recipient` is "list of recipient
   identifiers" — an arbitrary string). When notifier dispatches to a
   chat-agent bridge, the field-rename hides a real ambiguity: is `recipient`
   a webid (member identity) or a `chatId` (platform DM-thread id)? L1c
   forces an explicit `memberResolver` step (types.js:62-66 `webid?`
   resolution); L1f assumes the app has already resolved.
4. Future bridges (Signal, Matrix, Email, Push) end up implemented twice
   — once for chat-agent's `MessagingBridge`, once for notifier's `Channel`.

### Finding 2 — Notifier extends Node's `EventEmitter` instead of core's `Emitter` [medium]

**File(s):** `/home/frits/expotest/nkn-test/packages/notifier/src/Notifier.js:16, 28`

**SDK primitive that should serve this:** `Emitter` from `@canopy/core`
(`packages/core/src/Emitter.js:5`). The SDK surface map calls this out
explicitly:

> `Emitter` — tiny in-house EventEmitter, no deps. **Substrates should use
> this, not Node's `events`.** (SDK-surface-map.md:26)
>
> Tiny in-house EventEmitter | `Emitter` from `@canopy/core` — works in
> browser, Node, and RN (Node's `events` does NOT, on RN-Hermes minus polyfill)
> (SDK-surface-map.md:495)

**Evidence:**

L1f imports and extends Node's `EventEmitter` directly:

```js
// packages/notifier/src/Notifier.js:16,28
import { EventEmitter } from 'node:events';
…
export class Notifier extends EventEmitter {
```

The test file does the same to construct its upstream emitter
(`test/Notifier.test.js:2`):

```js
import { EventEmitter } from 'node:events';
```

Core's `Emitter` exposes the same `on/off/once/emit` surface and is the
substrate-portable choice — L1c (`packages/chat-agent/src/ChatAgent.js:20`)
also currently extends `node:events`, so this is a substrate-level pattern
that should be normalised.

**Impact:**

1. RN consumption requires the polyfill chain. Apps that pull notifier into
   a non-Hermes-polyfilled environment crash at module load. Architecture.md
   explicitly notes L1f's RN variant ambition (L1f-notifier.md:128-136).
2. `notifier.on(emitter, eventName, handler)` (`Notifier.js:207-215`) has
   to do an awkward dance to disambiguate "I'm calling EE.on with an
   external emitter" vs "I'm calling EE.on with self": the bypass at line
   214 (`return super.on(emitter, eventName)`) is brittle and is the only
   reason the test at `test/Notifier.test.js:98` works
   (`notifier.on(notifier, 'fired', ...)`). With core's `Emitter` we can
   give notifier a clean `subscribe(emitter, name, handler)` method
   distinct from `Emitter.on(name, handler)`.

### Finding 3 — `ulid()` is re-implemented; should reuse core's `genId()` or share with item-store [low]

**File(s):** `/home/frits/expotest/nkn-test/packages/notifier/src/ulid.js:1-23`

**SDK primitive that should serve this:** core exports `genId()`
(`packages/core/src/Envelope.js:91-103`) which is the canonical UUID-v4
generator with full crypto-fallback handling. L1f only needs `genId()` —
its jobIds are opaque tokens, the time-ordering property of ULID isn't used
anywhere in the codebase (no `WHERE jobId > X` or "newest jobId first"
sort). The file's own header comment admits the duplication:

```js
// Minimal ULID — same impl as @canopy/item-store.  Inlined here to
// avoid a cross-substrate dependency on item-store just for one function.
// (When stable, both might consume a shared ULID helper from
// @canopy/core; for now duplication is cheap.)
```

**Evidence:**

L1f's `ulid.js:8-23`:
```js
export function ulid() {
  const now = Date.now();
  let timeStr = '';
  let t = now;
  for (let i = 9; i >= 0; i--) {
    timeStr = CROCKFORD[t % 32] + timeStr;
    t = Math.floor(t / 32);
  }
  const rand = new Uint8Array(16);
  globalThis.crypto.getRandomValues(rand);
  …
```

Core's `Envelope.js:91-103`:
```js
export function genId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const b = crypto.getRandomValues(new Uint8Array(16));
    …
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
```

**Impact:**

1. Every `globalThis.crypto.getRandomValues(...)` call in L1f bypasses the
   crypto-fallback chain core has worked out (notably the
   `crypto.randomUUID() → getRandomValues → Math.random` ladder). On
   RN-Hermes pre-polyfill, `globalThis.crypto.getRandomValues` is undefined
   and the call throws.
2. If item-store and notifier ever disagree on ULID format (e.g. someone
   moves item-store to t-based 26-char ULIDs but notifier stays at 26-char
   different layout), the assumption that `cancelKey: nudge-${item.id}`
   produces consistent strings across substrates breaks silently.

### Finding 4 — Push channel is a stub; `MobilePushBridge` already exists and is the obvious composition target [medium]

**File(s):**
- `/home/frits/expotest/nkn-test/packages/notifier/src/index.js:1-6` (no push export)
- `/home/frits/expotest/nkn-test/packages/notifier/CHANGELOG.md:79-80` ("Push channel — needs Track E2c (push relay)")
- `/home/frits/expotest/nkn-test/Project Files/Substrates/L1f-notifier.md:9, 110-111` ("**RN variant?** Yes — push integration when E2c lands needs APNs/FCM bindings"; "Push channel — stub today; real implementation when E2c…")

**SDK primitive that should serve this:** `MobilePushBridge` from
`@canopy/react-native` (`packages/react-native/src/transport/MobilePushBridge.js:41-130`).
Plus its abstract `PushAdapter` (line 22 of
`packages/react-native/src/transport/pushAdapters/PushAdapter.js`) and the
shipping concrete `ExpoNotificationsAdapter`. Per SDK-surface-map.md:404-408
and 502, this is exactly the primitive notifier should compose against, and
it's been DONE for some time (the gap is in *direction*: `MobilePushBridge`
wakes the local agent on inbound push; notifier wants to push *outbound* to a
recipient device).

**Honest gap analysis:**

`MobilePushBridge` does *receive* (token registration + inbound notification
→ skill invocation). What L1f's "push channel" wants is the *send* side —
"given a device push token registered for recipient R, post a notification
to APNs/FCM". The SDK currently has:

- `MobilePushBridge.register()` returns `{token, platform}` — the device
  identity for outbound targeting (`MobilePushBridge.js:70-78`).
- No SDK-side "PushSender" abstraction to actually call APNs/FCM HTTPv1 or
  similar from a notifier-driven daemon.

So the honest situation is: L1f cannot *yet* fully compose with the SDK
for push because the send-side primitive is genuinely missing — but L1f's
`Channel` interface should already be designed around the existence of the
receive-side `MobilePushBridge` so that:

1. The `recipient` field in `ChannelDeliverArgs` is explicitly typed as the
   push token format `MobilePushBridge.register()` returns (or a webid that
   resolves to one), not a plain string.
2. The substrate ships a `PushChannel` adapter that takes a sender function
   `(token, platform, payload) → Promise<void>` — analogous to ChatChannel's
   `send` function — and documents that the consumer wires either a
   relay-side push daemon (Track E2c) or a direct APNs/FCM client.
3. The notification payload shape matches the convention `MobilePushBridge`
   expects on the wake side (`{skillId, parts, …}` per
   `MobilePushBridge.js:11-16`), so digest → push → wake-and-process is
   end-to-end coherent.

**Evidence (substrate side):**

`packages/notifier/src/index.js` exports nothing push-related:
```js
export { Notifier } from './Notifier.js';
export { InMemoryScheduleStore } from './stores/InMemoryScheduleStore.js';
export { PodScheduleStore }      from './stores/PodScheduleStore.js';
export { ChatChannel, NoopChannel, RecordingChannel } from './channels/ChatChannel.js';
export { nextDailyFireInTz } from './timezone.js';
```

`L1f-notifier.md:106-111`:
> The substrate ships:
> - **Chat channel** — adapter that calls `chatAgent.bridge.sendReply`.
> - **No-op channel** — for testing.
> - **Push channel** — stub today; real implementation when E2c
>   (Track E push relay) lands.

**Evidence (SDK side, what's already built):**

`packages/react-native/src/transport/MobilePushBridge.js:1-38` (file head):
> MobilePushBridge — wakes a local Agent when a push notification arrives.
> Bridges a {@link PushAdapter} (Expo / APNs / FCM) to an `Agent`:
>   1. Adapter registers + acquires a device push token.
>   2. Notifications fire → bridge dispatches them to the Agent…
> ── Notification payload convention ──
>   { skillId: 'wake-task', parts: [...], … }

Architecture.md:232 explicitly tags this as `?` "needs verification" status,
and the user's auto-memory `session_group_dd_phone_integration.md` notes "3
untried code paths" through `MobilePushBridge` for the rendezvous-on-phone
flow. So **the bridge itself is implemented but its end-to-end coverage is
half-verified** — substrate authors should not assume full coverage but
should design the wire shapes to fit.

**Impact:**

1. L1f forces apps to invent their own push wire shape, which will probably
   NOT match `MobilePushBridge`'s `{skillId, parts}` convention — meaning
   the digest → push → wake-and-handle flow will require an extra adapter
   on the receive side too.
2. L1f's `recipient: string` typing means the eventual `PushChannel` will
   have to do its own webid → push-token resolution, duplicating L1h
   (identity-resolver) work.
3. The substrate ships `ChatChannel` + `NoopChannel` + `RecordingChannel`
   but no `PushChannel` placeholder, so apps wanting push today end up
   subclassing `Channel` directly and there's no canonical shape for the
   eventual rule-of-two pull when E2c lands.

### Finding 5 — Hand-rolled timer scheduler overlaps with `StateManager` TTL eviction; not a duplication, but an unflagged boundary [low]

**File(s):**
- `/home/frits/expotest/nkn-test/packages/notifier/src/Notifier.js:38-39, 219-228, 230-236, 238-259`
- `/home/frits/expotest/nkn-test/packages/core/src/state/StateManager.js:15` (per SDK-surface-map.md:248)

**SDK primitive that should serve this:** none directly. `StateManager`
(SDK-surface-map.md:248) provides TTL-evicting Maps for tasks, streams, and
sessions — but its semantics ("after T ms, drop this entry from a Map") are
**not** what notifier needs. Notifier needs "at instant T, fire a callback,
re-arm if recurring". These are genuinely different primitives. **No
duplication of SDK functionality here.**

The only reason this surfaces in the audit is that the SDK has no shipped
"`scheduleAt(timestamp, callback)`" primitive and none of `LiveSyncSkill`,
`StateManager`, or core's protocol/streaming covers this case. The
substrate's hand-rolled scheduler is appropriate.

**Evidence:**

`Notifier.js:219-228` (the timer arm path):
```js
#armTimer(job) {
  if (!this.#started) return;
  if (this.#timers.has(job.jobId)) {
    this.#clearTimeout(this.#timers.get(job.jobId));
  }
  const fireAt = job.nextFireAt ?? this.#now();
  const delay  = Math.max(0, fireAt - this.#now());
  const t = this.#setTimeout(() => this.#fire(job.jobId), delay);
  this.#timers.set(job.jobId, t);
}
```

This is correct. The pluggable `#now`/`#setTimeout`/`#clearTimeout`
(Notifier.js:35-37, 68-70) is exactly the test seam architecture.md:321
flags as the "inject clock primitive into core" problem the SDK still
hasn't solved — when that lands, notifier should adopt it.

**Impact:** None today. **Flag for action:** when core ships an injectable
`Clock` primitive (architecture.md item E.1, "HIGH PRIORITY per
TODO-GENERAL.md"), notifier's `#now`/`#setTimeout`/`#clearTimeout` triple
should be replaced by it. This is an opportunistic future swap, not a
blocking duplication today.

### Finding 6 — `InMemoryScheduleStore` is the right level of "in-memory fake"; **not** a duplication of SDK storage [low / no-action]

**File(s):** `/home/frits/expotest/nkn-test/packages/notifier/src/stores/InMemoryScheduleStore.js:6-32`

**Why this is fine, despite the auditor's checklist:** L1f's `ScheduleStore`
interface (`packages/notifier/src/types.js:26-33`) is *not* a `DataSource` —
it's a typed schedule-job store with `put/get/listAll/remove/removeByCancelKey`,
a job-shaped value, and is consumed only by `Notifier`. Implementing it as
a `DataSource` adapter would force notifier to do `DataSource.write(jobId,
JSON.stringify(job))` and lose the typed shape. The interface is correctly
specialised. The Map-backed in-memory impl is the canonical "no-deps fake"
that mirrors `MemorySource`, `MemoryQueueStore`, `VaultMemory`,
`MemoryTombstones`, etc — and is exactly the shape SDK-surface-map.md:437
endorses ("Implement DataSource (or one of its concrete subclasses) rather
than wrapping `fs` / IndexedDB / `localStorage` directly" — note: this is
about DataSource which is a different abstraction).

**Action:** none. This is a clean substrate primitive.

### Finding 7 — `PodScheduleStore` correctly composes `pod-client`; not a duplication [low / no-action]

**File(s):** `/home/frits/expotest/nkn-test/packages/notifier/src/stores/PodScheduleStore.js:48-58, 109-139`

This is the recently-shipped pod-backed schedule store (CHANGELOG.md:5-31).
It is **not** a duplicate of SDK pod write paths — it correctly accepts a
duck-typed `PodClient` rather than reaching into `SolidPodSource` or Inrupt
directly:

```js
// PodScheduleStore.js:48-58
constructor({ podClient, uri, builderResolver = null } = {}) {
  if (!podClient || typeof podClient.read !== 'function' || typeof podClient.write !== 'function') {
    throw new TypeError('PodScheduleStore: podClient with read/write required');
  }
  …
  this.#podClient = podClient;
  this.#uri       = uri;
  …
}
```

The `read(uri,{decode}) → {content,…}` shape it consumes
(PodScheduleStore.js:112-113) is exactly the `PodClient.read` API
documented in SDK-surface-map.md:331. The `write(uri, content,
{contentType})` shape (PodScheduleStore.js:138) matches `PodClient.write`
(SDK-surface-map.md:331). The `NOT_FOUND` error code handling
(PodScheduleStore.js:115) is the documented `PodClient` contract (not a
private opinion).

**The "lazy-load + flush-full-blob" mutation pattern is intentional.** It's
explicitly chosen over `PodClient.append` because the Job records have
mutable `nextFireAt`/`lastFiredAt` that recurring fires update — append-only
would grow without bound. The single-writer caveat is documented at the
file head (PodScheduleStore.js:14-19). This is a defensible design choice,
not an SDK bypass.

**Action:** none. Possibly a comment pointing to `PodClient`'s
`'conflict'` event semantics for the multi-writer follow-up, but no
refactor needed.

### Finding 8 — Substrate boundary: notifier vs relay's per-peer offline queue [low / no-action]

**File(s):**
- `/home/frits/expotest/nkn-test/packages/notifier/src/Notifier.js` (whole substrate)
- `/home/frits/expotest/nkn-test/packages/relay/src/server.js:243-249` (offline queue)

**Boundary check:** the relay's offline queue (`server.js:230-250`) is
**transport-layer** (per-peer, time-bounded, per-envelope buffer when the
recipient WebSocket is disconnected — default cap 50 messages, default TTL
5 min, see `WsServerTransport`'s `offlineQueueTtl`). L1f's notifier is
**application-layer** (scheduled jobs that may need to fire even when no
peer is connected; persistence across process restart; user-facing intent
like "20:00 daily digest").

These are genuinely different responsibilities and the existing boundaries
are correct:

- The relay queue holds opaque envelopes the relay does not introspect; TTL
  is short; intent is "if the peer reconnects within 5 min, deliver the
  envelopes it missed."
- Notifier holds typed `Job` records; cadence is "next 20:00 in
  Europe/Amsterdam"; intent is "fire a builder closure that may compose the
  outbound payload from current pod state at fire-time."

The one place this boundary *could* leak: if a future "push channel" in
L1f writes an envelope to the relay that gets queued in the relay's
offline buffer (peer momentarily disconnected), and the notifier then also
re-fires from its persisted job record because the recurring cadence ticked
over, you get a duplicate. **Mitigation, when push lands:** the channel's
`deliver` should be idempotent at the per-(jobId, fireAt) level (e.g., a
relay-side dedup key, or notifier already has `jobId` and `fireAt` to
combine into one). This is a future concern; flag for the V1+ push-channel
work, no current code change needed.

**Action:** none today. Document the boundary explicitly in the substrate
sketch's "Push channel" section so the eventual implementer doesn't try to
treat notifier as a long-haul queue.

## Refactor plan

Numbered steps, in priority order. Steps 1-3 are the substantive medium-severity
work; steps 4-6 are mechanical / documentation.

### Step 1 — Fold `Channel` into `MessagingBridge` (Finding 1)

1.1. **Decide direction:** make notifier consume L1c's `MessagingBridge`
shape directly. (The other direction — L1c consumes `Channel` — is wrong
because L1c has the larger user base and the more battle-tested interface,
and `MessagingBridge` already has the explicit `start()`/`stop()`/`onMessage`
lifecycle that notifier doesn't need but doesn't hurt.)

1.2. **Update L1f types.js** — replace `Channel` typedef with a re-export
of L1c's `MessagingBridge` typedef (or, to avoid a cross-substrate type
import, document `Channel` as an alias):

```js
/**
 * @typedef {import('@canopy/chat-agent').MessagingBridge} Channel
 *   Notifier's channel surface IS L1c's MessagingBridge — the substrates
 *   share an interface so the same bridge implementation works for both
 *   chat-agent's reply path AND notifier's digest delivery.
 */
```

1.3. **Rename `ChannelDeliverArgs` to `SendReplyArgs`** (matching L1c's
`SendReplyArgs`). Field rename: `recipient → chatId`. `meta` becomes a free
passthrough that channel implementations may ignore (matches L1c's loose
typing).

1.4. **Update `Notifier.#fireOnce` and `#fireRecurring`** (Notifier.js:261-292)
to call `channel.sendReply({ chatId: recipient, text, buttons, meta })`
instead of `channel.deliver({ recipient, text, buttons, meta })`.

1.5. **Delete `ChatChannel`** (`packages/notifier/src/channels/ChatChannel.js`).
Apps now pass a `MessagingBridge` directly into `notifier.channels`. The
example in `README.md:18-25` becomes:

```js
const notifier = new Notifier({
  channels: {
    chat: chatAgent.bridge,        // any MessagingBridge: TelegramBridge, InMemoryBridge, …
  },
});
```

1.6. **Delete `RecordingChannel`** in favour of L1c's `InMemoryBridge`. Tests
that need an outbox import `{ InMemoryBridge } from '@canopy/chat-agent'`.
This adds a devDependency on `@canopy/chat-agent` for tests only — fine,
since the substrates are already designed to compose. Alternative if you
want to keep notifier's tests dependency-free: rename `RecordingChannel` to
`RecordingBridge`, give it the same shape as `InMemoryBridge`, and migrate
L1c to import it *from notifier* (one-direction-only test fake).
Recommended: take the dep, delete `RecordingChannel`.

1.7. **Update README + CHANGELOG.** README's "Channel interface" section
becomes "Bridge interface — same as `@canopy/chat-agent`'s
`MessagingBridge`."

1.8. **Update L1f-notifier.md sketch** — line 41-49 ("`channels: { chat:
chatAgent, … }`") already implies this; promote it to "channels accept
`MessagingBridge` instances; the substrate ships no channel adapters."

### Step 2 — Adopt core's `Emitter` (Finding 2)

2.1. **Replace import** in `Notifier.js:16`:
```js
// before
import { EventEmitter } from 'node:events';
// after
import { Emitter } from '@canopy/core';
```

2.2. **Replace `extends`** at `Notifier.js:28`:
```js
export class Notifier extends Emitter {
```

2.3. **Rename external-emitter subscribe path.** `notifier.on(emitter, name,
handler)` overload (Notifier.js:207-215) is brittle and is the only reason
the test at `test/Notifier.test.js:98` works (`notifier.on(notifier, 'fired',
…)`). Replace with a clean `subscribe(emitter, name, handler) → off` method
distinct from `Emitter.on`:

```js
// new public method
subscribe(emitter, eventName, handler) {
  if (!emitter || typeof emitter.on !== 'function') {
    throw new TypeError('subscribe: emitter must expose .on()');
  }
  emitter.on(eventName, handler);
  const off = () => emitter.off?.(eventName, handler);
  this.#subscribers.push(off);
  return off;
}
```

2.4. **Update tests** at `test/Notifier.test.js:155, 169` from
`notifier.on(upstream, …)` to `notifier.subscribe(upstream, …)`. Self-emitter
subscribers (`notifier.on(notifier, 'fired', …)` at line 98) become regular
`notifier.on('fired', …)`.

2.5. **Drop `node:events` from test imports** (`test/Notifier.test.js:2`).
Use `Emitter` for the upstream emitter too.

2.6. **Coordinate with L1c.** Chat-agent's `ChatAgent.js:20` also extends
`node:events`; that's a separate substrate refactor. Note in the L1c
audit follow-up.

### Step 3 — Push channel: type the recipient and document the wire shape (Finding 4)

This step does NOT ship a real push channel — that's still V1+ pending
Track E2c — but it nails the wire-shape decision so the eventual PR is
mechanical.

3.1. **Add a `PushChannel` placeholder** in
`packages/notifier/src/channels/PushChannel.js`:

```js
/**
 * PushChannel — V1+ stub placeholder.
 *
 * When Track E2c lands, this composes a `pushSend(token, platform, payload)`
 * function with notifier's scheduler.  The payload shape follows
 * `MobilePushBridge`'s notification convention so digest → push →
 * wake-and-process is coherent end-to-end:
 *
 *   { skillId: 'wake-and-handle-digest', parts: [TextPart('…')] }
 *
 * The recipient identifier passed to deliver() is interpreted as a push
 * token (whatever `MobilePushBridge.register()` returned), not a webid.
 * Webid → token resolution is the consuming app's responsibility (V1+:
 * via L1h identity-resolver).
 */
export class PushChannel {
  constructor({ pushSend, id = 'push' } = {}) {
    if (typeof pushSend !== 'function') {
      throw new TypeError('PushChannel: pushSend (function) required');
    }
    this.id = id;
    this.#pushSend = pushSend;
  }
  #pushSend;
  async sendReply({ chatId /* push token */, text, buttons, meta }) {
    const skillId = meta?.skillId ?? 'wake-and-notify';
    const parts   = meta?.parts   ?? [{ kind: 'text', text }];
    await this.#pushSend(chatId, meta?.platform ?? 'unknown', { skillId, parts });
  }
}
```

3.2. **Add a JSDoc note** at the top of `Notifier.js` explaining the
`recipient` field semantics: "the `recipient` field passed to `schedule` /
`scheduleOnce` is opaque to the notifier — its meaning is determined by
the `channel`. ChatChannel/MessagingBridge bridges interpret it as a
chatId; PushChannel interprets it as a push token; future EmailChannel
would interpret it as an email address. Webid → identifier resolution is
the consuming app's responsibility (typically via L1h identity-resolver)."

3.3. **Update L1f-notifier.md** — replace lines 110-111 with explicit
reference to `MobilePushBridge` and the wire-shape convention. Note the
honest gap: SDK's send-side push primitive is missing, so for now apps
ship their own `pushSend(token, platform, payload)`.

3.4. **No code that imports `MobilePushBridge` directly.** It's a
react-native-only module, and notifier is platform-agnostic. The
composition is by *convention* (the `{skillId, parts}` payload shape)
documented in both packages' READMEs.

### Step 4 — Use core's `genId()` for jobIds (Finding 3)

4.1. **Delete `packages/notifier/src/ulid.js`** entirely.

4.2. **Update `Notifier.js:18`** from
```js
import { ulid } from './ulid.js';
```
to
```js
import { genId } from '@canopy/core';
```

4.3. **Update the one call site** at `Notifier.js:154` from
`const jobId = ulid();` to `const jobId = genId();`. The format change
(ULID → UUID v4) is observable in test assertions IF any assert on
the format. Quick scan of test/Notifier.test.js: no test inspects jobId
format — only that `listJobs()` returns expected counts and that
`scheduleOnce` returns "a string". Safe.

4.4. **Coordinate with item-store.** Item-store has its own `ulid.js`;
that's a parallel refactor (Finding 3 in the eventual L1b audit). Not
blocked by this one.

### Step 5 — Add a small docs-only refactor: substrate boundary call-out (Finding 8)

5.1. **Add a "Boundaries" section** in `packages/notifier/README.md` after
"Architecture":

```markdown
## Boundaries

Notifier is **application-layer** scheduling — typed `Job` records, cadence
semantics, builder closures that read pod state at fire-time. It is NOT a
transport-layer queue.

The relay's per-peer offline buffer (`packages/relay/src/server.js:230-250`)
is transport-layer — opaque envelopes, ~5 min TTL, "if the peer reconnects
soon, deliver these." If a notifier-driven push notification can't be
delivered because the recipient relay is briefly disconnected, the relay's
queue handles it. If the recipient is offline for hours and the next daily
digest fires, notifier creates a fresh job. The two are complementary, not
competing.
```

### Step 6 — Future-proofing: opportunistic clock-primitive swap (Finding 5)

6.1. **No change today.** When core ships an injectable `Clock` primitive
(architecture.md E.1), replace notifier's `#now`/`#setTimeout`/`#clearTimeout`
triple with `clock.now()` / `clock.setTimeout()` / `clock.clearTimeout()`.

6.2. **Add a TODO comment** at `Notifier.js:35-37`:
```js
// TODO: when core ships an injectable Clock (TODO-GENERAL.md item E.1),
// collapse this triple into a single `clock` instance accepted in
// the constructor.
```

## Public API — before / after

### Before (v0.3.0)

```ts
// @canopy/notifier
export class Notifier extends EventEmitter {
  constructor({ channels, store?, retryDelaysMs?, now?, setTimeoutFn?, clearTimeoutFn? })
  start(): Promise<void>
  stop():  Promise<void>
  schedule({id, cadence, recipients, channel, builder}):     Promise<jobId>
  scheduleOnce({triggerAt, recipient, channel, builder, cancelKey?}): Promise<jobId>
  cancel(keyOrJobId):                                        Promise<void>
  listJobs():                                                Promise<Job[]>
  on(emitter, eventName, handler):                           () => void   // overloaded with EE.on(name,handler)
}
export { ChatChannel, NoopChannel, RecordingChannel } from './channels/ChatChannel.js';
export { InMemoryScheduleStore } from './stores/InMemoryScheduleStore.js';
export { PodScheduleStore }      from './stores/PodScheduleStore.js';
export { nextDailyFireInTz }     from './timezone.js';

interface Channel {
  id: string;
  deliver({recipient, text, buttons?, meta?}): Promise<void>;
}
```

### After (v0.4.0)

```ts
// @canopy/notifier
export class Notifier extends Emitter {                                   // ← core's Emitter
  constructor({ channels, store?, retryDelaysMs?, now?, setTimeoutFn?, clearTimeoutFn? })
  start(): Promise<void>
  stop():  Promise<void>
  schedule({id, cadence, recipients, channel, builder}):     Promise<jobId>
  scheduleOnce({triggerAt, recipient, channel, builder, cancelKey?}): Promise<jobId>
  cancel(keyOrJobId):                                        Promise<void>
  listJobs():                                                Promise<Job[]>
  subscribe(emitter, eventName, handler):                    () => void   // ← clean, no overload
}
export { NoopChannel, PushChannel } from './channels/index.js';            // ← ChatChannel/RecordingChannel removed
export { InMemoryScheduleStore } from './stores/InMemoryScheduleStore.js';
export { PodScheduleStore }      from './stores/PodScheduleStore.js';
export { nextDailyFireInTz }     from './timezone.js';

// Channel IS @canopy/chat-agent's MessagingBridge — no separate type.
//   { id, sendReply({chatId, text, buttons?, replyTo?}): Promise<void>, … }
```

**Breaking changes:**

1. `ChatChannel` deleted — apps pass `chatAgent.bridge` (or any
   `MessagingBridge`) directly into `notifier.channels`.
2. `RecordingChannel` deleted — tests use `InMemoryBridge` from
   `@canopy/chat-agent`.
3. `notifier.on(emitter, name, handler)` removed — use
   `notifier.subscribe(emitter, name, handler)`. Self-subscription
   (`notifier.on(notifier, 'fired', …)`) becomes plain
   `notifier.on('fired', …)`.
4. `Channel` typedef renamed/realiased; `recipient` field becomes
   `chatId` to match `MessagingBridge`.
5. `jobId` format changes from ULID-shaped 26-char to UUID v4.

**Non-breaking additions:**

1. `PushChannel` exported as a placeholder for V1+ Track E2c integration.

## Migration path for downstream consumers

The only known consumer of L1f today is `apps/household` — and per the
README/CHANGELOG it's still self-hosting its scheduler (`apps/household/src/
scheduler/*`) and only consumes `nextDailyFireInTz`. So the migration
surface is small:

### household app

- `nextDailyFireInTz` — unchanged. No migration needed.
- `Notifier` — currently not consumed; when it is, follow the new API
  shape.

### Hypothetical "neighborhood-v0" or other consumer (NOT yet wired)

- Replace `import { ChatChannel } from '@canopy/notifier/channels/chat'`
  with the chat-agent bridge instance:
  ```js
  // before
  channels: { chat: new ChatChannel({ send: chatAgent.dispatch.bind(chatAgent) }) }
  // after
  channels: { chat: chatAgent.bridge }      // or your TelegramBridge directly
  ```
- Replace `notifier.on(emitter, name, handler)` with
  `notifier.subscribe(emitter, name, handler)`.
- If any code path inspected `jobId` format, switch from "26 char Crockford
  base32" to "36 char UUID v4 with dashes". Unlikely.

### Migration pull request checklist

- [ ] Update `package.json` peerDep: add `@canopy/core` (for `Emitter`,
      `genId`).
- [ ] Update `package.json` devDep: add `@canopy/chat-agent` for tests
      that need `InMemoryBridge`.
- [ ] Bump `@canopy/notifier` to `0.4.0`.
- [ ] Update CHANGELOG with the breaking-change list above.

## Test changes

### Tests to update

- **`test/Notifier.test.js`:**
  - Line 2: drop `import { EventEmitter } from 'node:events'` → use
    `Emitter` from core.
  - Line 6: drop `RecordingChannel` import → import `InMemoryBridge`
    from `@canopy/chat-agent`.
  - Line 36: `new RecordingChannel({ id: 'chat' })` →
    `new InMemoryBridge({ id: 'chat' })`.
  - Lines 60, 125-128, 142, 145, 207-210: `channel.deliveries` →
    `channel.outbox`. Field rename in assertion: `{recipient, text}` →
    `{chatId, text}`.
  - Line 98: `notifier.on(notifier, 'fired', …)` → `notifier.on('fired', …)`.
  - Lines 155, 169: `notifier.on(upstream, name, h)` →
    `notifier.subscribe(upstream, name, h)`.
- **`test/PodScheduleStore.test.js`:** unchanged — doesn't touch any of
  the refactored surfaces.
- **`test/timezone.test.js`:** unchanged.

### New tests to add

- **PushChannel construction** (V1+ placeholder coverage):
  - throws on missing `pushSend`.
  - `sendReply({chatId: 'token-X', text: 'hi'})` invokes
    `pushSend('token-X', 'unknown', {skillId: 'wake-and-notify', parts:
    [TextPart('hi')]})`.
  - `meta.skillId` and `meta.parts` override defaults.
- **`Emitter` swap** — re-run all existing notifier tests against the
  Emitter base class. The internal `subscribers` cleanup behaviour
  (Notifier.js:42-43, 88-94) needs to keep its existing semantics.

### Tests in chat-agent affected

- `InMemoryBridge` may grow a `clear()` alias for `clearOutbox()` to match
  notifier's old `RecordingChannel.clear()`. Trivial.

## Estimated effort

**Total: ~2 days** (1 person, full-time).

| Step | Effort |
|---|---|
| Step 1 — fold Channel into MessagingBridge | 0.5 day (code + tests + docs + CHANGELOG) |
| Step 2 — adopt core's Emitter | 0.25 day (mostly mechanical) |
| Step 3 — PushChannel placeholder + docs | 0.5 day (code + sketch update + payload-shape decision write-up) |
| Step 4 — use genId for jobIds | 0.25 day (mechanical) |
| Step 5 — boundary docs | 0.1 day |
| Step 6 — clock-primitive TODO comment | trivial |
| Buffer / coordination with L1c maintainers | 0.4 day |

The risk profile is low: the medium-severity items are well-contained
(rename, swap, docs), the SDK primitives being composed (`Emitter`,
`genId`, `MobilePushBridge`'s payload convention) are stable and well-tested,
and there are zero current downstream consumers that would break.

## Cross-substrate dependencies surfaced

This audit surfaces several dependencies between substrates that the SDK
surface map / substrate sketches should formalise:

1. **L1f ⇄ L1c (chat-agent):** L1f's `Channel` interface is L1c's
   `MessagingBridge`. After the refactor, the substrates share a typed
   contract. Document this in BOTH sketches' "Dependencies" section
   (currently L1f-notifier.md:120-126 mentions L1c as "optional", but
   doesn't note the shared interface).

2. **L1f → L0 (`@canopy/core`):** new explicit deps on `Emitter` and
   `genId`. Add to `package.json` peerDeps. Currently package.json has
   no `@canopy` deps at all (notifier/package.json:18-19).

3. **L1f → L1h (identity-resolver, future):** webid → push-token
   resolution is L1h's job, NOT notifier's. Document in PushChannel.js
   header comment so the eventual implementer doesn't bake resolution into
   notifier.

4. **L1f → react-native's `MobilePushBridge`:** by *convention only* (the
   `{skillId, parts}` push payload shape). Notifier itself never imports
   `MobilePushBridge` — that's a react-native peer dep. The convention is
   documented in `MobilePushBridge.js:11-16` and should be cross-referenced
   from `PushChannel.js` and from L1f-notifier.md's Push Channel section.

5. **L1f ⇄ relay's offline queue:** clean boundary, documented in Step 5.
   Surface this so future contributors don't try to elide one into the
   other.

6. **L1f → core's future `Clock` primitive (architecture.md E.1):**
   opportunistic future swap. When core ships it, the four constructor
   options `now`/`setTimeoutFn`/`clearTimeoutFn`/(implicit Date.now) all
   collapse into one `clock` injection. Track via the TODO comment from
   Step 6.

7. **L1f ⇄ L1b (item-store):** both substrates have their own `ulid.js`
   (`packages/item-store/src/ulid.js` and `packages/notifier/src/ulid.js`,
   per notifier's own header comment). Both should switch to core's
   `genId` (or, if true ULID time-ordering is wanted, core could grow a
   shared `ulid` export; but neither substrate needs the time-order
   property today). This is two separate audit follow-ups; only L1f's is
   in scope here.

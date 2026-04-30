# Messaging bridges — Telegram (shipped) and beyond

## What this doc is for

The household agent talks to humans through messaging platforms via
the `MessagingBridge` interface (Q-H2.5 lock).  Telegram is the v0
implementation.  This doc covers:

- The `MessagingBridge` interface (recap from the design doc).
- What it would take to add a Signal alternative.
- What it would take to add a Matrix alternative.
- Trade-offs: which bridge belongs where.

Think of this as a scouting report for the next platform we add —
which one + how much work + which traps.

---

## `MessagingBridge` interface (recap)

```ts
interface MessagingBridge {
  start(): Promise<void>;
  stop():  Promise<void>;

  sendReply(args: {
    chatId: string;          // platform-scoped opaque id
    replyTo?: string;        // message-id this is a reply to
    text: string;
    buttons?: Array<{ id: string; label: string }>;
  }): Promise<void>;

  onMessage(handler: (msg: IncomingMessage) => Promise<Reply>): void;

  bridgeId: 'telegram' | 'signal' | 'matrix' | …;
}
```

Designed deliberately small.  Every adapter exposes:

- A way to start + stop listening (long-poll / webhook / WebSocket /
  whatever the platform wants).
- A way to send a reply with optional inline buttons.
- A way to register a handler that gets called per incoming message.
- A bridgeId for identification.

All four messaging adapters discussed below fit this interface.  The
shape held up to scrutiny when we wrote the Telegram adapter; the
question for Signal / Matrix is whether each platform's wire format
maps onto it without forcing the shape to grow.

---

## Telegram (shipped — `apps/household/src/bridges/TelegramBridge.js`)

### Status

✅ shipped in Phase 1 commit `1fe4533`.  Both webhook + long-polling
(Q-H2.3); addressed-only filter (Q-H2.4); inline-button taps
synthesise an `IncomingMessage`.

### Why Telegram first

- **First-class bot platform**: BotFather / bot tokens / inline
  keyboards are designed for this exact use case.
- **Mature lib**: `telegraf` (mature, async/await-native, large
  community) wraps the API cleanly.
- **Real users already use it**: most households we'd test with
  already have Telegram on their phones.  Zero install friction.
- **The interface is a clean fit** — `bot.on('text')` ↔
  `onMessage`, `bot.telegram.sendMessage` ↔ `sendReply`, inline
  keyboard ↔ buttons.

### Notable Telegram-specific gotchas (already handled)

- Group chats need `privacy mode` ON to scope the bot to addressed
  messages.  This is the BotFather default.  If a household later
  wants Twist 2 (ambient extraction — Q-H2.4 dropped in v0), this
  setting flips OFF.
- The bot's auto-detected `@username` needs ONE round-trip to
  Telegram on first start (`bot.telegram.getMe()`); cache it.
- Webhook needs a public HTTPS endpoint.  Long-polling works around
  NAT but is slower + less reliable.
- Inline buttons cap at ~10 per row; we render plain text past that.

---

## Signal — exploration

### Status

❌ Not started.  This section is a **scouting report**, not a plan.

### Verdict (TL;DR)

**Possible but harder than Telegram.**  Signal has no first-class
bot platform; you run `signal-cli` (a Java daemon) as a normal user
account, then drive it via JSON-RPC.  The `MessagingBridge` interface
fits, but the underlying integration is clunkier — more deployment
ceremony, more fragility, and a phone-number requirement that may
feel weird for a household-bot identity.

If you really need Signal (privacy-conscious household, Signal is
already their group chat), it's doable.  If you can pick the
platform, **Matrix is a cleaner fit** for the project's ethos.

### What Signal's bot story actually looks like

Signal does not ship an official bot platform à la Telegram.  The
options:

1. **`signal-cli`** — Java daemon by AsamK.
   https://github.com/AsamK/signal-cli.  The de-facto choice for
   "Signal bots".  Wraps `libsignal-client` (the protocol library)
   and exposes a CLI + JSON-RPC server interface.  Each running
   instance is bound to ONE phone number (real Signal account).
2. **`bbernhard/signal-cli-rest-api`** — a Docker image that wraps
   `signal-cli` in a small REST surface
   (https://github.com/bbernhard/signal-cli-rest-api).  Easier to
   integrate from Node, harder to reason about (extra layer).
3. **Direct `libsignal-client`** — too low-level; reimplements
   what `signal-cli` already does.  Don't.

In all cases:

- The bot has a **real Signal account** tied to a phone number.
  Either a SIM you control or a VoIP number (Google Voice,
  Burner, etc.).  Signal's ToS prohibits some VoIP numbers; verify
  before committing.
- Onboarding requires receiving an SMS or voice call once to verify
  the number.  After that, the registration is sticky.
- Group invites require either an admin manually adding the bot, or
  the bot being added via a group invite link.  Signal's
  invite-link API is partial.

### Adapter sketch — `SignalBridge` against `signal-cli` JSON-RPC

```js
// apps/household/src/bridges/SignalBridge.js (sketch, not real)

export class SignalBridge {
  constructor({ phoneNumber, signalCliEndpoint = 'http://127.0.0.1:8080', fetchFn }) {}

  async start() {
    // Open a JSON-RPC connection to signal-cli (running locally,
    // started separately) and subscribe to the receiveMessage
    // stream.  signal-cli pushes incoming messages over stdout
    // or via WebSocket depending on its mode.
  }
  async stop() {
    // Close the subscription.  signal-cli itself stays running.
  }
  async sendReply({ chatId, replyTo, text, buttons }) {
    // POST to signal-cli's send endpoint.  chatId is either a
    // phone number (1:1) or a group id (Base64).
    // Buttons: SIGNAL DOES NOT HAVE INLINE BUTTONS.  See below.
  }
  onMessage(handler) {}
  get bridgeId() { return 'signal'; }
}
```

### Where `MessagingBridge` flexes

The interface holds, but two of its features need adapter-side
compromises on Signal:

**(a) Inline buttons — not supported.**  Signal has no equivalent of
Telegram's inline keyboards.  Three options:

- **Drop buttons silently on Signal.**  `sendReply({ buttons })`
  ignores `buttons` and just sends the text.  The user types out
  their reply (`done bread`) instead of tapping.  Easiest.
- **Render buttons as a numbered text menu.**
  `[1] ✓ done bread / [2] ✓ done milk / Reply with the number.`
  Then the bridge intercepts numeric replies and synthesises the
  corresponding `IncomingMessage` with the button id as text.
  Works but adds adapter-level state.
- **Emoji reactions.**  Signal supports message reactions; the bot
  could ask "react with 👍 to mark complete".  Reactions ARE
  visible to bots via signal-cli.  Not great UX (small
  affordance).

Lean: **drop buttons silently for v0**.  Optionally promote to the
numbered-menu approach when a user complains.

**(b) `replyTo`.**  Signal supports message quoting (the "reply"
gesture).  signal-cli exposes it as `quote: { id, author, text }`
on the send call.  Map our `replyTo` → quote field.  Round-trip
works.

**(c) Privacy filtering.**  Signal doesn't have Telegram's
"privacy mode" — bots see everything in groups they're members of.
Implement the addressed-only filter (Q-H2.4) entirely adapter-side:

- Direct messages (1:1 chat) → always addressed.
- Group messages → addressed iff:
  - The text contains `@<botName>` (Signal supports @-mentions
    natively now).
  - OR the message's `quote` field points at a recent bot message.

### Deployment cost

For testing: run `signal-cli` in `daemon` mode locally on the
agent's host.  Java runtime required.  Signal account needed.

For production: same, plus the signal-cli daemon should be wrapped
in a systemd unit alongside the agent.

Signal's protocol uses pre-key bundles + double-ratchet — the
daemon process must persist its state directory; lose the state
directory and the bot's registration is gone, must re-register.
Document the state directory's location prominently in any
deployment notes.

### Trap list (will populate during real implementation)

- VoIP-number bans on Signal — verify the number works before
  rolling out.
- Group-invite-link API gaps mean the bot may need to be added
  manually each time a household forms.
- signal-cli's JSON-RPC is the "supported" surface but evolves;
  pin the version.
- Registration codes via SMS / voice call are one-shot and rate-
  limited — getting them wrong burns time.
- Multi-device registration: signal-cli typically registers as the
  PRIMARY device.  If a member also runs Signal on their phone with
  the same number (don't), things break.

---

## Matrix — exploration

### Status

❌ Not started.  But the closest fit for the project's ethos:
federated, open-source, end-to-end-encrypted, real bot ecosystem.

### Verdict (TL;DR)

**The cleanest second-platform pick after Telegram.**  Matrix has a
mature bot ecosystem (`matrix-bot-sdk`, `matrix-nio`), a federated
network (no central trust), and end-to-end encryption (E2EE) that
matches the project's privacy posture.  The big caveat: E2EE on a
bot account requires a verified device — more setup than Telegram,
but well-documented.

### Why Matrix is the natural second platform

- **Open + federated.**  No corporate gatekeeper.  Aligns with the
  project's "decentralised infrastructure" pitch.
- **Real bot story.**  Bots are first-class accounts (no VoIP-number
  weirdness), and the libs (`matrix-bot-sdk` for Node, `matrix-nio`
  for Python) are mature.
- **Inline UI primitives.**  Reactions, quote-replies, threads, and
  m.notice messages.  No native inline keyboards (so same compromise
  as Signal — render numbered menus or use reactions).
- **Self-hostable.**  Households can run their own Matrix homeserver
  (`Synapse`, `Conduit`, `Dendrite`) and never trust a third-party
  service at all.

### Adapter sketch — `MatrixBridge` against `matrix-bot-sdk`

```js
// apps/household/src/bridges/MatrixBridge.js (sketch)

import { MatrixClient, SimpleFsStorageProvider } from 'matrix-bot-sdk';

export class MatrixBridge {
  constructor({ homeserverUrl, accessToken, storageDir }) {
    const storage = new SimpleFsStorageProvider(storageDir);
    this.#client = new MatrixClient(homeserverUrl, accessToken, storage);
  }
  async start() {
    this.#client.on('room.message', (roomId, event) => {
      if (event.sender === this.#client.userId) return; // skip own messages
      this.#handleIncoming(roomId, event);
    });
    await this.#client.start();
  }
  async stop() { await this.#client.stop(); }
  async sendReply({ chatId, replyTo, text, buttons }) {
    // chatId = roomId.  Build an m.room.message event.  Buttons:
    // render as numbered text or as a thread-poll (advanced).
  }
  onMessage(handler) { this.#handler = handler; }
  get bridgeId() { return 'matrix'; }
}
```

### Where `MessagingBridge` flexes

- **Buttons**: same compromise as Signal — render as numbered text
  or use reactions.  Matrix's `m.poll` event type is technically
  available but supported unevenly across clients (Element web/iOS
  yes; older clients no).
- **`replyTo`**: native (`m.in_reply_to` field).  Maps cleanly.
- **E2EE**: a Matrix bot is "verified" if it shares device keys
  with the room.  `matrix-bot-sdk` has `setupCrypto()` for this.
  First-time setup needs the bot to be cross-signed by an existing
  member (one-time UX).  Without crypto, the bot only sees plaintext
  rooms.

### Deployment cost

- Pick a homeserver (or self-host).  Matrix.org is the default
  public one but doesn't inspire confidence for a privacy-focused
  household.  A small VPS running `Conduit` or `Synapse` is the
  ethos pick.
- Bot account = real Matrix user with `@household:example.org`.
- E2EE setup is a one-time onboarding step; document carefully.

### Trap list (anticipated, not yet seen)

- E2EE store synchronisation across restarts — `SimpleFsStorageProvider`
  is fine but the storage directory is critical.
- Federation latency: the bot's homeserver may take seconds to see
  messages from other homeservers.  Probably fine for 30-min nudges,
  worth measuring.
- Spam / unauth-room joins — Matrix has these on the open federation;
  bots should auto-leave any room they didn't expect to be in.

---

## Decision matrix

| Concern | Telegram (shipped) | Matrix | Signal |
|---|---|---|---|
| Native bot platform | ✅ | ✅ | ❌ (signal-cli) |
| Lib maturity (Node) | telegraf — excellent | matrix-bot-sdk — good | signal-cli REST — fair |
| Inline buttons | Native | Numbered-menu compromise | Numbered-menu compromise |
| `replyTo` round-trip | Native | Native (m.in_reply_to) | Native (quote) |
| Identity tied to | Bot token (BotFather) | Account (homeserver) | Phone number (real) |
| E2EE | ✗ (server-trusted) | ✅ (with crypto setup) | ✅ (always) |
| Self-hostable | ✗ | ✅ (Synapse/Conduit) | ✗ (federation closed) |
| Open-source? | client only | server + client | client + protocol |
| Project-ethos fit | Pragmatic | Highest | Mid |
| Effort to ship 2nd | n/a | ~1 week | ~1.5 weeks |

### What I'd recommend

**For the next platform: Matrix.**

- Cleanest ethos fit.
- Mature lib.
- E2EE is a real privacy benefit (Telegram only encrypts in transit
  to the server; Matrix encrypts client-to-client when crypto is on).
- Federation lets households self-host if they want.

**Signal makes sense if:**

- You're targeting households who already use Signal heavily.
- You're willing to absorb the signal-cli ops cost.
- You don't mind the phone-number-account oddness.

**Discord, WhatsApp, iMessage are off the table for v0:**

- Discord — first-class bots but ethos mismatch (gamer-y, corporate).
- WhatsApp — bot platform requires Meta business approval; not for
  household-scale anything.
- iMessage — Apple-only, no official bot API for groups.

---

## Implementation roadmap (when "second platform" lands)

If/when the household app actually goes through this, the slicing
mirrors Phase 1's parallel-streams approach:

1. **Foundation** (1 dev, ~1 day): the `MessagingBridge` interface
   already exists.  No SDK changes.  Confirm the interface still
   fits — extend if needed (probably not).
2. **Stream — `<NewPlatform>Bridge`** (1 dev, ~1 week for Matrix /
   ~1.5 weeks for Signal): implement the new adapter conforming to
   `MessagingBridge`.  Test seam (`fetchFn` or `clientFactory`)
   for unit tests; gated integration tests for real-world.
3. **Convergence** (1 dev, ~1 day): wire the new adapter into
   `HouseholdAgent.bridges` alongside Telegram.  Verify both fire
   independently (skill replies route to the bridge that received
   the message; nudge / digest can post to either or both).
4. **Polish + docs**: update TESTING.md with the platform's setup
   recipe; update this file with traps discovered.

---

## Reading list

- Telegram bot API: https://core.telegram.org/bots/api
- telegraf docs: https://telegraf.js.org/
- signal-cli: https://github.com/AsamK/signal-cli
- signal-cli-rest-api: https://github.com/bbernhard/signal-cli-rest-api
- Matrix bot SDK: https://github.com/turt2live/matrix-bot-sdk
- Conduit (lightweight Matrix homeserver): https://conduit.rs/
- Synapse (reference Matrix homeserver): https://github.com/matrix-org/synapse

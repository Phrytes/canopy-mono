# H2 — Household app (chat-driven, LLM-mediated household state)

| | |
|---|---|
| **Status** | Design with answers locked (2026-04-30 evening — Q-H2.1–14 all answered).  Implementation plan still deferred to a follow-up document. |
| **Started** | 2026-04-30 (drafted by consolidating prior sources; answers locked same day) |
| **Owner** | unassigned |
| **App name** | TBD — placeholder names: **Hearth**, **Stoel**, **Bord** (Dutch for "plate", evokes shared meal-times), **Telex**.  Confirm before kickoff. |
| **Blocked on** | nothing structurally.  Track A + B + D shipped.  Local LLM choice (Q-LLM) is the only outstanding gate; first deployment can decide. |

**Goal:** ship the household-chat app described in the user's framing —
a Telegram bot that watches a family/housemate channel, lets the LLM
extract structured items from natural-language utterances ("we need
bread"), stores them in a shared household pod, and replies on demand
with filtered, completed-or-open lists.  Privacy-aligned: the LLM is
local; chat content never leaves the household.

This is the **first @canopy app where the LLM is the agent's
intelligence**, not just a tool.  The SDK provides identity,
transport, capabilities, role-aware groups, pod storage; the LLM
provides parsing + classification + extraction.

**Refs (consolidated into this doc):**

- [`../projects/07-household-app/README.md`](../projects/07-household-app/README.md)
  — L2 design notes (the most detailed source).
- [`../projects/07-household-app/llm-cost.md`](../projects/07-household-app/llm-cost.md)
  — feasibility + hardware + monthly cost analysis.
- [`./track-H-design-sketches.md`](./track-H-design-sketches.md) §H2 —
  the "Telegram-as-keyboard" functional sketch with Twist 1 + 2.
- [`../USE CASES.md`](../USE%20CASES.md) §7 — cross-cutting use-case
  summary (post pass-3 refresh).
- [`../LOCAL LLM OVERVIEW.md`](../LOCAL%20LLM%20OVERVIEW.md) —
  cross-project local-LLM reasoning.
- [`./track-H-app-folio.md`](./track-H-app-folio.md) — Folio's
  pod-client + sync-engine layering is reusable here for the pod
  side of the bot.
- [`../projects/04-tasks-app/README.md`](../projects/04-tasks-app/README.md)
  — H4's task model is what household items aspire to migrate into
  later.

---

## Why this is project #7 and NOT a variant of H4 (Tasks)

Tempting to call this "H4 Tasks with chat input."  It isn't:

- **H4 is structured.**  Tasks have explicit DAG dependencies, skill
  requirements, claim semantics, role-based permissions.  Input is
  user-driven via a tasks UI.
- **H2 is freeform.**  A household chat is a stream of unstructured
  natural-language utterances, most of them noise, with structure
  *inferred* by the LLM.

The two end up with overlapping pod state ("a list of open items the
household cares about") but the **acquisition pattern is fundamentally
different**.  Trying to design one app that does both ends up doing
both badly.

That said: post-extraction, household items can be stored *in the
same task-ledger schema H4 uses*.  Item lifecycle (open / claimed /
complete) is the same; the input pipeline is the difference.  **Keep
the schemas aligned** so a household that grows into "we'd like a
proper task DAG" can migrate smoothly.

---

## The user's ambition (verbatim Dutch + English reading)

Preserved verbatim from the user's framing — useful as the durable
acceptance test for whether v0 actually delivers what was asked for:

> Een soort huisgenoten-app, bijv:
>
> - een telegramkanaal die je een appje kunt sturen met 'we hebben
>   brood nodig'
> - dit wordt weer allemaal opgeslagen in ofwel een gezamenlijke
>   pod, of een gezamenlijke pod die linkt naar items op de
>   individuele pods
> - vervolgens haal je, voor je naar de winkel gaat, deze lijst op
>   door het telegramkanaal te appen met 'wat hebben we nodig in
>   de supermarkt?'
> - dan worden alle berichtjes die nog niet gemarkeerd zijn als
>   compleet opgehaald, geanalyseerd door de llm, gefilterd (heel
>   veel huishoudelijke appjes zijn irrelevant) en vervolgens komt
>   de juiste lijst toegestuurd
> - na 30 minuten oid appt de llm de gebruiker via het tg-kanaal
>   wat er allemaal is afgewikkeld (of wanneer het weer opnieuw
>   moet appen)
> - de gebruiker appt na afloop welke punten afgestreept kunnen
>   worden
> - de llm vertaalt dit weer naar welke taken afgestreept kunnen
>   worden en update desbetreffende items in de pods, zodat die
>   niet opnieuw opgehaald hoeven worden

**English reading:** A bot in a household Telegram channel watches
incoming messages.  A local-LLM-mediated agent classifies each
message (actionable / noise), extracts structured items from
actionable ones (shopping, repair, errand, schedule), stores them in
a shared household pod.  On retrieval ("what do we need at the
supermarket?"), it returns a clean filtered list.  After completion,
it follows up, captures what got done, updates pod state.

---

## What you see (v0 functional sketch)

Direct port from `track-H-design-sketches.md` §H2.  Concrete UX target.

In the family Telegram chat:

```
[Anne]    "@Household milk needs buying"
[Bot]     ✓ added to groceries
[Bot]     ▸ assigned to: anyone in household
          ▸ list now: milk, bread, eggs, chicken (+1)

[the author]   "@Household I bought groceries"
[Bot]     ✓ marked groceries done.  Anything else?

[L.]      "@Household someone please pick me up at 17:00"
[Bot]     🚗 ride request: today 17:00 from school
          who can?   [I can — the author]   [I can — Anne]   [neither — postpone]
[the author taps "I can"]
[Bot]     ✓ the author will pick L. up at 17:00.
[the author]   "@Household running 5 min late"
[Bot]     ✓ updated. L., the author is 5 min late.
[L.]      "@Household ok"
```

Inline buttons (Telegram's native "inline keyboard") are first-class
where the action is small/pickable; freeform replies for everything
else.

**For the user's ambition specifically — shopping flow:**

1. Members send messages: "we need bread", "we're out of cocoa", "buy
   tomato passata".  Bot reacts with `✓` (added) or stays quiet
   (classified as noise).
2. Member messages "what do we need in the supermarket?".  Bot pulls
   open items where `type='shopping'` from the household pod, returns
   a clean list.
3. After ~30 min (configurable per household), bot sends "what got
   done?".  Member replies "got bread + cocoa".  Bot marks those
   complete.

**Twist 1 — the bot is a household member, not a feature.**  The bot
has a name, an avatar, and shows up in the household app's member
list with role `coordinator` (per Track D).  It can issue membership
proofs to new members ("Anne adds @Household-Bot to family chat → bot
detects this in Telegram → bot prompts Anne in DM to also join the
household app → bot mints her a household membership proof once she's
verified").  The bot is the social bridge between Telegram (where
everyone already lives) and the agent ecosystem (where the data lives).

**~~Twist 2 — implicit signals, not just commands.~~  Dropped per
Q-H2.4.**  The bot only responds when addressed (`@Household ...`
mention, reply-to-bot, or DM).  No passive watching of unaddressed
chat.  This rules out a class of false-positives and reduces privacy
unease.  If a household later wants ambient extraction, the
LLM-skill machinery is still there — it'd just take dropping the
adapter's "is the message addressed?" filter.

---

## Architecture

**One process, one agent, one or more messaging adapters.**  Earlier
drafts of this section described a "bridge agent" and a "household
agent" as separate runtimes with skill-calls between them — that was
over-engineered.  The bot has a separate *cryptographic identity* (its
own keypair, audit-trail-distinguishable from human members), but
that's independent of how the code is organised.  V0 ships as a
single Node process.

```
                Telegram (long-poll or webhook)
                          │
            ┌─────────────▼──────────────┐
            │  Telegram adapter          │  ← one of N possible
            │  - listens, parses,        │    `MessagingBridge` impls
            │    posts replies           │
            └─────────────┬──────────────┘
                          │ in-process function calls
            ┌─────────────▼──────────────────┐
            │  Household agent (Node)        │
            │  - skills: addItem, listOpen,  │
            │    markComplete, …             │
            │  - LLM-mediated skill          │
            │    (classifyAndExtract)        │
            │  - tool-catalog accessor       │
            │  - pod read/write              │
            │  - vault: bot keypair +        │
            │    bot-token + member webids   │
            └────┬───────────────────┬───────┘
                 │ prompts            │ pod ops
                 ▼                   ▼
        ┌────────────────┐    ┌──────────────────┐
        │ Local LLM      │    │ Household pod    │
        │ (Ollama)       │    │ (Solid)          │
        │ qwen2.5:3b     │    │ /household/      │
        └────────────────┘    └──────────────────┘
```

### Why one process and not two

I wrote the original two-agent split because Twist 1 in the design
sketch ("the bot is a household member, not a feature") phrased the
bot as a first-class participant.  That's a statement about *identity*
— the bot has its own keypair, its own member-list entry, its own
audit-trail signature — not about *runtime layout*.

For v0 with only Telegram:

- One process is simpler to deploy, debug, and reason about.
- The "second messaging platform" justification for splitting is
  hypothetical until Signal / Matrix / Discord actually arrives.
- No IPC (inter-process communication) overhead — adapter and skills
  share memory, function calls are direct.
- The bot still has its own cryptographic identity inside the same
  process; nothing about "one process" forces "one identity".

When a second backend lands (likely Signal next; ethos-aligned —
federated + open-source), the right move is **a second adapter
inside the same process**, both implementing a common interface
(`MessagingBridge` — see callout below).  Splitting into separate
processes only becomes attractive if one adapter has different
deployment constraints than the other (e.g., webhook needs a
public-internet endpoint and you want to keep the LLM behind NAT).
That's a deployment decision, not a v0 design decision.

### `MessagingBridge` interface — the small abstraction we keep real

Even though v0 ships only Telegram, we define + use the abstraction
from day one so v1 doesn't trigger a refactor:

```ts
interface MessagingBridge {
  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;

  // Outgoing — the agent calls this to post a reply.
  sendReply(args: {
    chatId: string;          // platform-scoped opaque id
    replyTo?: string;        // message-id this is a reply to
    text: string;
    buttons?: Array<{ id: string; label: string }>;
  }): Promise<void>;

  // Incoming — the bridge calls the agent's onMessage.
  onMessage(handler: (msg: IncomingMessage) => Promise<Reply>): void;
}

type IncomingMessage = {
  bridgeId: 'telegram' | 'signal' | 'matrix' | …;
  chatId:   string;
  messageId:string;
  sender:   { displayName: string; bridgeUid: string; webid?: string };
  text:     string;
  replyTo?: string;
  isAddressed: boolean;     // true when @-mentioned, false for ambient
};

type Reply = { replies: Array<{ text: string; buttons?: Array<{ id: string; label: string }> }>;
                stateUpdates: Array<...> };
```

The Telegram adapter implements this interface.  A Signal adapter
later does the same.  The household agent talks only to the
interface — it doesn't know which platform a message came from.

### Components in the v0 process

The single Node process holds:

1. **Telegram adapter** (implements `MessagingBridge` above).  Uses
   `node-telegram-bot-api` (or `telegraf` — locked per Q-H2.1).  Holds
   the Telegram bot token in `OAuthVault` (Track F1).  Stateless apart
   from a per-chat message cursor (so we don't reprocess the same
   message after a restart).
2. **Household agent skills** — `addItem`, `listOpen`,
   `markComplete`, `nudgeCompletion`, `removeItem`, etc.  Plain
   functions registered with the agent's `SkillRegistry`.  The key
   one is **`classifyAndExtract(message, context)`**, whose
   implementation calls the local LLM with the other skills
   advertised as tools.
3. **Local LLM client** — Ollama-hosted, default `qwen2.5:3b-instruct`.
   Speaks OpenAI-API-compatible tool-calling JSON so model swaps stay
   cheap.  Pluggable provider (Q-H2.12 — opt-in cloud is the same
   code path with a different base URL).
4. **Vault** — keys held: bot's keypair (signs autonomous bot actions),
   per-member webids (used when acting on a member's behalf), Telegram
   bot token, household group key.

### Adapter → agent flow (one round-trip)

When the Telegram adapter receives an incoming message, it does a
small filter and calls into the agent:

1. **Cheap filter** (in the adapter): is the message addressed to the
   bot?  (`@Household ...` mention, reply-to-bot, or direct message.)
   Yes → continue.  Otherwise → drop silently (per Q-H2.4 lock).
2. **Hand to the agent** (function call): adapter calls
   `agent.onMessage(incomingMessage)`.
3. **Two-path routing inside the agent (Path 2, locked):**
   - **Fast path — regex.**  Try the structured-command grammar
     (`add <type> <text>`, `list <type>`, `done <id|keyword>`,
     `help`, `what do we need?`, etc.).  Match → call the
     corresponding skill directly.  Sub-second.
   - **Slow path — LLM.**  No regex match → hand the message to
     `classifyAndExtract`, which calls the local LLM with the
     agent's tool-catalog as available tools.  Used for freeform
     input ("we need bread, milk, and toilet paper this week";
     multi-clause, mixed-language, ambiguous-intent messages).
   - **LLM-unavailable fallback.**  If the LLM is offline (suspended
     server, crashed Ollama), reply with a hint to use a structured
     command instead.  Bot stays useful.
4. **Reply** — agent returns `{ replies, stateUpdates }`.  Adapter
   walks `replies` and posts each one to Telegram via `sendReply`.

No skill-call-over-the-wire.  No serialization between layers.  The
adapter and the agent live in the same module graph; the
`MessagingBridge` interface is the only contract between them.

### Household agent — `classifyAndExtract` flow

```js
async function classifyAndExtract({ chatId, messageId, sender, text, replyTo, mode }) {
  // 1. Pull recent context (last N messages from chat-meta cursor).
  const ctx = await loadContext(chatId);
  // 2. Call the LLM with tool catalog.
  const result = await llm.invoke({
    system: PROMPT_HOUSEHOLD,
    messages: [...ctx, { role: 'user', content: text }],
    tools: agent.skills.toolCatalog({ scope: 'household' }),  // L0 SDK addition
  });
  // 3. The LLM returns either a tool call (e.g. `addItem({ ... })`),
  //    structured JSON ("classification: noise"), or a reply text.
  if (result.toolCall) {
    const toolResult = await agent.invokeSkill(result.toolCall.id, result.toolCall.args);
    return composeReply(toolResult, sender);
  }
  if (result.classification === 'noise') return { replies: [] };  // silent
  return { replies: [{ text: result.replyText }] };
}
```

The LLM is the parser; the SDK skills are the executors.  This keeps
the LLM's responsibilities small and verifiable.

---

## Pod schema

### Hybrid pod from v0 (Q-H2.6 lock)

H2 will be the **first @canopy app to ship the hybrid-pod pattern**
documented in `Design-v3/topology.md` § Hybrid pod patterns.  Three
pods are involved:

```
─── per-member pod ─────────────────────────────────────────
  /private/                       (read-only to other members)
    errands.json                  # Anne's personal errands

─── per-bot pod ────────────────────────────────────────────
  /bot/                           (admin = household admins, root = bot)
    config.json                   # bot's settings, model choice, prompt rev
    audit/yyyy-mm.jsonl           # local LLM call audit log
    chat-meta/<chatId>/cursor.json # last-processed Telegram message id
    bot-token.enc                 # F1 OAuthVault entry — Telegram bot token

─── shared household pod ───────────────────────────────────
  /household/
    config.json                   # household name, member webids, group key id
    groceries/
      open/<ulid>.json            # type='shopping' — shared, encrypted to group key
      done/yyyy-mm/<ulid>.json    # archived monthly
    errands/                      # household-shared errands (anyone can pick up)
      open/<ulid>.json            # references per-member errands.json when relevant
      done/yyyy-mm/<ulid>.json
    repairs/                      # type='repair' (longer-lived; rarely auto-archived)
      open/<ulid>.json
      done/yyyy-mm/<ulid>.json
    schedule/yyyy-mm/<dd>.jsonl   # one line per scheduled event for that day
    chat-archive/                 # OPTIONAL — only if user enabled per-chat archive (Q-H2.2)
      <chatId>/yyyy-mm/messages.jsonl
```

**Item-routing convention**: an item is "household-shared" if it's
relevant to the whole household (groceries everyone benefits from,
shared errands, repairs).  An item is "personal" if it's
member-specific (Anne's dentist appointment).  Personal items go on
the member's pod; the household pod can hold a *reference* if it's
useful for the household to see "Anne is busy at 14:00 Friday"
without seeing what for.

**Bot's pod governance** (Q-H2.6 lock follow-up):
- Bot's keypair is the pod's root credential.  Stored in the same
  vault as other secrets on the private server.
- Every household member with the `admin` role (Track D's role-aware
  groups) holds an admin capability token granting full read/write/
  manage on the bot's pod.
- If the bot misbehaves or the keypair is compromised, any human
  admin can: revoke the bot's capabilities, mint a new bot keypair,
  update the household pod's references to point at the new one,
  read everything in the bot's pod, audit history, roll back actions.
- The bot's pod survives household membership changes; nothing is
  re-encrypted to a new admin's key.  The capability tokens are
  what change.

**Encryption.**  Each pod is encrypted to its respective group key:
- Per-member pod → member's own key.
- Bot's pod → bot's key + household-admin capability tokens.
- Household pod → household group key (rotated when membership
  changes).

Same encryption-by-ACL convention used by Folio + Archive.

**Caveat — first-of-kind.**  This is genuinely the first @canopy
app to ship hybrid pods.  Folio + Archive validated single-pod
patterns; H2 validates hybrid.  The implementation pass should
expect to discover the kind of fence-post details that surfaced
during Folio's mobile bring-up.  Document in a `HYBRID-POD-NOTES.md`
under `apps/household/docs/` if traps come up.

### Schema alignment with H4

Each open item conforms to a subset of H4's task shape:

| Field | H2 v0 | H4 |
|---|---|---|
| `id` | ULID | ULID |
| `type` | `'shopping' \| 'errand' \| 'repair' \| 'schedule'` | open enum |
| `text` | freeform string | `title` (string) |
| `addedBy` | webid | webid |
| `addedAt` | ms epoch | `createdAt` |
| `claimedBy` | webid \| null | `assignee` |
| `completedAt` | ms epoch \| null | matches |
| `source` | `{ tg: { chatId, messageId } }` | open dict |
| `subTasks` | absent in H2 v0 | DAG of subtasks |
| `dueAt` | optional | optional |

A household that "graduates" to H4 can lift these into the H4 schema
without a migration — H4 just ignores the `source.tg` field and
treats each item as a standalone task.

---

## LLM choice + hardware (distilled from `llm-cost.md`)

### Workload shape

Classification + extraction, **not reasoning or creative generation.**
Latency tolerance is **seconds**, not sub-second.  Throughput is
**5–30 requests/day per household.**  Concurrency is **1**.  This is
unusually friendly to small local LLMs.

### Model

- **`qwen2.5:3b-instruct`** — recommended starting point.  Strong
  classification, good Dutch support, decent tool-calling.  3B params,
  fits in 4 GB RAM via Ollama.
- **`phi3.5:mini` (3.8B)** — comparable; Microsoft.
- **`qwen2.5:7b-instruct`** if hardware permits (~8 GB RAM) —
  meaningful quality jump.
- **Avoid `llama-3.2-3b`** for the v0 — weaker tool-calling.

The agent treats the model as a swappable resource behind a clean
skill interface.  Swapping models (or temporarily a cloud API) is a
config change, not a code change.

### Hardware (NL @ €0.30 / kWh)

| Setup | Up-front | Idle | Monthly elec | 3B fit |
|---|---|---|---|---|
| Whatever you already have (laptop) | €0 | n/a | €0 marginal | Good |
| Raspberry Pi 5 8 GB | ~€100 | ~5 W | ~€1.10 | Acceptable |
| Used Mac mini M1 8 GB | ~€350 | ~6 W | ~€1.30 | Fast |
| **Used Mac mini M2 16 GB** | **~€500** | **~8 W** | **~€1.70** | **Very fast** |
| Cloud GPU dedicated | n/a | n/a | ~€200-400 | Excellent |

**Production recommendation: used Mac mini M2 16 GB, ~€500 once,
~€2/mo electricity.**  Co-host the household's Solid pod on the same
hardware to amortise.  Wake-on-LAN auto-suspend can drop idle to ~1 W
between requests.

### Local-LLM-as-default (privacy)

Cloud APIs are technically cheaper (~€0.50/mo) than self-hosting
electricity, but cloud APIs send every household conversation to a
third party.  **For H2, "cheaper" is not the deciding factor —
privacy is.**  Cloud-API support exists in the agent (it's just
another LLM provider) but is opt-in, with a visible warning.

---

## Privacy posture

Inherits the project's defaults; called out explicitly because
household data is intimate:

- **Raw Telegram messages are NOT persisted to the pod by default.**
  Only the *extracted structured items* land in the pod.  Telegram
  itself retains the chat history (the household already accepts
  this).  V1 may add an opt-in encrypted chat-archive section.
- **LLM runs local.**  No conversation goes to OpenAI / Anthropic /
  Google.
- **Pod data is encrypted to the household group key.**  Per
  encryption-by-ACL convention.  The bot has a per-bot capability
  token (Track A's `CapabilityToken`), not the group key directly —
  it can read/write but the human members own the key.
- **Bot agent identity is its own keypair**, not a shared household
  identity.  Audit trails distinguish "the author added bread" from "bot
  marked groceries done".
- **Audit log every LLM call**, locally.  Inputs + outputs to a
  rotating log on the private server, in case a hallucination needs
  to be retraced.  Not synced to the pod.

---

## Hallucination tolerance + UX safety net

Small local LLMs sometimes misclassify ("buy gym membership" →
shopping?) or invent items.  Two-pronged mitigation:

1. **Per-extraction confirmation.**  When the LLM extracts an item
   from a message that wasn't a direct command (i.e. ambient
   classification, not `@Household add ...`), the bot replies with a
   `✓ added: <item>  [undo]` confirmation.  One-tap undo within 60 s
   removes it from the pod and the bot's memory.  Direct commands
   skip this — `@Household add bread` is unambiguous.
2. **Daily / weekly digest.**  At a configurable cadence ("Sunday
   evening"?), the bot posts the current open list to the channel as
   a markdown message.  Members can see it and edit if anything's
   wrong.  Cadence per Q-H2.7.

These are *post-hoc* safety nets.  *Pre-hoc* safety: a quality-bar
test that gates model selection — give the candidate model 50 real
household messages in your target language, and verify ≥90% precision
+ ≥80% recall on shopping extraction.  See `llm-cost.md`.

---

## SDK surface (what's new vs. what reuses)

### Reuses existing SDK primitives

| Primitive | Source | Use |
|---|---|---|
| Solid pod with storage convention (small/structured = direct, big = reference) | Track A | All household state |
| Encryption-by-ACL | Track A | Encrypted to household group key |
| Role-aware groups (Group X) | Track D | Member / admin / guest roles |
| Closed-group invitation governance | Track D + relay | Bot-as-coordinator can mint membership proofs |
| `CapabilityToken` | `packages/core/src/permissions/CapabilityToken.js` | Bot's authorization to read/write pod |
| `OAuthVault` | Track F1 | Telegram bot token storage |
| `PodClient` (read/write/list) | `packages/pod-client/` | Item CRUD |
| Skill registry + skill calls | `packages/core/src/skills/` | Bot/LLM tool catalog |

Folio's pod-client + sync-engine layering is also reusable for the
pod side of the bot — though H2 doesn't need a *local-folder ↔ pod*
sync because all writes go directly to the pod from the agent.

### New — likely L1 SDK additions (promote when a second consumer arrives)

- **LLM-skill wrapper pattern.**  An idiomatic way to register a
  skill where the implementation is "ask an LLM, with these other
  agent skills available as tools."  Could ship as a small helper in
  `@canopy/core/llm` or stay app-level.  Lean: **start app-level**;
  promote to L1 when H3 (Household V1) lands so the helper is shared.
- **External-bot-bridge pattern.**  How a Telegram (or Signal /
  Matrix / Discord) bot agent hooks into the SDK so its incoming
  messages become skill calls and outgoing messages flow naturally.
  App-level for Telegram-only; promote to L1 if a second platform
  follows.  Closest existing analogue is `A2ATransport` for HTTP, but
  chat bots are a different shape (long-poll / webhook, bot tokens
  not pubkeys).  Lean: **start app-level**; design the
  `MessagingBridge` interface in v0 so the second platform is a
  drop-in.

### New — required L0 SDK addition

- **Tool-catalog accessor on `SkillRegistry`.**  When the LLM needs
  to know what other skills are available to call, it should be able
  to query the agent's skill registry and get a list with signatures
  + descriptions.  Already partially in
  `packages/core/src/skills/SkillRegistry.js`; needs a clean
  consumer-facing accessor:
  ```js
  agent.skills.toolCatalog({ scope: 'household' })
    → [{ id: 'addItem', description: '...', schema: { ... } }, ...]
  ```
  Small, isolated change.

### Conversation-state primitive — open question

Tracking "this is the ongoing conversation in chat X" across many
turns.  Could be a thin wrapper over `StateManager`; could remain
app-level.  Lean: **app-level for v0**; reconsider when H3 (LLM
ramp-up) needs more sophisticated multi-turn state.

---

## Locked decisions (Q-H2.1 – Q-H2.14)

All design questions resolved 2026-04-30 evening.  Companion
worksheet (with rationales + alternatives considered) lives in
[`./track-H-app-household-questions.md`](./track-H-app-household-questions.md).

| # | Question | **Locked** |
|---|---|---|
| Q-H2.1 | Bot framework | **`telegraf`** — mature, Promises/async-await, larger community.  Phone-compat concern resolved: any future household phone client talks REST to the agent (not directly to Telegram), so the lib only needs to work on Node. |
| Q-H2.2 | Chat archive retention | **Configurable per chat, default forever.**  Encrypted; low storage cost.  Optional section — raw chat is NOT persisted by default, only extracted items are. |
| Q-H2.3 | Bot deployment (webhook vs long-polling) | **Support both.**  Webhook for production (the LLM needs a server anyway, so a public endpoint is already on the table); long-polling for dev/test.  Choose via env var or config. |
| Q-H2.4 | Twist 2 — implicit signals / passive suggestions | **Dropped.**  Bot only responds when addressed (`@Household ...`, reply-to-bot, or DM).  No passive watching of unaddressed chat.  Removes a whole class of false-positives + privacy unease. |
| Q-H2.5 | `MessagingBridge` interface in v0 | **Define it now.**  ~50 LOC of interface + Telegram adapter that conforms.  Cheap insurance for v1 (Matrix is the natural second platform — federated + open-source + ethos-aligned).  Signal fits the interface but with a clunkier underlying integration (signal-cli; no first-class bot platform). |
| Q-H2.6 | One pod or many | **Hybrid pod from day 1.**  Each household member has their own pod; the bot has its own pod (treated as a member); a shared household pod holds genuinely-shared state and references to per-member items.  H2 will be the first @canopy app to ship the hybrid pattern documented in `Design-v3/topology.md`.  Bot's pod governance: bot's keypair is root; admin role on the household group → admin capability on the bot's pod (any human admin can read everything, kick the bot, rotate keys, audit history, roll back actions). |
| Q-H2.7 | Completion-loop cadence | **(a)** 1-hour default delay before per-activity nudge.  **(b)** Daily digest at **20:00 local**, configurable per household. |
| Q-H2.8 | Hallucination tolerance / confirmation flow | **Trust direct commands silently** — no per-commit undo button.  Daily digest is the safety net.  Justified because Twist 2 is dropped (Q-H2.4) — there are no ambient extracts that could surprise the user; everything is directly commanded. |
| Q-H2.9 | Multi-language quality bar | **Ad-hoc script first time we deploy.**  Run 50 real chat messages through the chosen model, measure extraction precision/recall.  Promote to a real test harness only if we end up swapping models more than once. |
| Q-H2.10 | LLM production hardware | **Defer.**  Testing on whatever's already on (laptop, etc.).  Decision deferred to first real deployment — could be Mac mini M2, Pi 5, an existing always-on machine, or a friend's spare device. |
| Q-H2.11 | Tool-calling shape | **OpenAI-style JSON schema.**  Universally supported (Qwen, Phi, Llama, GPT, Claude via translation, Mistral); minimal implementation surface.  MCP rejected as over-engineered for a single-agent setup. |
| Q-H2.12 | Cloud LLM as opt-in | **Support, opt-in only, behind a visible warning.**  Same code path as local; just a different base URL.  Privacy warning: "Are you sure?  Your household chat will be sent to <provider>." |
| Q-H2.13 | Bot identity | **Own keypair.**  Audit trail distinguishes "the author added bread" (signed by the author's webid) from "bot marked complete" (signed by bot's keypair).  Bot is a member, not a feature. |
| Q-H2.14 | Channel-to-pod mapping | **Single channel = single pod.**  One Telegram chat feeds one household; multi-pod routing is V1+ if it ever turns out to be needed. |

### LLM-vs-rules — meta-decision (added during the lock pass)

Originally H2 was framed as "every message goes through the LLM."
After locking Q-H2.4 (no Twist 2 / addressed-only), most of the LLM's
job evaporated for direct commands.  Three paths discussed:

- **Path 1**: rule-based only (regex / slash commands), no LLM.
- **Path 2**: hybrid — regex first, LLM fallback for freeform.
- **Path 3**: LLM-everything (the original design).

**Locked: Path 2 (hybrid).**  Routing flow:

1. Telegram adapter receives an addressed message.
2. **Fast path (regex)**: try to parse against the structured-command
   grammar (`add <type> <text>`, `list <type>`, `done <id-or-keyword>`,
   `help`, `what do we need?`, etc.).  If it matches, route directly
   to the corresponding skill.  Sub-second response.
3. **Slow path (LLM fallback)**: if regex doesn't parse, hand the
   message to the LLM-mediated `classifyAndExtract` skill.  Used for
   freeform input ("we need bread, milk, and toilet paper this
   week"; multi-clause, mixed-language, ambiguous-intent messages).
4. **Graceful degradation**: if the LLM is unavailable (Mac mini
   suspended, Ollama crashed), the slow path is unavailable but the
   fast path keeps working.  Bot replies "I couldn't parse that —
   try `add <type> <text>`?" for unparseable input.

Path 2 is **more code than Path 3** (regex layer + LLM stack +
routing logic), but bought:

- Snappy feel on common commands (regex is microseconds).
- Bot stays useful when the LLM is offline.
- Lower per-message LLM cost (most messages hit the fast path).

The LLM remains the centerpiece for freeform input — H2 is still
"first @canopy app where the LLM is the agent's intelligence" for
the slow path.

---

## Cross-cutting integrations

How H2 touches other tracks / apps:

- **H1 (Folio).**  No direct dependency.  But: a household member can
  configure a "shared notes" subfolder of their Folio pod that's
  readable by the household; the household pod can link to it.
  Optional, post-v0.
- **H4 (Tasks).**  Schemas align (see "Schema alignment with H4"
  above).  A household that grows up into H4 lifts its open items
  cleanly.  H2's bot is a *coordinator* role (Track D) in the
  household group; H4 uses the same role primitive.
- **H5 (Neighborhood).**  No direct dependency.  Same closed-group
  governance pattern (Track D).
- **H7 (Archive).**  H7's read-side API (search / filter open items)
  could be reused as the retrieval layer for "what do we need at the
  supermarket?" — but H2 v0 is small enough that the household agent
  just queries its own pod directly.  Promote later if H7's
  filtering UX becomes attractive.
- **Track E (mobile push relay).**  Not required for v0 (Telegram is
  the push channel).  Becomes relevant when a "household app" RN
  client lands as a complement to the chat surface — same idea as
  Folio's web + mobile pair.
- **Track I (distribution).**  The bot agent is a deployable Node
  service.  Track I's installer / launchd / systemd story (already
  shipped for Folio) extends naturally.

---

## Out of scope for v0 (named so we don't drift)

- **Anything beyond Telegram.**  Signal / Matrix / Discord stay in
  the design sketch only.  V1+.
- **Calendar bidirectional sync.**  V0 records `schedule` items in
  the pod but does NOT sync to Google Calendar / Apple Calendar /
  CalDAV.  Track-J style work.  V1+.
- **Voice messages.**  Telegram supports voice; transcription via
  Whisper on the same private server is technically possible.  V1.
- **Multi-household.**  V0 is one household per agent instance.
- **Per-member private items inside the household pod.**  V0 =
  everything is encrypted to the group key, all members can read
  everything.  V1 = hybrid pod (Q-H2.6).
- **DAG sub-tasks.**  H4's territory.  V0 items are flat.
- **Mobile-native client.**  V0 is "the bot is the app".  A mobile
  app that wraps the same agent is a follow-up.
- **LLM that ramps up (proactive scheduling, voice personality,
  yearbook).**  H3's territory.  V0 is reactive only.
- **Photo / file attachments to items.**  V0 is text-only.

---

## Hand-off triggers

| When this completes | These tracks unblock |
|---|---|
| **v0 (chat → pod → retrieval round-trip)** | First @canopy app where the LLM is the agent's intelligence.  Validates LLM-skill wrapper pattern, tool-catalog accessor, external-bot-bridge pattern.  Delivers the user's stated ambition. |
| **v1 (multi-channel via `MessagingBridge`)** | Confirms the bridge abstraction.  Signal / Matrix follow naturally. |
| **v1 (hybrid pod — per-member + shared)** | First production exerciser of `Design-v3/topology.md` § Hybrid pod patterns. |
| **H3 unblocks** | When LLM choice is locked + tool-calling proven, H3 (the conversational household assistant) builds on the same primitives. |

---

## Implementation plan — DEFERRED

This document is the design.  An implementation plan (week-by-week
slicing, file paths, test additions, DoD per slice) belongs in a
separate follow-up doc — `track-H-app-household-impl.md` or similar.
The README's "Suggested staging" section already sketches a four-week
sequence (Telegram bridge → LLM extraction one-type → retrieval flow
→ completion loop) that's a reasonable starting point, but the
implementation plan should:

1. Lock Q-H2.1–14 above before slicing.
2. ~~Decide whether the bridge agent + household agent are one process
   or two~~ — **already locked**: one process, multiple adapters
   inside it.  See the architecture section's "Why one process and
   not two".
3. Pick a test-strategy: the LLM is non-deterministic, so unit tests
   need a test-mode that swaps the LLM for a deterministic stub or
   recorded fixtures.  Same pattern as the `_setExchangeFn` /
   `_setDiscoveryFn` test seams in `apps/folio-mobile/src/auth/folioAuth.js`.
4. Define the prompt + tool-catalog regression test (50 real
   household messages, target-language) as the gate for "v0 ships".
5. Pin the deployment story (private server, install-service,
   wake-on-LAN auto-suspend).

---

## Loose ends — flagged for the implementation pass

These belong in the design conversation but I want them visible
before the planner starts writing weeks:

- **The `@Household` mention pattern is Telegram-specific.**  In a
  group chat with `privacy mode` ON (Telegram bots default), the bot
  only sees messages addressed to it.  With privacy mode OFF, it
  sees everything (needed for Twist 2).  Decide which mode v0 ships
  with — leans OFF for ambient extraction + Twist 2 to be possible.
- **Member ↔ webid mapping.**  How does the bot know that
  `@frits` in Telegram corresponds to webid `https://id.inrupt.com/frits`?
  v0: explicit one-time mapping during the bot's onboarding DM with
  each member.  Stored in `/household/config.json`.  v1 may use
  shared verifications.
- **Bot inactivity — what if the LLM is offline (Mac mini suspended,
  Ollama down)?**  Telegram adapter should queue messages and retry,
  with a stale-state warning if the queue grows past N messages.
  Document; build a small retry loop with exponential backoff.
- **Onboarding UX — adding a member to the household app.**  Twist 1
  describes the bot detecting a new chat member and prompting them
  in DM.  This needs Telegram's native "new chat member" event +
  the bot DMing them + a sign-in flow that mints a membership proof.
  Not trivial; document as part of the implementation plan.
- **Group key rotation.**  When a member leaves the household, the
  group key needs to rotate so they can no longer decrypt new pod
  content.  Track A + Track D handle the primitives; H2's UX needs
  to surface the "remove member" action and trigger rotation.
- **Cost of always-on.**  Per `llm-cost.md`, the dominant cost is
  idle electricity.  Document the "auto-suspend with wake-on-LAN" /
  "co-host with pod" tactics in the deployment guide.
- **Twist 2 reactions vs replies.**  Telegram emoji reactions don't
  carry a text payload, so the "🛒 add to groceries?" suggestion
  needs to be a *reply* (small message) rather than a *reaction*.
  UX trade-off: a reply is more visible (good for discoverability,
  bad for noise).  Lean: reply with a single emoji-prefixed inline
  button; auto-deletes after 5 min if not tapped.
- **Audit log retention.**  How long is the local LLM-call audit log
  kept?  Lean: 30 days, rotated daily, purged on member leave.
- **"Forget this chat" UX.**  A member command (`@Household forget
  yesterday`) should let users prune things the bot extracted.
  Important for trust.  Not the same as "mark complete" — this
  removes from history entirely.

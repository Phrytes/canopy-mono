# H2 — Household app v2 (1:1 DM, conversational LLM, shared pod)

| | |
|---|---|
| **Status** | Design — drafted 2026-05-02 as a reframe of [`./track-H-app-household.md`](./track-H-app-household.md) after recognising the original intent was a **1:1 Telegram DM per member**, not a multi-member group chat.  v1 retained for reference; v2 replaces v1 for going-forward planning. |
| **Started** | 2026-05-02 (drafted same day as the architectural pivot). |
| **Owner** | unassigned |
| **App name** | TBD — same placeholder names as v1: **Hearth**, **Stoel**, **Bord** (Dutch for "plate"), **Telex**.  Confirm before kickoff. |
| **Blocked on** | nothing structurally.  Track A + B + D shipped.  LLM choice (Q-LLM) is the only outstanding gate; first deployment can decide.  Tier likely **promotes from "Tier 3 — defer" (v1 placement) toward Tier 2** once this reframe is locked, because the architecture is simpler and the external-ops complexity drops. |

**Goal:** ship a household assistant accessible **per-member via a private 1:1 Telegram DM**.  Each household member talks to their own bot in a private chat; the bot maintains a natural-language conversation; a small set of tools writes structured items to a **shared household pod** that all members' bots read from.  Privacy-aligned: the LLM is local; chat content never leaves the household; the pod is the multi-member layer.

This is the **first @canopy app where the LLM is the agent's
intelligence**, not just a tool — same as v1.  The shift from v1 is
that **conversation is the primary interface**, not classification.
Tools fire only when the user signals state mutation (add / complete
/ remove); everything else is just chat.

**Refs (consolidated into this doc):**

- [`./track-H-app-household.md`](./track-H-app-household.md) — **v1**:
  the multi-member-group-chat design that this v2 supersedes.
  Useful as a reference for SDK surface analysis, MessagingBridge
  interface, hybrid pod governance, locked decisions Q-H2.1–14, and
  privacy posture — most of those carry over.
- [`./track-H-app-household-questions.md`](./track-H-app-household-questions.md)
  — companion worksheet for v1.  v2 needs its own follow-up
  worksheet for the new design questions surfaced below
  (Q-H2.15–Q-H2.21).
- [`../projects/07-household-app/README.md`](../projects/07-household-app/README.md)
  — the original L2 design notes.  The verbatim Dutch ambition there
  is **the source of truth that drove this reframe** — it describes
  the 1:1 flow, not group chat.
- [`../projects/07-household-app/llm-cost.md`](../projects/07-household-app/llm-cost.md)
  — feasibility + hardware + monthly cost analysis.  Still applies.
- [`./track-H-design-sketches.md`](./track-H-design-sketches.md) §H2 —
  the "Telegram-as-keyboard" functional sketch.  Twist 1 (bot is a
  member) still applies; Twist 2 (ambient signals) was already dropped.
- [`../USE CASES.md`](../USE%20CASES.md) §7 — cross-cutting use-case
  summary.
- [`../LOCAL LLM OVERVIEW.md`](../LOCAL%20LLM%20OVERVIEW.md) —
  cross-project local-LLM reasoning.
- [`./track-H-app-folio.md`](./track-H-app-folio.md) — Folio's
  pod-client + sync-engine layering is reusable for the pod side.
- [`./track-H-app-tasks.md`](./track-H-app-tasks.md) — H4's task model
  is what household items still align with.
- `apps/household/docs/LLM-MODEL-COMPARISON.md` — empirical model
  comparison from 2026-05-01: qwen2.5:3b at 89% on the v1
  classification benchmark.  Note: that benchmark tests the v1
  architecture (single-turn classification); v2 needs a different
  benchmark (conversational quality) — see "Quality bar" below.

---

## Why v2 — the reframe in one paragraph

The v1 design baked in the assumption that the bot lives in a household *group chat* with multiple members talking and the bot watching their interleaved messages.  Re-reading the original Dutch ambition (`projects/07-household-app/README.md`) showed this was never the user's intent — the verbatim text describes **one user sending the bot a message, the bot replying, the user later asking "wat hebben we nodig", the bot returning a list, the user reporting completion**.  That's a 1:1 DM, not a group chat.  The architectural cost of building for the group-chat case (single-turn classification, aggressive `noise` bias, no LLM session memory, per-message extraction discipline) was high — and unnecessary for the actual use case.  v2 collapses the architecture to **one user ↔ one bot in a private DM, multi-turn natural conversation, narrow tool set, pod as the multi-member shared layer**.

---

## The user's ambition (verbatim Dutch + English reading)

Same source as v1, **re-read with the 1:1 frame in mind**:

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

**English reading (1:1 frame):** A user has a private DM with their
household bot.  When they message "we need bread", the bot adds it
to the shared household pod.  When they message "what do we need at
the supermarket?", the bot loads the open shopping list from the pod
and answers.  After ~30 min, the bot follows up about completion.
When the user reports items done, the bot updates the pod.  Other
household members run the same flow with their **own** bots; the
shared pod is what makes them a household.

---

## What you see (v0 functional sketch)

Concrete UX target — adapted to the 1:1 frame.

In Anne's private DM with the household bot:

```
[Bot]    Hoi Anne!  Open lijst nu:
         Boodschappen: appels, melk
         Geen openstaande klusjes.
         Wat kan ik voor je doen?

[Anne]   Doe nog brood en eieren erbij.
[Bot]    ✓ Brood en eieren toegevoegd.  Anders nog?

[Anne]   Heb je een idee voor avondeten?
[Bot]    Wat dacht je van een eenvoudige stamppot met andijvie?  Je
         hebt aardappelen nodig, een struik andijvie, en een rookworst.
         Zal ik die ingrediënten toevoegen aan de boodschappenlijst?

[Anne]   Ja graag.
[Bot]    ✓ Aardappelen, andijvie, rookworst toegevoegd.

[Anne]   Ik ben net thuis, heb appels en melk gekocht.
[Bot]    ✓ Appels en melk afgevinkt.  Je hebt nog: brood, eieren,
         aardappelen, andijvie, rookworst op de lijst.
```

Meanwhile, in the author's *separate* private DM with the same bot
(different session, different chatId):

```
[the author]  Wat hebben we nodig in de supermarkt?
[Bot]    Hoi the author!  Open boodschappen:
         - brood (Anne, vandaag)
         - eieren (Anne, vandaag)
         - aardappelen (Anne, 5 min geleden)
         - andijvie (Anne, 5 min geleden)
         - rookworst (Anne, 5 min geleden)
[the author]  Ik ga ze halen.  Ook even pickles erbij.
[Bot]    ✓ Pickles toegevoegd.  Veel succes!
[the author]  Net terug.  Heb alles gekocht behalve pickles.
[Bot]    ✓ Brood, eieren, aardappelen, andijvie, rookworst afgevinkt.
         Pickles staat nog open.
```

Two members, two private conversations, **one shared pod**.  Anne's
bot doesn't know what the author and his bot discussed; it knows what's
on the pod.

---

## Architecture

### One agent process, N per-member sessions, one shared pod

```
            ┌────────────────────────┐  ┌────────────────────────┐
            │ Anne's Telegram DM     │  │ the author's Telegram DM    │
            │ (chatId: A)            │  │ (chatId: F)            │
            └───────────┬────────────┘  └───────────┬────────────┘
                        │                            │
                        ▼                            ▼
            ┌─────────────────────────────────────────────────────┐
            │  Household-bot agent (single Node process)          │
            │  - Telegram adapter (one bridge, N sessions)        │
            │  - per-(chatId)-session state:                      │
            │      sessionId, messageHistory[],                   │
            │      lastPodLoadAt, currentMember (webid)           │
            │  - LLM client (local, e.g. qwen2.5:7b-instruct)     │
            │  - tools: addItems, markComplete, removeItems       │
            │  - PodClient (Track A) for shared household pod     │
            │  - vault: bot keypair, member-webid map, bot-token  │
            └────────────────────────┬────────────────────────────┘
                                     │
                                     ▼
                        ┌────────────────────────────┐
                        │ Shared household pod (Solid)│
                        │ /household/                 │
                        │   open/<ulid>.json          │
                        │   closed/yyyy-mm/<ulid>.json│
                        │   audit/yyyy-mm.jsonl       │
                        └────────────────────────────┘
```

**Per-member session, not per-message classification.**  The bot
keeps a conversation-history buffer for each Telegram chat (each
member's DM is its own chatId).  Each message in that DM is fed to
the LLM **with the full session context AND a freshly-loaded
natural-language summary of the pod**.  The LLM responds with
either a free reply, a tool call (or several), or both.

### Why one process for N members

Same reasoning as v1's "one process, multiple adapters" decision,
generalised to "one process, multiple **per-chat sessions**".  Each
member's DM is bound to its own chatId; per-session state is a map
keyed by chatId.  No new process, no new daemon — just N
conversations sharing the same Node runtime.

When a second messaging platform lands (Signal DM, Matrix DM), it
adds another adapter inside the same process; per-chat sessions are
the natural state-management unit regardless of platform.

### `MessagingBridge` interface — unchanged from v1

The interface is still the right shape for v2 (Telegram now,
Signal/Matrix later); see v1 doc §`MessagingBridge` interface.
Difference: **`isAddressed` always returns true in 1:1 DMs**, so the
adapter doesn't need to drop unaddressed messages.  The interface
stays generic so that a Matrix room (which can be 1:1 or
multi-member) is also expressible.

### Components in the v0 process

The single Node process holds:

1. **Telegram adapter** (implements `MessagingBridge`).  Same
   library choice as v1 (Q-H2.1: `telegraf`).  Maintains per-chatId
   message cursors so a restart doesn't reprocess messages.
2. **Per-chat session manager** — a small Map<chatId, SessionState>
   holding rolling message history (last N messages), session start
   time, member webid, and a cached pod snapshot.  Session expires
   after configurable inactivity (default 30 min — see Q-H2.16);
   next message after expiry triggers a fresh pod-load.
3. **NL-context builder** — given the current pod state, produces a
   natural-language summary suitable for prepending to the LLM
   system prompt (see "NL pod-context format" below).
4. **Conversational LLM client** — Ollama-hosted, default candidate
   shifts toward **qwen2.5:7b-instruct** or
   **bramvanroy/geitje-7b-ultra** (Dutch-specialised) since
   conversational Dutch quality dominates the metric for v2.  Q-H2.LLM
   below.
5. **Tool dispatcher** — when the LLM emits one or more tool calls,
   routes them to the corresponding handlers (`addItems`,
   `markComplete`, `removeItems`).  Multiple tool calls in one LLM
   response are supported and executed in order.
6. **PodClient** — reads/writes the shared household pod.  Reads on
   session start; writes on each tool call.
7. **Vault** — keys held: bot's keypair, per-member webids,
   Telegram bot token, household group key (for pod encryption).

### Adapter → agent flow (v2)

```
1.  Adapter receives a Telegram message in chatId X from sender S.
2.  Adapter calls agent.onMessage({ chatId: X, sender: S, text: "..." }).
3.  Agent looks up the session for chatId X.
    - If no session OR session expired:
        - Read /household/open/*.json from pod.
        - Build NL summary.
        - Resolve sender's webid (from MemberWebIdMap).
        - Create session: {history: [], podSummary: ..., member: ...}.
4.  Agent appends the new message to session.history.
5.  Agent calls LLM with:
       system: PROMPT_CONVERSATIONAL + session.podSummary + tool catalog
       messages: session.history (last N)
6.  LLM responds with one of:
    a. Free reply (no tool call) — relay to user, append to history.
    b. One or more tool calls — execute each, capture results,
       optionally re-call LLM with tool results so it can compose
       a final reply that mentions what it just did.
    c. Both: a reply that includes the user-facing text PLUS tool
       calls (telegraf protocol allows mixing in one chat completion).
7.  Agent posts the reply via adapter.sendReply.
```

No regex fast-path.  No classify-and-extract.  The LLM **is** the
parser — but it's also the conversationalist.  The architecture
trusts the LLM with both jobs because the conversational cost (one
LLM call per user message) is acceptable for the 5-30 messages/day
per household.

### Why no regex fast-path in v2

v1's Path 2 hybrid (regex first, LLM fallback) was bought because
group-chat noise was high and avoiding LLM cost on common commands
mattered.  In v2:

- **Volume is much lower** (5-30 msg/day per member; typically
  only a handful actually arrive at the bot since each member uses
  it intentionally).
- **There is no "noise"** — every message in your DM with the bot
  is intentional.  No filter cost to justify a fast path.
- **The LLM IS the conversation** — replying with regex would be
  weird ("I added bread to your shopping list." is fine; "✓
  shopping/bread" is not).

So v2 simplifies to "always LLM" without a meaningful cost
penalty.  If/when this turns out to be too slow on a small
household-server, **a structured-command grammar can be re-added as
a slash-command shortcut** (`/add bread`) that bypasses the LLM —
but it's an optimisation, not the architecture.

### Conversational LLM — system prompt shape

```
You are the household assistant for the <household-name> household.
The current user is <Anne / the author / ...> (their webid).

Current open household items (loaded from the household pod):

Boodschappen:
- [id-7H4] appels — toegevoegd door Anne, eergisteren
- [id-2JK] melk — toegevoegd door the author, vandaag
- [id-9PM] brood — toegevoegd door Anne, 12 minuten geleden

Klusjes:
- [id-K8M] stofzuigen — niet toegewezen

Reparaties:
(geen open reparaties)

Tools available:
- addItems(items[])           : add new open items
- markComplete(refs[])         : mark items complete (refs = ids)
- removeItems(refs[])          : hard-delete items (refs = ids)

When the user asks to add, complete, or remove items, emit a tool
call and a natural reply confirming what you did.  When the user
asks "what's open" or "what do we need", answer from the list above
— no tool call needed.  When the user just chats (greetings,
recipe ideas, brainstorming), reply naturally — no tool call.

Respond in the user's language (Dutch or English).  Match their
tone.  Be brief.
```

### NL pod-context format (Q-H2.15)

The natural-language summary is built deterministically by the
NL-context builder.  Structure:

```
Boodschappen:
- [id-XX] <text> — toegevoegd door <displayname>, <human-relative-time>
- [id-XX] <text> — toegevoegd door <displayname>, <human-relative-time>
(or "(geen open boodschappen)" if empty)

Klusjes:
- ...

Reparaties:
- ...

Schedule:
- [id-XX] <text> — <date/time>
```

`<human-relative-time>` is computed from the item's `addedAt`:
"vandaag", "gisteren", "X dagen geleden", "X minuten geleden", etc.

The `[id-XX]` tokens are stable handles for the LLM to reference in
tool calls; they MUST NOT appear in the LLM's user-facing output.
The system prompt instructs this; we test it.

### Tool reference resolution

When the LLM emits `markComplete([{id: "id-7H4"}, {id: "id-2JK"}])`:
1.  Tool dispatcher looks up each id in the current session's pod
    snapshot.
2.  For each match, calls `PodClient.markComplete(itemUrl)` which
    moves the item from `/open/<ulid>.json` to
    `/closed/yyyy-mm/<ulid>.json`.
3.  Reports success / failure back to the LLM as tool results.
4.  LLM composes the user-facing reply mentioning what was done.

If the LLM emits a tool call with an id NOT in the snapshot
(LLM-hallucinated), the dispatcher returns an error result; the LLM
can either retry or apologise to the user.  Resilient by design.

**Fallback for text-based references:** if the LLM emits
`markComplete([{match: "appels"}])` instead of using the id, the
dispatcher does fuzzy text-matching against the session's pod
snapshot.  Less precise but tolerant of LLMs that don't always use
the id token.  Same shape as v1's `markComplete({match})` skill.

---

## Pod schema

### Hybrid pod from v0 (carried over from v1)

Pod structure unchanged from v1 — the multi-member layer was always
the pod, regardless of whether members chat in a group or in
private DMs.  The **bot's pod and member pods are still part of the
hybrid pattern**; only the *chat layer* changed.

```
─── per-member pod ─────────────────────────────────────────
  /private/                       (read-only to other members)
    errands.json                  # member's personal errands
    posture.json                  # claim posture per skill
                                  #   (carries over from H4 alignment)

─── per-bot pod ────────────────────────────────────────────
  /bot/                           (admin = household admins, root = bot)
    config.json                   # bot's settings, model choice, prompt rev
    audit/yyyy-mm.jsonl           # local LLM call audit log
    chat-meta/<chatId>/cursor.json # last-processed Telegram message id
    chat-meta/<chatId>/session.json # rolling session-state snapshot
                                  #  (for restart-survival; optional)
    bot-token.enc                 # F1 OAuthVault — Telegram bot token

─── shared household pod ───────────────────────────────────
  /household/
    config.json                   # household name, member webids,
                                  #   member-webid → telegram-uid map
    open/<ulid>.json              # ALL types in one bucket — type is a field
    closed/yyyy-mm/<ulid>.json    # archived monthly
    audit/yyyy-mm.jsonl           # state changes (who added/completed what)
```

**v2 schema simplification — items in one bucket.**  v1 had
`groceries/`, `errands/`, `repairs/`, `schedule/` as sibling
directories.  v2 puts everything in `/open/<ulid>.json` with a
`type` field on the item.  Reasoning:

- The NL-context builder groups by `type` regardless of storage
  layout.
- Cross-type queries are uniform.
- Migration of an item between types (a "shopping" reclassified as
  "errand") is a field edit, not a file move.

The directory layout is an internal convention; nothing in the rest
of the SDK / pod ecosystem requires per-type directories.

### Item document shape (v2)

```js
{
  id:               "01HX...",   // ULID
  type:             "shopping" | "errand" | "repair" | "schedule" | string,
  text:             "appels",
  addedBy:          "https://id.inrupt.com/anne",
  addedByDisplayName: "Anne",
  addedAt:          1714000000000,
  addedByBot:       "telegram",  // which bridge / source
  completedAt:      null | 1714008000000,
  completedBy:      null | "https://id.inrupt.com/frits",
  source:           { tg: { chatId, messageId } } | null,
  notes:            null | "freeform",
}
```

Same fields as v1's H2 item, plus `addedByDisplayName` (used in the
NL summary) and `addedByBot` (which bridge originated the write).

### Schema alignment with H4 — unchanged

H4's task schema is still a strict superset of H2's.  See
[`./track-H-app-tasks.md`](./track-H-app-tasks.md) §"Schema
alignment with H2".  v2 doesn't change the alignment; the
attribution fields (`addedBy`, `addedByDisplayName`,
`completedBy`) become *more* important since H2 v2 is now natively
multi-member at the pod layer.

---

## LLM choice + hardware

### Workload shape — shifted

v1: classification + extraction.  Latency tolerance: seconds.
Throughput: 5-30 req/day per household.  Concurrency: 1.

v2: **conversation + occasional tool emission.**  Latency tolerance:
seconds (a chat reply taking 3 sec feels normal in Telegram).
Throughput: same 5-30 messages/day per member, but each message is
now a multi-turn-context LLM call (N messages of history + pod
summary + system prompt → one response).  Token-input grows;
token-output stays small.

### Model — shifted toward conversational quality

v1's recommendation was `qwen2.5:3b-instruct` because the
classification benchmark gave it 89%.  **v2's quality bar is
different — conversational Dutch dominates.**

| Model | Size | Dutch quality | Tool-calls | v2 Lean |
|---|---|---|---|---|
| `qwen2.5:3b-instruct` | 1.9 GB | poor (`groetlijstje`, `Wasnoten`) | strong | likely insufficient |
| `qwen2.5:7b-instruct` | 4.7 GB | servicable (occasional typos / wrong words) | strong | candidate |
| `bramvanroy/geitje-7b-ultra` | 4.4 GB | excellent (Dutch-specialised) | unknown | **primary candidate** — pending tool-call verification |
| `mistral:7b-instruct` | 4.4 GB | good (European-language strong) | strong | candidate |
| `aya:8b` | ~5 GB | good (multilingual focus) | strong | backup candidate |

**Decision deferred** to a v2 quality-bar test (see "Quality bar"
below).  Expectation: **GEITje 7B Ultra OR Mistral 7B**.  The 3B
Qwen that v1 settled on is unlikely to clear v2's Dutch bar.

### Hardware — unchanged from v1

Same options table as v1.  Lean: defer until first deployment;
test on whatever's already on.  See v1 doc § "Hardware" for the
full table.

### Local-LLM-as-default — unchanged from v1

Same privacy posture: local by default; cloud opt-in with warning.
See Q-H2.12 in v1's locked decisions.

---

## Privacy posture — adjusted

Same defaults as v1, with changes called out:

- **Raw Telegram messages STILL not persisted by default.**  Only
  the extracted structured items land in the pod.  Optional
  per-chat archive remains opt-in (Q-H2.2 carries over).  Note:
  v2's per-session message history lives in process memory only;
  it's not pod-persisted by default.
- **LLM runs local** (same).
- **Pod data encrypted to the household group key** (same).
- **Bot agent identity is its own keypair** (same — Q-H2.13).
- **Audit log every LLM call** locally (same).
- **NEW: per-session context snapshot.**  The bot's NL pod summary
  is built from the household pod, which has access only to
  household-shared items.  The bot does NOT include items from
  member-private pods in any session's NL summary.  The hybrid pod
  pattern enforces this at the storage layer.

---

## Hallucination tolerance — looser, with safety nets

In v1's group-chat frame, hallucination was high-risk because the
bot's mistake was visible to all members and silently appended to
the shared list.  In v2's 1:1 frame:

- **Each member sees only their own bot's behaviour** in real-time.
  If the bot adds "wasnoten" to the list because it mis-paraphrased
  the user, the user sees "✓ wasnoten toegevoegd" in their next
  reply and can correct: "schrap dat wasnoten weer".
- **The conversational interface naturally surfaces the bot's
  understanding.**  When the bot says "ik heb appels en melk
  toegevoegd, en stofzuigen aan de klusjes", the user can object
  if anything is wrong — same turn, same conversation.
- **Hallucinated items are reversible** — `removeItems` is a tool
  the LLM has and the user can invoke.

So the safety net is **conversational reversibility**, not
pre-emptive confirmation.  v1's per-extract "✓ added [undo]"
button is unnecessary.

Persistent safety net: **daily digest** (Q-H2.7) — the bot DMs each
member at a configurable time with the current open list.  Members
spot stale or wrong items.  Carries over from v1.

### Quality bar (v2-specific)

Different from v1's classification benchmark
(`apps/household/scripts/llm-smoke.js` — 18 fixtures of
single-turn classification).  v2 needs a **conversational
benchmark**:

- **5-10 scripted Dutch + English conversations** (3-7 turns each)
  that exercise:
  - Adding multiple items in one message.
  - Clarification questions ("welke ui — gele of rode?" —
    optional but desirable).
  - Marking complete with fuzzy reference ("appels en melk gehaald").
  - Recipe brainstorm + bulk-add of ingredients.
  - "Wat hebben we nodig?" retrieval.
  - Greeting-only / chitchat (no tool call expected).
- **Pass criteria:** verbatim quote of user-mentioned items in the
  pod (no fabrication), Dutch quality not embarrassing, tool calls
  fire only on state-mutation intent, replies are natural.

This benchmark replaces the v1 smoke harness for v2 readiness.
Estimated effort: half day to script + run + judge.

---

## SDK surface (what's new vs. what reuses)

### Reuses existing SDK primitives — same as v1

See v1 doc §"Reuses existing SDK primitives" — every primitive
listed there still applies.

### NEW or DIFFERENT in v2

- **NL-context builder** — app-level helper that turns a list of
  pod items into a natural-language summary suitable for LLM
  context.  Pure function, ~100 LOC; not a candidate for SDK
  promotion in v0.  Promote to L1 only if H3 / H4 / H6 also need it.
- **Per-chat session manager** — app-level Map<chatId,
  SessionState> with TTL eviction.  Not SDK-worthy; trivially
  re-implementable.
- **Tool dispatcher with multi-call support** — when the LLM
  returns multiple tool_calls in one response, all are executed
  before composing the next LLM turn.  Already supported by the
  Ollama provider in `apps/household/src/llm/providers/ollama.js`;
  H4 and H6 will need it too.

### REMOVED from v1

- **Regex fast-path / Path 2 hybrid routing** — gone in v2.  See
  "Why no regex fast-path".
- **`classifyAndExtract` skill** — gone.  The LLM is the
  conversation; there's no separate classification step.
- **The 5-tool catalog** — narrows to **3 tools**.

### Tool catalog (v2)

```
addItems(items: Array<{ type: string, text: string, notes?: string }>)
  → adds N items in one call.  Returns ids.

markComplete(refs: Array<{ id: string }>)
  → marks N items complete.  Refs are item ids from the session
    NL summary.  Fallback: { match: "<text>" } for fuzzy lookup.

removeItems(refs: Array<{ id: string }>)
  → hard-deletes N items.  Same ref shape as markComplete.
```

`listOpen` is **not** in the tool catalog because the NL summary
is already loaded into context at session start; the LLM doesn't
need to call a tool to "see what's open".  If the session is long
and the pod might have changed since session start, the agent
optionally re-loads at intervals — but this is internal, not an
LLM tool.

### Required L0 SDK additions — narrowed

v1 required:
- Tool-catalog accessor on `SkillRegistry` (small change).

v2 doesn't strictly need this — the tool catalog is short enough
to be defined inline.  The `SkillRegistry` accessor is still nice
for H3 + H4; it's no longer H2-driven.

### Promote-when-second-consumer-arrives

- **External-bot-bridge pattern (`MessagingBridge`)** — same as v1.
- **NL-context-loading pattern** — promote to L1 if H4 or H6 ends
  up using the same shape (loading pod state as natural language
  rather than JSON for an LLM consumer).

---

## Locked decisions (Q-H2.x)

### Carried over from v1 (unchanged)

| # | Question | **Locked (carried over)** |
|---|---|---|
| Q-H2.1 | Bot framework | `telegraf` |
| Q-H2.2 | Chat archive retention | configurable per chat, default forever; raw chat NOT persisted by default |
| Q-H2.3 | Bot deployment | support both webhook + long-polling |
| Q-H2.5 | `MessagingBridge` interface | define it now |
| Q-H2.6 | One pod or many | hybrid pod from day 1 — **schema layout simplified in v2** (items in one bucket with `type` field) |
| Q-H2.7 | Completion-loop cadence | 1-hour default per-activity nudge; daily digest at 20:00 local, configurable |
| Q-H2.10 | LLM production hardware | defer until first deployment |
| Q-H2.11 | Tool-calling shape | OpenAI-style JSON schema |
| Q-H2.12 | Cloud LLM as opt-in | support, opt-in, with visible warning |
| Q-H2.13 | Bot identity | own keypair |
| Q-H2.14 | Channel-to-pod mapping | single chat = single household — **but each member has their own chat with the same household pod** (the v2 reframe) |

### Reframed by v2

| # | Original v1 Question | **v2 Reframe** |
|---|---|---|
| Q-H2.4 | Twist 2 — implicit signals | **N/A in v2.**  In a 1:1 DM there is no "passive watching of unaddressed chat" — every message is addressed by definition. |
| Q-H2.8 | Hallucination tolerance | **Looser in v2** — conversational reversibility replaces per-extract confirmation.  Daily digest still the persistent safety net. |
| Q-H2.9 | Multi-language quality bar | **Bar shifted** — v1's single-turn classification benchmark replaced by a v2 conversational benchmark (5-10 scripted Dutch + English conversations).  See "Quality bar" above. |

### NEW design questions for v2 (Q-H2.15–Q-H2.21) — not yet locked

These need their own worksheet
(`track-H-app-household-v2-questions.md`) before kickoff:

| # | Question | **Drafted answer** |
|---|---|---|
| Q-H2.15 | NL pod-context format (exact shape) | Group by type, include `[id-XX]` tokens, attribution + relative time, `(geen open <type>)` for empty.  See "NL pod-context format" above. |
| Q-H2.16 | Session expiry / TTL | 30 minutes of inactivity expires the session; next message rebuilds it (fresh pod-load).  Configurable. |
| Q-H2.17 | Item-id token format in context | Short stable tokens: `[id-7H4]` (last 3 chars of ULID, prefixed).  Easy for the LLM to copy into tool calls; not visible in user-facing replies (system prompt enforces). |
| Q-H2.18 | Multi-tool-call handling | Execute all tool calls in one LLM response in order; on any failure, return error tool-result and let the LLM compose a "partial success" reply.  Don't abort. |
| Q-H2.19 | Default LLM model | **Pending v2 conversational benchmark** between qwen2.5:7b-instruct, GEITje 7B Ultra, Mistral 7B Instruct.  Lean: GEITje for households that chat primarily in Dutch; Mistral for mixed; Qwen 7B as fallback. |
| Q-H2.20 | LLM-offline fallback | Reply "Sorry, ik kan even niet bij m'n hersens — probeer over een paar minuten opnieuw, of gebruik /add bread (slash-command shortcut)." + queue messages with backoff.  Slash-command shortcut bypasses LLM and writes directly to pod via tool dispatcher. |
| Q-H2.21 | Member-webid mapping (carried over from v1's loose ends) | Explicit one-time mapping during the bot's onboarding DM with each member.  Stored in `/household/config.json` under `members[]`. |

---

## Cross-cutting integrations

How H2 v2 touches other tracks / apps:

- **H1 (Folio).**  No direct dependency.  Same as v1: a household
  member can configure a "shared notes" subfolder.
- **H4 (Tasks).**  Schemas align (see "Schema alignment with H4").
  v2 strengthens the alignment because attribution fields are now
  load-bearing in H2 (multi-member at pod layer).
- **H5 (Neighborhood).**  No direct dependency.  Same closed-group
  governance pattern (Track D).
- **H6 (Import bridge).**  Could feed H2 — e.g. import a Google
  Doc shopping list as an initial pod state.  Not a v0 dependency.
- **H7 (Archive).**  Same as v1 — H7's read-side could back the
  retrieval surface, but v2's NL-context-loading bypasses the need
  for a separate retrieval API.
- **Track E (mobile push relay).**  Not required for v0 (Telegram
  is the push channel — and 1:1 DM Telegram pushes are reliable).
- **Track I (distribution).**  Same as v1 — bot agent is a
  deployable Node service.

---

## Out of scope for v0 (named so we don't drift)

Most of v1's out-of-scope list still applies; called out where v2
changes things:

- **Anything beyond Telegram.**  Signal / Matrix / Discord stay in
  the design sketch only.  V1+.
- **Group chat support (the v1 architecture).**  Out of scope —
  v2 is 1:1 DM only.  If a household later wants the bot in a
  group chat, that's a v1+ feature on top of v2 (NOT a return to
  v1's architecture; rather, a new "group" adapter that translates
  group-chat-mention events into per-member sessions).
- **Calendar bidirectional sync.**  Same as v1 — v1+.
- **Voice messages.**  Same as v1.
- **Multi-household per agent instance.**  Same as v1.
- **Per-member private items inside the household pod.**  Same as
  v1 — V0 = everything is encrypted to the group key, all members
  can read everything via their bots; member-private items live on
  member pods.  Per-task `visibility` (à la H4) is V1+.
- **Mobile-native client.**  Same as v1 — "the bot is the app" for
  v0.  A mobile app that wraps the same agent is V1+.
- **LLM that ramps up (proactive scheduling, voice personality).**
  H3's territory.
- **Photo / file attachments to items.**  V1+.
- **Per-member-per-bot personality customisation** (e.g. Anne wants
  formal Dutch, the author wants casual).  V1+.

---

## Hand-off triggers

| When this completes | These tracks unblock |
|---|---|
| **v0 (DM → conversational reply → pod write round-trip)** | First @canopy app where the LLM is the agent's intelligence in a conversational mode (not classification mode).  Validates conversational LLM in production, NL-context-loading pattern, multi-call tool dispatch, narrow-tool-catalog pattern.  Delivers the user's stated ambition. |
| **v0 (multi-member via parallel sessions on the same pod)** | First @canopy app to exercise the hybrid pod pattern with multiple writers from the same agent process. |
| **v1 (multi-channel via `MessagingBridge`)** | Confirms the bridge abstraction.  Signal / Matrix DM follow naturally. |
| **v1 (group-chat adapter as overlay on top of v2 sessions)** | If anyone asks for it — the v2 architecture allows a group-chat adapter that maps group `@mention` events to per-member sessions.  Not v0 work. |
| **H3 unblocks** | When LLM choice is locked + tool-calling proven, H3 (the conversational household assistant) builds on the same primitives. |

---

## Implementation plan — DEFERRED

This document is the design.  An implementation plan (week-by-week
slicing, file paths, test additions, DoD per slice) belongs in a
separate follow-up doc — `track-H-app-household-v2-impl.md` or
similar.

Compared to v1's deferred implementation plan:

1. **Lock Q-H2.15–21 first** (the v2-new questions).
2. **Run the v2 conversational benchmark** against GEITje + Mistral
   + qwen2.5:7b to settle Q-H2.19 (default model).
3. **Slice differently from v1** — v2's natural slices are:
   - Slice A: per-chat session manager + NL-context builder
     (testable in isolation against fixture pod data).
   - Slice B: tool dispatcher + 3-tool catalog (testable against
     a stub LLM that emits scripted tool calls).
   - Slice C: integration with telegraf (live test).
   - Slice D: completion-loop cadence (Q-H2.7) — same as v1.
   - Slice E: hybrid pod write paths + audit logging — same as v1.
4. **Test strategy** — same as v1 (the LLM is non-deterministic so
   tests use a deterministic stub or recorded fixtures).  Plus:
   the conversational benchmark gates "v0 ships".
5. **Pin the deployment story** — same as v1.

---

## Loose ends — flagged for the implementation pass

Most of v1's loose ends still apply (member-webid mapping, bot
inactivity / LLM-offline retry, onboarding UX, group key rotation,
cost of always-on, audit log retention, "forget this chat" UX).
v2-specific additions:

- **Session-state restart-survival.**  In-memory session state is
  lost on bot restart.  Should we persist `chat-meta/<chatId>/session.json`
  to the bot's pod every N seconds so a restart can resume the
  conversation mid-flow?  Lean: **no for v0** — accept that a
  restart loses session history; the next message rebuilds context
  from the pod.  The user notices a "bot forgot context" moment;
  acceptable for v0.
- **Concurrent LLM calls when multiple members message at the same
  moment.**  Two members each send a message; the bot has one
  Ollama instance running one model.  Ollama serialises requests;
  responses arrive in order.  Acceptable for v0.  Worst case: a
  3 sec response becomes 6 sec.
- **NL-context size as the pod grows.**  A household with 100 open
  items has a ~3 KB NL summary.  At 1000 items, ~30 KB — starts to
  pressure the LLM context window.  Mitigation: archive items
  older than N days from the NL summary (still in pod, just not
  loaded into LLM context); show "... (N more older items)
  hidden".  Not v0 — v0 households shouldn't have 1000 open items.
  Watch for it.
- **Tool-call hallucination — LLM emits an id that doesn't exist.**
  Dispatcher returns error; LLM gets the tool-result and must
  retry or apologise.  Test that the LLM handles this gracefully
  (qwen2.5:7b does; smaller models may not).
- **NL summary attribution — "toegevoegd door jou" vs "toegevoegd
  door Anne".**  When Anne is the current user, items she added
  show "jou"; items the author added show "the author".  Personalisation in
  the NL builder, not in the system prompt.  Trivial but worth
  noting.
- **Multi-language quality on the same conversation.**  If Anne
  switches mid-conversation between Dutch and English, can the
  model follow?  Qwen 7B handles this; smaller models may not.
  Test in benchmark.
- **Daily digest in 1:1 frame.**  The bot DMs each member's chat
  individually at 20:00 local — N DMs sent.  Can be staggered to
  avoid Telegram rate limits if the household grows past ~10
  members.  Not v0 concern.
- **LLM emits text that LOOKS like a tool call but isn't structured.**
  Already a known failure mode (we saw it with phi4-mini).  v2's
  tool dispatcher uses Ollama's structured tool_calls field only;
  text-form "addItems(...)" in the body is treated as user-facing
  text.  Cleaner than parsing-the-text fallbacks.

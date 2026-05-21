# 07 — Household app: chat-driven, LLM-mediated household state

**Use-case:** a small group (housemates, family, partners) has
running ambient chatter in a shared Telegram channel.  Lots of it
is irrelevant noise; some of it has actionable household state
buried inside ("we need bread" / "the toilet's broken" / "I'll
pick up the dry cleaning Friday").  An LLM-mediated household
agent watches the chat, extracts state, surfaces it on demand,
follows up on completion, and writes the resulting state into a
shared pod.

**Status:** scope sketched.  No code yet.  First app where an
LLM is intrinsic to the design rather than incidental.

---

## User's framing (verbatim, Dutch)

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

## In one paragraph

A bot in a household Telegram channel watches incoming messages.
A local-LLM-mediated agent classifies each message as actionable
or noise, extracts structured items from actionable ones (shopping
list, repair, errand, schedule), and stores them in a shared
household pod.  When asked ("what do we need at the supermarket?"),
the agent retrieves all open items of the relevant kind, returns a
clean list to the channel.  After completion, it follows up,
captures what got done, and updates pod state accordingly.  The
LLM is the *intelligence* of the agent; the SDK provides the
identity, transport, skills, and storage layers it stands on.

---

## Why this is project #7 and not a variant of #4

Tempting to call this "use case #4 with chat input."  It isn't,
because:

- **#4 is structured:** tasks have explicit DAG dependencies,
  skill requirements, claim semantics, role-based permissions.
- **#7 is freeform:** a household chat is a stream of
  unstructured natural-language utterances, most of them noise,
  with structure inferred by the LLM.

The two end up with overlapping pod state ("a list of open items
the household cares about") but the *acquisition pattern* is
fundamentally different.  Trying to design one app that does both
ends up doing both badly.

That said: post-extraction, the household items could be stored
*in the same task-ledger schema #4 uses*.  Item lifecycle
(open / claimed / complete) is the same; the input pipeline is
the difference.  Worth keeping the schemas aligned so a household
that grows into "we'd like a proper task DAG" can migrate
smoothly.

---

## Resolved direction (sketch level)

- **Telegram is the input channel for v0.**  Real users already
  use it; building a chat UI from scratch is unnecessary.  Other
  channels (Signal, Matrix, Discord, the project's own native
  protocol) come later.
- **LLM is local for privacy.**  Household chat is intimate;
  shipping it to OpenAI / Anthropic / Google undoes the project's
  whole point.  Local LLM, even a small one, is sufficient — see
  [`llm-cost.md`](./llm-cost.md).
- **Shared household pod for v0.**  One pod the household shares.
  V1 may move toward "a household pod that links to items on
  individual pods" once members want privacy boundaries within
  the household.
- **Schema aligned with #4's task model.**  An open household item
  is a task with attributes `{type: 'shopping' | 'repair' |
  'errand' | …, text, claimed_by?, completed_at?}`.

## Open questions

1. **One pod or many?**  V0 is one shared household pod for
   simplicity.  V1 might be: each housemate has their own pod,
   plus a household pod that holds *references* to per-housemate
   items.  Cleaner privacy; harder integration.  Decide based on
   real user feedback.

2. **Channel-to-pod mapping.**  Does each Telegram channel map to
   one pod?  Or could a channel feed multiple pods (housemates,
   sports club, family at once)?  V0: one channel, one pod.

3. **LLM hardware**: where does the always-on LLM live?  Mac
   mini in the living room / a Pi 5 / a friend's spare laptop?
   The cost analysis ([`llm-cost.md`](./llm-cost.md)) lays out
   options.  Decision deferred to first deployment.

4. **Tool-calling shape.**  How does the LLM invoke agent skills
   (`fetch-open-items`, `mark-complete`, `send-tg-reply`)?
   Through MCP-like tool calls?  Through a thin wrapper?  See
   the SDK-additions section below.

5. **Privacy of un-extracted chat.**  Raw Telegram messages
   contain lots of stuff the household doesn't want stored
   forever.  Does the agent persist raw messages, or only
   the extracted structured items?  V0: only extracted items
   in the pod; raw messages stay in Telegram (which the user
   already accepts).

6. **Completion-loop UX.**  The "30 minutes later, ask what got
   done" flow needs a sensible cadence.  Too eager = annoying;
   too rare = stale state.  User-configurable per household.

7. **Hallucination tolerance.**  Small local LLMs sometimes
   misclassify ("buy gym membership" → shopping?) or hallucinate
   items.  Mitigation: every LLM-extracted item is shown back to
   the channel as a confirmation prompt before being committed
   to the pod, OR a periodic "here's what I think the open
   items are, edit if wrong" digest.

8. **Multi-language.**  Dutch / English / mixed?  Both Qwen 2.5
   and Phi-3.5 mini handle Dutch reasonably well.  Verify with
   real household chat in the target language.

---

## Pod shape

How shared household state is stored across members is a
hybrid-pod question — see [`../../Design-v3/topology.md` § Hybrid pod patterns](../../Design-v3/topology.md#hybrid-pod-patterns).
Open question 1 above frames it as one-shared-pod (v0) vs.
household-pod-linking-to-per-member-pods (v1), but the working
assumption is now that **both patterns coexist** within one
household for different parts of the state.  Which fields live
in the household pod and which project from member pods — and
the merge contracts for the projected ones — are decisions this
app should make concrete during v0 → v1, not pinned in the SDK.

---

## How this fits with the project

### Reuses existing SDK primitives

- **Solid pod with the storage convention** — same as #1, #3,
  #4, #5.
- **Encryption-by-ACL** — household items are encrypted to the
  household's group key (or, in v1, to per-housemate keys).
- **Group X / role-aware groups** — household is a group; roles
  could be "member" / "admin" / "guest" (a babysitter for a
  weekend gets `guest` access to relevant items).
- **CapabilityToken** — the Telegram bot agent presents a token
  proving it's authorized to read/write the household pod on
  behalf of the LLM agent.

### Brings new flavors

- **LLM-mediated agent** — the agent's intelligence is an LLM
  rather than handcrafted code.  Triggers think about
  tool-calling, prompt management, output validation.  First
  appearance in the project.
- **External chat-channel bridge** (Telegram) — agents interact
  with a non-`@canopy` system.  Closest existing analogue: A2A
  for HTTP, but Telegram is a different shape (asynchronous,
  long-polling or webhook, bot tokens not pubkeys).
- **Ambient-input → structured-state pipeline** — most of the
  other apps have user-initiated structured input.  This one's
  user-initiated input is freeform chat that the agent has to
  parse.  The LLM is the parser.

### Overlap with other use cases

- **Strong overlap with #4** on the *post-extraction* state
  model.  Worth keeping schemas compatible.
- **Strong overlap with #5** on the *retrieval* side (search /
  filter open items in the pod).  Could literally use the
  archive app's API for retrieval.
- **Weak overlap with #2** if you imagine "household" as a
  small-trust closed group; the closed-group governance + role
  primitives are the same.

---

## What this app needs that the SDK doesn't have today

L0 / L1 SDK additions:

- **LLM-skill wrapper pattern.**  An idiomatic way to register
  a skill where the implementation is "ask an LLM, with these
  other agent skills available as tools."  Could be in the SDK
  as a small helper, or fully app-level.  Likely L1.
- **Tool-catalog skill metadata.**  When the LLM needs to know
  what other skills are available to call, it should be able to
  query the agent's skill registry and get a list with
  signatures + descriptions.  Already partially in
  `packages/core/src/skills/SkillRegistry.js`; needs a clean
  consumer-facing accessor.  L0.
- **External-bot-bridge pattern.**  How a Telegram bot agent
  hooks into the SDK so its incoming messages become skill
  calls, and outgoing messages flow naturally.  App-level for
  now; if Signal / Matrix / Discord follow, generalize into
  L1.
- **Conversation-state primitive.**  Tracking "this is the
  ongoing conversation in channel X" across many turns.  Could
  be a thin wrapper over `StateManager`.  Could remain
  app-level.

L2 (purely app-level for the household app):

- The Telegram bot integration (token storage, webhook /
  long-polling).
- The LLM prompts + tool definitions.
- Shopping / repair / errand schemas (extends #4's task model).
- Completion-loop UX (when to ask, what to ask, how to confirm).
- Per-household configuration (which channel, what roles, how
  often to poll).

---

## Suggested staging

Designed to ship fast and gather real-user feedback:

1. **Week 1 — Telegram bridge.**  Bot agent that posts to and
   reads from a TG channel, no LLM yet.  Just "this bot
   acknowledges your messages and writes them to a pod as raw
   entries."  Confirms the plumbing.
2. **Week 2 — LLM extraction (one type).**  Add an Ollama-hosted
   Qwen 2.5 3B (or similar) running on whatever device is
   handy.  One use case only: shopping items.  Prompt:
   "given these messages, return a JSON array of shopping items
   mentioned, or empty if none."
3. **Week 3 — Retrieval flow.**  "What do we need at the
   supermarket?" command returns the LLM-filtered open list.
   Confirm with friends that it works for real households.
4. **Week 4 — Completion loop.**  Periodic "what did you do?"
   nudge + cross-off-via-chat.
5. **Generalize**: repair, errand, schedule items follow the
   same pattern.  Tune prompts per type.
6. **V2 — multiple chat backends** (Matrix is open-source +
   federated; closer to the project's ethos).

---

## Honest take

This is the **most concrete and most testable** of the seven use
cases.  Real households + a Telegram bot + a small LLM + a Solid
pod — all components exist today.  V0 is shippable in a month
with one focused developer.  Real-user feedback is unusually
fast (households use a lot of household chat; bugs surface
quickly).

It's also the **first app where the LLM is the agent's
intelligence**, not just a tool.  That's a meaningful direction
for the project — turning the SDK into infrastructure for
LLM-mediated agents, not just human-and-device-mediated ones.
The household app is a good first proving ground because:

- Stakes are low.  Mistakes are recoverable; nobody loses money.
- Feedback is rich.  Households talk to each other constantly,
  so the "is this working?" signal is loud.
- The privacy story matters intensely.  Your household chat is
  precisely the data you'd never put into a cloud LLM.  Local
  LLM here isn't a quirk; it's the point.
- It exercises the cross-app primitives (pod, encryption,
  groups, capability tokens) for a real, immediate use case.

**Verdict:** the right next app to build, in parallel with #1
(notes app).  #1 unblocks the storage substrate; #7 exercises
the LLM-agent pattern.  Both ship fast, both attract real-user
feedback, both inform the rest of the project.

---

## Investigation notes

- **[`llm-cost.md`](./llm-cost.md)** — feasibility + hardware
  options + monthly-cost analysis for self-hosting a small LLM
  for household-grade tasks.  Recommendation: used Mac mini M2
  for production, anything-you-already-have for testing.

## Cross-app substrate compatibility (added 2026-05-07)

Tasks V1 (see [`../../Tasks App/advice-2026-05-07.md`](../../Tasks%20App/advice-2026-05-07.md))
introduced patterns the household app should adopt or track
forward-compat for:

- **Canonical user-skills profile at `<user-pod>/profile/skills.json`.**
  When the household app asks "what can you help with?" or builds
  a per-housemate skill view, **prefill from the canonical
  profile and let the user edit before submitting**. New skills
  added in the household app can be saved back to the canonical
  profile so Tasks / Stoop see them too. Same pattern as Tasks
  V1 + Stoop V2.
- **Approval / DoD lifecycle on `item-store`.** Tasks V1 adds
  `submitted` + `rejected` + `definitionOfDone` + `approval` +
  `deliverable` + `master` + `parentTaskId` fields. The
  household chore flow can opt in for "kid marks done; parent
  approves" without further substrate work.
- **`InAppInboxChannel`** — additive notifier channel from
  Tasks V1; available for household digest items / nudges that
  shouldn't push.
- **Calendar read adapter + Folio calendar sync.** Same iCal-
  on-pod convention. The household app's "what window are we
  going to the supermarket" question maps cleanly onto
  `getFreeBusy` once V1.5 lifts the read adapter into a
  substrate.
- **Chat-bot pattern source.** Tasks V1's forward-compat note
  for Telegram-bot access lifts directly from the household
  app's existing `TelegramBridge` work — that is the canonical
  reference.

## Pod-data sharing — caution principles (added 2026-05-07)

Inherited from
[`../04-tasks-app/README.md`](../04-tasks-app/README.md). Each
cross-pod read needs an explicit per-context opt-in; each new
cross-pod flow in a future coding plan gets explicit sign-off
from the author before it ships.

## Related work in the repo

- `packages/core/src/skills/SkillRegistry.js` — needs a
  consumer-facing tool-catalog accessor for LLM tool-calling.
- `packages/core/src/permissions/CapabilityToken.js` — Telegram
  bot agent uses these to authorize itself against the pod.
- `packages/core/src/storage/SolidPodSource.js` — pod write
  primitives.
- `projects/04-tasks-app/` — schema for items should align with
  #4's task model.
- `projects/05-archive-app/` — retrieval API could be reused
  ("search open household items").
- `LOCAL LLM OVERVIEW.md` (cross-project, at repo root) — broader
  notes on local-LLM choices for this project.

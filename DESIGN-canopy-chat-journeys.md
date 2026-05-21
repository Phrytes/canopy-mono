# canopy-chat — user journeys (2026-05-21)

Draft user journeys to ground the canopy-chat architecture. Each
journey describes:

- **What the user does** in a single chat session
- **What the chat shell renders back** — text, inline keyboard, form,
  mini-page
- **What skills get dispatched** and against which app's agent
- **What's missing today** to make this work
- **What design implications** follow

The journeys come BEFORE the architecture doc so that the architecture
is shaped by real flows, not vice-versa. After this doc settles, the
companion `DESIGN-canopy-chat.md` will absorb each design implication
into concrete decisions (parser shape, reply taxonomy, mini-page
hosting, cross-app namespace, per-conversation state).

## Per-journey template

```
### J<n> — <short tagline>

**Persona** who's at the keyboard / phone
**Context** what app(s), what state, what intent

**Transcript**
> User:  <what they type or say>
> Chat:  <rendered reply — text, buttons, card, mini-page>
> User:  <next message>
> Chat:  <next reply>

**Skills dispatched**
- `<app>.<skillId>({args})`
- `<app>.<skillId>({args})`

**Mini-pages rendered (if any)**
- <description of the embedded HTML / form / record view>

**What's missing today**
- gap 1 (substrate / manifest / skill / state)
- gap 2

**Design implications**
- what this forces the architecture to handle
```

---

## Seed Journey 1 — single-app, single-action (the baseline)

### J1 — Mark a chore done

**Persona** Anne, partner in a household with kids and a shared chore
list. Phone in the kitchen.

**Context** Household app active. Single-app intent — just mark a
chore done.

**Transcript**

Path A (arg supplied):
> Anne: `/done dishwasher`
> Chat: ✓ Dishwasher marked complete. (Karl was up next.)

Path B (arg missing — elicitation):
> Anne: `/done`
> Chat: Which chore?
>   `[Dishwasher (open)]`
>   `[Trash bins (open)]`
>   `[Hoover (claimed by Karl)]`
> Anne: *taps Dishwasher*
> Chat: ✓ Dishwasher marked complete.

**Skills dispatched**
- `household.markComplete({id: '<resolved-from-fuzzy-name>'})`
  — preceded by `household.listOpen({})` for path B

**Mini-pages rendered**
- None. Plain text reply + optional inline keyboard.

**What's missing today**
- **Fuzzy name → id resolution**. "Dishwasher" isn't an id; the shell
  needs to look it up against the recently-listed items (per-conv
  cache) or call `listOpen` and pick by substring.
- **Reply shape declaration** — `markComplete` returns `{ok, id}`;
  chat needs to know that's a status-style confirmation, not a list.
- **Derived next-up info** ("Karl was up next") — would come from
  reading the next item in the same chore-rotation; not the skill's
  responsibility today.

**Design implications**
- Chat shell must keep **short-term per-conversation state** (what
  was last listed, what was last dispatched).
- Slash args are **partial** — when a required param is missing, the
  shell elicits via an inline keyboard built from the relevant
  list-skill.
- Reply rendering can **synthesize** information by chaining sibling
  skills (next-up); the chat shell, not the skill, is responsible.

---

## Seed Journey 2 — slash with params (form territory)

### J2 — Add a task with details

**Persona** Frits, busy parent, laptop.

**Context** tasks-v0 active with a `family` crew. Adding a task that
has multiple required params (text + assignee + due).

**Transcript**

Path A — full command in one line:
> Frits: `/addtask "Fix the back door" --assignee=karl --due=friday`
> Chat: ✓ Task added: *Fix the back door*. Assigned to Karl, due Fri
> 24 May.

Path B — incremental elicitation (inline form):
> Frits: `/addtask`
> Chat: 📝 **New task**
>   ```
>   Text:    [_______________]
>   Assignee [me ▾]
>   Due:     [select date ▾]
>             [Submit]  [Cancel]
>   ```
> Frits: types "Fix the back door", picks Karl, picks Friday, *taps
> Submit*
> Chat: ✓ Task added: *Fix the back door*. Assigned to Karl, due Fri
> 24 May.

Path C — natural language (LLM layer, deferred):
> Frits: "add a task to fix the back door, give it to karl, due friday"
> Chat: (LLM parses → reuses Path B's form with pre-filled values, or
> dispatches directly with Path A's args)

**Skills dispatched**
- `tasks-v0.addTask({text, assignee, dueAt})`
- (Path B) sibling: `tasks-v0.listMembers()` to populate the assignee
  picker

**Mini-pages rendered**
- Path B uses an **inline form** generated from `op.paramsSchema` via
  `schemaToFormFields()`. The form could render as:
  - **Inline HTML** in the chat message (a form node with fields)
  - **Mini-page** popped out to a side panel (TG WebApp pattern)
  - **Sequential chat prompts** (one field per turn — gentler, slower)
  The chat shell picks the strategy based on field count / complexity.

**What's missing today**
- **Form generation strategy** — inline vs mini-page vs sequential.
  Each has UX trade-offs; the shell needs a rule (e.g. ≤3 fields
  inline, more → mini-page).
- **Date param type** — Q23 covers `file | image`; no `date`
  yet. Either extend Q23 enum or parse strings ("friday" → epoch ms)
  in the shell.
- **Assignee resolver** — `karl` → WebID. Same gap as J1's name
  resolution but cross-cuts: every app has its own member taxonomy.
- **Command-line arg parser** — `/addtask "..." --assignee=...
  --due=...` — a substrate helper that consumes `match.body` plus
  the optional flags and produces the typed param object. Today the
  slash grammar has `body: 'match'` / `body: 'reject'` modes; a
  `body: 'flags'` mode would be new.

**Design implications**
- Chat shell supports **inline forms generated from
  paramsSchema** — the substrate already produces field descriptors;
  the shell just renders them.
- Param types need **chat-friendly extensions** — date pickers,
  member pickers (chained from a list-skill), enum dropdowns,
  booleans as toggles.
- **Picker-from-list** is a first-class field type — when the
  manifest declares a param as `kind: 'enum', of: '<skillId>'`, the
  shell calls that skill to populate the choices.
- The **CLI-arg parser** is the slash-first fast path; the form is
  the fall-through when args are missing or the user types only the
  command name.

---

## Seed Journey 3 — cross-app composition

### J3 — Anne is moving in

**Persona** Frits, household admin. Partner moving in next week.

**Context** All four apps active. Anne is a new contact who doesn't
exist anywhere yet. Need to: add her to the household roster, share
his `notes/shared/` folder, create a "set up bedroom" task.

**Transcript**

Pre-LLM (command-first) — the user has to break it up:
> Frits: `/add-member`
> Chat: 📝 **Add household member**
>   ```
>   Name:  [_______________]
>   WebID: [paste or scan QR]
>   Role:  [member ▾]
>           [Submit]
>   ```
> Frits: fills "Anne", pastes WebID, picks member, submits.
> Chat: ✓ Anne added to the household. Want to invite her to other
> things? `[Share folio folder]` `[Add a task for her]`
>
> Frits: *taps Share folio folder*
> Chat: 📝 **Share notes folder**
>   ```
>   Folder: [notes/shared/ ▾]
>   With:   [Anne ▾]  ← pre-filled from context
>            [Submit]
>   ```
> Frits: submits.
> Chat: ✓ Capability token issued. Anne can now read `notes/shared/`.
> `[Add a task for Anne]`
>
> Frits: *taps Add a task for Anne*
> Chat: 📝 **New task** (assignee pre-filled: Anne)
>   ```
>   Text:    [Set up Anne's bedroom__________]
>   Assignee:[Anne ▾]
>   Due:     [Fri 30 May ▾]
>            [Submit]
>   ```
> Frits: submits.
> Chat: ✓ Task added: *Set up Anne's bedroom*. Assigned to Anne, due
> Fri 30 May. Anne will see it once she joins.

Post-LLM (deferred) — single natural-language sentence:
> Frits: "Anne is moving in next week. Add her to the household,
> share `notes/shared/` with her, and add a task to set up her
> bedroom for Friday."
> Chat: (LLM proposes a plan)
>   📋 **Proposed actions** (3)
>   1. Add Anne to household (needs her WebID)
>   2. Share `notes/shared/` with Anne
>   3. Add task "Set up Anne's bedroom" due Fri 30 May, assigned Anne
>   `[Run all]` `[Edit]` `[Cancel]`
> Frits: *taps Run all*, prompted for WebID, ✓✓✓.

**Skills dispatched**
- `household.addMember({name, webid, role})`
- `folio.share({relPath, withWebid})` — needs WebID from previous
  step's reply
- `tasks-v0.addTask({text, assignee, dueAt})` — assignee resolves to
  Anne from per-conv context

**Mini-pages rendered**
- Three forms back-to-back, each from the relevant op's
  `paramsSchema`.
- Each completion suggests **the next plausible action** via inline
  buttons — chat-shell heuristic, not a manifest declaration.

**What's missing today**
- `household.addMember` **doesn't exist** as a manifest op (the
  household app has the underlying skill via the registry pattern,
  but it's not surfaced for chat dispatch).
- `folio.share` is **declared but not wired** — folio's manifest is
  declaration-only.
- **Cross-app identity propagation** — Anne's WebID flows between
  the three calls. The shell must remember "the Anne we just added"
  across skills.
- **Cross-app slash namespace** — `/add` exists in household; `/add-
  member` is fine for now but if stoop had `/add-member` too there'd
  be a collision. Decision needed: namespace (`/household/add-
  member`) vs. context-sensitive resolution.
- **"What next?" suggestions** — `[Share folio folder]` after adding
  the member is heuristic; the shell needs a way to know which
  cross-app follow-ups make sense. Either hard-coded chains or a
  `surfaces.chat.followUps: [opId, ...]` manifest field.

**Design implications**
- Chat shell **merges N manifests at boot**; ops surface via their
  slash command, namespaced when collisions occur.
- **Per-conv state** carries cross-skill identity ("Anne" once added
  → reusable in subsequent commands without re-prompting WebID).
- **App-presence detection** — a user with only household + stoop
  shouldn't see folio commands. The shell loads only enabled apps.
- **Follow-up hints** — either manifest-declared (Q-something) or
  inferred from `appliesTo.type` overlap. Less critical for command-
  first; central to the LLM-layer flow.
- Compound prompts ("Anne is moving in...") are **explicitly out of
  scope for command-first**; the shell hints with "I don't know that
  command; try one of these."

---

## Seed Journey 4 — list + drill-down with mini-page

### J4 — Browse open tasks and drill into one

**Persona** Anne, on her tablet in the evening.

**Context** tasks-v0 active. Scanning what's open, acting on a
couple.

**Transcript**
> Anne: `/mine`
> Chat: 🗂️ **Your open tasks (4)**
>   ```
>   1. Fix the back door — due Fri 24 May  (Karl)
>      [Open] [Done] [Reassign]
>   2. Set up Anne's bedroom — due Fri 30 May  (you)
>      [Open] [Done] [Reassign]
>   3. Replace smoke detector — overdue 2d
>      [Open] [Done] [Reassign]
>   4. Order new garden hose — no due date
>      [Open] [Done] [Reassign]
>   ```
>
> Anne: *taps Open on #2*
> Chat: (renders **mini-page** inline or popout)
>   ```
>   ┌────────────────────────────────┐
>   │ Set up Anne's bedroom           │
>   │ Assigned: you                   │
>   │ Due:      Fri 30 May            │
>   │ Master:   Frits                 │
>   │ State:    claimed               │
>   │ ────────────                    │
>   │ Notes: clear out the boxes,     │
>   │ get a desk lamp                 │
>   │ ────────────                    │
>   │ Sub-tasks (2):                  │
>   │  • Clear boxes (open)   [done]  │
>   │  • Get desk lamp (open) [done]  │
>   │ ────────────                    │
>   │ [Submit for review] [Reassign]  │
>   │ [Add subtask]      [Close ×]    │
>   └────────────────────────────────┘
>
> Anne: *taps "done" on Clear boxes*
> Chat: ✓ Subtask complete. (mini-page refreshes — "Clear boxes" now
> shows ✓)
>
> Anne: *taps Close on the mini-page*
> Chat: (returns to the previous task list)

**Skills dispatched**
- `tasks-v0.listMine({})` — initial list
- `tasks-v0.getTask({id})` — when opening the detail mini-page
- `tasks-v0.markSubtaskComplete({id})` — inside the mini-page

**Mini-pages rendered**
- The **list reply** is a chat message with per-row inline keyboard
  (uses existing `inlineKeyboardFor`).
- The **detail card** is a **mini-page**: the same shape as
  `apps/tasks-v0/web/task-detail.html` would render, generated on
  demand from the manifest's `task` view + the item's data + the
  item's per-state `itemActions`.

**What's missing today**
- **Per-item inline keyboard rendering** — already in substrate (`renderChat.inlineKeyboardFor(item)`), just needs the shell to call it.
- **List-shape reply rendering** — formatting an array as a chat
  message with per-row buttons. The shell does this; no manifest
  change needed.
- **Detail-view scope** — Q1 in the NavModel doc was deferred to V1
  ("V0 = buttons-on-row"). Chat is the consumer that **forces the
  decision**: for T2/T3 web pages, the page owns detail layout; for
  chat, who owns it? Probably: substrate gains an optional
  `view.detail: {fields, sections}` declaration, the shell renders
  it as a mini-page.
- **Mini-page state** — when Anne taps a subtask "done," the mini-
  page refreshes. The page subscribes to the same `item-removed` /
  `item-changed` events the existing web pages do. The substrate has
  these; the shell needs the same `mountLive` plumbing.
- **Mini-page hosting model** — does the page live **inline** in the
  chat message (HTML embedded), in a **side panel** (TG WebApp
  style), or as a **separate route** (deep link out)? Affects URL
  semantics, back-button behaviour, bandwidth.
- **"Open" intent** — the `[Open]` button on each list row is a
  navigation action, not a skill dispatch. Today the substrate models
  every button as `opId`. A `view: 'detail'` action would be new — or
  the shell could synthesize it from `view.shape: 'record'` declared
  on the detail view.

**Design implications**
- Reply-shape **list** produces a TG-style list with per-row inline
  keyboards from `inlineKeyboardFor`. Reply-shape **record** triggers
  a **mini-page** render — shell takes item data + manifest view +
  projects to HTML.
- The chat shell needs a **mini-page lifecycle**: open, refresh-on-
  event, close, return to caller.
- **Detail-view scope (Q1)** becomes load-bearing — chat is the use
  case that forces unwinding the V0 deferral.
- **Navigation actions** (Open, Close, Back) are a new category
  alongside `opId` dispatch actions. Either a new
  `surfaces.ui.placement: 'navigation'` or a different mechanism.

---

## Suggested additional journey shapes (for you to fill in)

| Shape | Why it matters |
|---|---|
| **Status / morning brief** — "what's on my plate today across everything?" | Tests cross-app aggregation; reveals reply-format conventions for multi-app summaries |
| **Destructive action with confirm** — `/clear-inbox`, "/delete this folder from pod" | Tests Q27 confirm severity flowing into chat (button styling, double-tap-to-confirm) |
| **Settings change with ambiguity** — "turn on holiday mode" | Tests disambiguation across apps that both have the concept (stoop + tasks-v0 both do) |
| **Onboarding new user** — `/start` from a fresh install | Tests T3 wizard ↔ chat boundary; auth handoff |
| **Notification-driven** — chat wakes you with "Karl just completed *Replace smoke detector*. `[View]` `[Thank]`" | Tests outbound/reactive chat (server-initiated messages), notifier substrate integration |
| **Privacy-sensitive** — "show my mnemonic" (Tier C app-side only) | Tests how chat hands off to T3 surfaces without compromising security |
| **Folio sync status** — `/folio-status` → mini-page with last sync, conflicts, sharing state | Tests folio as the first real consumer of its declaration-only manifest |
| **Bulk action over a list reply** — list returns 8 tasks, batch select + `/done all` | Tests bulk-op composition + Q27 confirm for bulk |
| **External event arrives** — Anne accepts the invite; chat says "Anne is now in your household. `[Send welcome]` `[Assign first task]`" | Tests reactive chat — skill replies in the future, not just immediate |
| **Cross-device handoff** — "send this task to my phone" | Tests the canopy mesh / relay model from a chat UI |
| **Search across apps** — "find anything about 'back door'" | Tests cross-app search; reveals whether/how each app exposes a `search` op |
| **Help / discovery** — `/help` or "what can I do?" | Tests how chat surfaces the merged toolCatalog as a navigable menu |

## How to fill in additional journeys

- **Stay concrete** — specific names (Anne, Frits, Karl), specific
  commands, specific reply text. Vague journeys → vague architecture.
- **Use existing app contexts** — household chores, stoop posts,
  tasks-v0 crews, folio notes. The four apps give plenty of surface.
- **Per-journey gap list is the load-bearing part** — that's what
  the architecture doc will absorb.
- **Don't pre-design** — describe what the user does + what should
  happen, not how the shell achieves it. Architecture decisions
  belong in the next doc.

## What this doc will feed into next

Once the journey set is filled in, `DESIGN-canopy-chat.md` will
absorb the gaps and design implications into concrete decisions:

- **Chat shell anatomy** — parser, router, renderer, per-conv state
- **Reply-shape taxonomy** — Q-number proposal for the manifest
  (`surfaces.chat.reply: 'text' | 'list' | 'record' | 'mini-page' | 'file'`)
- **Form generation** — `paramsSchema` → inline / mini-page /
  sequential, including new param types (date, picker-from-skill)
- **Mini-page hosting** — inline HTML vs side panel vs deep-link
- **Detail-view scope** — closing the Q1 deferral
- **Cross-app namespace + identity-bridge rules**
- **Slash → LLM → free-text routing rules**
- **Per-conversation state schema**
- **Follow-up hints** — `surfaces.chat.followUps`?
- **Reactive / outbound chat** — server-initiated messages

The journeys decide which of these are real concerns vs. premature
generalisation.

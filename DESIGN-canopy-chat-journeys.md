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

## Cross-cutting design choices these journeys force

Three concerns surfaced reading the journeys; each one cuts across
many of them. Captured here as **open questions for the architecture
doc** — not decided yet.

### A. Menu / button lifecycle in chat history

When the chat renders an inline keyboard (the buttons under a list or
card), what happens to that keyboard as the conversation continues?
Three plausible models, each with real trade-offs:

**A1. TG-style "menus persist forever."** Every inline keyboard stays
clickable indefinitely. The user can scroll back and re-tap.
- *Pro:* simple mental model; "everything is always available"
- *Con:* memory bloats — after a day you have 50 stale keyboards;
  most are duplicates of the same op. Worse, tapping a stale list
  may operate on a snapshot of items that no longer matches reality.
- *Variant:* persistent BUT with a **grey overlay** when stale, that
  the user has to tap to "wake" (re-fetches the list, re-renders).
  Good for *settings* mini-pages — the panel stays visible, but you
  re-activate it before adjusting.

**A2. "Used menus disable when you post a new message below."** Once
the user types anything after a keyboard, that keyboard greys out
and stops accepting taps.
- *Pro:* prevents duplicate dispatches + stale-data taps; visually
  signals "you've moved on"
- *Con:* what about *settings* mini-pages you'd want to come back
  to? If you're toggling holiday-mode on/off, you don't want the
  panel to disable just because you typed something else
- *Hybrid:* action-shaped keyboards (list + per-row, section-header
  CTAs) disable; record-shaped panels (settings, profile) stay
  live with explicit `[Close]` control

**A3. Bounded chat with FIFO history.** Chat keeps only the last N
turns visible / clickable; older content scrolls off and is
unrecoverable from the chat surface (still reachable through the
fixed settings panel — see B).
- *Pro:* memory bounded by design; no stale-menu problem because
  old menus don't exist
- *Con:* loses the chat-as-log mental model; users can't scroll
  back to "what did I do yesterday"
- *Variant:* infinite chat for *reading* but FIFO for *interactive
  elements* — the text stays, the buttons collapse to text after N
  turns

**Decision (2026-05-21):** **A2 hybrid.** Action menus (list + per-row,
section-header CTAs) disable on the next user message. Record-shape
panels (settings, profile) stay live until explicit `[Close]`. Bulk
action over a stale list is rejected with "list is stale, run
`/mine` again." The architecture doc carries this forward; journey
transcripts assume A2 hybrid throughout.

### B. Chat is the primary surface, but NOT the only one

Some surfaces should NOT live in chat:

- **Profile / password / privacy / security settings** — these are
  long-form, multi-section, and benefit from a stable panel that
  doesn't scroll away. A user wants to find "where do I change my
  pod URL" by going to *the same place every time*, not by
  scrolling through chat history.
- **Critical security flows** — mnemonic display, passphrase
  prompts, OIDC redirects. These already stay app-side per the
  Tier C audit; chat can *trigger* them but the flow runs outside
  the chat thread.
- **Long-form reads** — folio note content, audit logs. Read
  surfaces benefit from full-window rendering, not a chat bubble.

**Architecture implication:** canopy-chat is **one of several
surfaces**, not a replacement for the others. A side panel /
separate "Settings" route lives alongside the chat. Mini-pages
generated inline in chat for *contextual* views; the side panel
hosts *persistent* views.

This maps loosely to Telegram's own model: chat for messages, side
menu for settings, WebApps for rich one-off interactions.

#### B.1 Chat ⇄ side-panel navigation protocol (decided 2026-05-21)

Chat and the persistent side surfaces (settings, logs, file
directories, etc.) must be **mutually navigable**:

- **Chat → side surface.** Chat replies can include navigation
  actions that link to the relevant side-panel page — either as a
  tappable link, an "open settings ▸" inline button, or a textual
  instruction ("swipe right to open settings"). The chat shell
  decides the form based on platform (web/RN/desktop).
- **Side surface → chat.** Every settings / logs / file-directory
  page (and similar non-chat persistent surfaces) ships a
  **floating "back to chat" button**, shown when the user arrived
  from chat. The button returns to the **specific thread** the user
  came from, not the chat root.

This is a chat-shell concern, not per-app — the navigation protocol
is uniform across apps' side panels. Implementation: the chat-side
nav-link carries a return-context (`returnTo: <threadId>`); the
side-panel reads it and surfaces the floating button.

### C. App boundaries blur — items can cross-reference (separate concern)

Reading the journeys exposes that **the four apps' item taxonomies
overlap**:

- A household "klusje" (chore) is functionally a tasks-v0 task with
  no master
- A tasks-v0 task with a `dueAt` is functionally a calendar item
- A stoop skill-request can spawn tasks
- A task can require skills (which are stoop concepts)
- A skill-request OR a task could be **embedded in a person-to-
  person chat message** (not just bot → human, but human ↔ human
  too)

The chat surface *makes this blur visible* (because the user sees
all apps in one place), but **the underlying concern is the item
data model**, not chat-specific.

**Folio is the exception.** Notes are a different shape (file ↔
pod sync); they don't participate in the chore/task/skill/calendar
overlap. Folio's surface in chat is more about file actions
(share, sync, conflicts) than item linking.

**Architecture implication for canopy-chat:** the chat shell needs
a **rich-message embed primitive** — "this message contains a task
card" — that renders the same way a list-reply renders a single
item. Embedded items become live cards in the chat (with the
sender's per-row buttons, gated by `appliesTo`).

**Architecture implication for the substrate:** there is probably
a **unified item taxonomy** under the surface — a single "thing
with a state, a master, an assignee, optional deps, optional
skills, optional dueAt" — that the four apps each project differently
(household calls them chores, tasks-v0 calls them tasks, stoop
embeds them in skill-requests). This is a **separate design doc**
worth writing alongside the chat architecture; the chat will
benefit from it but isn't blocked on it.

Tracked as a forward-looking item; the journeys assume the chat
shell will eventually consume a unified item view, but command-
first v1 can ship without it (each app's items remain typed by app).

#### C.1 Unification is synthesis, not union (decided 2026-05-21)

When the unified item taxonomy is designed (separate doc), it should
be the **best-of-three distillation** — not the lowest common
denominator. Audit each app's existing item shape (household chore,
tasks-v0 task, stoop skill-request, the implicit calendar-item),
identify each shape's strengths and weaknesses, and synthesise a
single "task-chore-item" type that **carries forward what each does
well**. The four apps then project this unified type back into their
own UX shapes, but the type itself is one coherent thing.

#### C.2 Calendar is a view, not an app (decided 2026-05-21)

A `task-chore-item` with a `dueAt` field renders in calendar UX; one
without doesn't. The "calendar" is a **projection** (probably a
side-panel B-style surface) over the unified type, filtered to items
with `dueAt`. No separate item taxonomy for calendar events; no
separate "calendar app." This keeps the four-app boundary count
fixed and the data model coherent.

---

### D. Chat threads are user-managed workspaces (decided 2026-05-21)

The chat shell supports **multiple parallel chat threads**, but
threads are **not** auto-created from a taxonomy (no implicit "Anne
thread," no implicit "stoop-bot thread"). Instead:

- A thread is a **generic instance of the chat-shell** — same
  command grammar, same rendering pipeline
- The user **spawns threads** for their own mental processes (like
  browser tabs or terminal windows)
- Each thread has its own **explicit configuration**:
  - What events flow in (none / all / filtered by app, type, person)
  - What functions are permitted (a "focus" thread may forbid
    cross-app commands; an "inbox" thread may only show notifications)
  - Per-conv state (open live panels, last-listed items)

**Examples of how a user might configure threads:**

- A "work" thread filtered to crew=family-business with all
  cross-app commands enabled
- A "Anne" thread filtered to messages where Anne is involved
  (sender or subject) — events from other people muted
- An "alerts" thread that only receives notifications, no
  command-dispatch allowed
- A "personal todo" thread with notifications muted, only
  user-initiated commands

**Architecture implications:**
- The chat shell manages a **thread list** as a top-level concept;
  the user can create / rename / delete / configure threads
- Routing: skill replies + reactive events check each thread's
  filter rules to decide which threads display them
- Per-thread state is independent — open mini-pages don't leak
  across threads
- Cross-thread navigation (chat ⇄ side-panel from B.1) returns to
  the **originating thread**, not the root

#### D.1 Network-events log page — included in v1 (decided 2026-05-21)

A single non-technical **network-events surface** sits alongside the
side panel (B-style). Specification:

- **Content** — chronological feed of activity by *other* users +
  agents in your groups / networks. Examples:
  - "Anne added a chore: *Vacuum living room*"
  - "Karl claimed *Bins out*"
  - "Maria's bot replied to your skill-request"
  - "Frits synced changes to `notes/shared/`"
- **Not** the user's own actions (those happen in chat), **not**
  technical logs (no stack traces, no sync diagnostics — those go
  in a developer-mode panel)
- **Filterable** by group / network / event-type / actor; default
  view is "all groups, last 24h"
- **Per-event affordances** — `[View context]` jumps to the
  originating item (chat thread, item card, or relevant view);
  `[Mute this kind]` adds a chat-shell-level filter
- **Always-on default sink** — events that don't match any chat-
  thread filter still land here, so nothing is lost
- **Chat ⇄ logs nav** — same B.1 protocol; floating "back to chat"
  button when arrived from chat; "open in chat" button on each event
  if a thread is configured to surface it
- **Relationship to chat threads** — a user CAN route the same
  events into a chat thread (per D's filter config), in which case
  they appear in both. Logs page is the authoritative archive; chat
  threads are configurable foreground.

This is a chat-shell-owned surface, not per-app. Per-app contribution:
events must be **structured** (app + actor + verb + item-ref +
timestamp) so the page can render them coherently. Existing
substrate emits these via the notifier; the logs page consumes them.

### E. Pod-style as UX dimension (decided 2026-05-21)

The three pod-storage models map to three UX realities. The chat
shell knows the active pod-style per context and renders
**connectivity / staleness / partial-merge** hints accordingly. This
is **already a first-class concept** in canopy — `tasks-v0`'s
`crew-storage-policy` enum is `centralised | decentralised | hybrid`
(per Q26 `requiresField` adoption).

**Central pod (e.g. Inrupt-hosted):**
- *Reality:* one server holds canonical state; binary connection
- *Chat UX:* minimal divergence from page-based; "offline" =
  "Stoop is offline; cached view"
- *User model:* simple, Trello-like (not in terms of GUI, but of syncing UX)

**Decentralized pods (federated, per-peer sharing):**
- *Reality:* different parts of the data live on different peers'
  pods; access is per-relationship
- *Chat UX:* **natural fit** — "Anne is offline → her share
  unavailable" maps cleanly to chat's existing "Anne is offline"
  concept. Partial-merge UX surfaces explicitly: "Synced from Anne
  + Karl. Maria's pod unreachable; her contribution pending."
- *User model:* matches email / IM intuition

**Pod-less / pure P2P:**
- *Reality:* no central pod; items pass between devices; aggressive
  caching; polling for latest
- *Chat UX:* **chat IS the protocol** — messages ARE the data
  movement. Staleness explicit: "Last update from Karl: 2 hours ago
  [Refresh]" surfaces as a card affordance, not a hidden detail
- *User model:* more sophisticated, but chat surfaces what's
  invisible in page-based UX

**Why this matters for canopy-chat:**

Chat-oriented UX is **more honest** about decentralized realities
than page-based UX. Traditional pages assume a server; decentralized
realities don't fit. Chat already thinks in "who can I reach"
(connection-per-relationship), which is exactly what decentralized
data needs.

This is one of the strongest *arguments for* canopy-chat as the
primary interface for canopy apps — particularly for stoop
(decentralized by design) and for any future pod-less mode.

#### E.1 The `_sync` skill-reply convention (decided 2026-05-21)

Pod-style is **runtime-observed via skill return data**, not
manifest-declared. Skills serving decentralized or pod-less contexts
populate an optional `_sync` field on their reply; the chat shell
reads it and renders connectivity / staleness / partial-merge hints.

**Reply-envelope shape (formalised v1):**

```js
// Skill return value:
{
  // ...op-specific payload (the actual result the caller wanted)
  ok:        true,
  itemId:    'task-abc',
  // ...

  // Optional sync annotation — present iff the op crosses peer
  // boundaries (decentralized + pod-less) and the app's substrate
  // can report per-peer state.  Central-pod skills omit it.
  _sync?: {
    style:        'central' | 'decentralized' | 'pod-less',
    peers?:       string[],          // webids that confirmed receipt
    pending?:     string[],          // webids not yet confirmed
    unreachable?: string[],          // webids that couldn't be reached
    lastSeen?:    Record<string, number>,  // pod-less mode: per-peer
                                           // last-known-online timestamps
  },
}
```

**Chat shell rendering rules (per style):**

| style | UX |
|---|---|
| `'central'` (or `_sync` absent) | Show `✓` on success, error message on failure. Same as today's flat reply rendering. |
| `'decentralized'` | After `✓`, show "synced to N of M peers"; reactive update when pending peers confirm. Unreachable peers shown with "Pod offline — will sync when reachable." |
| `'pod-less'` | After `✓`, show "Last update propagated to peers: ..." with per-peer last-seen times. Cards include `[Refresh from peers]` affordance for explicit re-poll. |

**Adopter responsibility.** Apps that operate across peers (stoop,
tasks-v0 decentralised crews, future pod-less mode) populate `_sync`
when emitting skill replies. Central-only apps (folio per-pod,
household local-first) omit it; chat shell defaults to the simple
flat rendering. Forward-additive: existing skills work unchanged.

**Substrate location.** This is a **skill-reply convention**, not a
manifest schema field — so it doesn't get a NavModel Q-number. It's
formalised in `DESIGN-canopy-chat.md`'s reply-envelope section + a
substrate helper (`@canopy/web-adapter/syncStateRenderer` or similar)
that consumes the field uniformly.

#### E.2 Per-row staleness signal (deferred to substrate work)

For decentralized + pod-less list replies, the A2 hybrid "list is
stale" logic gets more nuanced — staleness is **per-row**, not
per-list (Anne's row stale because she's offline; Karl's row fresh
because he just synced). Substrate may need a per-item `_lastSync`
annotation alongside `_sync`. Deferred: revisit when a real
consumer's list rendering hits the limit.

#### E.3 Thread pod-style — mixed is fine (decided 2026-05-21)

A single chat thread can contain items from multiple pod-styles —
the chat shell does not try to keep threads pod-style-uniform. Each
card declares its own connectivity state via `_sync`; the user sees
a mix of "Synced ✓" / "Pod offline" / "Last seen 2h ago" cards in
the same thread. This is the natural state when a thread surfaces
events from multiple apps with different storage policies.

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

## Seed Journey 5 — settings panel (menu-lifecycle question made concrete)

### J5 — Toggle holiday mode + adjust poll interval

**Persona** Anne, on her phone while travelling.

**Context** Stoop active. She's about to be unreachable for a few
days. She wants to flip holiday-mode on AND raise the poll interval
to save battery. Two toggles, both on the same settings record.

**Transcript**
> Anne: `/settings`
> Chat: ⚙️ **Stoop settings**
>   ```
>   ┌─────────────────────────────────┐
>   │ Hop-relay (globaal)        [ ●] │
>   │ Hoe vaak verversen [elke 10s ▾] │
>   │ Auto-skill-match           [● ] │
>   │ Standaard locatie delen    [● ] │
>   │ ────────                        │
>   │ Vakantiemodus              [ ●] │  ← from profile
>   │                                  │
>   │                       [Close ×] │
>   └─────────────────────────────────┘
>
> Anne: *taps Vakantiemodus toggle (now ●)*
> Chat: ✓ Vakantiemodus aan.
>   (panel re-renders with the new state — still active)
>
> Anne: types "Karl, can you water the plants?"
> Chat: (the message goes to Karl via stoop's chat; settings panel
>   STAYS LIVE above)
> Karl: "Yes, dropping by tomorrow."
> Chat: (Karl's reply shows below; settings panel still active)
>
> Anne: *scrolls up to settings panel, changes poll interval to 5
>   min*
> Chat: ✓ Polling iedere 5 minuten.
>
> Anne: *taps Close on the settings panel*
> Chat: (panel collapses to a single line: "Stoop settings — closed")

**Skills dispatched**
- `stoop.getSettings({})` + `stoop.getMyProfile({})` — initial load
- `stoop.setHolidayMode({on: true})` — first toggle
- `stoop.updateSettings({patch: {pollIntervalMs: 300000}})` — second
  toggle (Q21 wrapped patch)

**Mini-pages rendered**
- A **record-shape settings mini-page**, rendered inline. It stays
  live (re-renders on each successful patch) until explicit
  `[Close]`. This is the **A1-variant lifecycle** for record panels.

**What's missing today**
- **Cross-manifest field aggregation** — the panel above includes
  both `getSettings` fields AND a profile field (`holidayMode`).
  Today these are two views in the manifest. Either the chat shell
  composes a single panel from two views, or the manifest gets a
  composite-view declaration. Probably the shell composes by tag.
- **Live panel lifecycle** — the architecture must explicitly model
  "stays live across other chat turns until close." Today's
  inline-keyboard model is one-shot. New Q-something:
  `surfaces.chat.lifecycle: 'one-shot' | 'live'` (or implied by
  reply-shape `record`).
- **Optimistic UI** — when Anne taps a toggle, the panel could
  re-render OPTIMISTICALLY (assuming success) and roll back on
  error. Same pattern as web shells today.
- **Re-render via skill event** — if Frits also toggles
  hop-relay from his device, Anne's panel should update via the
  `mountLive('item-changed', ...)` pattern. Web pages already do
  this; chat panels need the same plumbing.

**Design implications**
- **Reply-shape `record` → live mini-page** that survives other chat
  turns. Q28 candidate: `surfaces.chat.lifecycle`.
- **`[Close]` is a navigation action**, not a skill dispatch — same
  category as J4's `[Open]` / `[Close]` on the task detail.
- Per-conv state tracks **open live panels** — the shell can refresh
  them on relevant events.
- The settings panel here is **chat-inline** (stays in the message
  stream); contrast with the **side panel** mode (per design choice
  B) used for *crucial* settings like profile / password / pod URL.
  A future Q decision: which settings live in-chat vs in-side-panel?

---

## Seed Journey 6 — sign-in via chat with browser handoff

### J6 — First-run pod sign-in

**Persona** Frits, fresh install, has a Solid pod somewhere
(`https://frits.solidcommunity.net/`).

**Context** Stoop just installed. No active pod session. Wants to
sign in to his pod from the chat shell.

**Transcript**
> Chat: 👋 Welkom bij canopy-chat. Sign in to your Solid pod to get
> started.
>   `[Sign in to pod]`  `[I don't have one]`  `[Restore from backup]`
>
> Frits: *taps Sign in to pod*
> Chat: 📝 **Sign in**
>   ```
>   Pod issuer: [https://login.inrupt.com  ▾]
>               [Other...]
>               [Continue]
>   ```
> Frits: picks issuer, taps Continue.
> Chat: 🌐 Opening your browser to complete sign-in...
>   `[Open sign-in page]` (deep link)
>
>   (Browser opens; user signs in via OIDC; redirects back to
>   `canopy-chat://oidc/callback?code=...`)
>
> Chat: ✓ Signed in as `https://frits.solidcommunity.net/profile/card#me`
>   Pod attached. You can now use stoop / tasks / folio.
>   `[Set display name]`  `[Set holiday mode]`  `[Open settings]`

**Skills dispatched**
- `stoop.startPodSignIn({issuerUrl})` → returns
  `{authUrl, sessionId}`
- (out-of-chat: browser hits OIDC, redirects back with code)
- `stoop.completePodSignIn({sessionId, code})` → returns
  `{webid, ok: true}`
- `stoop.podSignInStatus({})` → confirmation

**Mini-pages rendered**
- Issuer-picker (small form). The browser handoff is **external**
  — chat shows a button that opens the browser, then waits.

**What's missing today**
- **Browser handoff primitive** — chat shell must support "open this
  URL externally, then handle the deep-link callback." Already
  exists conceptually (the desktop `folio serve` does OIDC via
  browser). Needs a chat-shell wrapper.
- **Out-of-band wake** — when the OIDC redirect lands, the chat
  shell must wake up and post a follow-up message. This is the
  **outbound / reactive chat** pattern flagged in the suggested
  shapes table — needed for sign-in flow.
- **Per-conv state for the in-flight sign-in** — chat remembers
  "we're waiting for OIDC callback with sessionId=X" so the
  reactive message can complete the dialog instead of starting from
  scratch.
- **Issuer picker** — same picker-from-list pattern J2 surfaced;
  here populated from a static list (or a remembered list of
  previously-used issuers).

**Design implications**
- The chat shell must support **out-of-process flows** — open URL,
  wait, complete on callback. This is structurally different from
  the slash → skill → reply model. // but this is already happening in all the apps that login to solidpods right? Isnt this exposed through the manifest or anything already?
- **Reactive chat messages** (server-initiated / event-driven) are
  first-class. Today's substrate has notifier + inbox bridges;
  chat-shell consumes those to wake the chat thread.
- **Deep-link scheme** — `canopy-chat://` (or `https://chat.canopy.
  dev/...`) for callbacks. Same shape as TG's `tg://` callback
  URLs.
- **Sign-in is structurally T3** (out-of-scope per Tier C) but **chat
  can still own the orchestration** — point the user at the right
  browser flow, then complete the handshake when it returns.

---

## Seed Journey 7 — embedded task in a person-to-person message

### J7 — Forwarding a task to a contact

**Persona** Frits, in stoop, talking to Anne (who's another stoop
member).

**Context** Frits has a task in tasks-v0 ("Fix the back door") that
he wants Anne to see. Not assign it yet — just show her the card.
Anne might want to *adopt* it (claim it) or just react to it.

**Transcript**
> Frits: *in his chat thread with Anne, types `/task fix-back-door`*
>   (resolves "fix-back-door" from his recently-listed items)
>
> Chat:  📋 **Task card to send to Anne**
>   ```
>   ┌────────────────────────────┐
>   │ Fix the back door           │
>   │ Master: Frits               │
>   │ State:  open                │
>   │ Due:    Fri 24 May          │
>   │ Notes:  the hinge is loose  │
>   │ ────────                    │
>   │ Anne can: [Adopt] [Comment] │
>   └────────────────────────────┘
>   `[Send to Anne]`  `[Cancel]`
>
> Frits: *taps Send to Anne*, adds "thoughts?"
> Chat (Anne's side, async):
>   📨 **Frits sent you a task**
>   "thoughts?"
>   ```
>   ┌────────────────────────────┐
>   │ Fix the back door           │
>   │ Master: Frits               │
>   │ State:  open                │
>   │ Due:    Fri 24 May          │
>   │ Notes:  the hinge is loose  │
>   │ ────────                    │
>   │ [Adopt]  [Comment]          │
>   └────────────────────────────┘
>
> Anne: *taps Adopt*
> Chat (Anne's side): ✓ You adopted *Fix the back door*. Now
> assigned to you.
> Chat (Frits's side, async via stoop replication):
>   ✓ Anne adopted *Fix the back door*.

**Skills dispatched**
- (Frits's side) `tasks-v0.getTask({id: 'fix-back-door'})` —
  preview before sending
- (Frits's side) `stoop.sendMessageWithEmbed({to: anne, text:
  'thoughts?', embed: {kind: 'task-card', taskId,
  appOrigin: 'tasks-v0'}})` — **new skill**, doesn't exist today
- (Anne's side) chat shell renders the embed card from the embed
  payload + her own tasks-v0 view of the same task (or a cached
  snapshot if she doesn't have access yet)
- (Anne's side) `tasks-v0.claimTask({id, master: 'frits'})` — if
  she taps Adopt; needs cross-pod permission

**Mini-pages rendered**
- The **task card** is a small inline view of a `task` itemtype,
  with the per-state itemActions gated by Anne's relationship to it
  (she can `[Adopt]` because she's not yet the assignee; she
  can't `[Approve]` because she's not the master).
- The card is the **same shape** as J4's task detail mini-page, just
  with a different set of actions (because `appliesTo.state` filters
  on the recipient's role).

**What's missing today**
- **`sendMessageWithEmbed` skill** — stoop has chat threads but
  doesn't carry typed-item embeds. New shape on the message envelope:
  `{text, embed: {kind, ref, appOrigin, snapshot?}}`.
- **Cross-pod item reference resolution** — Anne might not have
  read access to Frits's task; the embed has a **cached snapshot**
  for display + a **live ref** for actions. If she has no access,
  the live ref returns 403 and she sees only the snapshot.
- **Per-recipient `appliesTo` evaluation** — the embed card on
  Anne's side renders Anne's available actions, not Frits's. The
  manifest's `appliesTo` model already handles this (state-gating),
  but the chat shell needs to evaluate gates against the **viewing
  user's** context, which is different from the **dispatching**
  user's.
- **Cross-app skill chaining** — sending the message is a stoop
  skill; the embed payload references a tasks-v0 item; Anne's
  adopt action dispatches a tasks-v0 skill. The chat shell routes
  by `appOrigin`.

**Design implications**
- **Rich-message embed primitive** is first-class — messages carry
  typed payloads, not just text. The substrate gains a Q-something
  for "this skill returns an embeddable card" + the chat-message
  envelope gains an `embed` field.
- **Cross-app routing in chat** — embeds carry `appOrigin`; the
  shell dispatches actions against the right app's agent.
- **Snapshot vs live** — embedded items have both: a snapshot for
  read (works offline / cross-pod) and a live ref for action (may
  fail with insufficient permissions).
- This is the journey that **proves the cross-app data model is
  separate from chat** — chat-shell embedding doesn't require
  unified item taxonomy, just **typed embed payloads** + a way to
  route actions back to the right app.

---

## Seed Journey 8 — user-configured thread + notification arrives

### J8 — A focused "household alerts" thread

**Persona** Anne, partner in a household with three crews (family,
work-side-project, neighbourhood). Wants notifications about
*household* events only, in a thread where she can also take quick
action.

**Context** Multi-thread enabled (design choice D). Default main
thread is busy. Anne wants a dedicated thread that quietly streams
household events and lets her dismiss / claim from inline cards.

**Transcript — setting up the thread**

> Anne: *taps `+ New thread`*
> Chat: 🧵 **New thread**
>   ```
>   Name:       [_______________]
>   Receive:    ( ) Everything
>               (●) Filtered events only
>   Filter:     app:household
>               type:notification
>               actor:any
>               [Edit filter ▾]
>   Commands:   [✓] Allowed
>   [Create]    [Cancel]
>   ```
> Anne: names it "Household alerts", picks the filter, submits.
> Chat: ✓ Thread *Household alerts* created.

**Transcript — event arrives later that day**

(Karl has just marked the dishwasher chore done on his phone.)

> Chat → *Household alerts*: 🔔
>   ```
>   ┌────────────────────────────────────┐
>   │ Karl completed *Dishwasher*         │
>   │ 18:42 · 5 min ago                   │
>   │ [View] [Thank Karl] [What's next?] │
>   └────────────────────────────────────┘
>
> Anne: *taps Thank Karl*
> Chat → *Household alerts*: ✓ "Bedankt, Karl 🙏" sent.

**Transcript — second event, this time Anne acts**

(Maria's birthday — household has a recurring chore "Bring Maria's
birthday cake")

> Chat → *Household alerts*: 🔔
>   ```
>   ┌────────────────────────────────────┐
>   │ Chore unclaimed: *Maria's cake*     │
>   │ Due today, no one claimed yet       │
>   │ [Claim] [Reassign] [View]           │
>   └────────────────────────────────────┘
>
> Anne: *taps Claim*
> Chat → *Household alerts*: ✓ Claimed by you.
>   (the card refreshes — assignee now "you," buttons change to
>   `[Done]` `[Reassign]`)

**Skills dispatched**
- (thread creation) `chat.createThread({name, filter, ...})` — **new**
  shell-side, not an app skill
- (incoming events) reactive — household's notifier emits
  `chore-completed`, `chore-unclaimed`; the shell's filter matches
  and routes to *Household alerts*
- (Anne's actions) `stoop.sendChatMessage({to: karl, text: '...'})`
  for the thank-you; `household.claim({id: 'maria-cake'})` for
  the claim

**Mini-pages rendered**
- The "New thread" form (B-style — could be inline or a popout)
- Per-row alert cards (notification reply-shape with inline keyboard)

**What's missing today**
- **Thread management primitive** in the chat shell (D's main
  building block): create / configure / filter / route.
- **Event-to-thread routing** — every reactive event needs metadata
  (app, type, actor, item-ref) so filter rules can match. Today's
  inbox bridge stamps `type: 'inbox-item'` + `kind: <eventType>`
  (per the J7-era cleanup); extending to `app:` + `actor:` is small.
- **Filter DSL** — what does "app:household type:notification" look
  like in code? Probably a simple key:value match list, escape valve
  for arbitrary predicates later.
- **The `[What's next?]` button** is a fun affordance — would call
  back to household's `getNextChore` or similar — needs the manifest
  to surface "follow-up" hints (or the shell heuristics, see J3).

**Design implications**
- The chat shell owns **thread state + filters + routing**; the
  per-app substrate doesn't need to know about threads
- The chat shell's filter engine needs to be **declarative enough**
  for users to configure via a form (no scripting)
- Reactive events that fail to match any thread's filter still need
  a home — either default thread, the network-events log page, or
  silenced

---

## Seed Journey 9 — cross-app morning brief

### J9 — "What's on my plate today?"

**Persona** Frits, mid-morning coffee, opens chat.

**Context** Default thread. Wants a quick scan of what's happening
across his canopy footprint — open tasks, unread inbox, pending
share-requests, anything overdue.

**Transcript**
> Frits: `/morning` (or `/brief`, or "what's on my plate")
> Chat: 📋 **Morning brief — Wed 21 May**
>   ```
>   Tasks (3 open, 1 overdue)
>     ⚠ Replace smoke detector — overdue 2d
>     • Fix the back door — due Fri
>     • Set up Anne's bedroom — due Fri 30 May
>     [Open all]
>
>   Household chores (2 unclaimed today)
>     • Bins out — tonight
>     • Maria's cake — by 17:00
>     [See all]
>
>   Stoop activity (4 new posts in your buurt)
>     [Open prikbord]
>
>   Folio (sync clean, 1 conflict in `notes/work/`)
>     [Resolve conflict]
>
>   Inbox (5 unread)
>     [Open inbox]
>   ```

**Skills dispatched (parallel)**
- `tasks-v0.listMine({})` — open + overdue tasks
- `household.listUnclaimed({today: true})` — today's chores
- `stoop.listOpen({since: 'last-visit'})` — buurt activity
- `folio.getSyncStatus({})` — sync + conflicts
- `tasks-v0.inboxBadgeCount({})` — unread count

**Mini-pages rendered**
- One unified brief card with per-app sub-sections, each with
  `[See all]` / `[Open X]` navigation buttons that link to the
  respective list (chat-inline list, or side-panel page per design
  choice B)

**What's missing today**
- **Aggregator orchestration** — the brief is a fan-out: call N
  list-skills in parallel, format each section, render. Chat shell
  needs a recipe for this; per-app `surfaces.chat.brief: true` flag
  to opt in?
- **Reply-format conventions** for multi-app summaries — pick a
  cap (3-5 items shown per section, "+N more"), pick an ordering
  rule (overdue first, then by due date, then by other)
- **Per-app counts** — `inboxBadgeCount` is a count skill; not
  every app has one yet. Either every app adds one, or the
  aggregator fetches a list-skill and takes `.length`.
- **Skill batching / cost** — `/morning` fires ~5 skills in parallel.
  For a P2P decentralized model that crosses pods, this could be
  expensive. Maybe cache the brief for N minutes?

**Design implications**
- Chat shell has a **fan-out brief primitive** — possibly its own
  built-in slash (`/brief`) that knows how to compose per-app
  summaries
- Per-app **brief participation** is opt-in via manifest declaration
  — `surfaces.chat.brief: { summarySkill: 'briefSummary' }`
- The brief itself is a **list reply** (A2 disables on next message
  per design choice A); for a persistent "morning brief," the user
  would create a dedicated thread per design choice D

---

## Seed Journey 10 — pod-style differences for the same action

### J10 — Mark a chore done, in three pod-styles

**Persona** Anne again, but the household app is configured
differently in three hypothetical setups. Same J1 action, three
realities.

**Setup A — Central pod (Inrupt-hosted, online)**
> Anne: `/done dishwasher`
> Chat: ✓ Dishwasher complete. (instantly confirmed)

**Setup A — Central pod, offline**
> Anne: `/done dishwasher`
> Chat: ⚠ Stoop is offline; can't reach your pod. Queued — will sync
>   when you're back online.
>   [Show queue] [Cancel]

**Setup B — Decentralized pods, all peers reachable**
> Anne: `/done dishwasher`
> Chat: ✓ Marked done on your device.
>   Synced to Karl ✓ · Maria ✓
>   Frits's pod unreachable — pending.
>   (5 min later, reactive update:)
>   ✓ Frits's pod synced.

**Setup B — Decentralized pods, partial reachability**
> Anne: `/mine`
> Chat: 🗂️ Your open chores (3)
>   ```
>   • Dishwasher — your view (last sync 2 min ago)
>   • Bins out — your view (Karl's pod offline; last from Karl 3h ago)
>   • Maria's cake — ⚠ partial (Frits's pod unreachable;
>                                  showing stale snapshot)
>   ```
>   [Refresh reachable peers]

**Setup C — Pod-less (P2P, no pod)**
> Anne: `/done dishwasher`
> Chat: ✓ Marked done in your copy.
>   📡 Polling peers... Karl saw it, Maria saw it.
>   Frits not seen since 14:30 — will propagate next time he's
>   reachable.

**Skills dispatched (per setup)**
- All setups: `household.markComplete({id})` — same skill, same
  args
- The **return value** varies:
  - Central: simple `{ok: true}` or `{error: 'offline'}`
  - Decentralized: `{ok: true, syncedTo: [karl, maria], pending: [frits]}`
  - Pod-less: `{ok: true, polledPeers: [karl, maria], unreachable: [frits], lastSeenFrits: 14:30}`

**What's missing today**
- **Pod-style awareness in skill returns** — skills today return
  app-local results. For decentralized + pod-less, they'd need to
  report **per-peer sync state**. Substrate work: extend skill
  return shape with optional `_sync: {peers: [...]}` field.
- **Chat shell renders connectivity hints** per pod-style. Needs to
  know each app's active pod-style (probably runtime-observed; see
  open question 1 in choice E).
- **Reactive completion** — for "Frits's pod synced" follow-up,
  same reactive primitive as J6's OIDC callback + J8's filtered
  notifications.
- **Staleness annotation on list rows** (per-row freshness) — see
  choice E's open question 3.

**Design implications**
- The skill is **the same** across pod-styles; the chat shell
  **adapts the rendering** based on the skill's `_sync` return data
- Substrate gains an optional `_sync` field on skill replies — apps
  using decentralized or pod-less storage populate it; central
  apps omit it (chat shell shows simple "✓" when absent)
- This proves design choice E concretely — pod-style propagates via
  **runtime observation** (skill return data), not manifest
  declaration

---

## Suggested additional journey shapes (kept as one-liners)

Three of the original suggested shapes (status/brief, notification-
driven, pod-style differences) have been promoted to full journeys
(J9, J8, J10). The remaining shapes stay as one-line descriptions —
the architecture doc revisits them only if a gap appears:

| Shape | Why it matters |
|---|---|
| **Destructive action with confirm** — `/clear-inbox`, `/delete-folder` from pod | Tests Q27 confirm severity flowing into chat (button styling, double-tap-to-confirm) |
| **Settings change with ambiguity** — "turn on holiday mode" | Tests disambiguation across apps that both have the concept (stoop + tasks-v0 both do) |
| **Onboarding new user** — `/start` from a fresh install (NOT pod sign-in — that's J6) | Tests first-run flow + which T3 wizards chat replaces vs hands off to |
| **Privacy-sensitive** — "show my mnemonic" (Tier C app-side only) | Tests how chat hands off to T3 surfaces without compromising security |
| **Folio sync status** — `/folio-status` → mini-page with last sync, conflicts, sharing state | Tests folio as the first real consumer of its declaration-only manifest |
| **Bulk action over a list reply** — list returns 8 tasks, batch select + `/done all` | Tests bulk-op composition + Q27 confirm for bulk + the "is this list still fresh?" staleness question |
| **External event arrives** — Anne accepts the invite; chat says "Anne is now in your household. `[Send welcome]` `[Assign first task]`" | Tests reactive chat — skill replies in the future, not just immediate (J8 already exercises the same primitive for filtered events) |
| **Cross-device handoff** — "send this task to my phone" | Tests the canopy mesh / relay model from a chat UI |
| **Search across apps** — "find anything about 'back door'" | Tests cross-app search; reveals whether/how each app exposes a `search` op |
| **Help / discovery** — `/help` or "what can I do?" | Tests how chat surfaces the merged toolCatalog as a navigable menu |
| **Settings panel via SIDE menu (not chat)** — user navigates to a persistent settings route | Tests the chat-vs-fixed-panel split (design choice B) — which settings are chat-inline (J5) vs side-panel-only? |
| **Calendar view of items with due dates** — "show this week" → side-panel calendar projection over `task-chore-item`-with-`dueAt` | Tests choice C.2 (calendar is a view, not an app); reveals the chat ⇄ calendar-panel nav protocol from B.1 |
| **Network-events log page** — non-chat surface showing other users' / agents' activity in your groups | Tests choice D's "logs page" sibling surface; reveals whether v1 needs it or it can wait |
| **Person-to-person message with reply** — Anne types back, Frits sees her message + her task-card adoption | Tests J7's embed primitive across multiple turns + per-user appliesTo gating |
| **Embed a skill-request, not a task** — `/skill-request` (stoop's `postRequest`) embedded in a P2P message | Tests embed type extensibility (J7 covers tasks; do all itemtypes get an embed shape?) |

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

The journey set is now substantial enough to drive the architecture
doc. `DESIGN-canopy-chat.md` will absorb the gaps and design
implications into concrete decisions:

- **Chat shell anatomy** — parser, router, renderer, per-thread state
- **Menu/keyboard lifecycle** — **decided: A2 hybrid** (choice A);
  the architecture carries it forward
- **Multi-thread workspace model** — **decided shape: D** (user-
  managed instances). Architecture defines: thread storage, filter
  DSL, event routing engine, per-thread config schema
- **Pod-style runtime observation** (choice E) — skill replies carry
  optional `_sync: {peers, pending, lastSeen}` shape; chat shell
  renders connectivity hints accordingly. Manifest does NOT declare
  pod-style; runtime data drives UX
- **Reply-shape taxonomy** — Q-number proposal for the manifest
  (`surfaces.chat.reply: 'text' | 'list' | 'record' | 'mini-page' | 'file' | 'embed-card' | 'notification' | 'brief'`)
- **Form generation** — `paramsSchema` → inline / mini-page /
  sequential, including new param types (date, picker-from-skill)
- **Mini-page hosting model** — inline HTML vs side panel vs
  deep-link
- **Chat ⇄ side-panel navigation protocol** (B.1) — `returnTo:
  <threadId>` link convention + floating "back to chat" button
  contract for every persistent surface
- **Detail-view scope (Q1)** — closing the V0 deferral; chat is the
  forcing function
- **Cross-app slash namespace + identity-bridge rules**
- **Slash → LLM → free-text routing rules** (per-thread, since
  threads can disable commands per D)
- **Per-thread state schema** — short-term cache for fuzzy
  resolution, in-flight flows (e.g. OIDC handoff), open live panels,
  thread filter rules
- **Follow-up hints** — `surfaces.chat.followUps`?
- **Reactive / outbound chat** — server-initiated messages (J6 OIDC
  callback, J7 cross-pod adoption, J8 filtered events). Event router
  matches against thread filter rules
- **Embed payload shape** — rich-message embed primitive for J7;
  cross-app routing by `appOrigin`; snapshot vs live ref
- **External flow primitive** — browser handoff for OIDC / app-store
  / external auth
- **Brief / aggregator primitive** (J9) — fan-out across apps; per-
  app `surfaces.chat.brief` opt-in?

## Separate / forward-looking concerns these journeys surface

Not in scope for the chat architecture doc, but flagged here so they
don't get lost:

- **Unified item taxonomy** (design choice C) — a single "task-
  chore-item" type synthesised best-of-three from the four apps.
  Per choice **C.1**: synthesis, not lowest-common-denominator. Worth
  its own design doc. Chat ships without it (typed embeds bridge
  the gap); a future refactor could unify.
- **Calendar as a view** (choice C.2) — calendar is a side-panel
  projection over `task-chore-item`-with-`dueAt`. Not a separate app.
  Possibly filterable per chat-thread (so a thread can show "only my
  calendar items"). Revisit when a calendar surface is on the table.
- **Network-events log page** (choice D) — non-technical surface
  showing other users' / agents' activity in your groups. Sits
  alongside the side panel. Open whether v1 needs it or it can wait
  until a thread-with-filter proves insufficient.
- **Per-item staleness signal** (choice E open question 3) — for
  decentralized + pod-less, list rows may be fresh or stale per
  peer. Substrate may need a per-item `_lastSync` annotation.

The journeys decide which of these are real concerns vs. premature
generalisation.

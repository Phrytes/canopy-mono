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

**Recommended starting position (subject to user testing):** A2
hybrid — action menus disable on next user message; record-shape
panels stay live until explicit close; bulk action over an old list
is rejected with "list is stale, run `/mine` again."

This is a Q-decision the architecture doc will resolve. The choice
affects every journey's transcript.

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
  the slash → skill → reply model.
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

## Suggested additional journey shapes (for you to fill in)

| Shape | Why it matters |
|---|---|
| **Status / morning brief** — "what's on my plate today across everything?" | Tests cross-app aggregation; reveals reply-format conventions for multi-app summaries |
| **Destructive action with confirm** — `/clear-inbox`, `/delete-folder` from pod | Tests Q27 confirm severity flowing into chat (button styling, double-tap-to-confirm) |
| **Settings change with ambiguity** — "turn on holiday mode" | Tests disambiguation across apps that both have the concept (stoop + tasks-v0 both do) |
| **Onboarding new user** — `/start` from a fresh install (NOT pod sign-in — that's J6) | Tests first-run flow + which T3 wizards chat replaces vs hands off to |
| **Notification-driven** — chat wakes you with "Karl just completed *Replace smoke detector*. `[View]` `[Thank]`" | Tests outbound/reactive chat (server-initiated messages), notifier substrate integration |
| **Privacy-sensitive** — "show my mnemonic" (Tier C app-side only) | Tests how chat hands off to T3 surfaces without compromising security |
| **Folio sync status** — `/folio-status` → mini-page with last sync, conflicts, sharing state | Tests folio as the first real consumer of its declaration-only manifest |
| **Bulk action over a list reply** — list returns 8 tasks, batch select + `/done all` | Tests bulk-op composition + Q27 confirm for bulk + the "is this list still fresh?" staleness question |
| **External event arrives** — Anne accepts the invite; chat says "Anne is now in your household. `[Send welcome]` `[Assign first task]`" | Tests reactive chat — skill replies in the future, not just immediate |
| **Cross-device handoff** — "send this task to my phone" | Tests the canopy mesh / relay model from a chat UI |
| **Search across apps** — "find anything about 'back door'" | Tests cross-app search; reveals whether/how each app exposes a `search` op |
| **Help / discovery** — `/help` or "what can I do?" | Tests how chat surfaces the merged toolCatalog as a navigable menu |
| **Settings panel via SIDE menu (not chat)** — user navigates to a persistent settings route | Tests the chat-vs-fixed-panel split (design choice B) — which settings are chat-inline (J5) vs side-panel-only? |
| **Calendar view of tasks with due dates** — "show this week" → embedded calendar card | Tests whether calendar IS a separate app or a *view of* tasks-v0 (overlap surfaced in design choice C) |
| **Person-to-person message with reply** — Anne types back, Frits sees her message + her task-card adoption in one thread | Tests the chat-thread model — does each contact have its own thread, or one unified inbox? |
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

Once the journey set is filled in, `DESIGN-canopy-chat.md` will
absorb the gaps and design implications into concrete decisions:

- **Chat shell anatomy** — parser, router, renderer, per-conv state
- **Menu/keyboard lifecycle** — pick between A1/A2/A3 variants
  (recommended starting position: A2 hybrid; see design choice A)
- **Reply-shape taxonomy** — Q-number proposal for the manifest
  (`surfaces.chat.reply: 'text' | 'list' | 'record' | 'mini-page' | 'file' | 'embed-card'`)
- **Form generation** — `paramsSchema` → inline / mini-page /
  sequential, including new param types (date, picker-from-skill)
- **Mini-page hosting model** — inline HTML vs side panel vs
  deep-link
- **Chat-vs-side-panel split** — which surfaces are chat-inline
  (settings as J5, contextual cards) vs side-panel-only (profile /
  password / pod URL — see design choice B)
- **Detail-view scope (Q1)** — closing the V0 deferral; chat is the
  forcing function
- **Cross-app namespace + identity-bridge rules**
- **Slash → LLM → free-text routing rules**
- **Per-conversation state schema** — short-term cache for fuzzy
  resolution, in-flight flows (e.g. OIDC handoff), open live panels
- **Follow-up hints** — `surfaces.chat.followUps`?
- **Reactive / outbound chat** — server-initiated messages (J6 OIDC
  callback, J7 cross-pod adoption replication)
- **Embed payload shape** — rich-message embed primitive for J7;
  cross-app routing by `appOrigin`; snapshot vs live ref
- **External flow primitive** — browser handoff for OIDC / app-store
  / external auth

## Separate / forward-looking concerns these journeys surface

Not in scope for the chat architecture doc, but flagged here so they
don't get lost:

- **Unified item taxonomy** (design choice C) — a single "thing
  with a state, master, assignee, deps, skills, dueAt" that the
  apps project differently. Worth its own design doc. Chat ships
  without it (typed embeds bridge the gap); a future refactor
  could unify.
- **Calendar as a view** — is calendar a separate app or a `view`
  of tasks with `dueAt`? Probably the latter; revisit when a
  calendar surface is on the table.
- **Multi-thread chat model** — one thread per contact, one unified
  inbox, or threads-per-topic? Mostly a UX choice; affects the
  per-conv state model.

The journeys decide which of these are real concerns vs. premature
generalisation.

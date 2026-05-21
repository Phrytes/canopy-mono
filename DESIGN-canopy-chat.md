# canopy-chat — architecture (2026-05-21)

Companion to `DESIGN-canopy-chat-journeys.md`. The journeys doc
captured *what the user does*; this doc captures *how the chat
shell implements it*. Decisions only — open questions are flagged
explicitly.

## Status

**Working draft.** This doc folds the journeys doc's decided design
choices into concrete data shapes, file layouts, and implementation
phases. It does NOT lock the code — phase 0 starts after this is
reviewed.

## What canopy-chat is

A **command-first chat shell** that consumes any canopy app's
manifest (via `renderChat` + `renderWeb` + new chat-specific
projector additions). It is:

- **The unified chat surface** for canopy apps (household, tasks-v0,
  stoop, folio, and future apps)
- **A composition layer**, not an app in the manifest sense — it
  doesn't have its own `manifest.js`; it consumes others'
- **Command-first**, LLM-later — slash grammar is the deterministic
  base; natural-language dispatch is a future phase that translates
  to the same underlying tool calls
- **Multi-thread**, with user-managed thread instances (per
  journeys doc choice D)
- **Substrate-aware** — surfaces pod-style connectivity hints
  (choice E), per-item state gating (Q4 appliesTo), Q27 confirm
  severities, etc., all without app-specific code

What it is NOT:

- **Not a replacement** for app-side web shells / RN screens — it's
  one surface among several, per journeys doc B
- **Not where settings live** for crucial / persistent config —
  side-panel pages own those (B.1 navigation protocol)
- **Not a substrate for canopy apps** — it composes the existing
  substrates (`@canopy/app-manifest`, `@canopy/web-adapter`,
  `@canopy/sync-engine-rn/react`, etc.)

## Recap of decided design choices (from journeys doc)

| # | Choice | Decision |
|---|---|---|
| A | Menu/keyboard lifecycle | A2 hybrid: action menus disable on next user message, record-shape panels stay live until `[Close]`, stale lists rejected |
| B | Chat is primary but not only surface | Side panel hosts settings/logs/file-dirs; B.1 nav protocol: `returnTo: <threadId>` + floating back-to-chat button |
| C | App boundaries blur via typed embeds | Rich-message embeds carry `appOrigin`; routed back to source app's agent. C.1: future unified item taxonomy is synthesis not union. C.2: calendar is a view, not an app |
| D | Multi-thread workspace | Threads are user-managed instances; per-thread filter + command-permission config; D.1: network-events log page is a sibling side-panel surface, included in v1 |
| E | Pod-style as UX dimension | `_sync` runtime reply convention; chat shell renders connectivity hints; E.3: mixed-pod threads are fine |

## Anatomy of the chat shell

```
                ┌──────────────────────────────────┐
                │  User input                       │
                │  (text / slash / button tap)      │
                └──────────────────┬───────────────┘
                                   ▼
              ┌────────────────────────────────────────┐
              │  1. Parser                              │
              │  • slash matcher (deterministic)       │
              │  • LLM translator (v0.8+, deferred)    │
              │  • free-text fallback                  │
              └──────────────────┬─────────────────────┘
                                 ▼
              ┌────────────────────────────────────────┐
              │  2. Router                              │
              │  • resolves opId → app via manifest    │
              │    merge + namespace rules             │
              │  • applies per-thread permissions      │
              │  • binds args from parser output       │
              │    + per-conv state + paramsSchema     │
              │    elicitation                         │
              └──────────────────┬─────────────────────┘
                                 ▼
              ┌────────────────────────────────────────┐
              │  3. Dispatch                            │
              │  • Q27 confirm gate (if declared)      │
              │  • callSkill(opId, args) on the right  │
              │    app's agent                         │
              │  • external-flow primitive (J6)        │
              └──────────────────┬─────────────────────┘
                                 ▼
              ┌────────────────────────────────────────┐
              │  4. Renderer                            │
              │  • reply-shape taxonomy (Q28 below)    │
              │  • _sync hint rendering (E.1)          │
              │  • mini-page lifecycle                 │
              │  • A2 lifecycle (disable / live / close)│
              └──────────────────┬─────────────────────┘
                                 ▼
              ┌────────────────────────────────────────┐
              │  5. Thread state manager                │
              │  • per-thread per-conv cache           │
              │  • in-flight flows (e.g. OIDC wait)    │
              │  • open live panels                    │
              │  • thread filter rules                 │
              └────────────────────────────────────────┘

         ┌──────────────────────────────────────────────┐
         │  Event router (reactive path)                 │
         │  • inbound events from notifier / inbox /     │
         │    skill replies                              │
         │  • matches each thread's filter; routes copy  │
         │    to matched threads                         │
         │  • always-on archive: network-events log page │
         └──────────────────────────────────────────────┘
```

## Module: parser

**Responsibility.** Turn raw user input into a `ParseResult`.

**Three parse modes, in priority order:**

```
ParseResult =
  | { kind: 'slash', opId, args, threadId }         // matched slash command
  | { kind: 'natural', candidates: ParseResult[] }   // LLM (v0.8+); empty list pre-LLM
  | { kind: 'unknown', text }                        // fall-through
```

**Slash matching.**

1. Strip leading `/`.
2. Look up against the merged `commandMenu` from all loaded
   manifests (see *cross-app surface* below).
3. If matched:
   - Parse remaining body per the manifest's
     `surfaces.slash.match` rules (today: `body: 'match' | 'reject'`;
     v0 adds `body: 'flags'` for J2-style `--key=value` args)
   - Resolve any per-conv state references (`/done dishwasher`
     resolves "dishwasher" against the thread's last-listed items)
   - Emit `{kind: 'slash', opId, args}`

**LLM matching (v0.8+).** Defer. The substrate plumbing
(`renderChat.toolCatalog`) is already there.

**Free-text fallback.** Reply with a "didn't understand" message +
the `[Help] [What can I do?]` affordances.

**Where this lives.** `packages/canopy-chat/src/parser.js`.

## Module: router

**Responsibility.** Resolve a `ParseResult` into a `Dispatch` — opId,
args, target app, gating state.

```
Dispatch = {
  opId: string,
  args: object,
  appOrigin: string,         // 'tasks-v0' | 'stoop' | ...
  threadId: string,
  needsConfirm?: {            // Q27 severity hint
    severity, message,
  },
  needsForm?: {               // when required params are missing
    schema, prefilledArgs,
  },
  needsExternalFlow?: {       // J6 browser handoff
    url, returnRoute,
  },
}
```

**Steps.**

1. Look up `opId` in the merged manifest catalog → identify
   `appOrigin` (the manifest that owns this op).
2. Check thread permissions (per D: some threads disable command
   dispatch).
3. Validate `args` against the op's `paramsSchema`. If required
   params missing, return `needsForm` (renderer asks the user).
4. Read `op.surfaces.ui.confirm` (Q27). If severity ∈ `{warn,
   danger}`, return `needsConfirm`.
5. Return ready-to-dispatch `Dispatch`.

**Where this lives.** `packages/canopy-chat/src/router.js`.

## Module: dispatch

**Responsibility.** Execute a `Dispatch`. Returns a `Reply` envelope
(possibly streamed for long ops).

```
Reply = {
  // Op-specific payload — opaque to chat shell
  payload: any,

  // Q28 — reply shape (new manifest declaration; see below)
  shape: 'text' | 'list' | 'record' | 'mini-page' | 'file'
       | 'embed-card' | 'notification' | 'brief',

  // E.1 — pod-style sync hints (optional)
  _sync?: SyncHints,

  // Q29 — follow-up hints (optional; declared in manifest)
  followUps?: Array<{ opId, prefilledArgs?, label }>,

  // Error (if any)
  error?: { code, message },
}
```

**Per-`appOrigin` skill dispatch.** Each manifest brings its own
agent context (crew, pod, identity). The router pre-binds these
when constructing `Dispatch`; dispatcher calls into the right
agent's skill registry.

**External flow handoff (J6).** When `needsExternalFlow` is present,
dispatch opens the URL (browser intent on mobile, `window.open` on
web), persists `{threadId, awaitingCallback: true, dispatchId}` to
thread state, and yields control. Callback arrives via deep link
(`canopy-chat://callback?...`); the event router (below) wakes the
thread and completes the dispatch.

**Where this lives.** `packages/canopy-chat/src/dispatch.js`.

## Module: renderer

**Responsibility.** Render a `Reply` into the chat UI.

### Reply-shape taxonomy (Q28 — new manifest declaration)

**Proposal.** Add to NavModel substrate:

```
op.surfaces.chat.reply?: 'text' | 'list' | 'record' | 'mini-page'
                       | 'file' | 'embed-card' | 'notification' | 'brief'
```

Defaults: `'text'` for ops with `verb` in `{add, claim, complete,
remove, update}` (mutations return confirmations); `'list'` for
`verb: 'list'`; `'record'` for `view.shape: 'record'`. Apps override
when needed.

**Per-shape rendering:**

| Shape | Rendering | A2 lifecycle |
|---|---|---|
| `'text'` | Plain message (with `_sync` hint suffix if present) | n/a (no menu) |
| `'list'` | List with per-row inline keyboard from `inlineKeyboardFor` | Action menus disable on next user message |
| `'record'` | Mini-page (record-shape); fields from `view.fields[]`; per-field patch via Q18 | **Stays live** until `[Close]` (J5 demonstrated) |
| `'mini-page'` | Same as record but app-specific HTML (J4 task detail) | Stays live until `[Close]` |
| `'file'` | File attachment + optional inline preview | n/a |
| `'embed-card'` | Cross-app embedded card (J7) | Cards have per-recipient `appliesTo` gate; lifecycle per parent message |
| `'notification'` | Event card (J8) with `[Action]` buttons | Action menus disable on next user message in that thread |
| `'brief'` | Multi-section summary (J9) | Sections may be lists, each per `list` lifecycle |

### The `_sync` hint renderer (E.1)

If `Reply._sync` is present, the renderer appends a connectivity
suffix:

- `_sync.style === 'central'` (or absent) → no suffix
- `_sync.style === 'decentralized'` → "Synced to N peers · M pending"
  with reactive update when pending peers confirm (event router
  wakes the thread)
- `_sync.style === 'pod-less'` → "Polled K peers · last seen
  M h ago" with a `[Refresh from peers]` affordance

**Where this lives.** `packages/canopy-chat/src/renderer.js`.

## The `_sync` reply-envelope convention (formal spec)

Repeated here from the journeys doc, locked to one spec.

```ts
type SyncHints = {
  style:        'central' | 'decentralized' | 'pod-less',
  peers?:       string[],            // webids confirmed
  pending?:     string[],            // webids not yet confirmed
  unreachable?: string[],            // webids that couldn't be reached
  lastSeen?:    Record<string, number>,  // pod-less: webid → epoch ms
};
```

**Adopter rules:**

- Skills serving **central** contexts may omit `_sync` entirely
  (chat renders flat).
- Skills serving **decentralized** contexts populate `style:
  'decentralized'` + `peers` + `pending` + `unreachable`.
- Skills serving **pod-less** contexts populate `style: 'pod-less'`
  + `peers` + `lastSeen`.
- The substrate ships a helper:
  `packages/web-adapter/src/syncStateRenderer.js` consuming the
  field uniformly.

**Why this is not a NavModel Q-number.** `_sync` is a runtime reply
convention, not a manifest schema field — same category as the
existing `_scope` arg-injection (sync-engine-rn convention). The
canopy-chat doc is the spec home; future apps adopt by populating
the field.

## Menu/keyboard lifecycle (A2 hybrid implementation)

Per choice A:

**Action menus** (list with per-row buttons, section-header CTAs,
notification cards):
- Rendered with a per-message `lifecycleState: 'live' | 'disabled' |
  'stale'` flag
- Initial state: `'live'`
- On the user's *next* message in that thread (chat input
  submitted), all `'live'` action menus above that message flip to
  `'disabled'`
- On clicking a disabled menu: "This list is stale, run `/<command>`
  again."

**Record-shape panels** (settings, profile, task detail):
- Rendered with `lifecycleState: 'live'` and **NOT** flipped by
  next-message logic
- Explicit `[Close]` button transitions to `'closed'` (collapsed
  one-liner in chat)
- Re-renders on relevant `item-changed` events (per-app event
  feed)

**State storage.** Per-thread message store carries
`{messageId, lifecycleState}` for each rendered reply.

**Where this lives.** `packages/canopy-chat/src/renderer/lifecycle.js`.

## Module: thread state manager

**Responsibility.** Manage the user's threads — config, filters,
per-thread state, message history.

### Thread schema

```ts
type Thread = {
  id:        string,              // ulid
  name:      string,              // user-facing
  createdAt: number,

  filter: {
    apps?:     string[],          // ['household'] | ['household','tasks-v0']
    eventTypes?: string[],        // ['notification','reminder'] | undefined = all
    actors?:   string[],          // webids; undefined = all
    custom?:   FilterPredicate,   // escape hatch for v2+
  },

  permissions: {
    allowCommands:   boolean,     // false = read-only thread (events only)
    allowedApps?:    string[],    // restrict commands to a subset
    allowedThreads?: string[],    // for cross-thread refs (future)
  },

  state: {
    lastListings:  Record<string, ListSnapshot>,
                                  // opId → { items, listedAt } for fuzzy
                                  // arg resolution (J1 dishwasher case)
    inFlight?:     { dispatchId, awaiting: 'callback' | 'paramsForm' | 'confirm' },
    openPanels:    string[],      // message ids of currently-live record panels
  },

  messages: Message[],            // chronological
};

type Message = {
  id:        string,
  ts:        number,
  origin:    'user' | 'shell' | 'app:<name>',
  body:      Reply | UserInput,
  lifecycleState?: 'live' | 'disabled' | 'closed' | 'stale',
  // ...
};
```

### Thread management

- **Create** — user clicks `+ New thread`; UI presents the J8 form
  (name, filter, permissions). Persisted to local store; replicated
  per the user's bundle's storage policy.
- **Configure** — edit name / filter / permissions; same form,
  pre-filled.
- **Delete** — soft-delete (tombstone for sync) + UI archive option.
- **Reorder** — pinned threads first, then by recency.

### Default threads (shipped fresh-install)

| Thread | Filter | Purpose |
|---|---|---|
| Main | `apps: ['*']`, `eventTypes: []` (no events) | User-initiated commands across all apps |
| Inbox | `eventTypes: ['notification', 'reminder']`, `allowCommands: true` | Event sink + quick-action target |

Users can delete or reshape these; they're seeds, not fixed.

### Per-conv state lifetime

- `lastListings` — TTL 24h or until that op's items demonstrably
  change (per `item-changed` event); cleared on thread close
- `inFlight` — persisted across app restarts (J6's OIDC callback
  may take minutes); cleared on success / cancel / 30 min timeout
- `openPanels` — persisted; record panels survive app restart

**Where this lives.** `packages/canopy-chat/src/thread.js` +
`packages/canopy-chat/src/threadStore.js`.

## Module: event router (reactive path)

**Responsibility.** Inbound events (notifier output, item-changed
events from each app's bundle, skill-reply async completions like
J6's OIDC callback) get routed to matching threads + always to the
log page.

```
Event = {
  id:        string,
  ts:        number,
  app:       string,             // 'household' | 'tasks-v0' | ...
  type:      string,             // 'notification' | 'item-changed' | ...
  actor:     string,             // webid (if known)
  itemRef?:  { app, type, id },
  payload:   any,
}
```

**Routing rules:**

1. **Filter match** — for each thread, test the event against
   `thread.filter`; deliver to matching threads as `Reply` (shape
   `'notification'` typically).
2. **Always-on archive** — append to the network-events log page
   (D.1) regardless of thread matches.
3. **In-flight wake** — if the event matches a thread's
   `state.inFlight` correlation (e.g. OIDC callback with matching
   sessionId), complete the dispatch.
4. **Record-panel refresh** — for events matching an open record
   panel's item, trigger re-render.

**Where this lives.** `packages/canopy-chat/src/events.js`.

## Module: network-events log page (D.1)

Specification per the journeys doc. Architecture-side notes:

**Surface type.** A side-panel route (B-style), not a chat thread.
Renders as a chronological feed.

**Data model.** Same `Event` shape as the event router; persisted in
the same store. The log page reads-only; chat threads read +
optionally surface.

**Filter UI.** Top-of-page chips (group / app / event-type / actor)
with last-N-hours / last-N-days time-window selector.

**Per-event affordances.**

- `[View context]` — for events with `itemRef`, opens the item in
  its app's view (per-row navigation; uses the same opener as J4)
- `[Mute this kind]` — adds a `mute` rule to chat-shell-level
  filters (so future events of this kind don't appear in any
  thread, but still in the log)
- `[Open in chat]` — if a thread is configured to surface this
  event-type, jump to it

**Pagination.** Cursor-based; older events lazy-load on scroll.

**Where this lives.** `packages/canopy-chat/src/logs/` + a UI route.

## Cross-app surface

### Manifest merge

At chat-shell boot:

1. Load each enabled app's manifest (currently: tasks-v0, stoop,
   household, folio).
2. Run `validateManifest` on each (catch broken manifests early).
3. Produce a **merged catalog**:
   ```
   MergedCatalog = {
     opsById:       Map<string, { op, appOrigin }>,
     commandMenu:   Array<{ command, opId, appOrigin }>,
     toolCatalog:   Array<ToolDescriptor>,  // for v0.8+ LLM
     globals:       Array<{ opId, appOrigin }>,
     itemTypes:     Map<string, { type, appOrigin }>,
   }
   ```

### Op-id namespace

**Decision: app-prefixed when collision, flat when unique.**

- For each opId, count the apps that declare it.
- If unique → flat (`addTask` → no prefix).
- If colliding → prefixed (`/household/add-task` vs.
  `/tasks-v0/add-task`).
- The merge step computes this once at boot; the chat shell shows
  flat names everywhere except when collision-prefixing is needed.

Why not always-prefixed? Cleaner UX for users with a single app
that owns the op (90% of cases). The `/household` prefix only
appears when ambiguity actually exists.

Stoop's existing collision-avoidance (its slash commands already
avoid household's `/add`, `/done`, etc.) reduces collisions in
practice.

### Identity bridge

**Problem.** Anne's WebID is one identity, but each app may surface
her differently (household's actor pubkey, stoop's MemberMap entry,
folio's pod URL).

**Decision: bridge skill convention.** Each app exposes (if
applicable) a `resolveContact(name)` skill that returns
`{webid, displayName, ...}`. The chat shell calls these in parallel
when resolving names across apps; first non-empty result wins for
that name. Caches per-thread.

**Substrate work.** Add `resolveContact` as a documented
skill-convention in `DESIGN-canopy-chat.md` (this doc); each app
optionally implements it. Future Q-number considered if pattern
proliferates.

## Form generation (paramsSchema → UX)

For ops with required `params` the user hasn't supplied:

**Strategy decision rule (heuristic for v0.3):**

| Param count | Render |
|---|---|
| 0 (op has no params) | Fire directly; no form needed |
| 1 param, kind ∈ `{string, number, enum, boolean}` | Single sequential prompt ("What's the task text?") |
| 2-3 params, all simple kinds | Inline form (compact, in-chat message) |
| 4+ params OR any complex kind (object, file, image) | Mini-page form (popout / side panel) |

**Param types extension (v0.3):**

| Kind | Render |
|---|---|
| `string` | Text input |
| `number` | Number input |
| `boolean` | Toggle |
| `enum` | Dropdown / radio (uses `of: [...]` or `of: '<skillId>'` for picker-from-skill) |
| `date` | **New** — date picker; "friday" → epoch ms parsed by shell |
| `webid` | **New** — contact picker chained to `resolveContact` skill |
| `file` / `image` | Q23 — file picker; consumer-side transform per existing Q23 contract |

**Where this lives.** `packages/canopy-chat/src/forms/`.

## Mini-page hosting

**Decision: inline HTML by default, side-panel for "open in full."**

Per J4 + J5:

- **Inline HTML** — record-shape panels (J5 settings) and J4-style
  task detail render as `<div>` blocks within the chat message
  stream. They stay live (A2). Bandwidth-efficient; no separate
  route.
- **Side panel / WebApp-style** — for `[Open in full]` affordance
  on a mini-page; opens the same content as a larger panel
  (potentially the same page the web shell renders). Useful for
  big task detail views, settings with many fields, file
  directories.
- **Deep-link out** — for J6-style external flows (OIDC redirect);
  not a mini-page, an actual browser handoff.

**Lifecycle.** Mini-pages subscribe to relevant events via the
event router; re-render on match. Explicit `[Close]` removes from
chat (collapses to one-line summary) AND unsubscribes.

**Where this lives.** `packages/canopy-chat/src/miniPage.js`.

## Chat ⇄ side-panel navigation (B.1)

**Decision: `returnTo` query param + `back-to-chat` widget.**

**Chat-side.** Any chat reply that links to a side-panel page
includes the `returnTo` parameter:

```
/settings?returnTo=<threadId>
/logs?returnTo=<threadId>
/files/notes/today.md?returnTo=<threadId>
```

**Side-panel side.** Pages check for `returnTo` query param at
mount. When present:

- Render a **floating "back to chat" button** (bottom-right by
  default; configurable per side-panel page)
- Tapping the button navigates to `/chat?focus=<threadId>` —
  reopens the originating thread

Standard convention; every side-panel page (settings, logs,
file-dirs) implements it via a shared React/web helper:

```js
import { useReturnToChat } from '@canopy/chat-nav';

function SettingsPage() {
  const returnToChat = useReturnToChat();  // returns button props or null
  return (
    <div>
      <h1>Settings</h1>
      {/* page body */}
      {returnToChat && <FloatingButton {...returnToChat} />}
    </div>
  );
}
```

**Where this lives.** `packages/chat-nav/` (small shared helper —
sub-substrate of canopy-chat).

## Embed primitive (J7)

**Decision: typed embed payload on chat messages.**

Chat-message envelope gains an `embed` field:

```ts
type ChatMessage = {
  // ...existing fields
  text:    string,
  embed?: {
    kind:       'item-card',     // v1; future kinds: 'file-card', 'thread-ref'
    appOrigin:  string,           // 'tasks-v0'
    itemRef:    { app, type, id },
    snapshot:   ItemSnapshot,     // for read (works offline)
  },
};
```

**Rendering.** Embedded cards render the same way as a list-reply's
single item — `inlineKeyboardFor(item)` produces per-recipient
buttons; `appliesTo` gates evaluated against the **viewing user's**
context.

**Cross-app routing.** When the recipient taps an action, the chat
shell dispatches against the **embed's `appOrigin`**, not the
thread's owner app. Same dispatcher as direct slash commands.

**Snapshot vs live ref.** The embed includes a `snapshot` (for
offline / cross-pod read); actions fetch the live item via
`getItem({id})` against `appOrigin`. If live fetch fails (no
permission), the card stays visible (snapshot) but actions show
"insufficient permissions."

**New skill convention.**

```
op.surfaces.chat.embed?: {
  cardSnapshotSkill: '<skillId>',  // returns a snapshot for embedding
}
```

Apps opt in per item type. Tasks-v0's `getTask` becomes the
snapshot source for task-card embeds; stoop's `getRequest` for
skill-request embeds.

**Where this lives.** `packages/canopy-chat/src/embed.js` +
manifest schema extension.

## Slash → LLM → free-text routing

**v0.1–v0.7: slash-only.** All user input runs through the slash
matcher. Unmatched input falls through to "I don't understand"
with `[Help]` affordances.

**v0.8: LLM layer.** Unmatched input feeds an LLM with the merged
toolCatalog as tool definitions. The LLM proposes one or more
tool calls; chat shell presents them as **proposed actions** the
user confirms (J3 post-LLM mode). The LLM does NOT autonomously
dispatch — confirmation required.

**Why slash-first.** Per the journeys doc: command-first proves
the dispatch path deterministically. LLM becomes a thin translator
(NL → slash), not the dispatch authority. Predictable for power
users; testable per-op.

**Where this lives.** `packages/canopy-chat/src/llm/` (deferred).

## Brief / aggregator primitive (J9)

**Decision: `/brief` is a chat-shell built-in.**

Behavior:

1. Find every op across the merged catalog with
   `surfaces.chat.brief: { summarySkill: '<skillId>' }` declared.
2. Call each summary skill in parallel; aggregate results into a
   single reply with shape `'brief'`.
3. Renderer formats per-app sections with `[Open]` / `[See all]`
   navigation buttons.

**New manifest declaration:**

```
op.surfaces.chat.brief?: {
  summarySkill: '<skillId>',   // returns brief-shape payload
  order?: number,               // section ordering hint
  label?: string,               // section label
}
```

Apps opt in. Failures (skill error / unreachable pod) render as
"⚠ Brief from <app> unavailable" rather than failing the whole
brief.

**Where this lives.** Manifest schema extension +
`packages/canopy-chat/src/brief.js`.

## Confirm gate (Q27 in chat)

Existing Q27 `surfaces.ui.confirm: {severity, message}` flows
directly into chat:

- `severity: 'info'` → no gate; dispatch immediately
- `severity: 'warn'` → render `[Confirm] [Cancel]` inline buttons
  with `message`
- `severity: 'danger'` → red-styled `[I'm sure] [Cancel]` with
  `message`; secondary confirmation for destructive irreversible
  ops (deferred; v0.6+ when needed)

No new substrate; reuses `createOpBinding`'s `confirmAndCall`
pattern but adapted for chat's "press buttons" UX instead of
`window.confirm()`.

## Chat shell — app vs substrate

**Decision: canopy-chat is a sibling app, not a substrate.**

- Lives at `apps/canopy-chat/` (mirrors `apps/household/`,
  `apps/tasks-v0/`, etc.)
- Composes substrates: `@canopy/app-manifest`,
  `@canopy/web-adapter`, `@canopy/sync-engine-rn/react`,
  `@canopy/notifier`, etc.
- Imports other apps' manifests as workspace deps:
  `@canopy-app/tasks-v0/manifest`, etc.
- Has its own per-user pod-storage policy (where threads live;
  default: local-first, optional pod sync)

**Small substrates split out as needed:**

- `packages/chat-nav/` — shared `useReturnToChat` helper used by
  every side-panel page (not just canopy-chat-owned ones)
- Manifest schema extensions (Q28 reply-shape, embed snapshot
  skill, brief summary skill) land in `@canopy/app-manifest`

## Package layout

```
apps/canopy-chat/
├── package.json
├── manifest.js                  ← chat shell's own ops (createThread,
│                                   muteEvent, etc.)
├── src/
│   ├── index.js                 ← entry
│   ├── parser.js
│   ├── router.js
│   ├── dispatch.js
│   ├── renderer/
│   │   ├── index.js
│   │   ├── text.js
│   │   ├── list.js
│   │   ├── record.js
│   │   ├── miniPage.js
│   │   ├── embed.js
│   │   ├── notification.js
│   │   ├── brief.js
│   │   ├── syncHints.js         ← E.1 renderer
│   │   └── lifecycle.js         ← A2 hybrid lifecycle
│   ├── thread.js
│   ├── threadStore.js
│   ├── events.js
│   ├── brief.js
│   ├── forms/
│   │   ├── index.js
│   │   └── fieldTypes.js
│   ├── logs/                    ← network-events log page
│   ├── llm/                     ← deferred (v0.8+)
│   └── manifestMerge.js
├── web/                          ← web shell pages (chat + side panels)
├── rn/                           ← RN screens (parallel to web)
└── test/
    └── ...

packages/chat-nav/                ← B.1 helper substrate
├── package.json
└── src/
    ├── useReturnToChat.js
    └── FloatingButton.js
```

## Implementation phases

**v0.1 — bare-minimum chat shell**

- Single default thread (no multi-thread yet)
- Slash parser only
- `text` + `list` reply shapes
- Targets: tasks-v0 + household manifests merged
- Goal: prove `/done dishwasher`, `/mine`, `/addtask` end-to-end

**v0.2 — multi-thread**

- Thread management UI (create / configure / delete)
- Filter DSL (apps + eventTypes + actors)
- Event router with thread routing
- Default Main + Inbox threads
- Goal: J8 demoable

**v0.3 — mini-pages + forms**

- `record` + `mini-page` reply shapes
- Inline forms from `paramsSchema`
- A2 hybrid lifecycle (action menus disable; record panels live)
- B.1 chat ⇄ side-panel navigation (`useReturnToChat`)
- Goal: J5 demoable, J2 with form path

**v0.4 — cross-app polish**

- Manifest merge with op-prefix-on-collision
- `resolveContact` bridge skill convention
- Add stoop + folio manifests to the merged catalog
- Goal: J3 demoable (command-first; LLM path stays as fallback
  text)

**v0.5 — embeds**

- Embed payload schema on chat messages
- Cross-app routing by `appOrigin`
- `getCardSnapshot` skill convention
- Goal: J7 demoable

**v0.6 — pod-style + reactive**

- `_sync` reply convention adoption (stoop + tasks-v0 decentralised
  crews populate)
- Connectivity-hint rendering per style
- External-flow primitive (J6 OIDC handoff)
- Reactive event router (mini-page refresh on changes)
- Goal: J6 + J10 demoable

**v0.7 — log page + brief**

- Network-events log page (D.1)
- `/brief` aggregator + per-app `summarySkill` opt-in
- `[View context]` / `[Mute this kind]` affordances
- Goal: J9 demoable + log page operational

**v0.8 — LLM layer**

- Natural-language parser using merged toolCatalog
- Proposed-actions UI (J3 post-LLM mode)
- Confirmation required for autonomous dispatch
- Goal: J3 demoable in NL mode

Each phase is shippable on its own (the chat shell works at every
step; later phases add capability). v0.1 is the proof-of-concept;
v0.6 is feature-complete for the four current canopy apps.

## Manifest schema extensions summary

Net additions to `@canopy/app-manifest` to support chat:

| Q | What | Manifest field | Phase |
|---|---|---|---|
| Q28 | Reply-shape declaration | `op.surfaces.chat.reply: 'text' \| 'list' \| ...` | v0.1+ |
| Q29 | Embed snapshot skill | `op.surfaces.chat.embed: { cardSnapshotSkill }` | v0.5 |
| Q30 | Brief summary skill | `op.surfaces.chat.brief: { summarySkill, order?, label? }` | v0.7 |
| Q31 | Follow-up hints | `op.surfaces.chat.followUps: [{ opId, prefilledArgs? }]` | v0.4 |

`_sync` is **not** a Q-number (runtime reply convention; documented
here).

## Open questions (deferred from this doc)

1. **Per-row staleness signal** (E.2) — for decentralized + pod-less
   list replies, do we add a per-item `_lastSync` annotation? Defer
   to a real consumer hitting the limit.
2. **Cross-app follow-ups** (J3) — `surfaces.chat.followUps` is
   proposed as Q31, but the more interesting case is **across apps**
   ("just added a member, suggest sharing a folio folder"). May need
   a cross-app registry of "after X, consider Y." Defer to v0.4+
   when real cross-app chains surface.
3. **Multi-device chat sync** — when the user has chat threads on
   both phone and laptop, do threads sync? Probably yes via the
   user's pod (when one exists). Defer the sync model to v0.2+ once
   the storage shape is clear.
4. **Multi-thread bulk operations** — "mark all done in this
   thread" vs. "in all threads" — UX choice for v0.2+.
5. **Permission boundary for embed cards** (J7) — when Anne adopts
   Frits's embedded task, who issues the assignment? Frits's agent
   (because he owns the task) or Anne's agent (because she's the
   acting party)? Defer to v0.5 implementation; probably
   appOrigin's agent runs the skill, with the recipient's identity
   as the actor.

## Where this doc fits in the design canon

- **Owner decisions on the underlying NavModel substrate** —
  `DESIGN-navmodel-sketch.md` (Q1–Q27 today; this doc proposes
  Q28–Q31).
- **User journeys that drove these decisions** —
  `DESIGN-canopy-chat-journeys.md`.
- **Page tier policy (T1/T2/T3)** —
  `DESIGN-tier-policy.md`. Chat shell pages are T1 (substrate-
  rendered) per their nature; side-panel pages connected to chat
  via B.1 are T2 (manifest-bound with custom UX) at minimum.
- **Tier C proposals (Q-numbers deferred)** —
  `TIER-C-PROPOSALS.md`. Q27 (`confirm`) landed; this doc consumes
  it; the deferred Tier C signals (`enabledWhen`, multi-step,
  consent-gated reads) may resurface in chat context.

## Status when this doc lands on master

The doc is a **working draft architecture**. Code-side, nothing
exists yet (the `apps/canopy-chat/` tree is empty / to be created
in v0.1). The doc commits the decisions; the implementation
follows.

The journeys doc + this doc together give a future contributor
(or future-us) enough to start v0.1 without needing context from
the conversations that produced them.

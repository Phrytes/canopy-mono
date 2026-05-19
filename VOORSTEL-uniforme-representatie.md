# Proposal — one shared representation for chat, web and mobile

> Status: PROPOSAL / reading piece, rewritten 2026-05-19 (now in English, one
> language throughout). Not yet ratified; nothing in code has changed. Goal:
> give a picture, explain the model, propose an app-by-app path. One worked
> deep dive (household). Sharing model includes user journeys for review.

---

## 0. In one paragraph

Every "entry point" (Telegram bot, web UI, mobile app) already ends at the
same core: a fixed set of verbs on items (`add`, `complete`, `claim`,
`remove`, …). But each entry point **re-describes those verbs by hand**, so
they drift apart. The proposal: describe the verbs **once, as data** (a
*manifest*), and let each entry point *project* that data into its own shape
(LLM tools, slash commands, menus, screens). One source, many surfaces.
Start with the bot, because it has no *screen GUI* yet (only a rich chat
surface with buttons and a command menu) — that makes it the cheapest place
and immediately the reference for the rest.

---

## 1. The core idea in one picture

An action is always the same triple, regardless of the entry point:

```
   (verb ,  target item(s) ,  parameters)
    claim     task #42            —
    add       —                   { type: "groceries", text: "coffee" }
```

The only difference between chat and a GUI is **who assembles the triple**:

```
   CHAT                              GUI (web/mobile)
   ────                              ────────────────
   user types free text             user navigates
        │                                  │
        ▼                                  ▼
   LLM builds the triple             human builds the triple
   (from the tool descriptions)      (pick list → item → button → form)
        │                                  │
        └──────────────┬───────────────────┘
                        ▼
            agent.invoke(verb, target, params)   ←  already exists
                        ▼
                  ItemStore / skill                ←  already exists
```

The bottom two layers are **already shared**. What is missing is a shared
description of the top. That description is the **manifest**.

```
                    ┌───────────────────────────┐
                    │        APP MANIFEST        │   ← one source, per app
                    │  item types + operations + │
                    │  per-surface hints         │
                    └─────────────┬─────────────┘
                                  │  (projectors)
          ┌───────────────┬───────┴───────┬────────────────┐
          ▼               ▼               ▼                ▼
     renderChat       renderSlash      renderWeb       renderMobile
  (LLM tools +        (command menu    (menu/screen    (React-Navigation
   buttons + menu +    + /add grammar)  tree)           tree)
   system prompt)
          │               │               │                │
          ▼               ▼               ▼                ▼
   @canopy/chat-agent   bot fast-path    web UI          mobile app
```

Important: the projectors decide **how** a node is drawn, not **which**
nodes exist or in what order. That lives in the manifest. So web and mobile
menus *cannot* drift apart: there is only one list.

And "chat" is not a poor surface here. A Telegram bot has, besides free
text, a command menu and inline buttons — structured affordances that come
from exactly the same manifest fields as the web/mobile buttons. The
"conversation vs screen tree" dichotomy is too coarse; see §3d.

---

## 2. Why this is needed now — the drift, concretely

In the household bot (`apps/household`) the verb "add" lives, right now, in
**three** places, each maintained separately:

| # | Place | What it describes |
|---|-------|-------------------|
| 1 | `src/parsers/regexCommands.js` + `parsers/grammar.md` | the *deterministic* command: `add <type> <text>` |
| 2 | `src/llm/chatAgentBridge.js` → `V0_TOOL_CATALOG` + `SYSTEM_PROMPT_CLASSIFY` | the *LLM* surface: an `addItem` tool with an arg schema |
| 3 | `src/skills/addItem.js` | the *executor* itself |

Add "task" next to "list item" later, and you must touch (1), (2) and (3),
plus — once a web/mobile screen exists — a fourth and fifth place. Five
descriptions of one verb. That is "drifts apart", literally pinpointable in
the code.

The core (the executor, #3) stays. What we remove is the *by-hand
maintenance* of #1, #2, #4, #5. Those become **projected** from one manifest.

---

## 3. The building blocks — and the hooks that already exist

### 3a. The manifest (new, small, per app)

Not a UI framework. A piece of **data** an app exports once. Illustrative
(not the final API):

```js
// apps/household/manifest.js  — ILLUSTRATIVE
export const householdManifest = {
  app: 'household',
  itemTypes: ['list-item', 'task', 'contact'],   // from @canopy/item-types

  operations: [
    {
      id: 'addItem',
      verb: 'add',                                 // maps to ItemStore.addItem
      appliesTo: { type: ['list-item', 'task'] },
      params: [
        { name: 'type', kind: 'enum', of: 'itemTypes', required: true },
        { name: 'text', kind: 'string', required: true },
      ],
      role: 'member',                              // existing RolePolicy
      surfaces: {
        chat:  { hint: 'add <text> to <type>',
                 examples: ['put coffee on the groceries list'] },
        slash: { command: '/add', shape: '/add <type> <text>' },
        ui:    { placement: 'list-header', control: 'compose-box' },
      },
    },
    {
      id: 'claim', verb: 'claim',
      appliesTo: { type: 'task', state: 'open' },
      params: [], role: 'member',
      surfaces: {
        chat:  { hint: "I'll take <task>" },
        slash: { command: '/claim', shape: '/claim <id|text>' },
        ui:    { placement: 'item-action', control: 'button', label: "I'll do this" },
      },
    },
    // … complete, remove, registerName, …
  ],

  views: [   // what web/mobile show as the "menu" — one source, both identical
    { id: 'groceries', title: 'Groceries', type: 'list-item', filter: { open: true } },
    { id: 'tasks',      title: 'Tasks',     type: 'task',      filter: { open: true } },
    { id: 'members',    title: 'Members',   type: 'contact' },
  ],
};
```

Three things to keep in mind:

* **`verb` invents nothing.** The verb set is already fixed and canonical in
  `@canopy/item-store` (`addItem`, `listOpen`, `markComplete`, `remove`,
  `claim`, `reassign`, `submit`, `approve`, `reject`, `revoke`). The manifest
  *annotates* those — per app, per item type — with "where and how does this
  appear".
* **`surfaces` is the escape hatch.** Not "one representation to rule them
  all", but "shared skeleton + per-surface override". A chat-only affordance
  goes only under `chat`; a mobile gesture under a mobile block.
  Forward-additive: you add new surfaces, you never break existing ones.
* **Chat is a rich surface here.** `surfaces.slash` feeds Telegram's command
  menu; `surfaces.ui` (`control:'button'`, `label`) feeds both the
  web/mobile button *and* the Telegram inline button. One field → three
  surfaces. The bot is therefore partly graphical — see §3d.

### 3b. The projectors (new small package, e.g. `@canopy/app-manifest`)

Pure functions `manifest → surface-specific description`. No side effects,
easy to test.

* `renderChat(manifest)` → the free-text channel: exactly what
  `@canopy/chat-agent`'s `ChatAgent` already expects (`{ toolCatalog,
  toolHandlers, systemPrompt }`), **plus** the structured chat affordances:
  a `commandMenu` (Telegram `setMyCommands`) and an `inlineKeyboardFor(item)`
  that yields the applicable buttons per shown item. See §3d and §5.2.
* `renderSlash(manifest)` → the grammar that is by hand in `regexCommands.js`
  today.
* `renderWeb(manifest)` / `renderMobile(manifest)` → an abstract **NavModel**
  (tree: `view → list → per-item operations`), which a thin platform adapter
  (≈100 lines) maps onto CLI menus resp. React Navigation. The *content and
  order* come from the manifest; the adapter only knows *how to draw*.

### 3c. The hooks that already exist (build on these, not beside them)

| Existing | What it already does | Role in this model |
|----------|----------------------|--------------------|
| `@canopy/core` `defineSkill(id, fn, { description, visibility })` | register skill + metadata | embryonic manifest: id + description + visibility |
| `agent-ui` `discoverSkills() → AgentCard` | make skills discoverable over the A2A wire | the manifest is already *queryable*; a projector can lean on this |
| `@canopy/chat-agent` `ChatAgent({ toolCatalog, toolHandlers, systemPrompt })` | LLM + tools + session | the target format of `renderChat` — literally |
| `Store` seam (`InMemoryStore` → `HybridPodStore`, one line) | storage swappable | the manifest stays dumb about storage/transport — see §6 |

In other words: the manifest is not a new world. It is **promoting skill
metadata to first-class data**, plus projectors that make the existing
by-hand maintenance (catalogue #1, #2, #4, #5) unnecessary.

### 3d. "Chat" is not a poor surface — a Telegram bot is half graphical

A Telegram bot has not one but four input channels, and three of them are
*structured* (not free text):

1. **Free text** → LLM → operation. The only channel that is *not* a
   manifest projection: the LLM derives the triple from the tool
   descriptions.
2. **Command menu** — the list Telegram itself shows behind the "Menu"
   button (`setMyCommands`). This *is* a menu drawn by Telegram. Source:
   `surfaces.slash`.
3. **Inline buttons** — buttons under a message; each carries
   `callback_data`, a tap = a `callback_query`. This is exactly a "per-item
   action button" — literally the same as the `ui` button web/mobile show.
   Source: `surfaces.ui` (`control:'button'`, `label`) + `appliesTo`.
4. **Reply keyboard** — a fixed choice set replacing the keyboard; useful
   for short fixed choices (e.g. a `views` switcher).

Point: channels 2–4 come from the *same manifest fields* as the web/mobile
buttons/menus. Better than "conversation vs screen tree": **every surface is
a mix of free input (chat/LLM only) and structured affordances (buttons,
menus) that everywhere come from the manifest.** The bot is therefore partly
graphical, and that graphical half shares its source with web and mobile.

And the seam already exists: `@canopy/chat-agent` accepts `buttons` in
`SendReplyArgs`, and the Telegram bridge turns an incoming `callback_query`
into a regular `IncomingMessage` that runs through the same dispatch path as
typed commands. `renderChat` only has to *project* the buttons; the handling
is existing infrastructure.

Concretely, with the manifest from §3a: when the bot prints the task list,
each open task gets an inline button **"I'll do this"** — exactly the
`claim` operation's `surfaces.ui.label`. The `callback_data` carries
`claim:#42` — the triple again. Tap → existing dispatch → `ItemStore.claim`.
The same `claim` that is a row button on web and the `claim` tool in the LLM
catalogue. One operation, three surfaces, zero hand-duplication.

**The channels split by capability tier (refines §3f).** Channels 2–4 —
command menu, inline buttons, slash — are *base*: deterministic, always
available, fully local, no LLM. They come from `renderSlash` + the
structured projections. Channel 1 — free text → LLM — is the *optional
extension*, gated on the circle's/group's settings (the LLM is often
server-side, not on the phone). Consequence: a phone with no local LLM still
fully works via the structured channels; the LLM is the optional power
layer, not a requirement. This is the §3f base-vs-extension split applied to
chat itself.

### 3e. A bot is a surface, not an app — every app gets chat control

"Bot" is — like "web" and "mobile" — a **surface**, not an app.
`renderChat(manifest)` is generic: once an app has a manifest, it gets chat
control for free — tasks, stoop, folio, all of them. household goes first
not because it is "the bot app", but because it is the *cheapest* app to
prove the chat projection on (no legacy screen UI).

Two things to keep apart:

* **The chat projection of one app** — `renderChat(appManifest)`. Pure,
  per-app, next to the app. Yields tool catalogue + command menu + inline
  buttons for *that* app.
* **A running bot** — a Telegram token + process, bound to one *circle*
  (see §3g for what a circle is), which *composes* the `renderChat` output
  of all apps enabled for that circle. The bot is therefore **per-circle,
  not per-app**; it aggregates app manifests.

```
   circle "Household Jansen"
   ├── app: lists   ─┐
   ├── app: tasks    ├─ renderChat per app ─┐
   └── app: stoop   ─┘                      ▼
                              bot instance (1 token, 1 circle)
                              = composed command menu +
                                tools + buttons of all three
```

This coincides with the long-term notes: a bot is part of a circle, managed
by the admin → the bot instance is per-circle and admin-managed; "bot has
two sides: a data interface (bound to one circle) + an agent in the network"
→ the bot process = per-circle aggregator on top of the `@canopy/core` Agent
in the mesh; "but then a bot should be able to run on your device too" →
yes: because manifest + projector are dumb about transport and identity
(§6), the same per-circle composition runs either on a small server or on
your phone. A deployment choice, not a representation change.

What this model newly raises (honestly): once one bot serves N apps, their
commands and tools must be merged collision-free — tasks has `claim`, stoop
may also have a `claim`-like. That needs a composition rule at bot level
(prefix per app, or the LLM picks the app from context). The same question
appears on the GUI side once a "unified app" gets a menu with sections per
app. The manifest *does not solve this by itself* — but it makes it one
explicit, testable merge point instead of scattered hand-drift. Work for
after household, not for step 1. (This is a special case of the runtime
composition question in §8 / C2.)

### 3f. Optional on top of a base: pod, chat, network, circles

You have, several times, found the same shape: *must work without it, must
be able to with it* (pods, chat, agent-SDK interop). That is not three
design questions but one: a **mandatory base + independently switchable
extensions**, everything degrading back to the base.

```
            ┌───────────────────────────────────────┐
            │  optional extensions (each on/off)     │
            │   pod · chat · relay · mDNS · multihop  │
            └──────────────────┬────────────────────┘
                               │ degrade to ▼
   ┌────────────────────────────────────────────────┐
   │  BASE (always present, works alone, local,      │
   │  single-user, no chat, no network):             │
   │  identity + local store + merge contracts       │
   └────────────────────────────────────────────────┘
```

Two of the three are **already clean** in the design: pods are already a
ratified project invariant ("local-only is the floor; pod is portability"),
and chat is already an optional manifest projection.

**The agent-SDK is the sharpest observation: it does not always feel like a
core, because part of it is not.** It bundles things that should be
separable, and decomposing it is the concrete realisation of the existing
"smarter SDK composition" TODO — not a new idea:

| Layer | Truly base? |
|-------|-------------|
| identity / keys / vault | yes — even single-user (how a device/pod is identified) |
| local store + merge contracts | yes — Folio needs merge for multi-device sync |
| transports / relay / mDNS / Bluetooth / multi-hop | **no** — this is the "agent in the network" extension |
| skill registry / dispatch | belongs with the *manifest* execution seam, not "the network SDK" |

Folio sits on the bottom without the top. The resolution: split "the
agent-SDK" into *base* (identity + local store + merge) and *extension*
(relay / mDNS / Bluetooth / multi-hop / A2A). Then "every app on the SDK"
holds again — every app uses the base, only apps that need it pull an
extension.

This is what the manifest's `requires` block declares — and it must be
**fine-grained**, not a coarse `network: true`. See §9; the granularity is
gated on this SDK decomposition.

### 3g. Sharing without "groups as boxes" — one concept

Stop thinking "a group contains data/apps". Think:

> Every data item carries an **audience**: the set of people/pods that may
> see it. A "group" is nothing more than a saved, named audience with a
> membership lifecycle.

**Audience, circle, group are the same primitive at increasing
formalisation — not complementary systems:**

```
  audience            circle                 group
  (the set on an  →   (a saved, named   →    (a circle with a
   item; may be        audience)              membership lifecycle:
   ad-hoc/unnamed)                            invite/join/leave)
  ───────────────────────  one continuum  ───────────────────────
```

You never choose "group or audience". You share with people; saving,
naming, and managing that is an optional promotion. In code terms this means
*widening* the existing `crewId` / `group/<crewId>` (pod-routing) and
`visibility` (item-store) *downward* so they also cover lightweight, ad-hoc
audiences (such as Folio's "share with a colleague"). The existing crew is
the persisted form of an audience; the generalisation only adds the
lighter end.

What that resolves:

* **Overlap is no longer a problem.** Two households sharing a balcony =
  items whose audience is the union of both. No "balcony app", no rigid
  hierarchy. Audiences are sets, not folders; overlap is free.
* **Folio joins automatically, without bolted-on group support.** A note's
  audience can include another pod; save that set under a name and you have
  exactly "permissions tied to a group". For a single-user note the audience
  is just `{me}` — zero ceremony.
* **The GUI worry dissolves.** Because the audience is *per item*, the GUI
  only needs a small per-item "shared with: [Balcony]" control — an ordinary
  solved pattern (the Google-Docs share button). No global group toggles, no
  Tinder swiping.
* **No per-item tagging.** A `view` already has a `filter`; add an optional
  `defaultAudience`. Items created in that view inherit it. The common case
  (everything in the Balcony view is balcony-shared) is zero effort; the
  exception (a private note) is the one tap. On chat the conversation/channel
  carries that default automatically — which is why chat feels naturally
  fluid here.

**How a circle is born** (lightweight, no "join a group app"):

* *Handshake*: you create "Balcony", add yourself, send the neighbours an
  invite (link/QR/code, or via the relay). They accept; their pod is now in
  your circle (and, if mutual, yours in theirs). A one-time ~30-second
  handshake, like adding a contact.
* *From an item*: you share one item directly with another webid; the system
  offers "save these recipients as a circle?" → name it. The circle
  *crystallises from a concrete act of sharing* — the fluid path.

**The boundary, honestly:** this stays simple only while audiences are
*small and personal* (household, balcony, garden, the couple inside a
flatshare). A 500-person audience is not a saved recipient list anymore —
that is a published "space"/feed, a different mechanism (the Buurt /
Maatschappij ring of the public site, not the Thuis ring). Do not stretch
the audience model to large/anonymous; there it fails the simplicity test.

**Chat as a surface vs chat as an item type.** Keep these apart. The
Telegram bot is chat *as a projection surface* of the manifest
(`renderChat`). "Start a chat inside the app" (not Telegram) is chat *as
data*: `chat-message` items (already a canonical `@canopy/item-types` type)
scoped to a circle — i.e. just another mounted manifest. The two are
orthogonal: one is *how you reach* the data, the other is *a kind of* data.
The circle handles messaging without a separate concept: an in-app chat is a
circle-scoped `chat-message` stream, and "the right people" are simply that
circle's audience.

**The circle is the ambient scope of the surface.** A start screen is a
circle (or a composition of circles — see below). Everything inherits it:
the default `+` offers the operations of all manifests mounted for that
circle (add a list item, a vraag/aanbod item, start an in-app chat, a
task…), pre-filtered to the circle's people; reads are scoped to it. This is
the read **and** write counterpart of `defaultAudience`-per-context: you act
*in a place*, you do not re-pick the audience.

**A saved view is itself an item — decision, adopted now.** A view of type
`view` carries its own audience, exactly like any other item. So:
*circle-scoped view* = the view's audience is that circle (shared with its
members, projected by `renderWeb`/`renderMobile`); *personal view* =
audience `{me}`; *cross-circle view* = its scope is a **set** of circles.
The recursive application of the one primitive is **committed in this
phase** — cross-circle / multi-circle composition is enabled at the
mechanism level *now*, deliberately, so that *which* default screens emerge
can be decided later from real usage (see §10). This dissolves the
"saved-views: a circle item or not?" dilemma: the view's own audience
answers it, per view.

#### 3g.1 User journeys

**A. A household, nothing special.** Tim enables the hub app with only
"Lists" + "Tasks". No pod, no extra people. The default audience of the
"Groceries" view is "this household"; everything he adds there is
automatically shared with the housemates — he tags nothing. Turn on a pod
later and it becomes portable; his behaviour does not change. → *shows: zero
ceremony, default-per-view, pod optional.*

**B. The balcony (the crux).** Tim sends the neighbours (the Jansens) a
one-time invite link; from then on a circle "Balcony" = his household + the
Jansens exists on his side. He makes a "Balcony" view with default audience
Balcony and puts "water the planter — every other day" on it: immediately
visible to both households, no tag typed. One private note ("balcony tap
leaks, check myself first") he marks as the exception, one tap. On the
Jansens' side they have their own saved circle (possibly named differently);
they see the shared items, not his private note. → *shows: circle via
handshake, exception = one tap, asymmetric saved labels, overlap = plain
set-union.*

**C. Folio with a colleague.** Eva uses Folio solo: notes syncing between
laptop and phone, audience = `{Eva}`, zero ceremony, base only (no network
extension). For one project folder she sets the audience to `{Eva,
colleague-pod}`; the system asks "save this recipient as a circle?" →
"Project X". Folio got no group feature added — only the same audience
field, and "group" here is a saved permission to one other pod. → *shows:
base-only works, group = saved pod-permission, no bolted-on feature.*

**D. A neighbourhood board, deliberately LAN-only (ties §3f/§9).** A
community centre wants a board app that by design does nothing outside the
building: no pod, no Bluetooth, *with* mDNS, no multi-hop. The manifest
contains a `requires` block (`storage: local`, `discovery: [mdns]`,
`transport: [local]`, `routing: { multiHop: false }`, `chat: optional`).
The scaffolder reads it, mounts exactly those substrate modules, and
produces a testable app (board items + three projections + a small test).
The app *cannot* reach beyond the wifi — a declared choice, not a hidden
assumption. Need reach later? Flip `transport: [relay]`; nothing else
rewritten. → *shows: `requires` is the non-interface half, fine-grained per
capability, declared envelope, extend by flipping a flag.*

---

## 4. App-by-app plan (high-level, with reason + which axis applies)

Order chosen on *cost* and *evidential value*.

### Step 1 — `household` (the bot) · greenfield, your short-term task

* **Why first:** only a chat surface — rich (free text + command menu +
  inline buttons, §3d), but no second, hand-written *screen* representation
  (web/mobile) to keep in sync during the refactor. It *is* also your
  short-term wish (lists → tasks, members with a name in the shared pod),
  and the three hand-catalogues (§2) already exist to be replaced.
* **Axis:** base only (no network extension needed); audience model applies
  trivially (a single household = one circle).
* **Proves:** one manifest can feed `renderChat` + `renderSlash` without
  changing bot behaviour. Also the reference implementation for the rest.
* **Scope:** see the deep dive in §5.
* **Risk:** low. Bot is "scaffold + Phase 1", not in production.

### Step 2 — `tasks-v0` (web) · widest verb set = biggest payoff

* **Why here:** tasks has the broadest operation set (add/claim/complete/
  submit/approve/reject/revoke/reassign). The manifest pays off most there.
  `tasks-v0` is already on substrate 0.4.0 — stable enough.
* **Axis:** full verb set; circles already real here (multi-crew); base +
  pod extension.
* **Proves:** two things. (1) the same manifest feeds a real GUI
  (`renderWeb`) next to `renderChat` — the core of question 2. (2)
  `renderChat` is generic: tasks gets bot control for free (§3e) — proof
  that "every app can get a bot" is a projection, not a promise.
* **Scope:** extract the manifest *beside* the existing skills (not
  replacing them); add `renderWeb` reproducing the current menus; turn on
  `renderChat` on tasks as generic-projection proof (no running bot needed —
  the projection output suffices as a test). Web keeps working; we prove
  parity of the *projection*, not a rewrite.
* **Risk:** medium. The existing CLI UI is legacy to mirror, not discard.

### Step 3 — `tasks-mobile` · here the manifest becomes the mechanism

* **Why here:** `tasks-mobile` is a minor version behind and must catch up.
  Instead of porting screens by hand it **consumes step 2's manifest** via
  `renderMobile`. The parity work becomes "render the shared source"
  instead of "rewrite the UI". This is the practical answer to question 2.
* **Axis:** same as step 2; plus the pod-routing depth gate.
* **Hard constraint:** `tasks-mobile`'s plan is **gated** on the pod-routing
  depth freeze (stoop Phase 3.x). Do not force the manifest consumption
  before that freeze; the manifest layer is additive and must not unfreeze
  step 2.
* **Proves:** web ≡ mobile from one source, drift made impossible.

### Step 4 — `folio` / `folio-mobile` · stress-test of the abstraction

* **Why here:** Folio is not a verb-on-list app but a notes-↔-pod-sync app.
  If the manifest model fits there too (different shape: files, versions,
  restore), it is genuinely general. If it does not fit cleanly we learn the
  model's boundary — cheaply, because it is low in the stack.
* **Axis:** base only (identity + local store + merge); no network
  extension; audience model *does* apply (saved pod-permission, journey C).
* **Risk:** low-medium. folio-mobile is minimal anyway.

### Step 5 — `stoop` / `stoop-mobile` · deliberately last

* **Why last:** stoop currently owns the in-flight pod-routing depth. A
  manifest refactor there now = churn on a package other apps have just
  frozen as a dependency. Once stoop Phase 3.x is frozen and the pattern is
  proven on household+tasks, stoop adoption is mechanical.
* **Axis:** full circles + pod-routing depth.
* **Risk:** high if done now; low if you wait. Hence last.

```
  household ──> tasks-v0 ──> tasks-mobile ──> folio ──> stoop
   (bot,         (web,        (mobile, after  (stress-  (after pod-
    cheap)        payoff)      freeze gate)    test)     routing freeze)
```

---

## 5. Deep dive — `household`: from three hand-catalogues to one manifest

### 5.1 How it looks now (real code)

`HouseholdAgent.#routeMessage` does:

```
incoming message
   │
   ▼
regexParse(text)              ←  catalogue #1 (parsers/regexCommands.js)
   │
   ├─ recognised ───────────▶  #dispatchSkill(skillId, args)
   │                                   │
   │                                   ▼
   │                            SKILL_REGISTRY[skillId]   ←  executor #3
   │                            (skills/addItem.js, …)
   │
   └─ null ──▶ ChatAgent.processMessage()
                    │  toolCatalog: V0_TOOL_CATALOG       ←  catalogue #2
                    │  toolHandlers: buildHouseholdToolHandlers()
                    │  systemPrompt: SYSTEM_PROMPT_CLASSIFY
                    ▼
              LLM picks tool ──▶ tool handler ──▶ same skills (#3)
```

Skill shape (real, `skills/addItem.js`), deliberately pure:

```js
export async function addItem(args, ctx) {
  const { type, text } = args ?? {};
  // … validation …
  const item = await ctx.store.addItem({ type, text,
    addedBy: ctx.senderWebid, source: { tg: { chatId: ctx.chatId } } });
  return { replies: [{ text: `✓ added to ${item.type}: ${item.text}` }],
           stateUpdates: [{ kind: 'item.added', itemId: item.id }] };
}
```

`ChatAgent`'s constructor expects (real, `chat-agent/src/ChatAgent.js`):

```js
new ChatAgent({
  toolCatalog:  [{ id, description, schema }],        // ← renderChat must make this
  toolHandlers: { [id]: (args, ctx) => ToolResult },  // ← wrappers around skills #3
  systemPrompt: '…',
  contextBuilder, …
})
```

Three descriptions, one verb. The skill (#3) is fine — it stays. We replace
the *by-hand maintenance* of #1 and #2.

### 5.2 How it looks after step 1

```
       apps/household/manifest.js   (§3a — the only source)
                  │
        ┌─────────┴───────────┐
        ▼                     ▼
   renderSlash()          renderChat()
        │                     │
        ▼                     ▼
   regex grammar         { toolCatalog, toolHandlers, systemPrompt,
   (replaces #1)           commandMenu, inlineKeyboardFor }
        │                     (replaces #2)
        └──────────┬──────────┘
                   ▼
        same SKILL_REGISTRY (#3, unchanged)
                   ▼
        same Store seam  (InMemoryStore → later HybridPodStore)
```

`renderChat` is fully workable because the target format is exactly known —
and it yields not only the free-text channel but also the structured chat
affordances (§3d). Illustrative:

```js
// @canopy/app-manifest — ILLUSTRATIVE
export function renderChat(manifest, { skillRegistry }) {
  // (a) free-text channel — what ChatAgent already expects
  const toolCatalog = manifest.operations.map(op => ({
    id: op.id,
    description: op.surfaces.chat?.hint ?? op.id,
    schema: paramsToJsonSchema(op.params),
  }));
  const toolHandlers = Object.fromEntries(
    manifest.operations.map(op => [op.id,
      (args, ctx) => skillRegistry[op.id](args, toSkillCtx(ctx))]));
  const systemPrompt = buildPrompt(manifest);

  // (b) command menu — what Telegram shows behind "Menu" (setMyCommands)
  const commandMenu = manifest.operations
    .filter(op => op.surfaces.slash)
    .map(op => ({ command: op.surfaces.slash.command,
                  description: op.surfaces.chat?.hint ?? op.id }));

  // (c) inline buttons — per shown item the applicable actions
  const inlineKeyboardFor = (item) => manifest.operations
    .filter(op => matches(op.appliesTo, item)
                && op.surfaces.ui?.control === 'button')
    .map(op => ({ label: op.surfaces.ui.label ?? op.id,
                  callbackData: `${op.id}:${item.id}` }));   // ← the triple

  return { toolCatalog, toolHandlers, systemPrompt,
           commandMenu, inlineKeyboardFor };
}
```

The `callbackData` `"<operationId>:<itemId>"` is the triple in text form.
The existing Telegram bridge already turns an incoming `callback_query` into
a regular `IncomingMessage` running through the same `#dispatchSkill` path
as a typed command. The inline buttons are therefore **projection only** —
no new routing work.

`HouseholdAgent`'s constructor then becomes, instead of three loose imports
from `chatAgentBridge.js`:

```js
const chat = renderChat(householdManifest, { skillRegistry: SKILL_REGISTRY });
this.#chatAgent = new ChatAgent({ ...chat, bridges: [], contextBuilder });
const grammar  = renderSlash(householdManifest);    // replaces regexCommands
```

### 5.3 Your short-term wish, expressed as a manifest delta

"Not only lists but also tasks, and joiners give a name that lands in the
shared pod" =

1. `itemTypes`: add `task` and `contact` (canonical in `@canopy/item-types`,
   exactly what `tasks-v0` already adopted).
2. `operations`: add `claim` / `reassign` with `appliesTo.type: 'task'`, and
   `registerName` (writes a `contact` item to the shared household pod via
   the already-scaffolded `HybridPodStore` routing).
3. `views`: add a `tasks` and a `members` view.

No touches to bot routing, the bridge or the transport. The triple does not
change — only the manifest grows. And once a household screen ever appears,
`renderWeb`/`renderMobile` produce it from the *same* manifest — parity for
free, because there never was a divergent UI.

---

## 6. What not to do — constraints

* **The manifest stays dumb about transport and identity.** It describes
  verbs + types, not "is this a Telegram user, which webid, which pod". The
  *adapter* does that, not the manifest. This is exactly what makes "bot on
  your phone" vs "bot on a small server" a *deployment* choice rather than a
  representation change.
* **`agent-ui` is A2A glue, not a UI renderer.** (Correction to an earlier
  assumption.) `renderWeb`/`renderMobile` do not belong there. They go in a
  new small package; `agent-ui` stays only the *transport* over which a UI
  client invokes skills (`discoverSkills()` is a useful hook for manifest
  discovery).
* **Do not touch `stoop`'s pod-routing while it is in motion.**
  `tasks-mobile`'s parity plan is gated on it. The manifest layer is purely
  additive and must not unfreeze a frozen target. Hence stoop = step 5.
* **Forward-only.** The manifest grows with aliases + defaults; never a
  breaking removal. Fits the project's existing forward-additive convention.
* **Per-surface override is mandatory, not optional.** The model is "shared
  skeleton + overrides", not "universal UI from a schema" (the well-known
  trap: admin-panel look, leaking abstraction). The `surfaces` key *is* the
  hatch — use it.
* **Do not build the scaffolder first.** You only know which parts are truly
  generic after doing the manifest by hand 2–3 times (household, then
  tasks). A premature generator bakes guesses in. See §9.

---

## 7. Concrete first step (if you take this path)

1. Write `apps/household/manifest.js` for the *current* verbs (no scope
   expansion yet) — pure data.
2. Small package `@canopy/app-manifest` with `renderChat` + `renderSlash` +
   `paramsToJsonSchema`, with unit tests proving the output is
   byte-equivalent to the current `V0_TOOL_CATALOG` and the current regex
   grammar. (Proof: no behaviour change.)
3. Put `HouseholdAgent` on the projectors; remove the `chatAgentBridge.js`
   hand-catalogue and the `regexCommands.js` grammar.
4. *Then* apply the manifest delta from §5.3 (tasks + members) — now in one
   place.

Steps 1–3 are risk-free (behaviour identical, proven by tests). Step 4 is
your actual feature, now without drift risk. Then on to tasks-v0.

> Note: `defaultAudience` on a view (§3g) and the `requires` block (§3f/§9)
> are additive fields, **out of scope for step 1**. They are introduced
> later, once the projector pattern is proven, so step 1 does not swell.

---

## 8. Modularity: architecture, runtime, distribution

Three different "modularity" questions are easy to conflate. Keep them
apart:

* **C1 — architecture** (code: substrate + manifest + optional GUI; clean
  seams). That is the proposal.
* **C2 — runtime composition** (one running process/agent hosting multiple
  manifests at once). The per-circle bot of §3e already *is* this; the "hub"
  is its GUI counterpart.
* **C3 — distribution** (how it reaches a phone: Play Store, WeChat-style
  mini-programs, a hub app with installable mini-apps).

### C2 — one host mounts multiple manifests

A *host* (a process on a phone, a small server, or as a bot) holds the
shared base: identity, local store, merge, optionally a pod, optionally
network. "Mounting" a manifest means: the host loads it (data types +
operations + views + audience policy), registers the operations as
executable handlers, and projects the surfaces. Multiple manifests = several
of those sets side by side in one process, **sharing one identity, one local
store and one audience model**.

What it gives you:

* **One identity and one onboarding for the person**, not N per separate
  app.
* **Cross-app fluidity for free.** Because everything is in one process over
  one store with one audience model, an item from "lists" and one from
  "tasks" can share a circle, be shown together, reference each other — no
  glue between apps.
* **Bot and GUI are two hosts of the same composition.** Per-circle bot = a
  host mounting the circle's enabled manifests, projected to chat. The hub =
  a host mounting the person's/circle's enabled manifests, projected to
  screen. Same "mount + project", different surface. The hub is not a new
  idea — it is the screen twin of the bot. On screen the circle is the
  *ambient scope* (§3g): the start screen is a circle or a composition of
  circles (§10), the `+` creates into it, reads are scoped to it — "hub"
  (§8) and "circle-as-place" (§3g) are the same thing.

Genuinely new work for C2: a **manifest registry** + an enable/disable state
per circle (the "which apps are on" / launcher state); a **collision rule**
when two manifests define the same operation (namespace per app-id); and
**runtime mount/unmount** without restarting the host (enable an app → its
operations and views appear; disable → they vanish). That last point *is*
the fluidity you wanted, expressed as runtime mount/unmount rather than
reinstalling store apps.

Where the repo already is: tasks-v0 runs multi-crew (one `core.Agent`
serving N crews via `CrewState`/`bundleResolver`) — structurally the same
shape as "one host serving N manifests" (N crews ≈ N circles). C2 is
generalising an existing pattern, not inventing one.

### C3 — distribution: four options, honest, with the real catches

Because C1 and C2 are clean, C3 is a *late, swappable, plural* choice.

**Option 1 — one app *is* the hub; "apps" are manifests inside it
(super-app / mini-programs).** You publish one mobile app; inside sits the
base + a manifest registry. New functionality arrives as manifest *data*
(+ a declarative UI description), not as a new store install. Real catch:
Play allows shipping new *data/declarative UI*; it disallows downloading and
executing new *code* as a primary feature. So the manifest must stay
declarative data and the executors (skills) ship with the binary or run
agent-side. This is the strongest argument *for* the declarative-manifest
direction: it makes modular distribution permitted. Precedents: WeChat
mini-programs, **Telegram Mini Apps** (directly relevant — already on
Telegram), Home Assistant dashboards.

**Option 2 — hub app + installable mini-apps (plugin model).** Like option 1
with an open extension point: third parties (or you, later) add mini-apps a
user opts into at runtime. "Installing" here = enabling a manifest in the
registry — the same runtime mount/unmount from C2, surfaced as an
"app-store within the app". Same code-vs-data line as option 1. Precedents:
VS Code / Obsidian extensions, Home Assistant, Nextcloud apps, Tasker,
Telegram Mini Apps.

**Option 3 — N separate thin apps on a shared code library (the status
quo).** tasks-mobile / stoop-mobile / folio-mobile stay separate store
entries, each = base library + one manifest. Catch: exactly your complaint —
separate installs, N onboardings, no fluid cross-app, no shared circle
across apps. The manifest shares the *code*, not the *packaging*. The "do
nothing new in distribution" baseline — to consciously move away from.

**Option 4 — no store: web/PWA + agent on device or small server.** The
"hub" is a URL (PWA) and/or a local/remote agent process; Telegram is the
mobile chat entry. Matches the current reality (static site + TG bot) and
the "own small server" long-term note. Trade-off: weaker discoverability,
"feels less like an app", weaker native push — but no gatekeeper, instant
updates, fully fluid, and on-device-vs-server is itself just deployment. A
valid parallel channel, not mutually exclusive with 1/2.

**Recommendation:** commit C1 + C2 now; keep C3 deliberately open and
plural; let the default mental model be **option 1** (hub mounts manifests)
**growing toward option 2** — because it is open source, an open ecosystem
can only exist if "an app" is something a host mounts, not something
installed separately. Option 1 also delivers the fluid cross-app + shared
circle, and is store-permitted *because* it is declarative; the per-circle
bot is just its chat twin.

### What concretely changes (composed, not fused)

The apps are **not source-merged into one codebase**. Each app becomes a
thin, mountable unit — typed data + a manifest + its executors (skills) +
optional GUI — over the shared substrate; a shared host mounts several at
once. Boundaries are *kept*, not dissolved (the collision/namespace rule
exists precisely because apps stay distinct). Concretely:

* **New code:** one small package `@canopy/app-manifest` (the projectors);
  one host/registry that mounts N manifests — which *generalises* the
  existing tasks-v0 multi-crew pattern (`CrewState`/`bundleResolver`), not
  green-field.
* **Per app, additive:** a `manifest.js`. The skills/executors stay where
  they are.
* **Per app, removed:** the hand-maintained surface catalogues (household:
  the `regexCommands.js` grammar + the `V0_TOOL_CATALOG`/`SYSTEM_PROMPT`
  hand-catalogue; later: hand-written CLI / RN menus). Net *less* code.
* **Repo structure need not collapse.** `apps/*` may stay separate packages
  that each export a manifest; even one-binary distribution *imports* the
  per-app manifests + skills rather than fusing source.
* **Recombination gets easier** (a direct payoff): because items use the
  canonical `@canopy/item-types` taxonomy and a mounted host shares one
  store + one audience model, cross-app / cross-circle queries and
  references (`embeds`) are a filter/reference over one typed space, not
  glue between separate app databases. *Structural* recombination is largely
  free; *semantic* fusion still needs a declared operation; the
  decentralised cross-pod variant inherits the in-flight pod-routing gate.
* **App-by-app, not big-bang** (§4), with the byte-equivalence safety net
  for step 1.

What this deliberately does **not** decide: whether it ships as one
installed super-app or as many — that is the C3 choice above (recommended
default: option 1 → 2), kept swappable on purpose. Which recombinations and
which screens become defaults is likewise left to crystallise from use
(§10).

---

## 9. Manifest-driven app scaffolder

This is the *non-interface* half of the manifest. The manifest has two
distinct declarative halves and they must stay apart:

* **Representation half** — operations, views, surfaces. Feeds the interface
  (`renderChat`/`renderWeb`/`renderMobile`). That is §3a/§3b.
* **Capability half (`requires`)** — *not* interface. Says which optional
  substrate modules the host switches on for this app.

The `requires` block must be **fine-grained**, not a coarse `network: true`:

```yaml
requires:
  storage:   local | pod
  discovery: [mdns]            # deliberately not bluetooth
  transport: [relay]           # or [local]
  routing:   { multiHop: false }
  chat:      true | false
```

Given that block, a scaffolder can validate the manifest, wire the declared
substrate modules (configuration, not codegen — the host already has them;
this is the C2 mount mechanism), generate the projections, and produce a
runnable test skeleton (a host with that one manifest mounted + a mock store
+ a mock bridge — the repo already has MockBridge / InMemoryStore patterns +
a small test proving it runs).

The honest boundary — what it can and cannot generate:

* **Can (mechanical):** all wiring, the three surface projections, the test
  skeleton, the capability configuration, and the standard verbs over the
  declared item types (add/list/complete/remove/claim — already generic in
  item-store). For a plain list/task/contacts app — exactly household's
  needs — that means a working testable app with ≈zero custom code.
* **Cannot (intrinsic):** any operation that is more than CRUD-over-items —
  stoop's matching logic, Folio's file-sync diff, a digest composer. That is
  real code. The manifest *declares* the operation and the scaffolder
  *stubs* it; you fill the stub.

Two honest caveats:

* **Granularity is gated on the §3f SDK decomposition.** An à-la-carte
  `requires` is only as fine as the SDK split allows. While "network" is one
  block you cannot pick mDNS without Bluetooth. This is the realisation of
  the existing "smarter SDK" TODO.
* **"Easily carried" = the wiring is easy; the envelope is a real choice.**
  An mDNS-only app by design does not reach beyond the wifi. The scaffolder
  cannot conjure that away — but that is the win: reach becomes a *declared*
  choice instead of a hidden assumption.

This also supports the open-source / others'-apps point: publishing an
external app = publishing a manifest package (+ filled stubs + optional
declarative UI). The scaffolder is then also the onboarding tool for
contributors, and it stays store-permitted for the same reason (manifest =
data, not downloaded code). Build it only *after* the pattern is proven by
hand on household and tasks (§6).

---

## 10. Methodological stance: commit the mechanism, defer the interface

What is committed *now*:

* the **substrate + manifest + projector seam** (§3) — the mechanism;
* the **one-primitive audience model** (§3g), applied **recursively**:
  audiences, circles, groups and saved `view` items are the same thing at
  different formalisation, and **cross-circle / multi-circle composition is
  enabled at the mechanism level in this phase** — a deliberate decision, so
  the option is not foreclosed by an early UI choice;
* **C1 + C2** (§8) — one host mounts N manifests per circle.

What is deliberately **deferred, to crystallise from real usage**:

* the **set of default screens** — in particular whether the start screen is
  a single active circle ("a room you enter"), a composed union across
  several active circles, or a hybrid (a union "home" plus enterable
  per-circle rooms). The mechanism supports all three; which become the
  shipped defaults is an interface question, answered by use, not designed
  up front. (This absorbs what was an open "single vs multiple active
  circles" fork: the *mechanism* is decided here, only the *default screen*
  is left open.)

This is the same crystallisation pattern used throughout this proposal:
circles crystallise from an act of sharing (§3g), saved views crystallise
from repeated asks (§3g), default interfaces crystallise from repeated use.
Commit the seam; let the surface set emerge. It is also why the scaffolder
is built only after the manifest is hand-proven 2–3× (§6, §9) — the same
discipline: prove the mechanism, defer the convenience layer.

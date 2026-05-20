# `renderWeb` / `renderMobile` NavModel — design sketch

> **Status:** draft 2026-05-20.  Pre-feeds `PLAN-gui-chat-uplift.md`
> Slice A (household-web → renderWeb substrate).  Not yet
> implemented; this doc proposes the shape the projector should
> produce and the contracts adapters must honour.  Owner-reviewable
> in parallel with the SP-0…SP-11 substrate work — no production
> code depends on this until Slice A starts.

---

## What NavModel is

A **platform-neutral data structure** describing what an app's
navigation tree looks like + what items each section contains + what
affordances live where.

```text
manifest (per-app)              →  NavModel        (web adapter)
                                       │           ⤷ HTML pages + nav
   renderWeb / renderMobile             │
                                        ⤷ (mobile adapter)
                                          ⤷ React Navigation tabs
```

The killer property: **`renderWeb(m)` and `renderMobile(m)` produce
the same NavModel JSON**, byte-for-byte.  Only the adapter (the thing
that turns NavModel into a real surface) differs per platform.

This is the structural cure for parity drift
([[feedback-platform-parity]]): two surfaces, one source.

---

## Inputs already in the manifest

The existing manifest (`@canopy/app-manifest` SP-0) carries every
data point a NavModel needs:

```text
manifest.app          string       app id ("household", "tasks")
manifest.itemTypes    string[]     known item types
manifest.systemPrompt string       chat-side; ignored by NavModel
manifest.views        View[]       sections to render
manifest.operations   Operation[]  per-op behaviour + surface hints
```

Per existing samples:

```js
// household.manifest.js
views: [
  { id: 'tasks',   title: 'Tasks',   type: 'task',    filter: { open: true } },
  { id: 'members', title: 'Members', type: 'contact' },
],

// tasks-v0.manifest.js
views: [
  { id: 'open',      title: 'Open',      type: 'task', filter: { open: true } },
  { id: 'mine',      title: 'My work',   type: 'task' },
  { id: 'claimable', title: 'Claimable', type: 'task' },
],
```

Per existing operations:

```js
// household.manifest.js — addItem op (creates section affordance)
{ id: 'addItem', verb: 'add', params: [
    { name: 'type', kind: 'enum', of: LIST_TYPES, required: true },
    { name: 'text', kind: 'string', required: true },
  ],
  surfaces: { chat: { hint: '...' }, slash: { command: '/add', ... } },
},

// tasks-v0.manifest.js — claimTask op (state-gated per-item button)
{ id: 'claimTask', verb: 'claim',
  appliesTo: { type: 'task', state: 'open' },
  params:    [{ name: 'id', kind: 'string', required: true }],
  surfaces:  { chat: { hint: 'Claim a task' }, ui: { control: 'button', label: 'Claim' } },
},
```

Everything renderWeb needs is already declared.  No new manifest
fields required for V0; the projector just walks what's there.

---

## Proposed NavModel shape (V0)

```text
NavModel = {
  app:      string,                    // mirror of manifest.app
  sections: Section[],                 // one per manifest.view
  globals:  Affordance[],              // top-level affordances (e.g. global /help)
}

Section = {
  id:           string,                // matches manifest.view.id
  title:        string,                // mirror of view.title
  itemType:     string,                // mirror of view.type
  filter?:      object,                // mirror of view.filter (substrate-agnostic)
  affordances:  Affordance[],          // per-section actions (e.g. add form)
  itemActions:  ItemAction[],          // per-item buttons (state-gated)
  detailViewRef?: string,              // optional — section.id of detail view
}

Affordance = {
  opId:         string,                // matches manifest.operation.id
  label:        string,                // human-readable (from surfaces.ui.label or op.verb)
  paramsSchema: object,                // JSON Schema (from paramsToJsonSchema)
  placement:    'section' | 'global',  // where this affordance lives
}

ItemAction = {
  opId:         string,                // matches manifest.operation.id
  label:        string,                // human-readable
  appliesTo:    { type?: string | string[], state?: string | string[] },  // gate
  callbackData: (item) => string,      // "appId.opId:itemId" pattern from manifest-host
}
```

**Pure data — no functions in NavModel except `callbackData` which is
a closure-free template** (e.g. `appId.opId:${itemId}`).  Adapters
serialise the template, never call it.

---

## Worked example — household V0

```js
const navModel = renderWeb(householdManifest);
// →
{
  app: 'household',
  sections: [
    {
      id: 'tasks', title: 'Tasks', itemType: 'task',
      filter: { open: true },
      affordances: [
        { opId: 'addTask', label: 'Add a task', paramsSchema: {...}, placement: 'section' },
      ],
      itemActions: [
        { opId: 'claim',    label: 'Claim',    appliesTo: { type: 'task', state: 'open' }, ... },
        { opId: 'reassign', label: 'Reassign', appliesTo: { type: 'task' }, ... },
      ],
    },
    {
      id: 'members', title: 'Members', itemType: 'contact',
      affordances: [
        { opId: 'registerName', label: 'Register a name', paramsSchema: {...}, placement: 'section' },
      ],
      itemActions: [],   // no item-level actions on contacts in V0
    },
  ],
  globals: [
    { opId: 'help', label: 'Help', paramsSchema: {...}, placement: 'global' },
  ],
}
```

This drives:
- **Web adapter:** two HTML pages (`tasks.html`, `members.html`) with
  a top nav, an add-form per section, per-row buttons gated by state.
- **Mobile adapter:** two tabs, an FAB per tab, per-row buttons in
  React Native — same NavModel, different rendering.

---

## Worked example — tasks-v0 (Slice B target)

```js
const navModel = renderWeb(tasksManifest);
// →
{
  app: 'tasks',
  sections: [
    { id: 'open',      title: 'Open',      itemType: 'task', filter: { open: true }, affordances: [...], itemActions: [...] },
    { id: 'mine',      title: 'My work',   itemType: 'task', affordances: [...],     itemActions: [...] },
    { id: 'claimable', title: 'Claimable', itemType: 'task', affordances: [...],     itemActions: [...] },
  ],
  globals: [],
}
```

Each section's `itemActions` includes the state-gated DoD lifecycle
ops (`claimTask`, `submitTask`, `approveTask`, `rejectTask`,
`revokeTask`, `completeTask`).  The adapter walks `itemActions[]` per
item and filters by `appliesTo` against the item's current state —
same logic the existing UI-helpers (`taskStatus.js`,
`composeArgs.js`) implement today.

---

## Adapter responsibilities (per surface)

### Web adapter

- Walks `sections[]`; produces one route/HTML-page per section.
- Top-level nav menu from `sections[].title`.
- Per-section: hydrates `affordances[]` as forms / buttons; fetches
  items via the live skill `listOpen({...filter, type: itemType})`;
  walks `itemActions[]` per item gated by current state.
- `callbackData` template → button onClick handler that invokes the
  matching skill via the local UI's existing `callSkill()`.
- **What lives in the adapter, not in NavModel:** CSS, page chrome,
  loading skeletons, form validation UI, accessibility plumbing.

### Mobile adapter

- Walks `sections[]`; produces one React Navigation screen per
  section.
- Tab bar from `sections[].title`.
- Per-section: same affordances/items/actions logic as web, but
  rendered as `<Pressable>` + `<TouchableOpacity>` etc.
- `callbackData` template → button `onPress` handler that invokes
  the matching skill via the mobile-shell's existing dispatcher.

### Adapter parity rule

```text
∀ manifest m. structuralEqual(
  renderWeb(m).asNavModelJson,
  renderMobile(m).asNavModelJson,
)
```

Test as a cross-surface equivalence assertion (per
`PLAN-gui-chat-uplift.md` Slice C's acceptance gate).

---

## Edge cases the V0 projector handles

- **Operation with no `surfaces.ui`** — omit from `itemActions`
  (LLM-only ops don't surface as buttons).  Already the existing
  renderChat convention.
- **Operation with `surfaces.ui.placement: 'global'`** — surfaces in
  `globals[]` instead of any section.
- **View without matching `addX` op** — section has empty
  `affordances[]`.  Adapter renders just the list with no add-form.
- **Multi-state `appliesTo.state: [...]` (F-SP3-a)** — passes through
  verbatim into `itemActions[].appliesTo.state`; adapter does the
  matching.  Already proven in `renderChat`'s inlineKeyboardFor.

---

## What V0 NavModel does NOT do (deferred to V1+)

- **No detail-page model.**  Tapping an item could navigate to a
  detail view; V0 emits buttons-on-the-row only.  Detail-view
  declarations would join `manifest.views` with a `detail: true`
  flag — V1 work.
- **No audience-affordance fields.**  `view.audience` exists in the
  schema (SP-5 V0 added it) but the V0 NavModel ignores it.  F-SP5-a
  adds per-section "shared with" chip + per-item "shared with"
  control once SP-5b lands.
- **No interface-registry composition.**  Per-item rendering today =
  one row of {text, buttons}.  Once `@canopy/interface-registry`
  matures, NavModel will reference its `renderCompact` /
  `renderFull` — V1 work, P6 destination.
- **No protocol-driven multi-step affordances.**  Operations that
  belong to a `@canopy/protocol` declaration (e.g. invite ↔ accept ↔
  join) surface as ordinary buttons in V0; the protocol runner is
  the chat agent / orchestrator's responsibility.  P6 destination.
- **No sub-section grouping.**  Sections are flat in V0.  Could
  group by item type or by view-tag in V1.

---

## Forward-additive contract

NavModel's keys are **add-only**.  Future renderers may produce
additional fields; adapters must ignore unknown keys.  No breaking
removals — once a key is in NavModel, it stays.  Same forward-
additive discipline as everything else in `@canopy/app-manifest`.

---

## Owner decisions (locked 2026-05-20)

| # | Question                             | Locked answer                                                                                  |
| - | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 1 | Detail-view in V0?                   | **Defer to V1.**  User tests after substrate ships will inform.  V0 NavModel = buttons-on-row. |
| 2 | Section ordering                     | **Preserve `manifest.views[]` declaration order.**  Matches renderChat discipline; predictable for users. |
| 3 | Globals source                       | **Infer from `op.surfaces.ui.placement === 'global'`.**  No new manifest schema.  Forward-additive. |
| 4 | Adapter equivalence depth            | **Strict JSON equality default.**  Owner-approved exceptions only — note inline in `renderWeb.js`/`renderMobile.js` when added. |
| 5 | Item ordering inside sections        | **`view.sort = {by, direction}` passed through to `section.sort`.**  Adapter performs the sort.  User-reordering (interactive) deferred to V1+ (needs item-store ordinal field). |

Refinement surfaced in A.2 implementation (2026-05-20):

| #' | Refinement                          | Locked answer                                                                                  |
| -- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| 6  | Multi-type ops (e.g. household's `addItem(type, text)`) | **Type-enum param fallback.**  When an op has a `params: [{name:'type', kind:'enum', of:[...]}]` AND `view.type` is in that enum AND the op has no explicit `appliesTo`, the projector surfaces the op in that section.  An optional `prefilledParams: {type: view.type}` is added so the adapter knows to pre-fill the type param when calling the skill.  Keeps household's "one addItem op covers shopping/errand/repair/schedule" model intact AND exposes the four sections cleanly on web. |

Original raw answers (kept for trace):

## Original open questions (raw owner answers)

1. **Detail-view: V0 or V1?**  Some pages today (e.g. tasks-v0's
   task-detail navigation) already do per-item drilldowns.  Should
   NavModel V0 carry detail-view declarations (`section.detail`)
   or defer?
	> maybe either. Im going to do full user tests after completing everything anyway
2. **Section ordering.**  Manifest's `views[]` order today; should
   NavModel preserve that or sort alphabetically / by activity?
   (Existing chat output preserves declaration order — same
   discipline here?)
> does it bare consequences for the final GUI? In that case: sort as logical for a GUI. If it doesnt matter, then maybe activity first (sorted alphabetically) - and if there are sub-parts: also alphabetic. If you think it is useful: add an index to the code comments
3. **Global affordances source.**  `globals[]` proposed above —
   should the projector infer (ops without `appliesTo` AND with
   `surfaces.ui.placement === 'global'`) or should the manifest
   declare a `navigation: { global: [opId, ...] }` block?
> I have no idea. Whatever you think is best.
4. **Adapter equivalence test depth.**  Strict NavModel JSON equality
   between renderWeb/renderMobile, or relaxed (compare structural
   fields, allow adapter-specific metadata to differ)?
> would be nice to have equality as a goal, but exceptions can be made on request of the owner (me). Please write a note accordingly (in the comments?)
5. **Item ordering / sorting inside sections.**  Manifest `view`
   could declare a `sort: { by: 'createdAt', direction: 'desc' }`
   block.  V0 hardcodes "newest first" or lets adapter decide?
> sounds like different ways of sorting? multiple must be supported, so hardcoding is not a good idea. In some cases it makes sense to let the user reorder.
---

## Implementation order (Slice A internal)

When Slice A starts, suggested sub-slices:

1. **A.1** — `renderWeb` skeleton + NavModel JSDoc typedefs (no
   substrate consumer yet).  Pure-data; trivial unit tests with
   inline manifests.
2. **A.2** — household manifest → NavModel test: snapshot the
   produced NavModel + assert structural invariants.
3. **A.3** — `apps/household/web/` adapter: consumes the NavModel,
   renders HTML, wires per-item buttons to skill calls via
   `mountLocalUi`.  No characterization needed (greenfield).
4. **A.4** — basic interaction smoke (add a shopping item → it
   appears; mark complete → it moves).
5. **A.5** — DoD: household web browsable; NavModel JSON snapshot
   stable; document A.1's design as the locked contract for
   Slices B + C.

Estimated 1–2 weeks total (the substrate-design risk in A.1+A.2
dominates, NOT the implementation).

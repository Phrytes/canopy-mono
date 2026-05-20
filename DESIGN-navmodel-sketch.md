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
| 7  | **`view.dataSource`** — declared data-fetch skill per section (V0.2, 2026-05-21) | **`view.dataSource: {skillId, args?}`** declares which skill the adapter calls to populate the section.  Forward-additive; if absent, adapter defaults to `listOpen({type, ...filter})` (Q6 rule b).  Surfaced as `section.dataSource` in NavModel.  Closes the **convergent gap** B.2 + E.1 + B.1 agents independently flagged: household + stoop + tasks-v0 web adapters were each hard-coding "this section calls listMine / listMyRequests / getDagTree".  `@canopy/web-adapter`'s new `fetchSectionItems(section, {callSkill})` helper honours this. |
| 8  | **`appliesTo.type: '*'` wildcard** — multi-type lifecycle ops (V0.2, 2026-05-21) | **`appliesTo: { type: '*' }`** is permitted by the validator + matched by every section in renderWeb.  Surfaced by stoop's `cancelRequest` (spans ask/offer/lend) and similar multi-type lifecycle ops.  Q6/F-SP3-a's `type: [array]` is still valid for explicit lists; the wildcard is the sigil for "any of manifest.itemTypes".  ItemAction preserves `'*'` literal in NavModel (no narrowing to view.type) so adapters can detect + render appropriately. |
| 9  | **`view.readOnly: true` marker** (V0.2, 2026-05-21) | **`view.readOnly: true`** → `section.readOnly: true` and creative-verb affordances (Q10) are skipped.  Surfaced by A.3 agent: household's `members` section needed no Add affordance because `registerName` belongs to a different op-shape.  ItemActions still render (state-gated per-item buttons may apply on read-only views — e.g. delete on an audit log).  Forward-additive; absent → existing behaviour. |
| 10 | **Creative verbs auto-surface** (V0.2, 2026-05-21) | **`CREATIVE_VERBS = {add, register}`** generalises Q6 rule (a)'s `verb === 'add'` auto-surface.  Surfaced by A.3: household's `registerName` (verb=`register`, non-canonical via F-SP1-e) had no `surfaces.ui` so was omitted; now auto-surfaces in the `members` section.  Keep the set tight — each addition implicitly expands auto-surface behaviour.  Skipped under Q9 read-only. |
| 15 | **`view.dataSource.argsFromContext`** — runtime context substitution (V0.3, 2026-05-21) | **`dataSource.argsFromContext: {lang: '$lang', ...}`** — adapter recognises `$<key>` strings and substitutes from caller-supplied `context` at call time.  Surfaced by E.2 + E.3: stoop's privacy.html needs runtime `lang` (browser-derived); V0.2's static `dataSource.args` forced consumers to bypass the manifest.  Forward-additive; absent means existing static-args behaviour. |
| 16-strict | **`validateManifest(..., {strict: true})`** — skillId cross-check (V0.3, 2026-05-21) | **Opt-in `{strict: true}`** walks every `view.dataSource.skillId` and (V0.4) `view.fields[].patch.opId`, requiring each to either be declared in `manifest.operations[].id` OR appear in the new **`manifest.externalSkills?: string[]`** allow-list.  Default (no opt) keeps existing tolerant behaviour — adopters opt-in app-by-app as their manifests stabilise. |
| 17 | **`view.shape: 'record'`** — singleton record sections (V0.3, 2026-05-21) | **`view.shape: 'record' \| 'list'`** (default `'list'`) — adapter switches rendering: `'list'` iterates items[]; `'record'` renders the single returned record with its fields.  Surfaced by E.3: stoop's `settings.html` is a singleton (`getSettings` returns `{settings: {...}}`), not a list; V0.2 workaround was treating it as a 1-element list. |
| 18 | **`view.fields[].patch`** — per-field mutation declarations (V0.4, 2026-05-21) | **`view.fields: [{name, type, label?, choices?, patch?: {opId, argName, argWrapper?}}]`** — only meaningful when `view.shape === 'record'`.  Adapter renders each field as an input based on `type`; on change, dispatches `opId({[argName]: newValue})` (or Q21-wrapped).  Surfaced by E.3 as the natural sequel to Q17.  Forward-additive — absent means existing record rendering (no editable fields). |
| 19 | **`surfaces.ui.placement: 'section-header'`** — section-scope CTAs (V0.4, 2026-05-21) | **`placement: 'section-header'`** surfaces the op in `section.sectionActions[]`, parallel to `affordances[]` and `itemActions[]`.  Same Affordance shape; the placement difference is purely semantic — header CTAs sit adjacent to the section title (e.g. inbox's "Clear all").  Surfaced by B.2.3b deferral: not creative (no item added), not per-item.  Forward-additive. |
| 21 | **`patch.argWrapper`** — wrapped-patch dispatch shape (V0.5, 2026-05-22) | **`view.fields[].patch.argWrapper?: string`** — Q18's flat `{opId, argName}` model assumes `opId({[argName]: newValue})`, but many real APIs use nested patch shapes (e.g. stoop's `updateSettings({patch: {pollIntervalMs: 30000}})`).  When `argWrapper` is a non-empty string, the adapter dispatches `opId({[argWrapper]: {[argName]: newValue}})`; absent/empty keeps the V0.4 flat behaviour.  Surfaced by the V0.4-adopt for stoop's settings (commit 9e7003b) where the page-level adapter had to wrap ad-hoc.  Forward-additive; validator requires non-empty string when present. |
| 22 | **`labelKey`** — i18n passthrough (V0.6, 2026-05-20) | **`op.surfaces.ui.labelKey?: string`** and **`view.fields[].labelKey?: string`** — opt-in i18n keys.  When non-empty, the projector passes them through alongside `label`.  Consumers with a `t()` function resolve via the key; consumers without one fall back to `label`.  Pure consumer-side resolution — no adapter wiring.  Surfaced by C.3 close-out: tasks-mobile RN screens use `t(key, fallback)` already; stoop is Dutch-first.  Forward-additive; validator requires non-empty string when present. |
| 23 | **`field.type: 'file' \| 'image'`** — byte-shaped fields (V0.6, 2026-05-20) | **Q18 `field.type` enum extension.**  Adds `'file'` (generic binary) and `'image'` (preview-able / resize-able) to the recognized set alongside the existing `'string' \| 'number' \| 'boolean' \| 'enum' \| 'object'`.  Dispatch contract documented in `renderWeb.js`: web hands a DOM `File` to the patch dispatcher, RN hands the picker's `{uri, name, type, size}` object; consumer owns client-side transform (resize, format conversion) before calling the skill.  Substrate stays renderer-agnostic.  Surfaced by E.4 (stoop profile's avatar upload).  Validator stays lax — unknown types still pass through. |
| 24 | **`useAdapterAction()`** — RN dispatch hook (V0.6, 2026-05-20) | **Mobile-side companion** to `renderItemActions` / `renderSectionActions`: substrate resolves WHICH op + WHICH args; this hook does the dispatch without the screen wiring a per-op `useSkill(opId)`.  One stable async dispatcher; Rules-of-Hooks compliant; works for any opId the substrate surfaces — including ones added later, without code changes on the screen.  Same `_scope` (activeCrewId) enrichment as `useSkill`.  Surfaced by C.3 + C.4 (each screen accumulating N `useSkill('id')` lines, one per manifest op).  Lives in tasks-mobile pending a second-RN-app lift to `@canopy/manifest-adapter-rn`. |
| 25 | **`field.readSkill`** — multi-skill records (V0.7, 2026-05-20) | **`view.fields[].readSkill?: { skillId, args? }`** — same shape as `view.dataSource`.  When present, the adapter calls this skill to resolve the field's value instead of reading it from the record's `dataSource` payload.  Surfaced by E.4: stoop's `holidayMode` is reachable both via `getMyProfile` (bulk) AND a dedicated `getHolidayMode` skill; without Q25 the substrate forced bulk re-fetch when single-field refresh was wanted.  Validator: non-empty skillId + optional args object; Q16-strict cross-checks skillId.  Forward-additive. |
| 26 | **`field.requiresField`** — conditional-display gate (V0.7, 2026-05-20) | **`view.fields[].requiresField?: { <otherField>: value \| value[] }`** — same shape as `appliesTo.state`.  Adapter hides the field when the record's current value for any named gate key doesn't match.  Multiple keys AND-combined; array-value within a key OR-combined.  Surfaced by B.2.4: pod-settings `groupPodUri` only meaningful when `policy ∈ {centralised, hybrid}`.  V0.5 Q21 covered the dispatch shape but not the visibility gate.  Forward-additive — absent means "always show". |

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

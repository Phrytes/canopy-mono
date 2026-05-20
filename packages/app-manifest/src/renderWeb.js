/**
 * Render the web-surface projection of a manifest: a `NavModel`.
 *
 * NavModel is **platform-neutral** — the same data structure feeds
 * `renderMobile` (Slice C of `PLAN-gui-chat-uplift.md`).  The killer
 * cross-surface property:
 *
 *   ∀ manifest m.  renderWeb(m) ≡ renderMobile(m)  (as JSON)
 *
 * Equivalence is **strict by default** (owner direction 2026-05-20).
 * Per-field exceptions are allowed only on explicit owner approval,
 * with an inline comment explaining the deviation.  When an exception
 * is added, also update `DESIGN-navmodel-sketch.md` § "Adapter
 * equivalence test depth".
 *
 * Deterministic: outputs follow manifest declaration order
 * (sections from `manifest.views`, affordances/itemActions from
 * `manifest.operations`).  See "Owner decisions" below.
 *
 * ──── Owner decisions (locked 2026-05-20) ─────────────────────────
 *   Q1. Detail-view: V0 = buttons-on-row only.  No `section.detail`
 *       field yet.  V1 may add when user tests show drilldowns are
 *       needed.
 *   Q2. Section ordering: preserve `manifest.views[]` declaration
 *       order.  Activity-based sort would shift sections around at
 *       runtime, which is jarring for users.  Matches `renderChat`
 *       discipline (also declaration-order).
 *   Q3. Globals source: inferred from
 *       `op.surfaces.ui.placement === 'global'`.  No new
 *       `manifest.navigation` block needed; forward-additive.
 *   Q4. Equivalence: strict JSON equality renderWeb≡renderMobile;
 *       owner-approved exceptions only.
 *   Q5. Item sort: `view.sort = {by, direction}` passed through to
 *       `section.sort`.  Forward-additive.  Adapter performs the
 *       sort.  User-reordering (interactive) deferred to V1+ (needs
 *       item-store ordinal field).
 * ─────────────────────────────────────────────────────────────────
 *
 * SP-0 Phase boundary (PLAN guardrail #9): this package DECLARES.
 * `@canopy/interface-registry` runs per-type item rendering — once
 * mature, NavModel will reference `renderCompact` / `renderFull` for
 * per-item cells instead of returning `{text, buttons}`.  V0 stays
 * with the minimal {text, buttons} contract; adapters render the row.
 *
 * @typedef {object} NavModel
 * @property {string}   app                manifest.app verbatim
 * @property {Section[]} sections          one per manifest.view (declaration order)
 * @property {Affordance[]} globals        top-level affordances (e.g. global Help)
 *
 * @typedef {object} Section
 * @property {string}   id                 mirrors view.id
 * @property {string}   title              mirrors view.title
 * @property {string}   itemType           mirrors view.type
 * @property {object}   [filter]           mirrors view.filter
 * @property {{by: string, direction?: 'asc'|'desc'}} [sort]
 *                                         mirrors view.sort (Q5)
 * @property {*}        [audience]         mirrors view.audience (SP-5b consumer)
 * @property {{skillId: string, args?: object}} [dataSource]
 *                                         mirrors view.dataSource (V0.2 Q7).
 *                                         When present, adapters call this
 *                                         skill (with merged args) instead
 *                                         of the default `listOpen({type})`
 *                                         heuristic.  Resolves the
 *                                         convergent gap flagged by B.2 +
 *                                         E.1 + B.1 agents (sections
 *                                         needing custom data fetchers
 *                                         like `listMine`, `listMyRequests`,
 *                                         `getDagTree`).
 * @property {Affordance[]} affordances    per-section actions (e.g. add-form)
 * @property {ItemAction[]} itemActions    per-item state-gated buttons
 *
 * @typedef {object} Affordance
 * @property {string}   opId               matches manifest.operation.id
 * @property {string}   label              from surfaces.ui.label or op.verb
 * @property {object}   paramsSchema       from paramsToJsonSchema(op.params)
 * @property {'section'|'global'} placement
 * @property {object}   [prefilledParams]  Q6 (locked 2026-05-20) — when an
 *                                         op surfaces in a section via the
 *                                         type-enum fallback (params:
 *                                         [{name:'type', kind:'enum',
 *                                         of:[…]}]), the section's itemType
 *                                         is recorded here so the adapter
 *                                         pre-fills the `type` param when
 *                                         calling the skill.
 *
 * @typedef {object} ItemAction
 * @property {string}   opId               matches manifest.operation.id
 * @property {string}   label              from surfaces.ui.label or op.verb
 * @property {{type?: string|string[]|'*', state?: string|string[]}} appliesTo
 *                                         passed through (F-SP3-a multi-state
 *                                         honoured).  V0.2 — `type` may be
 *                                         `'*'` (wildcard, Q8): matches every
 *                                         section regardless of itemType.
 *                                         Surfaced by stoop's `cancelRequest`
 *                                         spanning ask/offer/lend.
 * @property {object}   [prefilledParams]  same semantics as Affordance.prefilledParams
 *
 * Note on `callbackData`: the design sketch proposed a per-action
 * `callbackData` template (`"${opId}:${itemId}"`).  V0 stores just
 * `opId` here; the adapter constructs the dispatch key at render
 * time (`${opId}:${item.id}` for single-app, prefixed by manifest-
 * host when ≥2 apps composed).  Keeps NavModel pure-data.
 *
 * ──── Q6 — multi-type ops via type-enum fallback (locked 2026-05-20)
 *
 * Surfaced in A.2 by household's `addItem(type: shopping|errand|repair|
 * schedule, text)` — one chat-side tool, four web sections.  Three
 * surfacing rules:
 *
 *   (a) **`verb === 'add'` auto-surface.**  Add ops surface as section
 *       affordances without needing `surfaces.ui` to be declared.
 *       Rationale: every web section needs an "add new item"
 *       affordance; the manifest shouldn't have to repeat
 *       `surfaces.ui` for each.
 *   (b) **`verb === 'list'` skip.**  List ops are the section's
 *       implicit data source — adapter calls
 *       `listOpen({type: section.itemType, ...filter})` to fetch
 *       items.  Not a button.
 *   (c) **Other verbs require `surfaces.ui`** to surface as
 *       itemActions (state-gated per-item buttons).  Same as V0.
 *
 * ──── Q7 — `view.dataSource` explicit declaration (locked 2026-05-21)
 *
 * Surfaced by the CONVERGENT signal from B.2 (tasks-v0 mine.html) +
 * E.1 (stoop mine.html) + B.1 (tasks-v0 dag.html).  Q6 rule (b) says
 * "list ops are the section's implicit data source — adapter calls
 * `listOpen({type, ...filter})`".  But many real sections need a
 * DIFFERENT list skill: `listMine`, `listMyMasteredTasks`,
 * `listClaimable`, `listMyRequests`, `getDagTree`.  Hard-coded in
 * adapters today; convergent signal = real substrate gap.
 *
 * Solution: `view.dataSource: {skillId, args?}` declares the skill
 * the adapter should call to populate the section, with optional
 * pre-filled args.  Forward-additive: absent → existing behaviour
 * (adapter calls `listOpen({type, ...filter})`).
 *
 * ──── Q9 — `view.readOnly: true` marker (locked 2026-05-21)
 *
 * Surfaced by A.3 agent's signal: household's `members` section is
 * empty by substrate default (no listOpen for contact) and has no
 * `registerName` affordance because `registerName` has no
 * `surfaces.ui`.  Adapter renders an empty "Add"-less section.
 *
 * Solution: `view.readOnly: true` → section gets `readOnly: true` +
 * affordances are skipped (creative verbs don't auto-surface in
 * read-only sections).  itemActions still render (state-gated per-
 * item buttons may still apply on read-only views — e.g. a "delete"
 * button on a read-only audit log).  Adapter can also use the
 * `section.readOnly` flag for visual cues.
 *
 * ──── Q10 — Creative verbs auto-surface (locked 2026-05-21)
 *
 * Q6 rule (a) said `verb === 'add'` auto-surfaces.  Generalised: any
 * verb in the `CREATIVE_VERBS` set (`{add, register}`) auto-surfaces.
 * Surfaced by A.3 agent: household's `registerName` op (verb=
 * 'register', non-canonical via F-SP1-e) creates contact items but
 * has no `surfaces.ui` — under Q6 rule (a) it was omitted from
 * NavModel.  Now it auto-surfaces in the `members` section.
 *
 * Forward-additive: future creative verbs can be added to the
 * CREATIVE_VERBS set.  Keep the set tight — each addition expands
 * the auto-surface behaviour implicitly.
 *
 * ──── Q8 — `appliesTo.type: '*'` wildcard (locked 2026-05-21)
 *
 * Surfaced by E.1: stoop's `cancelRequest` spans all 3 prikbord
 * types (ask/offer/lend); `markReturned` only matches `lend` but
 * conceptually belongs on every per-row button.  Q6 + F-SP3-a's
 * multi-type array helps but is manual per-op.
 *
 * Solution: `appliesTo: { type: '*' }` is permitted (validator).
 * Wildcard ops match EVERY view's section.  NavModel preserves the
 * `'*'` literal so adapters can decide rendering.
 *
 * Forward-additive: validator special-cases `'*'`; renderWeb's
 * `matchOp` returns matched=true for wildcard regardless of view.type.
 * ─────────────────────────────────────────────────────────────────
 */

import { paramsToJsonSchema } from './paramsToJsonSchema.js';

/**
 * Q10 (2026-05-21) — verbs that auto-surface as section affordances
 * without requiring `surfaces.ui` (Q6 rule (a) generalised).
 *
 *   'add'      — the canonical creative verb.
 *   'register' — household's `registerName` (non-canonical via F-SP1-e);
 *                still creates a contact item, so it belongs on the
 *                section's affordance row.
 *
 * Forward-additive: extend the set when new "creative" verbs appear in
 * real manifests.  Keep the list small — every entry expands the
 * adapter's affordance-rendering surface implicitly.
 */
const CREATIVE_VERBS = new Set(['add', 'register']);

/**
 * @param {object} manifest
 * @returns {NavModel}
 */
export function renderWeb(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('renderWeb: manifest required');
  }

  const ops   = Array.isArray(manifest.operations) ? manifest.operations : [];
  const views = Array.isArray(manifest.views)      ? manifest.views      : [];

  // (a) Globals — ops with surfaces.ui.placement === 'global'.  These
  //     surface at the app-shell level, NOT under any section.
  //     Inferred from existing surfaces.ui (Q3, no schema change).
  const globals = [];
  for (const op of ops) {
    const ui = op?.surfaces?.ui;
    if (!ui) continue;
    if (ui.placement !== 'global') continue;
    globals.push(buildAffordance(op, manifest, 'global'));
  }

  // (b) Sections — one per view; preserve declaration order (Q2).
  const sections = views.map((view) => buildSection(view, ops, manifest));

  return {
    app: typeof manifest.app === 'string' ? manifest.app : '',
    sections,
    globals,
  };
}

/* ─── internals ──────────────────────────────────────────────────── */

function buildSection(view, ops, manifest) {
  const section = {
    id:       view.id,
    title:    view.title,
    itemType: view.type,
    affordances: [],
    itemActions: [],
  };

  // Optional fields — only set when present (keep NavModel JSON minimal).
  if (view.filter     !== undefined) section.filter     = view.filter;
  if (view.sort       !== undefined) section.sort       = view.sort;
  if (view.audience   !== undefined) section.audience   = view.audience;
  // Q7 (2026-05-21) — explicit data-source declaration; adapters use
  // this in preference to the default `listOpen({type, ...filter})`
  // heuristic.  Validate-loose: shape correctness is the adapter's
  // concern (forward-additive — V0.3 may tighten via JSDoc).
  if (view.dataSource !== undefined) section.dataSource = view.dataSource;
  // Q9 (2026-05-21) — read-only marker.  Adapter skips Add forms /
  // creative affordances; itemActions still render (state-gated
  // buttons may still apply).  Section receives `readOnly: true`
  // verbatim so adapter can also disable per-row interactivity if
  // needed (e.g. dim the row).
  if (view.readOnly === true)       section.readOnly   = true;

  for (const op of ops) {
    const ui = op?.surfaces?.ui;
    if (ui?.placement === 'global') continue;  // already pushed to globals

    const m = matchOp(op, view);
    if (!m.matched) continue;

    if (op.verb === 'list') continue;  // implicit data source — adapter fetches items

    if (CREATIVE_VERBS.has(op.verb)) {
      // Q9: skip add/register affordances when the section is read-only.
      if (view.readOnly === true) continue;
      // (Q6 rule a) — creative verbs (Q10: add | register) auto-surface
      // as section affordances without needing `surfaces.ui`.  Every
      // web section needs an "add new item" path; the manifest
      // shouldn't have to repeat `surfaces.ui` for each.
      section.affordances.push(
        buildAffordance(op, manifest, 'section', m.viaTypeEnum ? { type: view.type } : null),
      );
    } else if (ui) {
      // (Q6 rule c) — other verbs require surfaces.ui to surface as itemActions.
      section.itemActions.push(
        buildItemAction(op, view, m.viaTypeEnum ? { type: view.type } : null),
      );
    }
  }

  return section;
}

/**
 * Does an op apply to this view's item-type?  Returns `{matched, viaTypeEnum}`.
 *
 *   - **Explicit `appliesTo.type` wins** (string OR array, F-SP3-a).
 *   - **Type-enum fallback (Q6, locked 2026-05-20):** op without
 *     `appliesTo` but with a `params: [{name:'type', kind:'enum',
 *     of:[…]}]` whose enum includes `view.type` matches that view.
 *     The section's itemType is recorded in `prefilledParams.type`
 *     downstream so the adapter pre-fills it.  Surfaced by
 *     household's `addItem(type, text)` — one chat-side tool, four
 *     web sections.
 *   - Op with neither signal does NOT match.
 */
function matchOp(op, view) {
  if (op.appliesTo?.type !== undefined) {
    // Q8 (2026-05-21) — wildcard: '*' matches every section.  No
    // prefilledParams; op is type-agnostic (operates on the item's
    // id, not its type).
    if (op.appliesTo.type === '*') {
      return { matched: true, viaTypeEnum: false, viaWildcard: true };
    }
    const types = Array.isArray(op.appliesTo.type) ? op.appliesTo.type : [op.appliesTo.type];
    return { matched: types.includes(view.type), viaTypeEnum: false };
  }
  const enumTypes = findTypeEnumParam(op);
  if (enumTypes !== null && enumTypes.includes(view.type)) {
    return { matched: true, viaTypeEnum: true };
  }
  return { matched: false, viaTypeEnum: false };
}

/**
 * Returns the enum-of values for an op's `type` enum param, or null
 * if the op doesn't have one.  Only handles the inline-array form
 * (`of: ['shopping', …]`); the string form (`of: 'itemTypes'`) is
 * out of V0 scope (needs manifest-level resolution).
 */
function findTypeEnumParam(op) {
  for (const p of op.params ?? []) {
    if (p.name === 'type' && p.kind === 'enum' && Array.isArray(p.of)) {
      return p.of;
    }
  }
  return null;
}

function buildAffordance(op, manifest, placement, prefilledParams) {
  const a = {
    opId:         op.id,
    label:        op?.surfaces?.ui?.label ?? op.verb ?? op.id,
    paramsSchema: paramsToJsonSchema(op.params ?? [], { manifest }),
    placement,
  };
  if (prefilledParams) a.prefilledParams = prefilledParams;
  return a;
}

function buildItemAction(op, view, prefilledParams) {
  // For explicit appliesTo: pass type + state verbatim.
  // For type-enum fallback: scope to view.type only.
  const appliesTo = op.appliesTo?.type !== undefined
    ? { type: op.appliesTo.type }
    : { type: view.type };
  if (op.appliesTo?.state !== undefined) {
    appliesTo.state = op.appliesTo.state;  // F-SP3-a passthrough
  }
  const action = {
    opId:  op.id,
    label: op?.surfaces?.ui?.label ?? op.verb ?? op.id,
    appliesTo,
  };
  if (prefilledParams) action.prefilledParams = prefilledParams;
  return action;
}

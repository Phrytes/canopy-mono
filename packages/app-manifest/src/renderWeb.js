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
 * @property {Affordance[]} affordances    per-section actions (e.g. add-form)
 * @property {ItemAction[]} itemActions    per-item state-gated buttons
 *
 * @typedef {object} Affordance
 * @property {string}   opId               matches manifest.operation.id
 * @property {string}   label              from surfaces.ui.label or op.verb
 * @property {object}   paramsSchema       from paramsToJsonSchema(op.params)
 * @property {'section'|'global'} placement
 *
 * @typedef {object} ItemAction
 * @property {string}   opId               matches manifest.operation.id
 * @property {string}   label              from surfaces.ui.label or op.verb
 * @property {{type?: string|string[], state?: string|string[]}} appliesTo
 *                                         passed through (F-SP3-a multi-state honoured)
 *
 * Note on `callbackData`: the design sketch proposed a per-action
 * `callbackData` template (`"${opId}:${itemId}"`).  V0 stores just
 * `opId` here; the adapter constructs the dispatch key at render
 * time (`${opId}:${item.id}` for single-app, prefixed by manifest-
 * host when ≥2 apps composed).  Keeps NavModel pure-data.
 */

import { paramsToJsonSchema } from './paramsToJsonSchema.js';

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
  if (view.filter   !== undefined) section.filter   = view.filter;
  if (view.sort     !== undefined) section.sort     = view.sort;
  if (view.audience !== undefined) section.audience = view.audience;

  for (const op of ops) {
    const ui = op?.surfaces?.ui;
    if (!ui)                         continue;  // chat-only / LLM-only — omit
    if (ui.placement === 'global')   continue;  // already pushed to globals

    if (!opMatchesView(op, view))    continue;

    if (op.verb === 'add') {
      section.affordances.push(buildAffordance(op, manifest, 'section'));
    } else {
      section.itemActions.push(buildItemAction(op));
    }
  }

  return section;
}

/**
 * Does an op apply to this view's item-type?
 *
 *   - `appliesTo.type` may be a string OR array (F-SP3-a allows
 *     multi-type ops).
 *   - Op without `appliesTo` is treated as NOT matching any section
 *     — keeps section affordances scoped to ops that explicitly opt
 *     in.  Cross-section ops (e.g. household's `addItem` which
 *     accepts a type param) need a per-view counterpart in the
 *     manifest or a future cross-section affordance shape (V1+).
 */
function opMatchesView(op, view) {
  if (!op.appliesTo)         return false;
  if (op.appliesTo.type === undefined) return false;
  const types = Array.isArray(op.appliesTo.type)
    ? op.appliesTo.type
    : [op.appliesTo.type];
  return types.includes(view.type);
}

function buildAffordance(op, manifest, placement) {
  return {
    opId:         op.id,
    label:        op?.surfaces?.ui?.label ?? op.verb ?? op.id,
    paramsSchema: paramsToJsonSchema(op.params ?? [], { manifest }),
    placement,
  };
}

function buildItemAction(op) {
  const action = {
    opId:  op.id,
    label: op?.surfaces?.ui?.label ?? op.verb ?? op.id,
    appliesTo: {
      type: op.appliesTo.type,
    },
  };
  // F-SP3-a — state may be string OR array; pass through verbatim.
  if (op.appliesTo.state !== undefined) {
    action.appliesTo.state = op.appliesTo.state;
  }
  return action;
}

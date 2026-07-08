/**
 * screenModel — B · Slice 3: the pure projection behind a manifest `surfaces.screen` list surface.
 *
 * Turns a raw item list + the user's filter state into a render-ready model: a text-filtered,
 * category-checkbox-filtered list of rows, each carrying its capability-gated ROW ACTIONS (reusing
 * `embedButtonsForReply`, so the actions inherit Slice-4's greying/hiding for free). Pure → the web +
 * mobile screen shells own only the widgets; the filter/categorise/row-action logic lives here once.
 *
 * The "contacten met k" acceptance test: `buildScreenModel({ items: contacts, query: 'k' })` returns
 * only the contacts whose label contains "k"; `categoryField: 'category'` adds the category checkboxes.
 */

import { embedButtonsForReply } from './replyEmbeds.js';
import { audienceFromItem, audienceMatches } from '@canopy/item-store';
import { normalizeAudienceRef } from './circleScope.js';

/** Distinct category values (in first-seen order) for `categoryField`. */
function distinctCategories(items, field) {
  const seen = [];
  const set = new Set();
  for (const it of items) {
    const c = it?.[field];
    if (c == null || c === '') continue;
    if (!set.has(c)) { set.add(c); seen.push(c); }
  }
  return seen;
}

/**
 * @param {object} args
 * @param {object[]} args.items                 the raw rows (from the screen's dataSource skill)
 * @param {string}  [args.query]                free-text filter (case-insensitive contains; matches an item
 *                                              when ANY of `searchFields` contains the query)
 * @param {string}  [args.labelField='label']   which item field is the row label
 * @param {string[]} [args.searchFields]         D-mig-2 — which item fields the free-text `query` matches.
 *                                              An item matches iff ANY listed field (case-insensitive)
 *                                              contains the query.  Absent/empty ⇒ `[labelField]` ⇒ the
 *                                              pre-D-mig-2 label-only behaviour, byte-identical (the
 *                                              "contacten met k" acceptance).
 * @param {string}  [args.categoryField]        which item field groups the rows (enables category checkboxes)
 * @param {string[]|null} [args.activeCategories]  checked categories (null = all checked); an item shows iff its
 *                                              category is checked
 * @param {*}       [args.defaultAudience]      SP-5b — the view's declared `defaultAudience`
 *                                              (projected from the manifest `view` via
 *                                              renderWeb's `section.audience`).  When set, the
 *                                              list is pre-filtered to items whose EFFECTIVE
 *                                              audience (`audienceFromItem`) matches it
 *                                              (`audienceMatches`) — so a view shows only the
 *                                              items its declared audience covers.  Absent →
 *                                              no audience filter (unchanged behaviour).
 * @param {*}       [args.audience]             SP-5b — an explicit caller audience filter; when
 *                                              provided it OVERRIDES `defaultAudience`.
 * @param {object}  [args.manifestsByOrigin]    for computing row actions (with `appOrigin`)
 * @param {string}  [args.appOrigin]
 * @param {Array}   [args.capabilityMatrix]     the member's matrix → row actions inherit greying/hiding (Slice 4)
 * @returns {{ rows: Array<{item:object,label:string,category:(string|null),actions:object[]}>,
 *            categories: Array<{id:string,count:number,checked:boolean}> }}
 */
export function buildScreenModel({
  items = [], query = '', labelField = 'label', searchFields, categoryField,
  activeCategories = null, defaultAudience, audience, manifestsByOrigin, appOrigin, capabilityMatrix = [],
} = {}) {
  const rawList = Array.isArray(items) ? items : [];
  // SP-5b — audience membership is a HARD pre-filter (a scope), applied before
  // category/text filtering so it also constrains the category checkboxes and
  // their counts.  An explicit caller `audience` overrides the view's declared
  // `defaultAudience`; when neither is set the list passes through untouched
  // (fully back-compatible).  Reuses the item-store audience predicate rather
  // than reimplementing it.
  //
  // Normalisation (SP-5b): a view declares its audience as the string
  // short-hand `circle:X`, but items created through a `@canopy/circles` /
  // saved-view path store the STRUCTURED `{kind:'circle-ref', id:'X'}`.  Those
  // are the same audience, but item-store's `audienceMatches` is strict-equal
  // (it can't depend on `@canopy/circles` to canonicalise).  So we canonicalise
  // the circle-ref spelling on BOTH operands (via the render path's own
  // self-contained `normalizeAudienceRef`) before matching — otherwise
  // structured-audience items silently vanish from a `circle:X` view.  Kept
  // self-contained (no `@canopy/circles` import) so the shared model stays
  // Metro/RN-portable.
  const effectiveAudience = audience !== undefined ? audience : defaultAudience;
  const normFilter = effectiveAudience === undefined ? undefined : normalizeAudienceRef(effectiveAudience);
  const list = effectiveAudience === undefined
    ? rawList
    : rawList.filter((it) => audienceMatches(normalizeAudienceRef(audienceFromItem(it)), normFilter));
  const active = activeCategories == null ? null : new Set(activeCategories);
  const q = String(query || '').trim().toLowerCase();
  const labelOf = (it) => String(it?.[labelField] ?? it?.label ?? it?.id ?? '');
  // D-mig-2 — the free-text filter grammar: the manifest declares WHICH
  // item fields the query matches.  Default `[labelField]` ⇒ label-only
  // search (the pre-D-mig-2 behaviour, byte-identical).  An item matches
  // when ANY listed field contains the query — same lowercase-contains
  // predicate as before, just iterated over the field list.
  const fields = Array.isArray(searchFields) && searchFields.length ? searchFields : [labelField];
  // The label field keeps its `labelField ?? label ?? id` fallback (so the
  // default `[labelField]` case is byte-identical); other fields read plain.
  const valueOf = (it, f) => (f === labelField ? labelOf(it) : String(it?.[f] ?? ''));
  const matchesQuery = (it) =>
    fields.some((f) => valueOf(it, f).toLowerCase().includes(q));

  // Filter: category checkboxes first, then the text query.
  const filtered = list.filter((it) => {
    if (active && categoryField && !active.has(it?.[categoryField])) return false;
    return !q || matchesQuery(it);
  });

  // Row actions in ONE pass (capability-gated + Slice-4 treatment), grouped back per item by itemId.
  const byItem = new Map();
  if (manifestsByOrigin && appOrigin && filtered.length) {
    const buttons = embedButtonsForReply({ reply: { items: filtered }, appOrigin, manifestsByOrigin, capabilityMatrix, maxButtons: 10000 });
    for (const b of buttons) { if (!byItem.has(b.itemId)) byItem.set(b.itemId, []); byItem.get(b.itemId).push(b); }
  }

  const rows = filtered.map((it) => ({
    item: it,
    label: labelOf(it),
    category: categoryField ? (it?.[categoryField] ?? null) : null,
    actions: byItem.get(it?.id) || [],
  }));

  // Category checkboxes reflect the FULL list (counts don't shrink as you type) + the checked state.
  const categories = categoryField
    ? distinctCategories(list, categoryField).map((c) => ({
        id: c,
        count: list.filter((it) => it?.[categoryField] === c).length,
        checked: active == null || active.has(c),
      }))
    : [];

  return { rows, categories };
}

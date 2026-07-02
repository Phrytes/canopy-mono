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
 * @param {string}  [args.query]                free-text filter (matched against `labelField`, case-insensitive)
 * @param {string}  [args.labelField='label']   which item field is the row label
 * @param {string}  [args.categoryField]        which item field groups the rows (enables category checkboxes)
 * @param {string[]|null} [args.activeCategories]  checked categories (null = all checked); an item shows iff its
 *                                              category is checked
 * @param {object}  [args.manifestsByOrigin]    for computing row actions (with `appOrigin`)
 * @param {string}  [args.appOrigin]
 * @param {Array}   [args.capabilityMatrix]     the member's matrix → row actions inherit greying/hiding (Slice 4)
 * @returns {{ rows: Array<{item:object,label:string,category:(string|null),actions:object[]}>,
 *            categories: Array<{id:string,count:number,checked:boolean}> }}
 */
export function buildScreenModel({
  items = [], query = '', labelField = 'label', categoryField,
  activeCategories = null, manifestsByOrigin, appOrigin, capabilityMatrix = [],
} = {}) {
  const list = Array.isArray(items) ? items : [];
  const active = activeCategories == null ? null : new Set(activeCategories);
  const q = String(query || '').trim().toLowerCase();
  const labelOf = (it) => String(it?.[labelField] ?? it?.label ?? it?.id ?? '');

  // Filter: category checkboxes first, then the text query.
  const filtered = list.filter((it) => {
    if (active && categoryField && !active.has(it?.[categoryField])) return false;
    return !q || labelOf(it).toLowerCase().includes(q);
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

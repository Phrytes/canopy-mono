/**
 * k-anonymity suppression at aggregation READ — the traceability guard's second
 * layer. The aggregation job already reads every released summary; here it counts
 * attribute-combos and SUPPRESSES the attributes of any record whose exact combo
 * is shared by fewer than `attributeK` participants. The feedback text still
 * aggregates — only the *segmentation* (the attributes) is hidden for rare combos.
 *
 * v1 = per-combo, all-or-nothing suppression. A later refinement (deferred) would
 * GENERALISE (drop the rarest attribute — district→municipality — and recheck)
 * rather than suppress outright; that needs a per-attribute generalisation
 * hierarchy. See plans/NOTE-requested-attributes-charter.md §4.2.
 *
 * Pure function; the caller owns record shape beyond `{ attributes }`.
 */

/**
 * Default attributeK: attributes are more identifying than mere participation,
 * so the floor is higher than the aggregation's own `k`.
 * @param {number} [aggregationK] the project's existing aggregation k (default 3)
 */
export function attributeKDefault(aggregationK) {
  const base = Number.isInteger(aggregationK) && aggregationK > 0 ? aggregationK : 3;
  return Math.max(base, 5);
}

// Canonical string for a record's shared attributes — order-independent, so
// {role,ageBand} and {ageBand,role} are the SAME combo.
function comboKey(attributes) {
  const entries = Object.entries(attributes ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

/**
 * Suppress the attributes of every record whose exact attribute-combo is held by
 * fewer than `attributeK` records. Returns NEW records with `attributes` replaced
 * by `{}` when suppressed (absent, not marked). Records with no attributes are
 * left untouched (their empty combo is common and carries nothing to hide).
 *
 * @param {Array<{attributes?: object}>} records
 * @param {{attributeK: number}} opts
 * @returns {Array<{attributes: object}>}  same order; suppressed records have attributes: {}
 */
export function suppressRareAttributes(records, { attributeK } = {}) {
  if (!Array.isArray(records)) return [];
  const k = Number.isInteger(attributeK) && attributeK > 0 ? attributeK : attributeKDefault();
  // Count only records that actually disclosed something.
  const counts = new Map();
  for (const r of records) {
    const key = comboKey(r?.attributes);
    if (key === '[]') continue;                 // no disclosed attributes → not counted
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return records.map((r) => {
    const key = comboKey(r?.attributes);
    if (key === '[]') return { ...r, attributes: {} };
    const safe = (counts.get(key) ?? 0) >= k;
    return { ...r, attributes: safe ? { ...r.attributes } : {} };
  });
}

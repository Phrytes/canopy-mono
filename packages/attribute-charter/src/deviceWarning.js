/**
 * Device warning — the traceability guard's third layer, an ON-DEVICE, low-leak
 * heuristic. The round exposes only an approximate cohort size `n` (a count —
 * low sensitivity). The device warns when the participant's enabled combo is
 * likely rare: it never needs the actual distribution, only `n` + the
 * participant's own enabled set.
 *
 * Heuristic (plans/NOTE-requested-attributes-charter.md §4.3): warn when the
 * participant enables ≥2 attributes AND the possible-combo space of their enabled
 * attributes exceeds `n` (so their combo is probably unique in the cohort).
 *
 * Returns a structured verdict; the UI renders the localised copy from it (this
 * package holds NO user-facing strings — invariant #8). Pure function.
 */
import { bucketCount } from './vocabulary.js';

/**
 * @param {{enabledKeys: string[], n: number}} args
 *   enabledKeys — the attribute keys the participant is about to share
 *   n           — approximate cohort size for this round/charter
 * @returns {{warn: boolean, comboSpace: number, enabledCount: number, n: number}}
 */
export function disclosureWarning({ enabledKeys = [], n } = {}) {
  const keys = Array.isArray(enabledKeys) ? enabledKeys : [];
  const enabledCount = keys.length;
  // Possible-combo space = product of each enabled attribute's bucket count.
  const comboSpace = keys.reduce((acc, key) => acc * Math.max(1, bucketCount(key)), 1);
  const knownN = Number.isFinite(n) && n > 0 ? n : null;
  const warn = enabledCount >= 2 && knownN !== null && comboSpace > knownN;
  return { warn, comboSpace, enabledCount, n: knownN };
}

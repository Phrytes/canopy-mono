/**
 * @onderling/attribute-charter — the requested-attributes charter.
 *
 * A coarse, capped, k-anon-guarded privacy mini-spec: a project lead may request
 * a FEW coarse background attributes (place, age band, role, …) that a
 * participant can CHOOSE to attach to pseudonymous feedback, so the lead can
 * segment WITHOUT enabling re-identification. The traceability budget is fixed
 * BEFORE any data flows (charter caps), guarded again at read (k-anon suppression)
 * and warned on-device (low-leak heuristic).
 *
 * This is the substrate half — pure functions, no UI, no transport. The
 * consent UI (feedback surface), the aggregation wiring, and the PM declaration
 * screen consume these. See plans/NOTE-requested-attributes-charter.md.
 */
export {
  VOCABULARY,
  CHARTER_ROLE_KEY,
  attributeKeys,
  isVocabKey,
  bucketsFor,
  isValidValue,
  bucketCount,
  PLACE_COMBO_WEIGHT,
} from './vocabulary.js';

export {
  CHARTER_MAX_ATTRIBUTES,
  createCharter,
  charterHash,
  charterKeys,
} from './charter.js';

export {
  createDisclosureProfile,
  setValue,
  setEnabled,
  enabledSharedKeys,
  releasedValues,
} from './disclosureProfile.js';

export {
  attributeKDefault,
  suppressRareAttributes,
} from './kAnon.js';

export { disclosureWarning } from './deviceWarning.js';

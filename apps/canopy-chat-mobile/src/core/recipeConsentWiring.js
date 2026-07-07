/**
 * recipeConsentWiring — the mobile SEAM for the REVIEWED apply-recipe flow (B · consent-card, web≡mobile).
 *
 * The load/review/apply LOGIC lives ONCE in shared `apps/canopy-chat/src/v2/recipeConsent.js`
 * (invariants #1/#2): mobile reuses `loadRecipeForReview` (source → review model) and
 * `applyReviewedRecipe` (Agree → policyStore.update via the SAME gate + record the declined optional
 * caps as `capabilityOptOuts`) VERBATIM — the web `circleApp.js` wires the identical pair. This module
 * only re-exports them from one place and adds the tiny PRESENTATION helper the RN consent card needs
 * (map its per-cap switch state to the `declinedKeys` the shared apply consumes). No recipe / consent /
 * apply logic is reimplemented here — a fork of the map or the consent model would be a bug.
 */
import {
  loadRecipeForReview, applyReviewedRecipe, buildRecipeConsentModel, hasReviewContent,
} from '../../../canopy-chat/src/v2/recipeConsent.js';

export { loadRecipeForReview, applyReviewedRecipe, buildRecipeConsentModel, hasReviewContent };

/**
 * The opt-outable caps the user turned OFF on the consent card → the `declinedKeys` the shared
 * `applyReviewedRecipe` records as this member's `capabilityOptOuts`. A cap defaults to KEPT-ON
 * (`checked` true) unless it is pre-declined (`item.optedOut`) or the user explicitly switched it off.
 * Purely a switch-state → key-array projection; the shared `optOutsFromDeclined` still validates the
 * result (a mandatory / unknown key can never survive), so this can't bypass the gate.
 *
 * @param {Array<{key:string, optedOut?:boolean}>} optItems  model.consent.items (the opt-outable caps)
 * @param {Record<string, boolean>} checked  key → keep-on switch state
 * @returns {string[]}
 */
export function declinedKeysFrom(optItems = [], checked = {}) {
  return (Array.isArray(optItems) ? optItems : [])
    .filter((i) => i && i.key && !(checked[i.key] ?? !i.optedOut))   // keptOn = checked ?? !optedOut
    .map((i) => i.key);
}

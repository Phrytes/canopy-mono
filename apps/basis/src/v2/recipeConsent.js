/**
 * recipeConsent — REVIEWED recipe apply (B · consent-card tail). Compose, don't fork.
 *
 * Applying a recipe (#64) is a POWERFUL, deny-by-default capability grant: it rewrites the circle's
 * whole allowlist + features + settings in one go. This module makes that a REVIEWED action — the user
 * sees what the recipe WOULD enable and Agrees / Declines (opting out of the optional caps) BEFORE it is
 * applied — WITHOUT forking either the recipe map or the consent logic:
 *
 *   - the recipe → policy-patch map is `recipeToCirclePolicyPatch` (recipeApply.js), verbatim;
 *   - the opt-outable review set is `buildJoinConsentModel` (circleConsent.js) run over the policy the
 *     circle WOULD have after apply (current policy ⊕ patch, via the SAME `mergeCirclePolicy` the store
 *     uses), so the card and the join-time consent card agree by construction;
 *   - Agree flows through the EXISTING `applyRecipeToCircle` (→ policyStore.update → the gate); the
 *     declined optional caps become `capabilityOptOuts` via `optOutsFromDeclined` — the exact member seam
 *     `effectiveCapabilities` already honours. No second apply path, no bypass of the gate.
 *
 * Everything here is platform-neutral (invariants #1/#2): web wires it now, mobile can wire the SAME model
 * later. The shell only injects the network (`fetch`/`verify` for the loader) + the persistence stores.
 */

import { recipeToCirclePolicyPatch, applyRecipeToCircle } from './recipeApply.js';
import { loadRecipe } from '@onderling/recipe-loader';
import { buildJoinConsentModel, optOutsFromDeclined, hasConsentChoices } from './circleConsent.js';
import { mergeCirclePolicy } from './circlePolicy.js';

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * PURE — a loaded recipe → the REVIEW model a user Agrees/Declines over (or a coded error, all-or-nothing).
 *
 * The model carries, purely for display + interaction:
 *   - `enabledCaps`  the capabilities the recipe TURNS ON (allowlist `enabled:true`), keyed for labels.
 *   - `features`     the feature flags the recipe turns on (surfaces.features true entries).
 *   - `settings`     the per-app settings the recipe writes (`{ key, value }`).
 *   - `consent`      the `buildJoinConsentModel` result over the WOULD-BE policy: the OPT-OUTABLE caps a
 *                    user may decline (optional freedom OR a privacy floor). This is the interactive set.
 *   - `patch`        the exact `recipeToCirclePolicyPatch` patch (what Agree persists).
 *   - `wouldBe`      the policy the circle WOULD have after apply (current ⊕ patch) — for callers/tests.
 *
 * @param {object} recipe   the normalised recipe (`loadRecipe(...).recipe`)
 * @param {object} [opts]
 * @param {Array<{manifest:object}>} [opts.sources]  the merged manifest sources (as fed to the gate)
 * @param {object} [opts.policy]                     the circle's CURRENT policy (for the ⊕ + apps axis)
 * @returns {{ patch, wouldBe, consent, enabledCaps, features, settings } | { error:{code,message} }}
 */
export function buildRecipeConsentModel(recipe, { sources = [], policy = {} } = {}) {
  const mapped = recipeToCirclePolicyPatch(recipe, { sources });
  if (mapped.error) return { error: mapped.error };
  const patch = mapped.patch;

  // The policy the circle WOULD have after apply — the SAME merge the store performs on Agree. The apps
  // axis (untouched by recipes) carries over from the current policy so the consent model scopes to the
  // circle's actually-enabled apps, exactly as the gate will.
  const wouldBe = mergeCirclePolicy(policy || {}, patch);

  // Reuse the join-time consent model verbatim: the ENABLED, OPT-OUTABLE caps over the would-be template.
  const consent = buildJoinConsentModel(sources, wouldBe);

  // ── display-only deltas ────────────────────────────────────────────────────
  const capsTmpl = isPlainObject(patch.capabilities) ? patch.capabilities : {};
  const enabledCaps = Object.entries(capsTmpl)
    .filter(([, row]) => row && row.enabled === true)
    .map(([key]) => {
      const [app, atom, ...noun] = key.split(' ');
      return { key, app, atom, noun: noun.join(' ') };
    });

  const featTmpl = isPlainObject(patch.features) ? patch.features : {};
  const features = Object.entries(featTmpl).filter(([, on]) => on === true).map(([f]) => f);

  const setTmpl = isPlainObject(patch.settings) ? patch.settings : {};
  const settings = Object.entries(setTmpl).map(([key, value]) => ({ key, value }));

  return { patch, wouldBe, consent, enabledCaps, features, settings };
}

/** True when the review model has ANY reviewable content (something to enable, or something to opt out of). */
export function hasReviewContent(model) {
  if (!model || model.error) return false;
  return (model.enabledCaps?.length ?? 0) > 0
      || (model.features?.length ?? 0) > 0
      || (model.settings?.length ?? 0) > 0
      || hasConsentChoices(model.consent);
}

/**
 * LOAD + REVIEW — the shell-facing pre-apply half: load a recipe from a source (URL / JSON / object) via
 * the shipped loader (the shell injects the network + trust seam), then build the review model. Keeps the
 * load logic in shared `src/` so the shell stays a thin adapter (invariant #1); NOTHING is persisted here.
 *
 * @param {object} args
 * @param {string|object} args.source   URL / JSON string / recipe object (loader's `source`)
 * @param {Array<{manifest:object}>} [args.sources]  merged manifest sources
 * @param {object} [args.policy]        the circle's current policy (for the ⊕ + apps axis)
 * @param {Function} [args.fetch]       injected fetcher (loader offline/trust seam)
 * @param {Function} [args.verify]      injected trust check (deny-by-default)
 * @returns {Promise<{ ok:true, recipe, model, warnings:string[] } | { ok:false, error:{code,message} }>}
 */
export async function loadRecipeForReview({ source, sources = [], policy = {}, fetch, verify } = {}) {
  const loaded = await loadRecipe(source, { fetch, verify });
  if (loaded.error) return { ok: false, error: loaded.error };
  const model = buildRecipeConsentModel(loaded.recipe, { sources, policy });
  if (model.error) return { ok: false, error: model.error };
  return { ok: true, recipe: loaded.recipe, model, warnings: loaded.warnings ?? [] };
}

/**
 * AGREE — apply a REVIEWED recipe. Persists the recipe patch through the EXISTING `applyRecipeToCircle`
 * (→ policyStore.update → the gate), then records the user's declined optional caps as the member's
 * `capabilityOptOuts` (via `optOutsFromDeclined` → the injected `recordOptOuts`). The effective set the
 * gate computes is therefore the recipe's allowlist MINUS the declined optional caps — no bypass, no fork.
 *
 * `recordOptOuts` is injected (the member-override store is a shell/persistence concern); it receives the
 * validated opt-out key array. Absent it, the recipe is still applied and the opt-outs are returned for
 * the caller to persist.
 *
 * @param {object} args
 * @param {string} args.circleId
 * @param {object} args.recipe                          the ALREADY-LOADED, reviewed recipe
 * @param {object} args.model                           the review model from buildRecipeConsentModel
 * @param {string[]|Set<string>} [args.declinedKeys]    the opt-outable caps the user unchecked
 * @param {Array<{manifest:object}>} [args.sources]     merged manifest sources
 * @param {object} args.policyStore                     the circle policy store (update())
 * @param {(optOuts:string[])=>any} [args.recordOptOuts]  persist the member's opt-outs (e.g. overrideStore)
 * @returns {Promise<{ ok:true, policy, patch, optOuts:string[] } | { ok:false, error:{code,message} }>}
 */
export async function applyReviewedRecipe({
  circleId, recipe, model, declinedKeys = [], sources = [], policyStore, recordOptOuts,
} = {}) {
  const applied = await applyRecipeToCircle({ circleId, recipe, sources, policyStore });
  if (!applied.ok) return applied;
  // Only opt-outable keys survive — a required / unknown key can never be recorded (join-consent seam).
  const optOuts = optOutsFromDeclined(model?.consent, declinedKeys);
  if (typeof recordOptOuts === 'function') {
    try { await recordOptOuts(optOuts); } catch { /* best-effort — the recipe itself is applied */ }
  }
  return { ...applied, optOuts };
}

// Disclosure layer — the single mechanism the whole property layer shares (design Phase 0).
// See plans/NOTE-property-layer-design.md §1–2.
//
// A DISCLOSURE POLICY records, PER CONTEXT (a circle / project / request), which properties
// the user chose to share and at which coarseness RUNG. It is default-WITHHOLD: a property
// not enabled for a context is simply not released — and a withheld key is ABSENT from the
// release, never marked (a "withheld" flag would itself be a signal).
//
// This is the generalisation of @canopy/attribute-charter's feedback-local disclosureProfile:
// ONE policy on the profile, reused across every app/bot. The policy is a plain serialisable
// object (persist it wherever); all functions are pure transforms.

import { resolveProperty } from './profileProperties.js';

/** A fresh, share-nothing policy. */
export function createDisclosurePolicy() {
  return { perContext: {} };
}

/**
 * Set (enable/disable + choose rung) the disclosure of one property for one context.
 * Returns a NEW policy. Default is withhold — you only ever ADD a deliberate share.
 * @param {object} policy
 * @param {string} contextId
 * @param {string} key
 * @param {{ enabled?: boolean, rung?: string|null }} [choice]
 */
export function setDisclosure(policy, contextId, key, { enabled = false, rung = null } = {}) {
  if (typeof contextId !== 'string' || !contextId) throw new TypeError('setDisclosure: contextId required');
  if (typeof key !== 'string' || !key) throw new TypeError('setDisclosure: key required');
  const perContext = { ...(policy?.perContext || {}) };
  const ctx = { ...(perContext[contextId] || {}) };
  ctx[key] = { enabled: enabled === true, rung: rung ?? null };
  perContext[contextId] = ctx;
  return { perContext };
}

/** The disclosure choice for a key in a context. Default = withhold ({enabled:false, rung:null}). */
export function getDisclosure(policy, contextId, key) {
  const e = policy?.perContext?.[contextId]?.[key];
  return { enabled: e?.enabled === true, rung: e?.rung ?? null };
}

/**
 * The values a REQUEST may see for a CONTEXT, given the user's profile + disclosure policy.
 * For each requested key: if the user enabled it for this context AND the profile resolves a
 * value (own, or inherited up the profile chain), release that value coarsened to the chosen
 * rung. Everything else is ABSENT (default-withhold, no marker). Pure.
 *
 * @param {object} profileCtx
 * @param {(id:string)=>({properties?:object}|null|undefined)} profileCtx.getProfile
 * @param {string} profileCtx.profileId
 * @param {string|null} [profileCtx.defaultProfileId]
 * @param {{ items?: Array<{key:string}> }} request   the consumer's typed request
 * @param {object} policy                              the user's disclosure policy
 * @param {string} contextId
 * @param {object} [vocabulary]                        a createVocabulary(...) — for coarsening (optional)
 * @returns {object}  { [key]: releasedValue } for enabled + resolvable keys only
 */
export function releasedValues({ getProfile, profileId, defaultProfileId = null }, request, policy, contextId, vocabulary = null) {
  const out = {};
  const items = Array.isArray(request?.items) ? request.items : [];
  for (const item of items) {
    const key = item?.key;
    if (typeof key !== 'string' || !key) continue;
    const { enabled, rung } = getDisclosure(policy, contextId, key);
    if (!enabled) continue;                                              // default-withhold → absent
    const value = resolveProperty(getProfile, profileId, key, { defaultProfileId });
    if (value === undefined) continue;                                   // nothing to share
    // Fail-CLOSED: if a declared coarsen fn can't reduce the value (returns undefined), WITHHOLD
    // it — never leak the raw fine value because coarsening failed. No coarsen fn → value as-is.
    const released = vocabulary ? vocabulary.coarsen(key, value, rung) : value;
    if (released === undefined) continue;
    out[key] = released;
  }
  return out;
}

// Disclosure layer — the single mechanism the whole property layer shares (design Phase 0).
// See plans/NOTE-property-layer-design.md §1–2.
//
// A DISCLOSURE POLICY records, PER CONTEXT (a circle / project / request), which properties
// the user chose to share and at which coarseness RUNG. It is default-WITHHOLD: a property
// not enabled for a context is simply not released — and a withheld key is ABSENT from the
// release, never marked (a "withheld" flag would itself be a signal).
//
// THREE ORTHOGONAL DISCLOSURE AXES (P4 foundation; NOTE-skills-vs-capabilities.md volley 3).
// A property carries three INDEPENDENT switches per (context, key), none collapsing into a
// single "share" toggle — each defaults to withhold (false):
//   • disclosed  (`enabled`)   — visible to the circle (the disclosure ladder; the only axis
//                                `releasedValues` reads). Default false.
//   • matchable                — may participate in on-device MATCHING without being disclosed
//                                (the "secret/passive" match: I don't publish my hobby, but the
//                                matcher may check it). A consent by the matched-AGAINST party;
//                                its safety rests on de-identification (anon circles) today, TEE
//                                two-sided-blind later. Can be TRUE while disclosed is FALSE —
//                                that is the whole point. Default false.
//   • requestable              — may others' agents invoke/ping me about it. Default false.
// matchable/requestable NEVER leak a VALUE: `releasedValues` keys off `enabled`/`rung` only.
//
// This is the generalisation of @onderling/attribute-charter's feedback-local disclosureProfile:
// ONE policy on the profile, reused across every app/bot. The policy is a plain serialisable
// object (persist it wherever); all functions are pure transforms.

import { resolveProperty } from './profileProperties.js';

/** A fresh, share-nothing policy. */
export function createDisclosurePolicy() {
  return { perContext: {} };
}

/**
 * Set the disclosure of one property for one context across the THREE independent axes.
 * Returns a NEW policy. Default is withhold — you only ever ADD a deliberate share.
 *
 * Each axis is set INDEPENDENTLY: pass only the axis you want to change and the others are
 * PRESERVED (not clobbered), so `matchable` can be toggled without touching `enabled`, and vice
 * versa. An axis never touched stays at its withheld default (false / null). This is what lets
 * matchable be TRUE while disclosed is FALSE.
 *
 * @param {object} policy
 * @param {string} contextId
 * @param {string} key
 * @param {{ enabled?: boolean, rung?: string|null, matchable?: boolean, requestable?: boolean }} [choice]
 */
export function setDisclosure(policy, contextId, key, choice = {}) {
  if (typeof contextId !== 'string' || !contextId) throw new TypeError('setDisclosure: contextId required');
  if (typeof key !== 'string' || !key) throw new TypeError('setDisclosure: key required');
  const c = choice || {};
  const has = (f) => Object.prototype.hasOwnProperty.call(c, f);
  const perContext = { ...(policy?.perContext || {}) };
  const ctx = { ...(perContext[contextId] || {}) };
  const prev = ctx[key] || {};
  ctx[key] = {
    // disclosed (the released axis) + its coarseness rung
    enabled:     has('enabled')     ? c.enabled === true     : prev.enabled === true,
    rung:        has('rung')        ? (c.rung ?? null)       : (prev.rung ?? null),
    // matchable — may participate in matching without being disclosed (default withhold)
    matchable:   has('matchable')   ? c.matchable === true   : prev.matchable === true,
    // requestable — may others' agents invoke/ping about it (default withhold)
    requestable: has('requestable') ? c.requestable === true : prev.requestable === true,
  };
  perContext[contextId] = ctx;
  return { perContext };
}

/**
 * The disclosure choice for a key in a context, across all three axes. Default = full withhold
 * ({enabled:false, rung:null, matchable:false, requestable:false}). Backward-compatible: an old
 * entry carrying only {enabled,rung} reads as matchable:false/requestable:false.
 */
export function getDisclosure(policy, contextId, key) {
  const e = policy?.perContext?.[contextId]?.[key];
  return {
    enabled:     e?.enabled === true,
    rung:        e?.rung ?? null,
    matchable:   e?.matchable === true,
    requestable: e?.requestable === true,
  };
}

/** Is this property DISCLOSED (visible to the circle) for this context? (the released axis) */
export function isDisclosed(policy, contextId, key) {
  return getDisclosure(policy, contextId, key).enabled === true;
}

/** May this property participate in MATCHING for this context — even without being disclosed? */
export function isMatchable(policy, contextId, key) {
  return getDisclosure(policy, contextId, key).matchable === true;
}

/** May others' agents invoke/ping about this property for this context? (default false) */
export function isRequestable(policy, contextId, key) {
  return getDisclosure(policy, contextId, key).requestable === true;
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
    // ONLY the disclosed axis (enabled/rung) releases a VALUE. matchable/requestable are
    // deliberately NOT consulted here — a matchable-but-not-disclosed property never leaks.
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

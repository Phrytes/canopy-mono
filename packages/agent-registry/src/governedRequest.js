// Governed request side — POLICY (not crypto) about what a requester may ASK, in which
// context (design Phase 1; plans/NOTE-property-layer-design.md §5).
//
// Because asking is trivial and refusal can be penalised under a power imbalance (an
// employer/landlord/insurer "asking"), some property TYPES/keys are un-askable — or
// flagged — in some context TYPES. This is a normative layer enforced at the request-RENDER
// step: a forbidden ask is refused (the app won't present it); a sensitive one is warned.
// It can't stop an out-of-band bad actor, but it stops the PRODUCT normalising the ask and
// gives the user cover.
//
// ⚠ The policy TABLE's authority/source (who decides context→forbidden) is an OPEN decision
// (design §8). The table below is a CONSERVATIVE, ILLUSTRATIVE starter — not a legal ruling.

export const DEFAULT_GOVERNED_POLICY = Object.freeze({
  // Hiring / tenancy: special-category data must not gate a job or a home (anti-discrimination).
  employment: { forbidTypes: ['coded'], forbidKeys: ['health', 'ageBand', 'pregnancy', 'ethnicity', 'religion'], warnKeys: [] },
  tenancy:    { forbidTypes: ['coded'], forbidKeys: ['health', 'ethnicity', 'religion'], warnKeys: ['ageBand'] },
  // A marketplace counterparty shouldn't mine willingness-to-pay / income to price-discriminate.
  commerce:   { forbidTypes: [], forbidKeys: ['income', 'willingnessToPay'], warnKeys: [] },
});

/**
 * Check a Request against a context TYPE. Pure.
 * @param {object} request                          a createRequest(...) record
 * @param {string} contextType                      e.g. 'employment' | 'tenancy' | 'commerce'
 * @param {object} [policyTable=DEFAULT_GOVERNED_POLICY]
 * @param {object} [vocabulary]                     a createVocabulary(...) — resolves an item's type when absent
 * @returns {{allowed:boolean, forbidden:string[], warn:string[]}}
 */
export function checkRequestAllowed(request, contextType, policyTable = DEFAULT_GOVERNED_POLICY, vocabulary = null) {
  const items = Array.isArray(request?.items) ? request.items : [];
  const rule = policyTable?.[contextType];
  if (!rule) return { allowed: true, forbidden: [], warn: [] };   // no rule for this context → nothing governed
  const forbidTypes = new Set(rule.forbidTypes || []);
  const forbidKeys = new Set(rule.forbidKeys || []);
  const warnKeys = new Set(rule.warnKeys || []);
  const forbidden = [];
  const warn = [];
  for (const it of items) {
    const type = it.type || vocabulary?.type?.(it.key) || null;
    if (forbidKeys.has(it.key) || (type && forbidTypes.has(type))) forbidden.push(it.key);
    else if (warnKeys.has(it.key)) warn.push(it.key);
  }
  return { allowed: forbidden.length === 0, forbidden, warn };
}

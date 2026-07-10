/**
 * catalogSource — the endorsement-backed curated catalog (commons-governance G1).
 *
 * Fills the `{ list, get }` seam that P3's `createStubCatalog` stubbed. It is a
 * CQRS read-view: it never stores a canonical list — it DERIVES the catalog by
 * reading a trust root's published endorsements, resolving each endorsed
 * agent's Agent Card, and keeping only the ones whose signed `recommend`
 * endorsement verifies (`verifyEndorsement` — Ed25519 sig + expiry +
 * cardHash-binding). A `flag` (or an invalid/expired/mismatched endorsement)
 * excludes the card.
 *
 * ── G1 scope: single-root + FLAT ──────────────────────────────────────────
 * Authority is one bootstrap root (a configured endorser pubKey, injectable).
 * An endorsement counts ONLY if its `endorser` is in `roots`. No transitive
 * walk, no trust-path ranking — that is G2 (web-of-trust). Rank here is the
 * trivial endorsement count. This proves the READ-PATH end-to-end into P3's
 * capability-secured install before any graph logic.
 *
 * The returned entries are plain Agent Cards (the SAME shape createStubCatalog
 * returned) with additive `x-canopy.endorsement` ranking metadata — so P3's
 * installCores (`cardId`/`declaredSkills`/`cardToEntry`) consumes them
 * unchanged and the install still runs through the capability-security grant
 * path. Transparent swap.
 */

import { verifyEndorsement } from './endorsement.js';

/**
 * createCatalogSource — a `{ list, get }` source over verified endorsements.
 *
 * @param {object} opts
 * @param {{ list: () => Promise<object[]> }} opts.endorsementResource
 *   — the root's published endorsement list (createEndorsementResource, or any
 *     `{ list() }`). Read cross-pod; authority is the signature, not this
 *     object.
 * @param {string[]|string} opts.roots
 *   — trusted endorser pubKey(s). G1: single root (pass one). An endorsement
 *     from an endorser NOT in this set is ignored.
 * @param {(subject: string, endorsement: object) => (object|null|Promise<object|null>)} opts.resolveCard
 *   — resolves an endorsed agent's Agent Card by its subject pubKey. The card
 *     is then cardHash-verified against the endorsement, so a resolver that
 *     returns a mutated card is rejected (endorse-then-escalate defence).
 * @param {() => number} [opts.now]  — injectable clock (tests)
 * @returns {{ list: () => Promise<object[]>, get: (id: string) => Promise<object|null> }}
 */
export function createCatalogSource({ endorsementResource, roots, resolveCard, now } = {}) {
  if (!endorsementResource || typeof endorsementResource.list !== 'function') {
    throw Object.assign(new Error('createCatalogSource: endorsementResource with list() required'), { code: 'INVALID_ARGUMENT' });
  }
  const rootSet = new Set(
    (Array.isArray(roots) ? roots : [roots]).filter((r) => typeof r === 'string' && r.length > 0),
  );
  const resolve = typeof resolveCard === 'function' ? resolveCard : () => null;

  const idOf = (card) => card?.['x-canopy']?.id ?? card?.agentId ?? card?.['x-canopy']?.pubKey ?? card?.pubKey ?? null;

  /**
   * Derive the verified, flat catalog. Returns a Map keyed by card id so `list`
   * and `get` share one build (and one card can't appear twice).
   */
  async function _derive() {
    const records = await endorsementResource.list();
    const list    = Array.isArray(records) ? records : [];

    // Pass 1: bucket verified endorsements by subject (recommend vs flag).
    const recommended = new Map();   // subject → { card, endorsers:Set, tags:Set }
    const flagged     = new Set();   // subject pubKeys with a valid flag

    for (const rec of list) {
      if (!rec || !rootSet.has(rec.endorser)) continue;            // single-root authority
      const card = await resolve(rec.subject, rec);
      const actor = verifyEndorsement(rec, card, now ? { now } : undefined);
      if (!actor) continue;                                        // invalid / expired / cardHash-mismatch → dropped
      if (actor.claim === 'flag') { flagged.add(actor.subject); continue; }
      // claim === 'recommend'
      let bucket = recommended.get(actor.subject);
      if (!bucket) { bucket = { card, endorsers: new Set(), tags: new Set() }; recommended.set(actor.subject, bucket); }
      bucket.endorsers.add(actor.endorser);
      for (const t of actor.tags) bucket.tags.add(t);
    }

    // Pass 2: flagged subjects are excluded even if also recommended.
    const byId = new Map();
    for (const [subject, bucket] of recommended) {
      if (flagged.has(subject)) continue;
      const id = idOf(bucket.card);
      if (typeof id !== 'string' || id.length === 0) continue;
      const ranked = _rank(bucket.card, {
        endorsementCount: bucket.endorsers.size,
        endorsers:        [...bucket.endorsers],
        tags:             [...bucket.tags],
      });
      byId.set(id, ranked);
    }
    return byId;
  }

  return {
    async list() {
      const byId = await _derive();
      // G1 flat rank: order by endorsement count (desc), then id for stability.
      return [...byId.values()].sort((a, b) => {
        const ca = a['x-canopy']?.endorsement?.count ?? 0;
        const cb = b['x-canopy']?.endorsement?.count ?? 0;
        if (cb !== ca) return cb - ca;
        return String(idOf(a)).localeCompare(String(idOf(b)));
      });
    },
    async get(id) {
      const byId = await _derive();
      return byId.get(id) ?? null;
    },
  };
}

/**
 * Attach additive endorsement/ranking metadata under `x-canopy.endorsement`
 * without disturbing any A2A/x-canopy field P3 reads. The card stays a valid
 * installable card.
 */
function _rank(card, { endorsementCount, endorsers, tags }) {
  const xc = card?.['x-canopy'] ?? {};
  return {
    ...card,
    'x-canopy': {
      ...xc,
      endorsement: { count: endorsementCount, endorsers, tags },
    },
  };
}

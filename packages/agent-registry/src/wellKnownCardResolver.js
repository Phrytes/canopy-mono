/**
 * wellKnownCardResolver — resolve an endorsed agent's Agent Card by fetching
 * its A2A `.well-known` discovery document (commons-governance G2).
 *
 * The trust-graph walk needs a `resolveCard(subject, endorsement)` collaborator.
 * G1/G2 tests inject an in-memory map (hermetic). For a REAL deployment a
 * third party who publishes an agent serves its standard Agent Card at the A2A
 * well-known path (`SPEC-agents-registry.md` — "the standard card portion can
 * be served at the A2A `.well-known/agent` discovery path"). This factory
 * builds a `resolveCard` over an INJECTED `fetch`, so the network stays a seam:
 * tests pass a fake fetch, production passes global `fetch`.
 *
 * Resolution: the endorsement's `subject` is a pubKey, not a URL, so we need a
 * base to fetch from. We take it from the endorsement's `url`/`agentUri` hint
 * when present, else fall back to `baseFor(subject)`. We then GET
 * `<base>/.well-known/agent` (and, tolerant of the JSON variant, `agent.json`).
 * The fetched card is returned AS-IS — its authority is re-established by the
 * caller's `verifyEndorsement` (cardHash-binding), so a host that serves a
 * mutated card is rejected downstream, not trusted here.
 *
 * NOTE (follow-up for Frits): this is the SEAM + a working default. The real
 * deployment still needs (a) how `subject`→base URL is discovered when the
 * endorsement carries no `url` (registry lookup?), and (b) response-size /
 * timeout / redirect hardening. Kept out of scope to keep the walk + tests
 * hermetic; wire `createWellKnownCardResolver({ fetch })` as the default
 * `resolveCard` in an app only once those are pinned.
 */

const WELL_KNOWN_PATHS = ['/.well-known/agent', '/.well-known/agent.json'];

function trimSlash(u) { return typeof u === 'string' && u.endsWith('/') ? u.slice(0, -1) : u; }

/**
 * Build a `resolveCard(subject, endorsement)` function over an injected `fetch` that GETs an
 * endorsed agent's A2A Agent Card from `<base>/.well-known/agent` (then `agent.json`). The base
 * URL is the endorsement's `url`/`agentUri` hint, else `baseFor(subject)`; fetch failures or
 * non-JSON bodies resolve to `null`. The card is returned as-is — cardHash verification stays with
 * the caller.
 *
 * @param {object} opts
 * @param {typeof fetch} opts.fetch  — injected fetch (required; keeps tests hermetic)
 * @param {(subject: string) => (string|null)} [opts.baseFor]  — pubKey → base URL fallback
 * @returns {(subject: string, endorsement?: object) => Promise<object|null>}
 */
export function createWellKnownCardResolver({ fetch: fetchImpl, baseFor } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw Object.assign(new Error('createWellKnownCardResolver: fetch is required'), { code: 'INVALID_ARGUMENT' });
  }
  const base = typeof baseFor === 'function' ? baseFor : () => null;

  return async function resolveCard(subject, endorsement) {
    const hint = endorsement?.url ?? endorsement?.agentUri ?? base(subject);
    if (typeof hint !== 'string' || hint.length === 0) return null;
    const root = trimSlash(hint);
    for (const path of WELL_KNOWN_PATHS) {
      try {
        const res = await fetchImpl(`${root}${path}`);
        if (!res || res.ok === false) continue;
        const card = typeof res.json === 'function' ? await res.json() : null;
        if (card && typeof card === 'object') return card;
      } catch { /* try the next path / give up → null */ }
    }
    return null;
  };
}

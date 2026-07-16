/**
 * Curated list of Solid OIDC issuers + a small resolver.
 *
 * **Mirror of `@onderling/oidc-session/src/issuers.js`** — kept here
 * (not imported) to avoid pulling the Node package's transitive
 * `@inrupt/solid-client-authn-node` dep into the RN bundle. If you
 * change one file, change both.
 *
 * Phase 52.15.1 (2026-05-14) — Solid-auth consolidation.
 *
 * @typedef {object} KnownIssuer
 * @property {string} id
 * @property {string} url
 * @property {string} label
 * @property {KnownIssuerCapabilities} capabilities
 *
 * @typedef {object} KnownIssuerCapabilities
 * @property {boolean | 'unknown'} dcr
 * @property {boolean | 'unknown'} acp
 * @property {boolean | 'unknown'} dpop
 */

/** @type {Readonly<KnownIssuer[]>} */
export const KNOWN_ISSUERS = Object.freeze([
  {
    id:    'inrupt',
    url:   'https://login.inrupt.com',
    label: 'Inrupt Pod Spaces',
    capabilities: { dcr: true, acp: true, dpop: false },
  },
  {
    id:    'solidcommunity',
    url:   'https://solidcommunity.net',
    label: 'SolidCommunity.net',
    capabilities: { dcr: true, acp: 'unknown', dpop: 'unknown' },
  },
  {
    id:    'solidweb',
    url:   'https://solidweb.org',
    label: 'SolidWeb.org',
    capabilities: { dcr: true, acp: 'unknown', dpop: 'unknown' },
  },
]);

export const DEFAULT_ISSUER_ID = 'inrupt';
export const DEFAULT_ISSUER    = KNOWN_ISSUERS.find(i => i.id === DEFAULT_ISSUER_ID);

/**
 * Resolve a `KnownIssuer` from id or URL. Falls back to a synthesised
 * `{ id: 'custom', ... }` for unknown URLs. Returns `null` on
 * malformed input. See `@onderling/oidc-session/src/issuers.js` for
 * full doc.
 *
 * @param {string} idOrUrl
 * @returns {KnownIssuer | null}
 */
export function resolveIssuer(idOrUrl) {
  if (typeof idOrUrl !== 'string' || idOrUrl.length === 0) return null;

  const byId = KNOWN_ISSUERS.find(i => i.id === idOrUrl);
  if (byId) return byId;

  const normalised = idOrUrl.endsWith('/') ? idOrUrl.slice(0, -1) : idOrUrl;
  const byUrl = KNOWN_ISSUERS.find(i => i.url === normalised);
  if (byUrl) return byUrl;

  try {
    const u = new URL(idOrUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return {
      id:    'custom',
      url:   normalised,
      label: u.host,
      capabilities: { dcr: 'unknown', acp: 'unknown', dpop: 'unknown' },
    };
  } catch {
    return null;
  }
}

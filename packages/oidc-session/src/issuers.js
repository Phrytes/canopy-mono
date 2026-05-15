/**
 * Curated list of Solid OIDC issuers + a small resolver.
 *
 * Ships from `@canopy/oidc-session`; mirrored in
 * `@canopy/oidc-session-rn` (the two packages must stay in sync —
 * either lift to a shared package or duplicate carefully here).
 *
 * Phase 52.15.1 (2026-05-14) — Solid-auth consolidation. See
 * `Project Files/Inrupt-migration/substrate-design-2026-05-14.md`.
 *
 * @typedef {object} KnownIssuer
 * @property {string} id      — stable identifier (`'inrupt'`, `'solidcommunity'`, …)
 * @property {string} url     — fully-qualified issuer URL
 * @property {string} label   — human-readable label for pickers
 * @property {KnownIssuerCapabilities} capabilities
 *
 * @typedef {object} KnownIssuerCapabilities
 * @property {boolean | 'unknown'} dcr   — Dynamic Client Registration
 * @property {boolean | 'unknown'} acp   — ACP-based ACL writes
 * @property {boolean | 'unknown'} dpop  — DPoP token binding
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

/** Issuer id used when the caller doesn't pick one. */
export const DEFAULT_ISSUER_ID = 'inrupt';

/** Convenience — the resolved default. */
export const DEFAULT_ISSUER = KNOWN_ISSUERS.find(i => i.id === DEFAULT_ISSUER_ID);

/**
 * Resolve a `KnownIssuer` from either an id (`'inrupt'`,
 * `'solidcommunity'`, …) or a full URL. URLs that don't match any
 * known issuer fall back to a synthesised `{ id: 'custom', url, label,
 * capabilities: { dcr: 'unknown', acp: 'unknown', dpop: 'unknown' } }`
 * so callers can still construct sessions against arbitrary
 * spec-compliant servers (self-hosted CSS, less common community
 * providers).
 *
 * Returns `null` on malformed input (not a known id and not a valid
 * URL).
 *
 * @param {string} idOrUrl
 * @returns {KnownIssuer | null}
 */
export function resolveIssuer(idOrUrl) {
  if (typeof idOrUrl !== 'string' || idOrUrl.length === 0) return null;

  const byId = KNOWN_ISSUERS.find(i => i.id === idOrUrl);
  if (byId) return byId;

  // Normalise — strip trailing slash so `https://login.inrupt.com/` and
  // `https://login.inrupt.com` match the same known issuer.
  const normalised = idOrUrl.endsWith('/') ? idOrUrl.slice(0, -1) : idOrUrl;
  const byUrl = KNOWN_ISSUERS.find(i => i.url === normalised);
  if (byUrl) return byUrl;

  // Treat as a custom URL if it parses as one.
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

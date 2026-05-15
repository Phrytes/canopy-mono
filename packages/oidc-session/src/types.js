/**
 * Shared types for Solid OIDC auth substrates.
 *
 * Mirrored in `@canopy/oidc-session-rn` (keep both copies in sync).
 *
 * Phase 52.15.1 (2026-05-14). See
 * `Project Files/Inrupt-migration/substrate-design-2026-05-14.md`.
 *
 * @typedef {object} SignInOpts
 * @property {string} issuer       — issuer id or URL (`resolveIssuer` accepts both)
 * @property {string} redirectUrl  — OAuth callback URL
 * @property {string} [clientName] — display name on the consent screen
 *
 * @typedef {object} Session
 * @property {string} webId
 * @property {string} issuer
 * @property {number} [expiresAt]    — unix-ms; absent if the substrate doesn't expose it
 *
 * @typedef {object} SolidAuth
 *   The conceptual interface both auth substrates implement.
 *   `@canopy/oidc-session.createSolidAuthNode` returns this shape
 *   for Node; `@canopy/oidc-session-rn.OidcSessionRN` returns the
 *   same shape (Phase 52.15.2 work).
 *
 * @property {(opts: SignInOpts) => Promise<{redirectUrl: string}>} start
 * @property {(callbackUrl: string) => Promise<Session>}            handleCallback
 * @property {() => boolean}                                        isAuthenticated
 * @property {() => Session | null}                                 getStatus
 * @property {() => typeof fetch}                                   getAuthenticatedFetch
 * @property {(opts?: {onWarning?: (msg: string) => void}) => Promise<boolean>} restoreFromVault
 * @property {() => Promise<void>}                                  logout
 */

// JSDoc-only module — no runtime exports. Importers reference the
// typedefs via `@typedef` JSDoc lookup.
export {};

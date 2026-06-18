/**
 * @canopy/secure-agent — public entry.
 *
 * Safety-by-default agent factory.  See createSecureAgent.js for
 * the full design + opt list.
 *
 * Convention (after this lands, codified in
 * Project Files/conventions/architectural-layering.md):
 *   New apps composing a real network transport MUST use this
 *   factory.  Per-opt opt-outs require a grep-able
 *   `// SECURITY: opted out — <reason>` comment.
 */

export { createSecureAgent } from './createSecureAgent.js';
export { createSecureMeshAgent } from './createSecureMeshAgent.js';   // T5.3 — the unified secure-mesh factory
export { makeBrowserVault, restoreOrGenerate } from './vault.js';

// S1 — mute / block
export { loadMuteSet, MuteSet } from './mute.js';

// S2 — signed WebID claim
export {
  signClaim,
  verifyClaim,
  serializeClaim,
  parseClaim,
  CLAIM_VERSION,
  DEFAULT_TTL_MS as DEFAULT_CLAIM_TTL_MS,
} from './claim.js';

// S3 — WebAuthn / passkey helpers
export {
  registerPasskey,
  unlockWithPasskey,
  webauthnAvailable,
  PASSKEY_ERRORS,
} from './passkey.js';

// S4 — peer identity resolver
export { createPeerResolver, PeerResolver } from './resolver.js';

// S6 — signed activity / audit log
export { loadAuditLog, AuditLog, AUDIT_VERSION } from './auditLog.js';

// S7 — rate limiter
export {
  createRateLimiter, RateLimiter, RATE_LIMIT_DEFAULTS,
} from './rateLimit.js';

// S8 — Perfect Forward Secrecy (partial Double-Ratchet)
export {
  loadPFSChain, PFSChain,
  PFS_VERSION, DEFAULT_MAX_SKIP,
} from './pfs.js';

// S5 + S7 — re-export the substrate primitives the factory wires
export {
  TrustRegistry,
  TIER_LEVEL,
  CapabilityToken,
  PolicyEngine,
  ROLES,
  roleRank,
  isKnownRole,
  registerCustomRole,
  unregisterCustomRole,
  canPromote,
  listKnownRoles,
  skillMatches,
  skillAttenuates,
  GroupManager,
  A2ATLSLayer,
  A2AAuth,
  migrateVaultToPod,
} from '@canopy/core';

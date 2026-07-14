/**
 * @canopy/agent-registry — canonical agent registry substrate.
 *
 * Standardisation Phase 52.10. See
 * `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`.
 */

export { createAgentRegistry }  from './src/AgentRegistry.js';
export { makeActorResolver }    from './src/makeActorResolver.js';
export {
  registryResourceUri,
  normaliseResource,
  emptyResource,
  RESOURCE_VERSION,
} from './src/resource.js';
export { withCAS } from './src/concurrency.js';
export { projectAgentCard } from './src/agentCard.js';
// identity step 2 — profile own/inherit property graph + root-derived profile creation
export {
  own, inherit, normaliseProperties, resolveProperty, effectiveProperties, setOwn, setInherit,
} from './src/profileProperties.js';
export { createProfile, profilePubKey, profileCircleAddress } from './src/createProfile.js';
export { loadProfile } from './src/loadProfile.js';
export { registerAgentBundle } from './src/registerAgentBundle.js';

// commons-governance G1 — signed endorsements of Agent Cards + the
// endorsement-backed curated catalog read-view (fills P3's catalogSource seam).
export {
  issueEndorsement,
  verifyEndorsement,
  cardHash,
  ENDORSEMENT_VERSION,
} from './src/endorsement.js';
export {
  createEndorsementResource,
  endorsementResourceUri,
  normaliseEndorsementResource,
  emptyEndorsementResource,
  ENDORSEMENT_RESOURCE_VERSION,
} from './src/endorsementResource.js';
export { createCatalogSource } from './src/catalogSource.js';

// commons-governance G2 — the web-of-trust graph walk (multiple roots,
// transitive bounded-depth endorsement walk, trust-path-proximity ranking)
// that createCatalogSource consumes, plus a real A2A well-known card resolver
// seam (injected fetch; the hermetic default is an injected map).
export { walkTrustGraph, CURATOR_ROLES, DEFAULT_MAX_DEPTH } from './src/trustGraph.js';
export { createWellKnownCardResolver } from './src/wellKnownCardResolver.js';

// commons-governance G3 — federation + moderation: circle-scoped, admin-gated
// COMMUNITY catalogs (a community = a circle; writes gated to its admins via
// the circle's own policy), SUBSCRIBE/unsubscribe (a community's admins become
// the user's curator roots), fork/exit, and revoke. `expiresAt` lapse is
// already enforced by verifyEndorsement (G1) — the walk drops lapsed edges.
export { createCommunityCatalog, communityCatalogUri } from './src/communityCatalog.js';
export { createCommunitySubscriptions } from './src/subscriptions.js';

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

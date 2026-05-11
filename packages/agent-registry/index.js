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

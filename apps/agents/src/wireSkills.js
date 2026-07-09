/**
 * wireSkills — the WIRE route for the agents app.
 *
 * Wraps each pure core in `AGENT_CORES` with `wireSkill(coreFn, op,
 * { storeFor })` — the manifest op stays the single contract; the
 * `defineSkill`-shaped handler is DERIVED from it (same generator
 * tasks-v0 / stoop use).  `storeFor` resolves the scope store from the
 * skill context; for this single-user surface the store is the injected
 * `{ registry, tokens? }` pair regardless of ctx:
 *   • `registry` — the `@canopy/agent-registry` instance (mirror truth).
 *   • `tokens`   — OPTIONAL token collaborator
 *     `{ issue({subject, skill, expiresIn}) → Promise<{id, expiresAt?}>,
 *        revoke(tokenId) → Promise<void> }`
 *     — the eventual binding is `Agent.issueCapabilityToken` +
 *     `TokenRegistry.revoke`.  Without it the P2 control ops run in the
 *     honest degraded mode (`tokenBacked: false`, mirror-only).
 *
 * Returns `[{ id, handler, visibility }]` — register each on a
 * `core.Agent` via `agent.register(id, handler, { visibility })`.
 *
 * NB: the eventual canopy-chat integration (composeManifests / realAgent)
 * is a later step and is NOT wired here.
 */
import { wireSkill } from '@canopy/sdk';

import { agentsManifest } from '../manifest.js';
import { AGENT_CORES } from './cores.js';

/**
 * @param {object} args
 * @param {object} args.registry  an `@canopy/agent-registry` instance
 *   (`createAgentRegistry({ pseudoPod, deviceId })`) — the store the
 *   cores read + mutate.
 * @param {object} [args.tokens]  optional duck-typed token collaborator
 *   (see module doc) backing the P2 grant/revoke ops.
 * @returns {Array<{ id: string, handler: Function, visibility: string }>}
 */
export function buildAgentSkills({ registry, tokens } = {}) {
  if (!registry || typeof registry.list !== 'function') {
    throw new TypeError('buildAgentSkills: registry (agent-registry) with list() required');
  }
  if (tokens && (typeof tokens.issue !== 'function' || typeof tokens.revoke !== 'function')) {
    throw new TypeError('buildAgentSkills: tokens must expose issue() and revoke() when supplied');
  }

  // Single-user surface — the store is the injected pair for every ctx.
  const store = { registry, tokens: tokens ?? null };
  const storeFor = () => store;

  const op = (id) => {
    const found = agentsManifest.operations.find((o) => o.id === id);
    if (!found) throw new Error(`buildAgentSkills: no manifest op "${id}"`);
    return found;
  };

  const wire = (id, visibility) => ({
    id,
    handler:    wireSkill(AGENT_CORES[id], op(id), { storeFor }),
    visibility,
  });

  return [
    wire('listAgents',  'authenticated'),
    wire('viewAgent',   'authenticated'),
    wire('revokeAgent', 'authenticated'),
    wire('grantAgent',  'authenticated'),
    wire('revokeGrant', 'authenticated'),
    wire('purgeAgent',  'authenticated'),
  ];
}

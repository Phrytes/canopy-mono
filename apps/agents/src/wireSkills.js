/**
 * wireSkills — the WIRE route for the agents app.
 *
 * Wraps each pure core in `AGENT_CORES` with `wireSkill(coreFn, op,
 * { storeFor })` — the manifest op stays the single contract; the
 * `defineSkill`-shaped handler is DERIVED from it (same generator
 * tasks-v0 / stoop use).  `storeFor` resolves the scope store from the
 * skill context; for this single-user, read-only surface the store is
 * simply the injected `@canopy/agent-registry` instance regardless of
 * ctx.
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
 *   read cores query.
 * @returns {Array<{ id: string, handler: Function, visibility: string }>}
 */
export function buildAgentSkills({ registry } = {}) {
  if (!registry || typeof registry.list !== 'function') {
    throw new TypeError('buildAgentSkills: registry (agent-registry) with list() required');
  }

  // Single-user, read-only surface — the store is the injected registry.
  const storeFor = () => registry;

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
    wire('listAgents', 'authenticated'),
    wire('viewAgent',  'authenticated'),
  ];
}

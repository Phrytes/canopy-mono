/**
 * agents — `local ≡ wire` equivalence + route-parity fitness test
 * (Workstream B, decision #5).
 *
 * Drives the shared harness with the agents app's cores + manifest,
 * backed by a REAL `createAgentRegistry` over a minimal in-memory
 * pseudo-pod stub (a Map behind `read`/`write`):
 *   • LOCAL route — the pure core in `AGENT_CORES` called directly over
 *     the registry.
 *   • WIRE route  — the SAME core, wrapped by `wireSkill` + registered
 *     as a `defineSkill`, invoked over the serialized parts path on a
 *     real `@canopy/sdk` agent.
 *
 * RESOLUTION NOTE: `apps/agents` has no `node_modules` yet, so bare
 * `@canopy/*` imports don't resolve when this suite runs standalone.
 * The @canopy modules are therefore imported here via RELATIVE paths so
 * the test is self-contained.  `manifest.js` + `src/cores.js` are
 * import-free (no bare `@canopy/*`) and imported normally; the wire
 * defs are built inline below with the relative `wireSkill` — mirroring
 * `src/wireSkills.js`'s `buildAgentSkills` exactly (that module keeps
 * its bare `@canopy/sdk` import for eventual integration).
 */
import { describe, it, expect } from 'vitest';

// Relative @canopy imports so the suite runs without app-local node_modules.
import { createAgent, wireSkill, Parts } from '../../../packages/sdk/src/index.js';
import { describeLocalWireFitness } from '../../../packages/sdk/src/testing/localWireFitness.js';
import { createAgentRegistry } from '../../../packages/agent-registry/src/AgentRegistry.js';

// App-local, import-free modules.
import { AGENT_CORES } from '../src/cores.js';
import { agentsManifest } from '../manifest.js';

const DEVICE = 'laptop-anne';

/**
 * Deterministic seed resource (v2 agent-registry shape) — two active
 * agents + one soft-revoked, all with fixed stamps so the two routes
 * compare byte-for-byte.
 */
function seedResource() {
  return {
    v:         2,
    updatedAt: '2026-07-01T00:00:00.000Z',
    agents: [
      {
        agentId:      'laptop-anne',
        pubKey:       'pub-anne-laptop',
        webid:        'https://anne.pod/profile#me',
        agentUri:     'https://anne.pod/profile#me/agent/laptop',
        role:         'device',
        name:         'Anne (laptop)',
        deviceId:     'laptop-anne',
        capabilities: ['tasks', 'stoop'],
        grants: [
          { tokenId: 't-1', skill: 'tasks.addTask', capability: 'tasks', subject: 'circle:home', expiresAt: '2027-01-01T00:00:00.000Z' },
        ],
        signedAt:  '2026-07-01T09:00:00.000Z',
        revokedAt: null,
      },
      {
        agentId:      'phone-anne',
        pubKey:       'pub-anne-phone',
        webid:        'https://anne.pod/profile#me',
        agentUri:     'https://anne.pod/profile#me/agent/phone',
        role:         'device',
        name:         'Anne (phone)',
        deviceId:     'phone-anne',
        capabilities: ['tasks'],
        grants: [
          { tokenId: 't-2', skill: 'stoop.postRequest', capability: 'stoop', subject: null, expiresAt: null },
        ],
        signedAt:  '2026-07-01T08:00:00.000Z',
        revokedAt: null,
      },
      {
        agentId:      'old-tablet',
        pubKey:       'pub-anne-tablet',
        webid:        'https://anne.pod/profile#me',
        agentUri:     'https://anne.pod/profile#me/agent/tablet',
        role:         'device',
        name:         'Anne (old tablet)',
        deviceId:     'old-tablet',
        capabilities: ['tasks'],
        grants:       [],
        // Soft-revoked — must be OMITTED from listAgents, but still
        // resolvable via viewAgent (status: 'revoked').
        signedAt:  '2026-06-01T00:00:00.000Z',
        revokedAt: '2026-06-15T00:00:00.000Z',
      },
    ],
  };
}

/** Minimal in-memory pseudo-pod: read/write a Map of uri → resource body. */
function makePseudoPodStub() {
  const map = new Map();
  return {
    _map: map,
    async read(uri) {
      return map.has(uri) ? { bytes: map.get(uri), etag: null } : null;
    },
    async write(uri, body /*, etag */) {
      map.set(uri, body);
      return { etag: null };
    },
  };
}

/** A fresh, deterministically-seeded registry over the stub. */
function buildRegistry() {
  const pod = makePseudoPodStub();
  const registry = createAgentRegistry({ pseudoPod: pod, deviceId: DEVICE });
  pod._map.set(registry.resourceUri, seedResource());
  return registry;
}

/** LOCAL invoker: call the pure core directly over the registry. */
function makeLocalInvoker() {
  const registry = buildRegistry();
  return (op, args = {}, ctx = {}) => AGENT_CORES[op](registry, args, ctx);
}

/** Wire defs — mirrors src/wireSkills.js's buildAgentSkills (relative wireSkill). */
function buildWireDefs(registry) {
  const storeFor = () => registry;
  const op = (id) => agentsManifest.operations.find((o) => o.id === id);
  const wire = (id) => ({
    id,
    handler:    wireSkill(AGENT_CORES[id], op(id), { storeFor }),
    visibility: 'authenticated',
  });
  return [wire('listAgents'), wire('viewAgent')];
}

/** WIRE invoker: fresh real agent with the wire skills; serialized invoke. */
async function makeWireInvoker() {
  const registry = buildRegistry();
  const agent = await createAgent();
  for (const s of buildWireDefs(registry)) {
    agent.register(s.id, s.handler, { visibility: s.visibility });
  }
  return {
    invoke: async (op, args = {}) =>
      Parts.data(await agent.invoke(agent.address, op, Parts.wrap(args))),
    stop: () => agent.stop(),
  };
}

describeLocalWireFitness(
  {
    app:           'agents',
    coreIds:       Object.keys(AGENT_CORES),
    registeredIds: buildWireDefs(buildRegistry()).map((s) => s.id),
    manifestOpIds: agentsManifest.operations.map((o) => o.id),
    makeLocalInvoker,
    makeWireInvoker,
    cases: [
      {
        // Proves soft-revoke filtering: 'old-tablet' is absent (2 rows).
        name: 'listAgents (non-revoked roster)',
        run:  (invoke) => invoke('listAgents', {}),
      },
      {
        // Detail by agentId — skills derived from grants + capabilities.
        name: 'viewAgent by agentId',
        run:  (invoke) => invoke('viewAgent', { agentId: 'laptop-anne' }),
      },
      {
        // Detail by pubKey — proves pubKey resolution (not webid).
        name: 'viewAgent by pubKey',
        run:  (invoke) => invoke('viewAgent', { agentId: 'pub-anne-phone' }),
      },
      {
        // Detail of a soft-revoked agent still resolves (status: revoked).
        name: 'viewAgent of a revoked agent (status surfaced)',
        run:  (invoke) => invoke('viewAgent', { agentId: 'old-tablet' }),
      },
    ],
  },
  { describe, it, expect },
);

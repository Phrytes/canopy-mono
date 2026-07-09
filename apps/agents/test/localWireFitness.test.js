/**
 * agents — `local ≡ wire` equivalence + route-parity fitness test
 * (Workstream B, decision #5) + P2 CONTROL-op semantics.
 *
 * Drives the shared harness with the agents app's cores + manifest,
 * backed by a REAL `createAgentRegistry` over a minimal in-memory
 * pseudo-pod stub (a Map behind `read`/`write`):
 *   • LOCAL route — the pure core in `AGENT_CORES` called directly over
 *     the `{ registry, tokens }` store.
 *   • WIRE route  — the SAME core, wrapped by `wireSkill` + registered
 *     as a `defineSkill`, invoked over the serialized parts path on a
 *     real `@canopy/sdk` agent.
 *
 * The harness runs TWICE: once with a deterministic mock token
 * collaborator (the token-backed path) and once without one (the
 * honest degraded `tokenBacked: false` path).  A third, direct-core
 * describe block asserts the ORDER discipline (decision 2 — token op
 * BEFORE registry mirror), best-effort continuation, and purge
 * semantics that equivalence comparison alone can't prove.
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
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

/**
 * Deterministic mock token collaborator (the duck-typed contract the
 * wire layer later binds to `Agent.issueCapabilityToken` +
 * `TokenRegistry.revoke`).  Sequential ids + a fixed expiry so results
 * compare byte-for-byte across the two routes; records every call for
 * the direct-core assertions.
 */
function makeMockTokens() {
  let n = 0;
  const issued  = [];
  const revoked = [];
  return {
    issued,
    revoked,
    async issue({ subject, skill, expiresIn }) {
      n += 1;
      issued.push({ subject, skill, expiresIn });
      return { id: `tok-${n}`, expiresAt: '2026-12-31T00:00:00.000Z' };
    },
    async revoke(tokenId) {
      revoked.push(tokenId);
    },
  };
}

/** LOCAL invoker: call the pure core directly over the store. */
function makeLocalInvokerWith({ withTokens }) {
  return () => {
    const store = {
      registry: buildRegistry(),
      tokens:   withTokens ? makeMockTokens() : null,
    };
    return (op, args = {}, ctx = {}) => AGENT_CORES[op](store, args, ctx);
  };
}

/** Wire defs — mirrors src/wireSkills.js's buildAgentSkills (relative wireSkill). */
function buildWireDefs(registry, tokens = null) {
  const store = { registry, tokens };
  const storeFor = () => store;
  const op = (id) => agentsManifest.operations.find((o) => o.id === id);
  const wire = (id) => ({
    id,
    handler:    wireSkill(AGENT_CORES[id], op(id), { storeFor }),
    visibility: 'authenticated',
  });
  return [
    wire('listAgents'),
    wire('viewAgent'),
    wire('revokeAgent'),
    wire('grantAgent'),
    wire('revokeGrant'),
    wire('purgeAgent'),
  ];
}

/** WIRE invoker: fresh real agent with the wire skills; serialized invoke. */
function makeWireInvokerWith({ withTokens }) {
  return async () => {
    const registry = buildRegistry();
    const tokens   = withTokens ? makeMockTokens() : null;
    const agent = await createAgent();
    for (const s of buildWireDefs(registry, tokens)) {
      agent.register(s.id, s.handler, { visibility: s.visibility });
    }
    return {
      invoke: async (op, args = {}) =>
        Parts.data(await agent.invoke(agent.address, op, Parts.wrap(args))),
      stop: () => agent.stop(),
    };
  };
}

/* ── Harness run 1 — token-backed path (mock collaborator injected) ───── */
describeLocalWireFitness(
  {
    app:           'agents',
    coreIds:       Object.keys(AGENT_CORES),
    registeredIds: buildWireDefs(buildRegistry(), makeMockTokens()).map((s) => s.id),
    manifestOpIds: agentsManifest.operations.map((o) => o.id),
    makeLocalInvoker: makeLocalInvokerWith({ withTokens: true }),
    makeWireInvoker:  makeWireInvokerWith({ withTokens: true }),
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
      {
        // Grant — token issued (deterministic tok-1) + mirrored into the
        // entry; explicit capability/expiry/subject args honoured.
        name: 'grantAgent (explicit capability + expiry + subject)',
        run:  (invoke) => invoke('grantAgent', {
          agentId:       'phone-anne',
          skill:         'stoop.report',
          capability:    'stoop',
          expiresInDays: 7,
          subject:       'pub-anne-phone',
        }),
      },
      {
        // Grant with defaults — capability ← skill, subject ← the
        // entry's pubKey, expiry ← 30 days.
        name: 'grantAgent (defaults: capability=skill, subject=pubKey)',
        run:  (invoke) => invoke('grantAgent', { agentId: 'pub-anne-laptop', skill: 'folio.sync' }),
      },
      {
        // Full-agent revoke: 1 grant token revoked, entry soft-revoked,
        // read-back shows status 'revoked' + drops off the roster.
        name: 'revokeAgent (tokens revoked, then registry; off the roster)',
        run:  async (invoke) => {
          const revoked = await invoke('revokeAgent', { agentId: 'laptop-anne' });
          const roster  = await invoke('listAgents', {});
          return { revoked, roster };
        },
      },
      {
        // Single-grant revoke (adjust): grant t-2 removed + its orphaned
        // coarse capability un-mirrored from the entry.
        name: 'revokeGrant (grant removed + capability un-mirrored)',
        run:  async (invoke) => {
          const revoked = await invoke('revokeGrant', { agentId: 'phone-anne', tokenId: 't-2' });
          const view    = await invoke('viewAgent', { agentId: 'phone-anne' });
          return { revoked, view };
        },
      },
      {
        // Hard delete works on an ALREADY-REVOKED agent; read-back
        // proves the entry is gone (not merely hidden).
        name: 'purgeAgent (removes even a revoked entry)',
        run:  async (invoke) => {
          const purged = await invoke('purgeAgent', { agentId: 'old-tablet' });
          const view   = await invoke('viewAgent', { agentId: 'old-tablet' });
          return { purged, view };
        },
      },
    ],
  },
  { describe, it, expect },
);

/* ── Harness run 2 — degraded path (NO token collaborator) ─────────────
 * The control ops still keep the registry mirror honest but must say so:
 * `tokenBacked: false`, `tokensRevoked: 0`.  The synthetic `local-…`
 * tokenId + wall-clock expiry are per-route volatile → stripped.
 */
describeLocalWireFitness(
  {
    app:           'agents (no token collaborator — degraded, honest)',
    coreIds:       Object.keys(AGENT_CORES),
    registeredIds: buildWireDefs(buildRegistry()).map((s) => s.id),
    manifestOpIds: agentsManifest.operations.map((o) => o.id),
    makeLocalInvoker: makeLocalInvokerWith({ withTokens: false }),
    makeWireInvoker:  makeWireInvokerWith({ withTokens: false }),
    cases: [
      {
        name: 'revokeAgent without tokens → tokenBacked false, still revoked',
        run:  async (invoke) => {
          const revoked = await invoke('revokeAgent', { agentId: 'laptop-anne' });
          const roster  = await invoke('listAgents', {});
          return { revoked, roster };
        },
      },
      {
        name:     'grantAgent without tokens → tokenBacked false, mirror still written',
        // Synthetic tokenId + Date.now()-derived expiry differ per route.
        volatile: ['tokenId', 'expiresAt'],
        run:  (invoke) => invoke('grantAgent', { agentId: 'phone-anne', skill: 'tasks.listTasks' }),
      },
    ],
  },
  { describe, it, expect },
);

/* ── Direct-core semantics — what equivalence alone can't prove ──────── */
describe('agents — P2 control-op semantics (direct core)', () => {
  it('grantAgent: token issued BEFORE the registry mirror (order discipline)', async () => {
    const registry = buildRegistry();
    const tokens   = makeMockTokens();
    const events   = [];
    const issueOrig = tokens.issue.bind(tokens);
    tokens.issue = async (a) => { events.push('tokens.issue'); return issueOrig(a); };
    const applyOrig = registry.applyGrant;
    const spied = {
      ...registry,
      applyGrant: async (...a) => { events.push('registry.applyGrant'); return applyOrig(...a); },
    };

    const res = await AGENT_CORES.grantAgent(
      { registry: spied, tokens },
      { agentId: 'phone-anne', skill: 'stoop.report' },
    );

    expect(events).toEqual(['tokens.issue', 'registry.applyGrant']);
    expect(res.granted).toBe(true);
    expect(res.tokenBacked).toBe(true);
    expect(res.tokenId).toBe('tok-1');
    // Defaults honoured on the token side: subject ← pubKey, 30 days.
    expect(tokens.issued).toEqual([
      { subject: 'pub-anne-phone', skill: 'stoop.report', expiresIn: 30 * MS_PER_DAY },
    ]);
    // Mirror matches the issued token (read-back in the result).
    expect(res.agent.grantSummary.tokens).toContainEqual({
      tokenId:    'tok-1',
      skill:      'stoop.report',
      capability: 'stoop.report',        // capability defaults to skill
      subject:    'pub-anne-phone',
      expiresAt:  '2026-12-31T00:00:00.000Z',
    });
    expect(res.agent.skills).toContain('stoop.report');
  });

  it('grantAgent: a token-issue failure propagates and the mirror is untouched', async () => {
    const registry = buildRegistry();
    const tokens = {
      async issue() { throw new Error('issuer offline'); },
      async revoke() {},
    };

    await expect(
      AGENT_CORES.grantAgent({ registry, tokens }, { agentId: 'phone-anne', skill: 'stoop.report' }),
    ).rejects.toThrow('issuer offline');

    // Never mirror a grant whose token doesn't exist.
    const entry = await registry.lookup('phone-anne');
    expect(entry.grants.map((g) => g.tokenId)).toEqual(['t-2']);
  });

  it('revokeAgent: revokes each grant token FIRST (best-effort), then the registry', async () => {
    const registry = buildRegistry();
    // Give laptop-anne a second grant so best-effort continuation shows.
    await registry.applyGrant('laptop-anne', { tokenId: 't-9', skill: 'folio.sync', capability: 'folio' });

    const events = [];
    const tokens = {
      async issue() { throw new Error('unused'); },
      async revoke(tokenId) {
        events.push(`tokens.revoke:${tokenId}`);
        if (tokenId === 't-1') throw new Error('token store hiccup');   // individual failure
      },
    };
    const revokeOrig = registry.revoke;
    const spied = {
      ...registry,
      revoke: async (...a) => { events.push('registry.revoke'); return revokeOrig(...a); },
    };

    const res = await AGENT_CORES.revokeAgent({ registry: spied, tokens }, { agentId: 'laptop-anne' });

    // Both tokens attempted BEFORE the registry revoke; the t-1 failure
    // doesn't stop t-9 nor the registry side.
    expect(events).toEqual(['tokens.revoke:t-1', 'tokens.revoke:t-9', 'registry.revoke']);
    expect(res).toMatchObject({ revoked: true, tokensRevoked: 1, tokenBacked: true });
    expect(res.agent.status).toBe('revoked');
    // Gone from the roster, still resolvable in detail.
    const roster = await AGENT_CORES.listAgents({ registry });
    expect(roster.agents.map((a) => a.agentId)).toEqual(['phone-anne']);
  });

  it('revokeAgent without tokens: honest degraded result, registry still revoked', async () => {
    const registry = buildRegistry();
    const res = await AGENT_CORES.revokeAgent({ registry }, { agentId: 'pub-anne-laptop' });
    expect(res).toMatchObject({ revoked: true, tokensRevoked: 0, tokenBacked: false });
    expect(res.agent.status).toBe('revoked');
  });

  it('revokeAgent: unknown id → revoked false, nothing touched', async () => {
    const registry = buildRegistry();
    const tokens = makeMockTokens();
    const res = await AGENT_CORES.revokeAgent({ registry, tokens }, { agentId: 'nope' });
    expect(res).toEqual({ revoked: false, tokensRevoked: 0, tokenBacked: true, agent: null });
    expect(tokens.revoked).toEqual([]);
  });

  it('revokeGrant: token revoked, then grant un-mirrored (orphaned capability dropped)', async () => {
    const registry = buildRegistry();
    const tokens = makeMockTokens();

    const res = await AGENT_CORES.revokeGrant({ registry, tokens }, { agentId: 'phone-anne', tokenId: 't-2' });

    expect(tokens.revoked).toEqual(['t-2']);
    expect(res.revoked).toBe(true);
    expect(res.tokenBacked).toBe(true);
    // Grant gone; 'stoop' was only referenced by t-2 → un-mirrored too
    // ('tasks' was never grant-backed and stays).
    expect(res.agent.grantSummary.total).toBe(0);
    expect(res.agent.skills).toEqual(['tasks']);
  });

  it('revokeGrant: a token-revoke failure propagates and the grant stays mirrored', async () => {
    const registry = buildRegistry();
    const tokens = {
      async issue() { throw new Error('unused'); },
      async revoke() { throw new Error('token store down'); },
    };

    await expect(
      AGENT_CORES.revokeGrant({ registry, tokens }, { agentId: 'phone-anne', tokenId: 't-2' }),
    ).rejects.toThrow('token store down');

    // Never un-mirror a still-live token (the UI must not under-claim).
    const entry = await registry.lookup('phone-anne');
    expect(entry.grants.map((g) => g.tokenId)).toEqual(['t-2']);
  });

  it('revokeGrant: unknown tokenId → revoked false, token side untouched', async () => {
    const registry = buildRegistry();
    const tokens = makeMockTokens();
    const res = await AGENT_CORES.revokeGrant({ registry, tokens }, { agentId: 'phone-anne', tokenId: 't-404' });
    expect(res.revoked).toBe(false);
    expect(tokens.revoked).toEqual([]);
    expect(res.agent.grantSummary.total).toBe(1);   // grant still there
  });

  it('purgeAgent: hard-deletes even an already-revoked entry; idempotent on a miss', async () => {
    const registry = buildRegistry();

    const first = await AGENT_CORES.purgeAgent({ registry }, { agentId: 'old-tablet' });
    expect(first).toEqual({ purged: true, tokensRevoked: 0, tokenBacked: false, agent: null });   // read-back proves it's gone
    expect(await registry.lookup('old-tablet')).toBeNull();
    expect((await registry.list()).map((a) => a.agentId)).toEqual(['laptop-anne', 'phone-anne']);

    const again = await AGENT_CORES.purgeAgent({ registry }, { agentId: 'old-tablet' });
    expect(again).toEqual({ purged: false, tokensRevoked: 0, tokenBacked: false, agent: null });
  });

  it('purgeAgent sweeps live grant tokens BEFORE erasing the entry (no invisible authority)', async () => {
    const registry = buildRegistry();
    const tokens = makeMockTokens();
    // Give the agent a live token-backed grant, then purge WITHOUT revoking first.
    await AGENT_CORES.grantAgent({ registry, tokens }, { agentId: 'old-tablet', skill: 'bot.*' });
    const granted = await registry.lookup('old-tablet');
    const liveTokenId = granted.grants[granted.grants.length - 1].tokenId;

    const res = await AGENT_CORES.purgeAgent({ registry, tokens }, { agentId: 'old-tablet' });
    expect(tokens.revoked).toContain(liveTokenId);   // enforced authority died first
    expect(res).toMatchObject({ purged: true, tokenBacked: true, agent: null });
    expect(res.tokensRevoked).toBeGreaterThanOrEqual(1);
    expect(await registry.lookup('old-tablet')).toBeNull();
  });

  it('purgeAgent: resolves by pubKey too (never webid)', async () => {
    const registry = buildRegistry();
    const byPubKey = await AGENT_CORES.purgeAgent({ registry }, { agentId: 'pub-anne-phone' });
    expect(byPubKey.purged).toBe(true);
    // webid must NOT resolve (it matches several entries by design).
    const byWebid = await AGENT_CORES.purgeAgent({ registry }, { agentId: 'https://anne.pod/profile#me' });
    expect(byWebid).toEqual({ purged: false, tokensRevoked: 0, tokenBacked: false, agent: null });
  });

  it('backward compat: a bare registry still works as the store (read ops)', async () => {
    const registry = buildRegistry();
    const roster = await AGENT_CORES.listAgents(registry);
    expect(roster.agents).toHaveLength(2);
    const view = await AGENT_CORES.viewAgent(registry, { agentId: 'laptop-anne' });
    expect(view.agent.agentId).toBe('laptop-anne');
    // Control ops accept it too — degraded (no tokens by definition).
    const res = await AGENT_CORES.revokeAgent(registry, { agentId: 'laptop-anne' });
    expect(res).toMatchObject({ revoked: true, tokenBacked: false });
  });
});

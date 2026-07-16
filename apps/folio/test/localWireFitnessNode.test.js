/**
 * folio — `local ≡ wire` equivalence + route-parity fitness test for the NODE
 * ops (Slice 1c; the node sibling of `test/localWireFitness.test.js`).
 *
 * Drives the shared `describeLocalWireFitness` harness with folio's extracted
 * pure NODE cores (`FOLIO_NODE_CORES`) + the folioManifest:
 *   • LOCAL route — the pure core called directly over an injected store whose
 *     `engine` is a deterministic fake SyncEngine.
 *   • WIRE route  — the SAME core, wireSkill-wrapped + registered on a REAL
 *     `@onderling/core` agent, invoked over the serialized parts path.
 *
 * The parity check is the ANTI-DRIFT guarantee: every `runtime:'node'`
 * folioManifest op must have a core AND a wire registration, and every node
 * core must map to such an op — a manifest node op with no core (or vice-versa)
 * fails CI.  `buildFolioNodeSkills` additionally THROWS if a node manifest op
 * has no core (the reverse direction).
 *
 * RESOLUTION: same self-contained pattern as the browser fitness suite — the
 * sdk helper is relative-imported from `packages/sdk/src`, the wire agent is
 * built from `@onderling/core` primitives folio DOES resolve.
 */
import { describe, it, expect } from 'vitest';

import {
  Agent, AgentIdentity, InternalBus, InternalTransport, Parts,
} from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { describeLocalWireFitness } from '../../../packages/sdk/src/testing/localWireFitness.js';

import { FOLIO_NODE_CORES } from '../src/nodeAgentCores.js';
import { buildFolioNodeSkills } from '../src/wireSkillsNode.js';
import { folioManifest } from '../manifest.js';

/**
 * A deterministic fake SyncEngine — records calls + returns fixed stats so the
 * two routes compare byte-for-byte.  Exposes exactly the method surface the
 * node cores reach (the SAME methods `src/server/routes.js` calls): runOnce,
 * start, stop, forcePush, deleteLocal + the `__watching` intent flag.
 */
function makeFakeEngine() {
  const calls = [];
  return {
    __watching: false,
    calls,
    async runOnce(opts) {
      calls.push(['runOnce', opts]);
      return { uploads: 2, downloads: 1, deletes: 0, conflicts: 0 };
    },
    start() { calls.push(['start']); },
    async stop() { calls.push(['stop']); },
    async forcePush() {
      calls.push(['forcePush']);
      return { uploads: 3, errors: 0 };
    },
    async deleteLocal(relPath) { calls.push(['deleteLocal', relPath]); },
  };
}

/** A fresh node folio store — just the fake engine, mirroring the real shape. */
function makeStore() {
  return { engine: makeFakeEngine() };
}

/** LOCAL invoker: call the pure node core directly over a fresh store. */
function makeLocalInvoker() {
  const store = makeStore();
  return async (op, args = {}, ctx = {}) => FOLIO_NODE_CORES[op](store, args, ctx);
}

/** WIRE invoker: a real @onderling/core agent with the node wire skills. */
async function makeWireInvoker() {
  const store = makeStore();
  const bus = new InternalBus();

  const hostId = await AgentIdentity.generate(new VaultMemory());
  const host = new Agent({ identity: hostId, transport: new InternalTransport(bus, hostId.pubKey) });
  for (const s of buildFolioNodeSkills({ store })) host.register(s.id, s.handler);
  await host.start();

  const peerId = await AgentIdentity.generate(new VaultMemory());
  const peer = new Agent({ identity: peerId, transport: new InternalTransport(bus, peerId.pubKey) });
  await peer.start();
  await peer.hello(host.address);

  return {
    invoke: async (op, args = {}) => {
      const res = await peer.invoke(host.address, op, Parts.wrap(args));
      return res?.[0]?.data;
    },
    stop: async () => { await peer.close?.(); await host.close?.(); },
  };
}

describeLocalWireFitness(
  {
    app:           'folio (node ops)',
    coreIds:       Object.keys(FOLIO_NODE_CORES),
    registeredIds: buildFolioNodeSkills({ store: makeStore() }).map((s) => s.id),
    manifestOpIds: folioManifest.operations.map((o) => o.id),
    makeLocalInvoker,
    makeWireInvoker,
    cases: [
      { name: 'syncOnce (returns engine stats)',        run: (invoke) => invoke('syncOnce', {}) },
      { name: 'watchStart (idempotent → watching:true)', run: (invoke) => invoke('watchStart', {}) },
      { name: 'watchStop (from stopped → watching:false)', run: (invoke) => invoke('watchStop', {}) },
      { name: 'forceRepush (returns uploads/errors)',   run: (invoke) => invoke('forceRepush', {}) },
      { name: 'deleteLocally (hit — ok + relPath)',     run: (invoke) => invoke('deleteLocally', { relPath: 'notes/today.md' }) },
      { name: 'deleteLocally (empty relPath → soft ok:false)', run: (invoke) => invoke('deleteLocally', { relPath: '' }) },
    ],
  },
  { describe, it, expect },
);

// ── Focused unit tests: behaviour over the fake engine + boundary misses ────
describe('folio node cores — engine wiring + boundary misses', () => {
  it('syncOnce calls engine.runOnce({direction:"both"}) and returns its stats', async () => {
    const store = makeStore();
    const r = await FOLIO_NODE_CORES.syncOnce(store, {});
    expect(r).toEqual({ ok: true, uploads: 2, downloads: 1, deletes: 0, conflicts: 0 });
    expect(store.engine.calls).toEqual([['runOnce', { direction: 'both' }]]);
  });

  it('watchStart starts the engine once + sets the __watching intent flag', () => {
    const store = makeStore();
    expect(FOLIO_NODE_CORES.watchStart(store, {})).toEqual({ ok: true, watching: true });
    expect(store.engine.__watching).toBe(true);
    // idempotent — a second call does NOT re-start the engine.
    expect(FOLIO_NODE_CORES.watchStart(store, {})).toEqual({ ok: true, watching: true });
    expect(store.engine.calls).toEqual([['start']]);
  });

  it('watchStop stops only when watching, and clears the intent flag', async () => {
    const store = makeStore();
    // not watching → no engine.stop()
    expect(await FOLIO_NODE_CORES.watchStop(store, {})).toEqual({ ok: true, watching: false });
    expect(store.engine.calls).toEqual([]);
    // now start then stop
    FOLIO_NODE_CORES.watchStart(store, {});
    await FOLIO_NODE_CORES.watchStop(store, {});
    expect(store.engine.__watching).toBe(false);
    expect(store.engine.calls).toEqual([['start'], ['stop']]);
  });

  it('forceRepush calls engine.forcePush() and returns its result', async () => {
    const store = makeStore();
    const r = await FOLIO_NODE_CORES.forceRepush(store, {});
    expect(r).toEqual({ ok: true, uploads: 3, errors: 0 });
    expect(store.engine.calls).toEqual([['forcePush']]);
  });

  it('deleteLocally forwards relPath to engine.deleteLocal', async () => {
    const store = makeStore();
    const r = await FOLIO_NODE_CORES.deleteLocally(store, { relPath: 'notes/x.md' });
    expect(r).toEqual({ ok: true, relPath: 'notes/x.md' });
    expect(store.engine.calls).toEqual([['deleteLocal', 'notes/x.md']]);
  });

  it('deleteLocally with empty relPath is a soft failure — no engine call', async () => {
    const store = makeStore();
    const r = await FOLIO_NODE_CORES.deleteLocally(store, { relPath: '' });
    expect(r.ok).toBe(false);
    expect(store.engine.calls).toEqual([]);
  });

  it('honest boundary miss when no engine is in reach', async () => {
    for (const op of ['syncOnce', 'watchStop', 'forceRepush']) {
      const r = await FOLIO_NODE_CORES[op]({}, {});
      expect(r.ok).toBe(false);
      expect(typeof r.error).toBe('string');
    }
    expect(FOLIO_NODE_CORES.watchStart({}, {}).ok).toBe(false);
  });
});

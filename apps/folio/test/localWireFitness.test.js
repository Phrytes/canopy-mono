/**
 * folio — `local ≡ wire` equivalence + route-parity fitness test
 * (Slice 1b, PLAN-folio-as-file-agent.md; the `apps/agents/test/
 * localWireFitness.test.js` shape).
 *
 * Drives the shared `describeLocalWireFitness` harness with folio's
 * extracted pure cores (`FOLIO_CORES`) + the folioManifest:
 *   • LOCAL route — the pure core called directly over the injected store.
 *   • WIRE route  — the SAME core, wireSkill-wrapped + registered on a REAL
 *     `@canopy/core` agent, invoked over the serialized parts path.
 *
 * The parity check is the ANTI-DRIFT guarantee: every `runtime:'browser'`
 * folioManifest op must have a core AND a wire registration, and every core
 * must map to such an op — a manifest op with no core (or vice-versa) fails
 * CI.
 *
 * RESOLUTION: the @canopy skill helpers are imported by RELATIVE path from
 * `packages/sdk/src` (folio's isolated node_modules has no `@canopy/sdk`) —
 * the same self-contained pattern the agents suite uses.  The wire agent is
 * built from `@canopy/core` primitives (which folio DOES resolve), so the
 * suite needs no sdk barrel at all.
 */
import { describe, it, expect } from 'vitest';

import {
  Agent, AgentIdentity, InternalBus, InternalTransport, Parts,
} from '@canopy/core';
import { VaultMemory } from '@canopy/vault';

// Relative sdk-source import — mirrors src/wireSkills.js's rationale.
import { describeLocalWireFitness } from '../../../packages/sdk/src/testing/localWireFitness.js';

import { FOLIO_CORES } from '../src/agentCores.js';
import { buildFolioSkills } from '../src/wireSkills.js';
import { folioManifest } from '../manifest.js';
import { buildFolioNoteSearch, indexFolioNotes, searchFolioNotes } from '../src/folioSearch.js';

/** Deterministic seed files (fixed stamps → the two routes compare byte-for-byte). */
const SEED = [
  { id: '/notes/recipes.md', name: 'recipes.md', type: 'file', mime: 'text/markdown', bytes: 5678, state: 'synced' },
  {
    id: '/notes/shared/anne.md', name: 'anne.md', type: 'file', mime: 'text/markdown',
    bytes: 1234, state: 'synced',
    frontmatter: { embeds: [{ type: 'task', ref: 't-anne', label: 'Anne onboarding' }] },
  },
  { id: '/docs/lease.pdf', name: 'lease.pdf', type: 'file', mime: 'application/pdf', bytes: 102400, state: 'synced' },
];

/**
 * A fresh, deterministic folio backend store — the same object shape
 * `createBrowserFolioAgent` threads, but with a MOCK `mintShareToken`
 * (fixed record → deterministic share reply) and a lexical-only note index
 * (no embedder).  No pod source attached (so `listFiles({source:'pod'})`
 * flags `needsPod`).
 */
function makeStore() {
  const files = SEED.map((f) => ({ ...f }));
  let noteSearch = null;
  async function ensureNoteSearch() {
    if (!noteSearch) noteSearch = buildFolioNoteSearch({ embedder: undefined });
    await indexFolioNotes(noteSearch, files);
    return noteSearch;
  }
  return {
    files,
    identity: { pubKey: 'pub-folio-test' },
    podRoot:  'https://alice.example.com/',
    mintShareToken: async (_identity, { webid, sharePath, podRoot }) => ({
      webid,
      sharePath,
      podUri:    `${podRoot.replace(/\/$/, '')}/${sharePath.replace(/^\//, '')}`,
      mode:      'cap-token',
      issuer:    'did:folio:test',
      issuedAt:  '2026-07-10T00:00:00.000Z',
      expiresAt: '2027-07-10T00:00:00.000Z',
      token:     '{"fake":"token"}',
    }),
    simulateSync: () => ({
      plannedPaths: [], durationMs: 0, bytesPushed: 0, bytesPulled: 0, conflictCount: 0, queueDepth: 0,
    }),
    listPodFolio: async () => [],
    getPodSource: () => null,
    ensureNoteSearch,
    searchFolioNotes,
  };
}

/** LOCAL invoker: call the pure core directly over a fresh store. */
function makeLocalInvoker() {
  const store = makeStore();
  return async (op, args = {}, ctx = {}) => FOLIO_CORES[op](store, args, ctx);
}

/** WIRE invoker: a real @canopy/core agent with the wire skills; serialized invoke. */
async function makeWireInvoker() {
  const store = makeStore();
  const bus = new InternalBus();

  const hostId = await AgentIdentity.generate(new VaultMemory());
  const host = new Agent({ identity: hostId, transport: new InternalTransport(bus, hostId.pubKey) });
  for (const s of buildFolioSkills({ store })) host.register(s.id, s.handler);
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
    app:           'folio',
    coreIds:       Object.keys(FOLIO_CORES),
    registeredIds: buildFolioSkills({ store: makeStore() }).map((s) => s.id),
    manifestOpIds: folioManifest.operations.map((o) => o.id),
    makeLocalInvoker,
    makeWireInvoker,
    cases: [
      { name: 'readNote (hit — metadata + embeds)',  run: (invoke) => invoke('readNote', { path: '/notes/shared/anne.md' }) },
      { name: 'readNote (miss — ok:false)',          run: (invoke) => invoke('readNote', { path: '/nope.md' }) },
      {
        name: 'shareFolder (real-shaped record)',
        run:  (invoke) => invoke('shareFolder', { folder: '/notes', with: 'https://bob.example/card#me' }),
      },
      { name: 'shareFolder (empty folder → soft ok:false)', run: (invoke) => invoke('shareFolder', { folder: '', with: '' }) },
      { name: 'listFiles (in-process index)',        run: (invoke) => invoke('listFiles', {}) },
      { name: 'listFiles source:pod (needsPod)',     run: (invoke) => invoke('listFiles', { source: 'pod' }) },
      { name: 'searchNotes (lexical ranking)',       run: (invoke) => invoke('searchNotes', { query: 'recipes' }) },
      { name: 'getFileSnapshot',                     run: (invoke) => invoke('getFileSnapshot', { path: '/notes/recipes.md' }) },
      { name: 'verifyPodState (hit)',                run: (invoke) => invoke('verifyPodState', { relPath: '/docs/lease.pdf' }) },
      { name: 'verifyPodState (miss)',               run: (invoke) => invoke('verifyPodState', { relPath: '/nope.md' }) },
      { name: 'deleteFromPod (splices the index)',   run: (invoke) => invoke('deleteFromPod', { relPath: '/notes/recipes.md' }) },
      { name: 'downloadFile',                        run: (invoke) => invoke('downloadFile', { path: '/docs/lease.pdf' }) },
      { name: 'saveToMyPod',                         run: (invoke) => invoke('saveToMyPod', { name: 'shared.md' }) },
      { name: 'folioStatus (aggregate counts)',      run: (invoke) => invoke('folioStatus', {}) },
    ],
  },
  { describe, it, expect },
);

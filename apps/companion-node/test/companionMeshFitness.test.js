/**
 * companion-node R1 — the FITNESS / ACCEPTANCE test.
 *
 * Proves R1's whole thesis: a SEPARATE device agent, over the REAL mesh,
 * invokes the remotely-hosted folio agent and gets REAL pod content back —
 * i.e. the full cross-process path
 *
 *     device → relay → host agent → folio core → pod source → back
 *
 * is exercised end-to-end with NOTHING on the wire stubbed:
 *   - REAL relay          — booted in-process by `startCompanionNode` (@canopy/relay)
 *   - REAL transport      — `RelayTransport` on BOTH agents (not InternalTransport;
 *                           the callSkill in-process fast-path is bypassed, so this
 *                           is the genuine encrypt → relay-forward → decrypt wire path)
 *   - REAL discovery      — the device runs a REAL `createAgentRegistry` over the
 *                           shared registry resource and lists the host's pubKey +
 *                           advertised capabilities (no hard-coded host address)
 *   - REAL handshake      — `deviceAgent.hello(hostPubKey)` (the production hello,
 *                           not a manual key injection)
 *   - REAL skills         — `buildFolioSkills` → `wireSkill` → folio's pure cores
 *   - REAL pod round-trip — `listFiles({source:'pod'})` walks a genuine pod
 *                           container via `listPodFolio` (a file that lives ONLY in
 *                           the pod backend, never in the in-process seed index)
 *
 * The two in-process agents share one relay + one registry Map — the honest
 * hermetic analog of two processes on a shared relay + a shared pod resource
 * (a true two-process test is impractical in vitest; every substrate here is
 * real per the plan's acceptance criteria).
 */
import { describe, it, expect, afterAll } from 'vitest';

import { Agent, AgentIdentity, Parts }    from '@canopy/core';
import { VaultMemory }                     from '@canopy/vault';
import { RelayTransport }                  from '@canopy/transports';
import { createAgentRegistry }             from '@canopy/agent-registry';

import { startCompanionNode }              from '../src/index.js';

describe('companion-node R1 — cross-process folio mesh over a real relay', () => {
  /** @type {Awaited<ReturnType<typeof startCompanionNode>>} */
  let host;
  /** @type {Agent} */
  let deviceAgent;

  afterAll(async () => {
    try { await deviceAgent?.stop?.(); } catch { /* best-effort */ }
    try { await host?.stop(); } catch { /* best-effort */ }
  });

  it('a device discovers the host via the registry and invokes real pod-file skills over the wire', async () => {
    // ── Boot the host (in-process local relay + real RelayTransport + registry) ──
    // identityVault: VaultMemory keeps the test hermetic (no on-disk keypair).
    host = await startCompanionNode({ identityVault: new VaultMemory() });
    expect(host.relayUrl).toMatch(/^ws:\/\//);

    // ── A SEPARATE device agent — its own identity, SAME relay, real transport ──
    const devId = await AgentIdentity.generate(new VaultMemory());
    deviceAgent = new Agent({
      identity:  devId,
      transport: new RelayTransport({ relayUrl: host.relayUrl, identity: devId }),
      label:     'device',
    });
    await deviceAgent.start();

    // ── REAL registry discovery: read the shared agent-registry resource ──
    const registry = createAgentRegistry({ pseudoPod: host.pseudoPod, deviceId: host.deviceId });
    const roster   = await registry.list();
    const hostEntry = roster.find((a) => a.role === 'service' && a.name === 'folio');

    expect(hostEntry, 'host self-registered as a folio service').toBeDefined();
    expect(hostEntry.pubKey).toBe(host.agent.address);
    // Advertises ONLY the relocatable browser subset (node ops stay local).
    for (const cap of ['listFiles', 'readNote', 'searchNotes']) {
      expect(hostEntry.capabilities).toContain(cap);
    }
    const hostPubKey = hostEntry.pubKey;

    // ── REAL bidirectional hello handshake (the production discovery path) ──
    await deviceAgent.hello(hostPubKey);

    // 1) listFiles (in-process index) — device → relay → host → folio core → store
    const listed = Parts.data(await deviceAgent.invoke(hostPubKey, 'listFiles', {}));
    expect(listed.source).toBe('index');
    const listedIds = listed.items.map((f) => f.id);
    expect(listedIds).toContain('/notes/recipes.md');
    expect(listedIds).toContain('/notes/shared/anne.md');

    // 2) readNote — real known content served by the host's relocated folio core
    const note = Parts.data(await deviceAgent.invoke(hostPubKey, 'readNote', { path: '/notes/recipes.md' }));
    expect(note.message).toMatch(/recipes\.md/);

    // 3) listFiles source:'pod' — the REAL pod leg (walks a genuine pod container).
    //    The pod-only note exists ONLY in the pod backend, proving the request
    //    actually traversed device → relay → host → folio core → podClient.list.
    const podList = Parts.data(await deviceAgent.invoke(hostPubKey, 'listFiles', { source: 'pod' }));
    expect(podList.source).toBe('pod');
    const podNames = podList.items.map((i) => i.name);
    expect(podNames).toContain('pod-only-note.md');
    // …and that file is NOT in the in-process seed index (so it can only have
    // come back through the pod source, not the index).
    expect(listed.items.map((f) => f.name)).not.toContain('pod-only-note.md');

    // 4) searchNotes — real lexical @canopy/pod-search index over the note corpus
    const search = Parts.data(await deviceAgent.invoke(hostPubKey, 'searchNotes', { query: 'anne' }));
    expect(Array.isArray(search.items)).toBe(true);
    expect(search.mode).toBe('lexical');
  }, 20_000);
});

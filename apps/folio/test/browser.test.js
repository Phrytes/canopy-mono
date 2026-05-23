/**
 * folio/browser — slice-4 composition smoke test.
 *
 * Verifies the web-only browser entry boots a real `@canopy/core`
 * Agent on a shared InternalBus, registers the chat-web subset of
 * folio skills, and that shareFolder issues a REAL
 * PodCapabilityToken (the bit that distinguishes slice 4 from the
 * mock-real handlers it replaces).
 */
import { describe, it, expect } from 'vitest';

import {
  AgentIdentity, InternalBus, InternalTransport, Agent, DataPart,
  PodCapabilityToken, VaultMemory,
} from '@canopy/core';

import { createBrowserFolioAgent } from '../src/browser.js';

/** Build a small invoking peer on the same bus to exercise the folio agent. */
async function makePeer(bus) {
  const vault    = new VaultMemory();
  const identity = await AgentIdentity.generate(vault);
  const agent = new Agent({
    identity,
    transport: new InternalTransport(bus, identity.pubKey),
  });
  await agent.start();
  return { agent, identity };
}

describe('createBrowserFolioAgent — boot + skill dispatch', () => {
  it('boots on a shared bus and serves listFiles with seed files', async () => {
    const bus = new InternalBus();
    const folio = await createBrowserFolioAgent({
      bus, identityVault: new VaultMemory(), label: 'TestFolio',
    });
    const { agent: peer } = await makePeer(bus);
    await peer.hello(folio.address);

    const result = await peer.invoke(folio.address, 'listFiles', [DataPart({})]);
    const data = result?.[0]?.data;
    expect(data.items.length).toBe(3);
    expect(data.items.map((f) => f.name).sort()).toEqual([
      'anne.md', 'lease.pdf', 'recipes.md',
    ]);
  });

  it('shareFolder issues a real PodCapabilityToken (not a placeholder)', async () => {
    const bus = new InternalBus();
    const folio = await createBrowserFolioAgent({
      bus, identityVault: new VaultMemory(),
      podRoot: 'https://alice.example.com/',
    });
    const { agent: peer } = await makePeer(bus);
    await peer.hello(folio.address);

    const result = await peer.invoke(folio.address, 'shareFolder', [DataPart({
      folder: '/notes',
      with:   'https://bob.example/profile/card#me',
    })]);
    const data = result?.[0]?.data;
    expect(data.ok).toBe(true);
    expect(data.share.mode).toBe('cap-token');
    expect(data.share.token).toBeTruthy();
    // Round-trip the token JSON through PodCapabilityToken.fromJSON to
    // prove it's a real, parseable token (not a fake stub).
    const token = await PodCapabilityToken.fromJSON(data.share.token);
    expect(token.subject).toBe('https://bob.example/profile/card#me');
    expect(token.scopes.some((s) => s.startsWith('pod.read:'))).toBe(true);
    expect(token.scopes.some((s) => s.startsWith('pod.write:'))).toBe(true);
  });

  it('shareFolder errors clearly without folder / with args', async () => {
    const bus = new InternalBus();
    const folio = await createBrowserFolioAgent({
      bus, identityVault: new VaultMemory(),
    });
    const { agent: peer } = await makePeer(bus);
    await peer.hello(folio.address);

    const r1 = await peer.invoke(folio.address, 'shareFolder', [DataPart({})]);
    expect(r1?.[0]?.data.ok).toBe(false);
    expect(r1?.[0]?.data.error).toMatch(/folder/);
  });

  it('getFileSnapshot + readNote return chat-shell-shaped replies', async () => {
    const bus = new InternalBus();
    const folio = await createBrowserFolioAgent({
      bus, identityVault: new VaultMemory(),
    });
    const { agent: peer } = await makePeer(bus);
    await peer.hello(folio.address);

    const snap = await peer.invoke(folio.address, 'getFileSnapshot',
      [DataPart({ path: '/notes/recipes.md' })]);
    expect(snap?.[0]?.data).toMatchObject({
      id: '/notes/recipes.md', type: 'file', name: 'recipes.md',
    });

    const read = await peer.invoke(folio.address, 'readNote',
      [DataPart({ path: '/notes/recipes.md' })]);
    expect(read?.[0]?.data.message).toMatch(/recipes\.md/);
  });

  it('folioStatus + folio_briefSummary surface aggregate counts', async () => {
    const bus = new InternalBus();
    const folio = await createBrowserFolioAgent({
      bus, identityVault: new VaultMemory(),
    });
    const { agent: peer } = await makePeer(bus);
    await peer.hello(folio.address);

    const status = await peer.invoke(folio.address, 'folioStatus', [DataPart({})]);
    expect(status?.[0]?.data).toMatchObject({
      fileCount:   3,
      syncedCount: 3,
      conflictCount: 0,
    });

    const brief = await peer.invoke(folio.address, 'folio_briefSummary', [DataPart({})]);
    expect(brief?.[0]?.data.count).toBe(3);
  });

  it('seedFiles:[] yields empty index', async () => {
    const bus = new InternalBus();
    const folio = await createBrowserFolioAgent({
      bus, identityVault: new VaultMemory(), seedFiles: [],
    });
    const { agent: peer } = await makePeer(bus);
    await peer.hello(folio.address);

    const r = await peer.invoke(folio.address, 'listFiles', [DataPart({})]);
    expect(r?.[0]?.data.items).toEqual([]);
  });
});

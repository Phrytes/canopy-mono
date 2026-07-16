/**
 * addBot — get a bot into the app PeerGraph (feedback-extension P5).
 * Drives a real @onderling/core PeerGraph + a fake discover (no network).
 */
import { describe, it, expect, vi } from 'vitest';

import { PeerGraph } from '@onderling/core';
import { addBotToGraph } from '../src/v2/addBot.js';
import { listContacts } from '../src/v2/contactsSource.js';

describe('addBotToGraph', () => {
  it('an https URL reuses discoverA2A (upserts the discovered bot)', async () => {
    const peers = new PeerGraph();
    const discover = vi.fn(async (agent, url, { peerGraph }) => {
      const rec = { type: 'a2a', url, name: 'Feedback bot', skills: [{ id: 'summarise' }], reachable: true };
      await peerGraph.upsert(rec);
      return rec;
    });
    const coreAgent = { id: 'core' };

    const rec = await addBotToGraph({ input: 'https://bot.example', peerGraph: peers, coreAgent, discover });
    expect(discover).toHaveBeenCalledWith(coreAgent, 'https://bot.example', { peerGraph: peers });
    expect(rec.name).toBe('Feedback bot');

    const rows = await listContacts(peers);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Feedback bot', isBot: true, skillCount: 1 });
  });

  it('a raw peer address upserts a hybrid bot (peer-only, no HTTP card)', async () => {
    const peers = new PeerGraph();
    const rec = await addBotToGraph({ input: 'NKNADDR123|Feedback bot', peerGraph: peers });
    expect(rec).toMatchObject({ type: 'hybrid', pubKey: 'NKNADDR123', name: 'Feedback bot' });
    const rows = await listContacts(peers);
    expect(rows[0]).toMatchObject({ contactId: 'NKNADDR123', name: 'Feedback bot', isBot: true, peerAddr: 'NKNADDR123' });
  });

  it('a bare address with no name uses the address as the name', async () => {
    const peers = new PeerGraph();
    const rec = await addBotToGraph({ input: 'NKNADDR123', peerGraph: peers });
    expect(rec.name).toBe('NKNADDR123');
  });

  it('rejects empty input + a missing PeerGraph + URL without a discover', async () => {
    const peers = new PeerGraph();
    await expect(addBotToGraph({ input: '  ', peerGraph: peers })).rejects.toThrow(/empty/);
    await expect(addBotToGraph({ input: 'x', peerGraph: null })).rejects.toThrow(/PeerGraph/);
    await expect(addBotToGraph({ input: 'https://b.example', peerGraph: peers })).rejects.toThrow(/discover/);
  });
});

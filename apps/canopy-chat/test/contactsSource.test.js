/**
 * contactsSource — the Contacten roster from a PeerGraph (feedback-extension P5).
 * Drives the real @canopy/core PeerGraph so the mapping + ordering match what
 * the live agent feeds the roster.
 */
import { describe, it, expect } from 'vitest';

import { PeerGraph } from '@canopy/core';
import { listContacts, peerToContactRow } from '../src/v2/contactsSource.js';

describe('peerToContactRow', () => {
  it('maps an a2a bot peer → a bot row with skill count + A2A url', () => {
    const row = peerToContactRow({
      type: 'a2a', url: 'https://bot.example', name: 'Feedback bot',
      skills: [{ id: 'summarise' }, { id: 'sentiment' }], reachable: true,
    });
    expect(row).toMatchObject({
      contactId: 'https://bot.example', name: 'Feedback bot', isBot: true,
      skillCount: 2, reachable: true, peerAddr: null, url: 'https://bot.example',
    });
  });

  it('maps a native peer → a person row with a peerAddr (pubKey)', () => {
    const row = peerToContactRow({ type: 'native', pubKey: 'PUBKEY1', name: 'Alice', reachable: true });
    expect(row).toMatchObject({ contactId: 'PUBKEY1', isBot: false, peerAddr: 'PUBKEY1', url: null });
  });

  it('treats a skill-bearing native/hybrid peer as a bot', () => {
    const row = peerToContactRow({ type: 'hybrid', pubKey: 'K', skills: [{ id: 'x' }] });
    expect(row.isBot).toBe(true);
    expect(row.peerAddr).toBe('K');
  });

  it('drops a peer with neither pubKey nor url', () => {
    expect(peerToContactRow({ type: 'a2a', name: 'ghost' })).toBeNull();
  });
});

describe('listContacts', () => {
  it('returns bots first, then people, each alphabetical', async () => {
    const peers = new PeerGraph();
    await peers.upsert({ type: 'native', pubKey: 'k-bob', name: 'Bob' });
    await peers.upsert({ type: 'a2a', url: 'https://b.example', name: 'Beta bot', skills: [{ id: 's' }] });
    await peers.upsert({ type: 'native', pubKey: 'k-ann', name: 'Ann' });
    await peers.upsert({ type: 'a2a', url: 'https://a.example', name: 'Alpha bot', skills: [{ id: 's' }] });

    const rows = await listContacts(peers);
    expect(rows.map((r) => r.name)).toEqual(['Alpha bot', 'Beta bot', 'Ann', 'Bob']);
    expect(rows.slice(0, 2).every((r) => r.isBot)).toBe(true);
    expect(rows.slice(2).every((r) => !r.isBot)).toBe(true);
  });

  it('null/!graph → empty (inert without a peer graph)', async () => {
    expect(await listContacts(null)).toEqual([]);
    expect(await listContacts({})).toEqual([]);
  });
});

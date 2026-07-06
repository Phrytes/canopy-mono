/**
 * Cluster K · pod-tier wiring — the WRITE-side grant(+seal) hook and the one-call composition seam.
 *
 * Exercised against the memory substrate with FAKE `sharing` (mimicking `client.sharing.grant`/`list`) and a
 * FAKE seal/open — no live pod, no `@canopy/pod-client` import. Covers:
 *   • a pod-backed share creates a read-grant for the recipient on the RIGHT resource URI (resourceUriFor)
 *   • the write-side re-seal writes sealed content back to the source store (sealed on write)
 *   • deny-safe: a failing grant fails the share (never a grant-less share reported ok)
 *   • memory path (no onShare) unchanged
 *   • makeCircleShareEnforcement round-trips: onShare grant → resolveSharedRef(grant present) resolves;
 *     a different recipient (grant absent) → null
 */
import { describe, it, expect } from 'vitest';
import {
  createCircleStores, memoryDataSource,
  shareIntoAudience, resolveSharedRef,
  makeShareGrantHook, makeCircleShareEnforcement,
  sealItem, unsealItem, SEAL_RESERVED_KEYS,
} from '../src/index.js';

function mkStores() {
  const registry = { validate: () => ({ ok: true }) };
  return createCircleStores({ dataSource: memoryDataSource(), registry });
}

/* ── Fakes standing in for the pod layer (no @canopy/pod-client import) ──────────────────────────── */

// Fake `client.sharing`: an in-memory ACP table keyed by resourceUri → [{subject, agent, modes}]. `grant`
// records; `list` filters by the queried agents / public. Mirrors the real surface shapes.
function fakeSharing() {
  const table = {};
  return {
    table,
    calls: [],
    async grant({ resourceUri, agent, modes }) {
      this.calls.push({ resourceUri, agent, modes });
      (table[resourceUri] ||= []).push({ subject: 'agent', agent, modes });
      return { targetUri: resourceUri, subject: 'agent', agent, modes };
    },
    async list({ resourceUri, agentsToQuery = [] }) {
      return (table[resourceUri] ?? []).filter((r) => r.subject === 'public' || agentsToQuery.includes(r.agent));
    },
  };
}

// A storage-layout style resolver: <pod>/group/<circle>/items/<id>.
const uriForRef = (ref) => `https://alice.pod/group/${ref.sourceCircle}/items/${ref.sourceId}`;

describe('makeShareGrantHook — write-side ACP grant', () => {
  it('a share creates a read-grant for the recipient on the source item resource URI', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'secret plan' });
    const sharing = fakeSharing();
    const onShare = makeShareGrantHook({ sharing, resourceUriFor: uriForRef });

    const r = await shareIntoAudience(stores, {
      itemId: item.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice', recipient: 'bob', onShare,
    });
    expect(r.ok).toBe(true);
    expect(sharing.calls).toEqual([
      { resourceUri: `https://alice.pod/group/A/items/${item.id}`, agent: 'bob', modes: ['read'] },
    ]);
  });

  it('grants to every recipient of a multi-member circle share', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'x' });
    const sharing = fakeSharing();
    const onShare = makeShareGrantHook({ sharing, resourceUriFor: uriForRef });
    await shareIntoAudience(stores, {
      itemId: item.id, fromCircleId: 'A', toCircleId: 'B', recipients: ['bob', 'carol'], onShare,
    });
    expect(sharing.calls.map((c) => c.agent)).toEqual(['bob', 'carol']);
  });

  it('re-seals the source item on write when a seal is injected (sealed on write)', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'note', body: 'plaintext body' });
    const sharing = fakeSharing();
    // seal wraps every string field for the recipient.
    const seal = (it, { recipient }) => ({
      ...it,
      body: `SEAL[${recipient}]:${it.body}`,
    });
    const onShare = makeShareGrantHook({ sharing, resourceUriFor: uriForRef, seal });

    await shareIntoAudience(stores, {
      itemId: item.id, fromCircleId: 'A', toCircleId: 'B', recipient: 'bob', onShare,
    });
    const stored = await stores.getStore('A').get(item.id);
    expect(stored.body).toBe('SEAL[bob]:plaintext body');   // written back sealed, same id
    expect(stored.id).toBe(item.id);
  });

  it('deny-safe: a failing grant FAILS the share (no grant-less share reported ok)', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'x' });
    const sharing = { grant: async () => { throw new Error('ACP write refused'); }, list: async () => [] };
    const onShare = makeShareGrantHook({ sharing, resourceUriFor: uriForRef });
    const r = await shareIntoAudience(stores, {
      itemId: item.id, fromCircleId: 'A', toCircleId: 'B', recipient: 'bob', onShare,
    });
    expect(r).toMatchObject({ ok: false, error: 'share-grant-failed' });
    expect(r.cause).toBeInstanceOf(Error);
  });

  it('no recipient → the hook throws → share fails (deny-by-default)', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'x' });
    const onShare = makeShareGrantHook({ sharing: fakeSharing(), resourceUriFor: uriForRef });
    const r = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'B', onShare });
    expect(r).toMatchObject({ ok: false, error: 'share-grant-failed' });
  });

  it('requires a { grant } surface', () => {
    expect(() => makeShareGrantHook({ sharing: {} })).toThrow(/grant/);
  });
});

describe('makeCircleShareEnforcement — write-grant + read-gate agree by construction', () => {
  it('round-trip: onShare grant → resolveSharedRef resolves; a non-granted recipient → null', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'secret plan' });
    const sharing = fakeSharing();

    const bobSeam = makeCircleShareEnforcement({ sharing, resourceUriFor: uriForRef, recipient: 'bob' });
    const r = await shareIntoAudience(stores, {
      itemId: item.id, fromCircleId: 'A', toCircleId: 'B', recipient: 'bob', onShare: bobSeam.onShare,
    });
    expect(r.ok).toBe(true);

    // Same resourceUriFor/mode ⇒ bob's read gate accepts.
    expect((await resolveSharedRef(stores, r.ref, { policy: bobSeam.policy })).text).toBe('secret plan');

    // A recipient who was never granted is denied by the same table.
    const carolSeam = makeCircleShareEnforcement({ sharing, resourceUriFor: uriForRef, recipient: 'carol' });
    expect(await resolveSharedRef(stores, r.ref, { policy: carolSeam.policy })).toBeNull();
  });

  it('write-side seal + read-side open compose (ciphertext never leaks to a non-recipient)', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'note', body: 'confidential' });
    const sharing = fakeSharing();
    const seal = (it, { recipient }) => ({ ...it, body: `SEAL[${recipient}]:${it.body}` });
    const open = (text) => {
      if (typeof text !== 'string' || !text.startsWith('SEAL[')) return text;
      const m = text.match(/^SEAL\[([^\]]+)\]:([\s\S]*)$/);
      if (m[1] !== 'bob') throw new Error('not a recipient');
      return m[2];
    };
    const seam = makeCircleShareEnforcement({ sharing, resourceUriFor: uriForRef, recipient: 'bob', open, seal });
    const r = await shareIntoAudience(stores, {
      itemId: item.id, fromCircleId: 'A', toCircleId: 'B', recipient: 'bob', onShare: seam.onShare,
    });
    expect(r.ok).toBe(true);

    // bob is granted AND a seal recipient → opens.
    expect((await resolveSharedRef(stores, r.ref, { policy: seam.policy, recipient: 'bob' })).body).toBe('confidential');

    // carol: grant her a read too, but she can't open the envelope sealed to bob → null (no ciphertext leak).
    await sharing.grant({ resourceUri: uriForRef(r.ref), agent: 'carol', modes: ['read'] });
    const carolPolicy = makeCircleShareEnforcement({
      sharing, resourceUriFor: uriForRef, recipient: 'carol',
      open: (t) => { if (String(t).startsWith('SEAL[')) throw new Error('not a recipient'); return t; },
    }).policy;
    expect(await resolveSharedRef(stores, r.ref, { policy: carolPolicy, recipient: 'carol' })).toBeNull();
  });

  it('requires a { grant, list } surface', () => {
    expect(() => makeCircleShareEnforcement({ sharing: { grant() {} }, resourceUriFor: uriForRef })).toThrow(/grant, list/);
  });
});

// share-policy slice 3b — the seam that carries the recipients' SEALING KEYS to the injected re-seal, and
// the symmetric `sealItem`/`unsealItem` content walk (structural keys stay plaintext).
describe('slice 3b — recipientKeys reach the seal; sealItem round-trips with unsealItem', () => {
  it('shareIntoAudience threads recipientKeys through onShare → seal', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'note', body: 'plaintext body' });
    const sharing = fakeSharing();
    let seenKeys = null;
    // seal records the recipientKeys it received; wraps content to them (fake).
    const seal = (it, { recipientKeys }) => { seenKeys = recipientKeys; return { ...it, body: `K[${recipientKeys.join(',')}]:${it.body}` }; };
    const onShare = makeShareGrantHook({ sharing, resourceUriFor: uriForRef, seal });

    await shareIntoAudience(stores, {
      itemId: item.id, fromCircleId: 'A', toCircleId: 'B', recipient: 'bob',
      recipientKeys: ['PUBKEY-bob'], onShare,
    });
    expect(seenKeys).toEqual(['PUBKEY-bob']);
    expect((await stores.getStore('A').get(item.id)).body).toBe('K[PUBKEY-bob]:plaintext body');
  });

  it('sealItem seals CONTENT fields but leaves structural keys plaintext; unsealItem reverses it', async () => {
    const item = { id: 'abc', type: 'list', posture: 2, text: 'secret', title: 'plan', createdBy: 'alice' };
    const sealed = await sealItem(item, (t) => `S:${t}`);
    // structural keys untouched…
    for (const k of SEAL_RESERVED_KEYS) if (k in item) expect(sealed[k]).toBe(item[k]);
    // …content sealed.
    expect(sealed.text).toBe('S:secret');
    expect(sealed.title).toBe('S:plan');
    // symmetric open (plaintext passes through the reader's opener).
    const opened = await unsealItem(sealed, (t) => (t.startsWith('S:') ? t.slice(2) : t));
    expect(opened).toEqual(item);
  });
});

describe('shareIntoAudience — memory path unchanged when no onShare', () => {
  it('shares without any pod hook exactly as before', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'plain' });
    const r = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'B' });
    expect(r.ok).toBe(true);
    expect((await resolveSharedRef(stores, r.ref)).text).toBe('plain');
  });
});

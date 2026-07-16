/**
 * Objective L — the `canonical` (revocable) share posture at the item-store seam.
 *
 * Hermetic, no @onderling/pod-client import — the pod-layer surfaces are FAKED exactly like sharedRefPolicy's
 * existing tests (a group-key opener modelling versioned rotation). Proves the substrate contract:
 *   • `canonical` is a recognized posture (SHARE_POSTURES / isCanonicalPosture) alongside the shipped four.
 *   • share-as-grant writes NO copy into the recipient circle — only the pointer `shared-ref`; the item
 *     stays canonical in its origin circle and is read IN PLACE via resolveSharedRef.
 *   • after revoke+rotate, the revoked recipient's opener can't open the re-sealed content ⇒ resolveSharedRef
 *     denies (null); a still-granted recipient resolves.
 *
 * The full crypto+ACP composition (grantMember / rotateGroupKeyResource / sharing.grant|revoke, incl. the
 * SHARING_REVOKE_NOOP contract) is proven with REAL primitives in
 * `packages/pod-client/test/canonicalShare.test.js`.
 */
import { describe, it, expect } from 'vitest';
import {
  createCircleStores, memoryDataSource,
  shareIntoAudience, resolveSharedRef, listShared,
  makeSharedRefPolicy, SHARE_POSTURES, isCanonicalPosture,
} from '../src/index.js';

function mkStores() {
  const registry = { validate: () => ({ ok: true }) };
  return createCircleStores({ dataSource: memoryDataSource(), registry });
}

// Fake versioned group-key seal: `GK[v]:text`. A recipient opener holds a SET of key versions (the group-key
// resource versions they were sealed to). It opens an envelope only when it holds that version — modelling
// "unwrapGroupKey throws for a version you're not a recipient of". Plaintext passes through.
const GK = 'GK[';
const sealAtVersion = (v, text) => `${GK}${v}]:${text}`;
function groupOpener(heldVersions) {
  const held = new Set(heldVersions);
  return (text) => {
    if (typeof text !== 'string' || !text.startsWith(GK)) return text;      // plaintext passes through
    const m = text.match(/^GK\[(\d+)\]:([\s\S]*)$/);
    if (!m) return text;
    if (!held.has(Number(m[1]))) throw new Error('sealing: not a recipient of this version');
    return m[2];
  };
}

// ACP table shape used by makeSharedRefPolicy.checkGrant (mirrors client.sharing.list).
function fakeSharing(table = {}) {
  return {
    async list({ resourceUri, agentsToQuery = [] }) {
      return (table[resourceUri] ?? []).filter((r) => r.subject === 'public' || agentsToQuery.includes(r.agent));
    },
  };
}

describe('canonical posture — recognition', () => {
  it('is in the recognized posture set, distinct from the copy-reseal postures', () => {
    expect(SHARE_POSTURES).toEqual(['closed', 'copy', 'trusted', 'registered', 'canonical']);
    expect(isCanonicalPosture('canonical')).toBe(true);
    for (const p of ['closed', 'copy', 'trusted', 'registered']) expect(isCanonicalPosture(p)).toBe(false);
  });
});

describe('canonical posture — share is a grant, not a copy', () => {
  it('writes ONLY the pointer shared-ref into the recipient circle; the item stays canonical in its origin', async () => {
    const stores = mkStores();
    // The canonical item lives (sealed under v1) in circle A. currentRecipients hold v1.
    const item = await stores.getStore('A').put({ type: 'note', body: sealAtVersion(1, 'canonical body') });
    const { ref, ok } = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice' });
    expect(ok).toBe(true);

    // NO COPY: circle B holds exactly one item, the shared-ref pointer — NOT a duplicate of the source.
    const inB = await stores.getStore('B').list();
    expect(inB).toHaveLength(1);
    expect(inB[0].type).toBe('shared-ref');
    expect(inB[0].sourceCircle).toBe('A');
    expect(inB[0].sourceId).toBe(item.id);
    expect(inB[0].body).toBeUndefined();           // the sealed body was NOT copied across
    expect(inB.some((x) => x.sharedCopyOf)).toBe(false);
    // The canonical item is untouched, still only in A.
    expect((await stores.getStore('A').get(item.id)).body).toBe(sealAtVersion(1, 'canonical body'));

    // READ IN PLACE: a granted recipient holding v1 opens the canonical item through the shared-ref.
    const resourceUri = `A/${item.id}`;
    const sharing = fakeSharing({ [resourceUri]: [{ subject: 'agent', agent: 'bob', modes: ['read'] }] });
    const policy = makeSharedRefPolicy({ sharing, open: groupOpener([1]), recipient: 'bob' });
    const got = await resolveSharedRef(stores, ref, { policy });
    expect(got.body).toBe('canonical body');       // opened the CANONICAL resource, no copy involved
    expect(await listShared(stores, 'B')).toHaveLength(1);
  });
});

describe('canonical posture — revoke denies future access; still-granted is unaffected', () => {
  it('after rotate+re-seal, the revoked recipient (old version) is denied; a remaining recipient resolves', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'note', body: sealAtVersion(1, 'v1 body') });
    const { ref } = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'B' });
    const resourceUri = `A/${item.id}`;

    // Revocation of Bob = rotate to v2 (sealed to the remaining recipients incl. Alice) + ACP revoke on the
    // resource + re-seal the canonical content under the NEW version. Model both effects:
    await stores.getStore('A').put({ ...item, body: sealAtVersion(2, 'v2 body') });   // re-sealed under new key
    const sharing = fakeSharing({
      [resourceUri]: [{ subject: 'agent', agent: 'alice', modes: ['read'] }],          // Bob's grant removed
    });

    // Bob keeps only the OLD version 1 → his opener throws on the v2 envelope → resolveSharedRef denies.
    // (And ACP no longer grants Bob either.)
    const bobPolicy = makeSharedRefPolicy({ sharing, open: groupOpener([1]), recipient: 'bob' });
    expect(await resolveSharedRef(stores, ref, { policy: bobPolicy })).toBeNull();

    // Alice — still granted, holds the rotated v2 key → opens the re-sealed canonical content in place.
    const alicePolicy = makeSharedRefPolicy({ sharing, open: groupOpener([1, 2]), recipient: 'alice' });
    expect((await resolveSharedRef(stores, ref, { policy: alicePolicy })).body).toBe('v2 body');
  });
});

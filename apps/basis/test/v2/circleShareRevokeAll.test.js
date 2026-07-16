/**
 * circleShare — listOutboundShares + revokeAllForMember (objective L, stop-sharing / auto-revoke).
 *
 * These are the SHARED helpers behind the "stop sharing" affordance + auto-revoke-on-member-removal. They reuse
 * the existing revoke path (`revokeItemShare` → `enforcement.revokeCanonical`) — no second revoke mechanism.
 * Reuses the canonical-posture fixture (real sealing primitives + real createCanonicalShare over a fake ACP).
 *
 * Honest scope: revokeAllForMember over-revokes (rotates EVERY outbound canonical share of the circle away from
 * the departing member — the `shared-ref` carries no per-recipient registry), which is forward-secret and leaks
 * nothing. That behaviour is asserted here, not hidden.
 */
import { describe, it, expect } from 'vitest';
import { makeCircleShareEnforcement } from '@onderling/item-store';
import { createCanonicalShare, generateKeypair, unwrapGroupKey } from '@onderling/pod-client';
import { makeResourceUriResolver, sharedRefResourceUri } from '@onderling/pod-onboarding/resourceUri';
import { makeCircleLists } from '@onderling/kring-host/circleLists';
import {
  shareItemAcrossCircles, listSharedResolved, listOutboundShares, revokeAllForMember,
} from '../../src/v2/circleShare.js';

function fakeSharing() {
  const table = new Map();
  const key = (uri) => { if (!table.has(uri)) table.set(uri, new Set()); return table.get(uri); };
  return {
    table,
    has: (uri, agent) => key(uri).has(agent),
    async grant({ resourceUri, agent }) { key(resourceUri).add(agent); return { resourceUri, agent }; },
    async revoke({ resourceUri, agent }) { key(resourceUri).delete(agent); return { resourceUri, agent }; },
    async list({ resourceUri, agentsToQuery = [] }) {
      const set = key(resourceUri);
      return agentsToQuery.filter((a) => set.has(a)).map((agent) => ({ subject: 'agent', agent, modes: ['read'] }));
    },
  };
}
const memKeyStore = (initial = null) => {
  let stored = initial;
  return { read: async () => stored, write: async (r) => { stored = r; }, current: () => stored };
};
function buildCanonicalEnforcement({ sharing, keyStore, controllerKey, currentRecipients }) {
  const resourceUriFor = sharedRefResourceUri(makeResourceUriResolver({ podUri: 'https://pod.example/' }));
  const canonicalShare = createCanonicalShare({ sharing, keyStore, controllerKey, resourceUriFor });
  return makeCircleShareEnforcement({ sharing, resourceUriFor, open: (text) => text, canonicalShare, currentRecipients });
}
const canonicalPolicyOf = () => ({ sharePosture: 'canonical' });

// Share one canonical item A→B to bob; returns the wiring so a test can list/revoke.
async function shareCanonicalAtoB() {
  const svc = makeCircleLists();
  const resolveService = async () => svc;
  const controllerKey = generateKeypair();
  const alice = generateKeypair();
  const bob = generateKeypair();
  const sharing = fakeSharing();
  const keyStore = memKeyStore();
  const enforcement = buildCanonicalEnforcement({
    sharing, keyStore, controllerKey, currentRecipients: () => [alice.publicKey],
  });
  const enforcementFor = async () => enforcement;
  const src = await svc.createList('A', 'secret plan', 'alice');
  await shareItemAcrossCircles({
    resolveService, enforcementFor, policyOf: canonicalPolicyOf,
    itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
    recipients: ['did:bob'], recipientKeys: [bob.publicKey],
  });
  return { svc, resolveService, enforcementFor, keyStore, alice, bob, sharing, src };
}

describe('listOutboundShares — a circle\'s outbound canonical shares', () => {
  it('lists what circle A shared OUT (source→target), deduped', async () => {
    const { resolveService, src } = await shareCanonicalAtoB();
    const out = await listOutboundShares({ resolveService, fromCircleId: 'A', circleIds: ['B', 'C'] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ toCircleId: 'B', itemId: src.id });
  });
  it('returns [] on bad input (guard)', async () => {
    expect(await listOutboundShares({})).toEqual([]);
    expect(await listOutboundShares({ resolveService: async () => null, fromCircleId: 'A', circleIds: 'nope' })).toEqual([]);
  });
});

describe('revokeAllForMember — auto-revoke a departing member across the circle\'s outbound shares', () => {
  it('revokes the member from every outbound canonical share; their read then resolves to null', async () => {
    const { resolveService, enforcementFor, keyStore, alice, bob } = await shareCanonicalAtoB();
    // sanity: bob reads before removal
    expect(await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'did:bob' })).toHaveLength(1);

    const res = await revokeAllForMember({
      resolveService, enforcementFor, policyOf: canonicalPolicyOf,
      fromCircleId: 'A', circleIds: ['B'], recipient: 'did:bob', remainingRecipients: [alice.publicKey],
    });
    expect(res).toMatchObject({ ok: true, attempted: 1, revoked: 1, skipped: 0 });
    expect(res.failed).toEqual([]);

    // group key rotated away from bob; alice (remaining) still unwraps.
    const rotated = keyStore.current();
    expect(rotated.version).toBe(2);
    expect(() => unwrapGroupKey(rotated, bob.privateKey)).toThrow();
    expect(unwrapGroupKey(rotated, alice.privateKey)).toBeTruthy();
    // deny-by-default read: bob's resolve is now empty.
    expect(await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'did:bob' })).toHaveLength(0);
  });

  it('counts a non-canonical share as skipped (not failed) — no in-place grant to rotate', async () => {
    const { resolveService, enforcementFor } = await shareCanonicalAtoB();
    // treat the circle as copy-posture at revoke time → revokeItemShare returns not-canonical → skipped.
    const res = await revokeAllForMember({
      resolveService, enforcementFor, policyOf: () => ({ sharePosture: 'copy' }),
      fromCircleId: 'A', circleIds: ['B'], recipient: 'did:bob',
    });
    expect(res).toMatchObject({ ok: true, attempted: 1, revoked: 0, skipped: 1 });
  });

  it('guards missing recipient / resolveService', async () => {
    expect(await revokeAllForMember({ fromCircleId: 'A', recipient: 'did:bob' }))
      .toMatchObject({ ok: false, attempted: 0, revoked: 0 });
    expect(await revokeAllForMember({ resolveService: async () => null, fromCircleId: 'A' }))
      .toMatchObject({ ok: false, attempted: 0 });
  });
});

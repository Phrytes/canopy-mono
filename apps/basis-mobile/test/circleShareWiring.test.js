/**
 * Mobile cross-circle SHARE composition root (objective L · invariant #2 web≡mobile). Proves the mobile
 * wiring in `src/core/circlePods.js` makes the SHARED share ops functional on mobile — the SAME
 * `buildCircleShareEnforcement` assembly + `circleShare.js` ops the web pod-site (circleApp.js) uses, with
 * no mobile-specific reimplementation.
 *
 *   • The composition root's OWN share wrappers (`shareItemIntoCircle` / `listSharedItems` /
 *     `unshareItemFromCircle`) thread resolveService + enforcement + the initiator gate into the shared ops.
 *   • A canonical share built via the SHARED enforcement assembly (`buildCircleShareEnforcement` — exactly
 *     what the mobile root calls) round-trips: grant → recipient resolves IN PLACE (no copy); revoke → key
 *     rotates away + ACP revoked → denied.
 *   • The additive fallback: with NO pod session the pod path declines (null enforcement + null pod-lists) and
 *     the default in-memory lists still work — parity with web.
 *
 * Hermetic like packages/pod-client/test/canonicalShare.test.js / apps/basis/test/v2/
 * circleShareCanonical.test.js: REAL createCanonicalShare + sealing primitives over a FAKE ACP `sharing`
 * surface + an in-memory keyStore — no live pod, no native modules.
 */
import { describe, it, expect } from 'vitest';
import { createCanonicalShare, generateKeypair, unwrapGroupKey } from '@onderling/pod-client';
import { makeResourceUriResolver, sharedRefResourceUri } from '@onderling/pod-onboarding/resourceUri';
import { makeCircleLists } from '@onderling/kring-host/circleLists';
import { buildCircleShareEnforcement } from '../../basis/src/v2/circleShareEnforcement.js';
import {
  shareItemIntoCircle, listSharedItems, unshareItemFromCircle,
  getPodCircleLists, getCircleShareEnforcement, getCircleLists,
  setCirclePodSession,
} from '../src/core/circlePods.js';

const POD_ROOT = 'https://pod.example/';
const resourceUriFor = sharedRefResourceUri(makeResourceUriResolver({ podUri: POD_ROOT }));
const canonicalPolicyOf = () => ({ sharePosture: 'canonical' });

// A fake ACP `sharing` surface — grant/revoke mutate an in-memory table; list answers deny-by-default from it.
function fakeSharing() {
  const table = new Map();   // resourceUri → Set(agent)
  const key = (uri) => { if (!table.has(uri)) table.set(uri, new Set()); return table.get(uri); };
  return {
    has: (uri, agent) => key(uri).has(agent),
    async grant({ resourceUri, agent }) { key(resourceUri).add(agent); return { resourceUri, agent }; },
    async revoke({ resourceUri, agent }) { key(resourceUri).delete(agent); return { resourceUri, agent }; },
    async list({ resourceUri, agentsToQuery = [] }) {
      const set = key(resourceUri);
      return agentsToQuery.filter((a) => set.has(a)).map((agent) => ({ subject: 'agent', agent, modes: ['read'] }));
    },
  };
}

// A one-resource in-memory keyStore for the item's group key.
function memKeyStore(initial = null) {
  let stored = initial;
  return { read: async () => stored, write: async (r) => { stored = r; }, current: () => stored };
}

// The enforcement the mobile composition root builds — via the SHARED assembly (buildCircleShareEnforcement),
// but hermetic: fake ACP `sharing`, in-memory keyStore, a stand-in controlAgent/idKey. `strategy.open` is the
// identity (content is plaintext in this seam). This is byte-for-byte the call circlePods.getCircleShareEnforcement
// makes — only the pod-object inputs are faked.
function buildMobileEnforcement({ sharing, keyStore, controllerKey, originMembers }) {
  return buildCircleShareEnforcement({
    sharing,
    strategy: { open: (text) => text },
    podRoot: POD_ROOT,
    controlAgent: { keyStore, members: () => originMembers },
    idKey: controllerKey,
  });
}

describe('mobile cross-circle share wiring (objective L)', () => {
  it('SHARE (canonical) round-trips through the mobile wrappers: grant IN PLACE, recipient reads, non-recipient denied', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const controllerKey = generateKeypair();   // this device (always a group-key recipient)
    const alice = generateKeypair();            // an origin member who must KEEP access
    const bob = generateKeypair();              // the outside recipient
    const sharing = fakeSharing();
    const keyStore = memKeyStore();
    const enforcement = buildMobileEnforcement({
      sharing, keyStore, controllerKey, originMembers: [{ publicKey: alice.publicKey }],
    });
    expect(enforcement).toBeTruthy();
    const enforcementFor = async () => enforcement;

    const src = await svc.createList('A', 'canonical plan body', 'alice');

    const r = await shareItemIntoCircle({
      resolveService, enforcementFor, policyOf: canonicalPolicyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipients: ['did:bob'], recipientKeys: [bob.publicKey],
    });
    expect(r.ok).toBe(true);

    // NO copy minted: source circle A keeps its ONE original item; target B holds ONE shared-ref pointer.
    const aItems = await svc.stores.getStore('A').list();
    expect(aItems).toHaveLength(1);
    expect(aItems.some((it) => it.sharedCopyOf)).toBe(false);
    const bRefs = await svc.stores.getStore('B').listByType('shared-ref');
    expect(bRefs).toHaveLength(1);
    expect(bRefs[0]).toMatchObject({ type: 'shared-ref', sourceCircle: 'A', sourceId: src.id });

    // KEY grant: bob + the origin member alice + the controller can all unwrap the item's group key.
    const kr = keyStore.current();
    expect(unwrapGroupKey(kr, bob.privateKey)).toBeTruthy();
    expect(unwrapGroupKey(kr, alice.privateKey)).toBeTruthy();
    expect(unwrapGroupKey(kr, controllerKey.privateKey)).toBeTruthy();

    // ACP grant landed on the CANONICAL source resource for bob.
    expect(sharing.has(resourceUriFor(bRefs[0]), 'did:bob')).toBe(true);

    // READ in place: bob resolves the canonical item; carol (non-recipient) is denied (deny-by-default).
    const forBob = await listSharedItems('B', { resolveService, enforcementFor, recipient: 'did:bob' });
    expect(forBob).toHaveLength(1);
    expect(forBob[0].item.text).toBe('canonical plan body');
    expect(forBob[0].item.sharedCopyOf).toBeUndefined();
    const forCarol = await listSharedItems('B', { resolveService, enforcementFor, recipient: 'did:carol' });
    expect(forCarol).toHaveLength(0);
  });

  it('REVOKE through the mobile wrapper denies the recipient: key rotated away + ACP revoked → read null', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const controllerKey = generateKeypair();
    const alice = generateKeypair();
    const bob = generateKeypair();
    const sharing = fakeSharing();
    const keyStore = memKeyStore();
    const enforcement = buildMobileEnforcement({
      sharing, keyStore, controllerKey, originMembers: [{ publicKey: alice.publicKey }],
    });
    const enforcementFor = async () => enforcement;

    const src = await svc.createList('A', 'secret', 'alice');
    await shareItemIntoCircle({
      resolveService, enforcementFor, policyOf: canonicalPolicyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipients: ['did:bob'], recipientKeys: [bob.publicKey],
    });
    expect(await listSharedItems('B', { resolveService, enforcementFor, recipient: 'did:bob' })).toHaveLength(1);

    const rev = await unshareItemFromCircle({
      resolveService, enforcementFor, policyOf: canonicalPolicyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', recipient: 'did:bob',
    });
    expect(rev.ok).toBe(true);

    // Group key rotated: bob can no longer unwrap; alice (remaining) still can. ACP revoked → bob's read null.
    const rotated = keyStore.current();
    expect(rotated.version).toBe(2);
    expect(() => unwrapGroupKey(rotated, bob.privateKey)).toThrow();
    expect(unwrapGroupKey(rotated, alice.privateKey)).toBeTruthy();
    expect(sharing.has(resourceUriFor({ sourceCircle: 'A', sourceId: src.id }), 'did:bob')).toBe(false);
    expect(await listSharedItems('B', { resolveService, enforcementFor, recipient: 'did:bob' })).toHaveLength(0);
  });

  it('additive fallback: no pod session → null enforcement + null pod-lists, default lists still work', async () => {
    setCirclePodSession(null);
    expect(await getCircleShareEnforcement('np', { storagePosture: 'p2' })).toBeNull();
    expect(await getPodCircleLists('np', { storagePosture: 'p2' })).toBeNull();
    const svc = await getCircleLists('np', {});
    expect(svc).toBeTruthy();
    const item = await svc.createList('np', 'local only', 'me');
    expect((await svc.stores.getStore('np').list()).some((it) => it.id === item.id)).toBe(true);
  });
});

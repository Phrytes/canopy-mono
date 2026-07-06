/**
 * circleShare (cluster K) — the app-level cross-circle SHARE op, tested at the SUBSTRATE seam (no DOM, no
 * live pod). Proves the vertical slice:
 *   • WRITE: shareItemAcrossCircles writes a `shared-ref` into the TARGET circle and — on the pod path —
 *     lands an ACP read-grant for the recipient on the SOURCE item's resource (via the injected onShare).
 *   • READ: listSharedResolved surfaces the target's shared items, resolving each through the source's
 *     enforcement policy — DENY-BY-DEFAULT (a non-recipient resolves to null and is DROPPED, no leak).
 *   • MEMORY path (no enforcement): share still writes + resolves, byte-unchanged (no grant/seal/gate).
 */
import { describe, it, expect } from 'vitest';
import { makeCircleShareEnforcement } from '@canopy/item-store';
import { makeResourceUriResolver, sharedRefResourceUri } from '@canopy/pod-onboarding/resourceUri';
import { makeCircleLists } from '../../src/v2/circleLists.js';
import { shareItemAcrossCircles, listSharedResolved, makeCrossCircleStores } from '../../src/v2/circleShare.js';

// A fake ACP `sharing` surface ({ grant, list }, the client.sharing shape). Records grants; answers list()
// from the recorded grants — exactly the deny-by-default gate a real pod enforces, without a pod.
function fakeSharing() {
  const grants = [];   // { resourceUri, agent, modes }
  return {
    grants,
    async grant({ resourceUri, agent, modes }) { grants.push({ resourceUri, agent, modes }); },
    async list({ resourceUri, agentsToQuery = [] }) {
      return grants
        .filter((g) => g.resourceUri === resourceUri && agentsToQuery.includes(g.agent))
        .map((g) => ({ subject: 'agent', agent: g.agent, modes: g.modes }));
    },
  };
}

function podEnforcement(sharing) {
  const resourceUriFor = sharedRefResourceUri(makeResourceUriResolver({ podUri: 'https://pod.example/' }));
  // open = identity (nothing sealed in this seam test); group-key posture ⇒ no seal.
  return makeCircleShareEnforcement({ sharing, resourceUriFor, open: (text) => text });
}

// slice 2 — the initiator gate reads the SOURCE circle's sharePosture (default 'closed' now REFUSES).
// The write/read success-path tests supply a permissive policyOf so they still exercise the substrate.
const openPolicyOf = () => ({ sharePosture: 'trusted' });

describe('circleShare — app-level cross-circle SHARE op', () => {
  it('MEMORY path (no enforcement): writes a shared-ref into the target + resolves back to the source', async () => {
    const svc = makeCircleLists();                       // one registry spanning all circles (the memory/IDB default)
    const resolveService = async () => svc;
    const src = await svc.createList('A', 'secret plan', 'alice');

    const r = await shareItemAcrossCircles({ resolveService, policyOf: openPolicyOf, itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice' });
    expect(r.ok).toBe(true);
    expect(r.ref).toMatchObject({ type: 'shared-ref', sourceCircle: 'A', sourceId: src.id, sharedBy: 'alice' });

    // No policy ⇒ the ref resolves for anyone (the pre-K in-memory behaviour, unchanged).
    const surfaced = await listSharedResolved({ resolveService, circleId: 'B' });
    expect(surfaced).toHaveLength(1);
    expect(surfaced[0].item.text).toBe('secret plan');
  });

  it('POD path: grants the recipient + resolves for them, returns NULL for a non-recipient (deny-by-default)', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const sharing = fakeSharing();
    const enforcement = podEnforcement(sharing);
    const enforcementFor = (cid) => (cid === 'A' ? enforcement : null);   // source circle A is pod-active
    const src = await svc.createList('A', 'confidential note', 'alice');

    const r = await shareItemAcrossCircles({
      resolveService, enforcementFor, policyOf: openPolicyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipients: ['webid:bob'],
    });
    expect(r.ok).toBe(true);

    // The write-side grant landed on the SOURCE item's canonical pod URI, for bob only.
    const expectedUri = `https://pod.example/group/A/items/${src.id}`;
    expect(sharing.grants).toEqual([{ resourceUri: expectedUri, agent: 'webid:bob', modes: ['read'] }]);

    // Recipient bob → resolves. Non-recipient eve → deny-by-default → dropped (no leak).
    const forBob = await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'webid:bob' });
    expect(forBob.map((x) => x.item.text)).toEqual(['confidential note']);

    const forEve = await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'webid:eve' });
    expect(forEve).toEqual([]);

    // And no recipient identity at all ⇒ also denied.
    const anon = await listSharedResolved({ resolveService, enforcementFor, circleId: 'B' });
    expect(anon).toEqual([]);
  });

  it('POD path: a grant-less share (no recipient) FAILS — never reports a share that would resolve to null', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const enforcement = podEnforcement(fakeSharing());
    const src = await svc.createList('A', 'x', 'alice');

    const r = await shareItemAcrossCircles({
      resolveService, enforcementFor: () => enforcement, policyOf: openPolicyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',   // no recipient / recipients
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('share-grant-failed');
    // The ref must NOT surface — the write refused before a resolvable ref could be trusted.
    // (shareIntoAudience wrote the ref then the hook threw; a non-recipient read is denied anyway.)
    const surfaced = await listSharedResolved({ resolveService, enforcementFor: () => enforcement, circleId: 'B', recipient: 'webid:bob' });
    expect(surfaced).toEqual([]);   // bob was never granted ⇒ deny-by-default
  });

  it('rejects bad args + same-circle without touching the substrate', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    expect(await shareItemAcrossCircles({ resolveService, fromCircleId: 'A', toCircleId: 'B' })).toMatchObject({ ok: false, error: 'missing-args' });
    expect(await shareItemAcrossCircles({ resolveService, itemId: 'x', fromCircleId: 'A', toCircleId: 'A' })).toMatchObject({ ok: false, error: 'same-circle' });
  });

  it('makeCrossCircleStores routes per-circle + throws for an unresolved circle', () => {
    const a = {}; const b = {};
    const stores = makeCrossCircleStores(new Map([['A', a], ['B', b]]));
    expect(stores.getStore('A')).toBe(a);
    expect(stores.getStore('B')).toBe(b);
    expect(() => stores.getStore('C')).toThrow(/no resolved store/);
  });
});

// slice 2 — the INITIATOR GATE: WHO may initiate a share is decided by the SOURCE circle's sharePosture
// (+ admins for 'registered'). Crypto-free; when the gate PASSES the write/read mechanics are unchanged.
describe('circleShare — initiator gate by source sharePosture (slice 2)', () => {
  // Share op that refuses before touching the substrate ⇒ nothing gets written into the target.
  async function shareWith(policyOf, extra = {}) {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const src = await svc.createList('A', 'plan', 'alice');
    const r = await shareItemAcrossCircles({
      resolveService, policyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice', ...extra,
    });
    const surfaced = await listSharedResolved({ resolveService, circleId: 'B' });
    return { r, surfaced };
  }

  it('closed (the default) → refuses with sharing-closed and writes nothing', async () => {
    const { r, surfaced } = await shareWith(() => ({ sharePosture: 'closed' }));
    expect(r).toEqual({ ok: false, error: 'sharing-closed' });
    expect(surfaced).toEqual([]);
  });

  it('missing/unreadable policy → treated as closed (deny-by-default), nothing written', async () => {
    // No policyOf at all.
    const { r, surfaced } = await shareWith(undefined);
    expect(r).toEqual({ ok: false, error: 'sharing-closed' });
    expect(surfaced).toEqual([]);

    // policyOf that throws ⇒ also treated as closed.
    const threw = await shareWith(() => { throw new Error('unreadable'); });
    expect(threw.r).toEqual({ ok: false, error: 'sharing-closed' });
    expect(threw.surfaced).toEqual([]);
  });

  it('registered + non-admin initiator → sharing-admin-only, nothing written', async () => {
    const { r, surfaced } = await shareWith(() => ({ sharePosture: 'registered', admins: ['carol'] }));
    expect(r).toEqual({ ok: false, error: 'sharing-admin-only' });
    expect(surfaced).toEqual([]);
  });

  it('registered + admin initiator → proceeds (writes the shared-ref)', async () => {
    const { r, surfaced } = await shareWith(() => ({ sharePosture: 'registered', admins: ['alice'] }));
    expect(r.ok).toBe(true);
    expect(r.ref).toMatchObject({ type: 'shared-ref', sourceCircle: 'A', sharedBy: 'alice' });
    expect(surfaced.map((x) => x.item.text)).toEqual(['plan']);
  });

  it('copy → any member may initiate → proceeds', async () => {
    const { r, surfaced } = await shareWith(() => ({ sharePosture: 'copy' }));
    expect(r.ok).toBe(true);
    expect(surfaced.map((x) => x.item.text)).toEqual(['plan']);
  });

  it('trusted → any member may initiate → proceeds', async () => {
    const { r, surfaced } = await shareWith(() => ({ sharePosture: 'trusted' }));
    expect(r.ok).toBe(true);
    expect(surfaced.map((x) => x.item.text)).toEqual(['plan']);
  });

  it('accepts a Promise-returning policyOf (async per-circle lookup)', async () => {
    const { r } = await shareWith(async () => ({ sharePosture: 'copy' }));
    expect(r.ok).toBe(true);
  });
});

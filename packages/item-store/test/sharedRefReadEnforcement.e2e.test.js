/**
 * Cluster K — END-TO-END enforcement proof of the shared-ref cross-circle READ.
 *
 * The other K suites prove the pieces (write-grant hook, read gate, seal/unseal, canonical share/revoke).
 * THIS file proves the FULL round-trip through the SAME seam, hermetically, with a single fake `sharing`
 * ACP surface whose ONE in-memory table is written by the SHARE side (`grant`/`revoke`) and read by the
 * READ side (`makeSharedRefPolicy.checkGrant` → `sharing.list`). No `@onderling/pod-client` import (invariant
 * #5): the pod-layer surfaces are injected, exactly as the existing K tests do.
 *
 * What is proven that the piecewise tests do NOT show in one loop:
 *   1. share (real ACP grant) → the GRANTED reader resolves the source item.
 *   2. a reader who was NEVER granted → null (isolation: granting A must not admit B).
 *   3. REVOKE (mutate the SAME ACP table) → the SAME previously-granted reader now resolves to null.
 *      i.e. the grant is re-consulted LIVE on every read, never cached at share time. This is the
 *      "revoked ACP not re-checked" gap the K note flags — shown closed.
 *   4. the gate is the ACP, not the memory posture floor: with NO posture information at all, flipping
 *      only the ACP table flips the outcome (and a failed `sharing` surface ⇒ deny, never open).
 *   5. cross-check: makeSharedRefPolicy (pod/ACP) AND makePosturePolicy (memory floor) both deny a
 *      non-recipient, and resolveSharedRef returns null (not the item, not a throw) on deny in both.
 */
import { describe, it, expect } from 'vitest';
import {
  createCircleStores, memoryDataSource,
  shareIntoAudience, resolveSharedRef,
  makeCircleShareEnforcement, makeSharedRefPolicy, makePosturePolicy,
} from '../src/index.js';

function mkStores() {
  const registry = { validate: () => ({ ok: true }) };
  return createCircleStores({ dataSource: memoryDataSource(), registry });
}

// One fake `client.sharing` ACP surface — a single in-memory table shared by grant/revoke/list. This is the
// crux of the "ACP genuinely consulted" proof: the WRITE side mutates `table`, the READ side reads it back.
// grant/revoke honour the SHARING_(GRANT|REVOKE)_NOOP contract (throw when nothing actually changed).
function fakeSharing() {
  const table = {};   // resourceUri → [{ subject, agent, modes }]
  return {
    table,
    grants: [], revokes: [],
    has(uri, agent) { return (table[uri] ?? []).some((r) => r.agent === agent); },
    async grant({ resourceUri, agent, modes }) {
      (table[resourceUri] ||= []).push({ subject: 'agent', agent, modes });
      this.grants.push({ resourceUri, agent, modes });
      return { resourceUri, agent, modes };
    },
    async revoke({ resourceUri, agent, modes }) {
      const rows = table[resourceUri] ?? [];
      const next = rows.filter((r) => r.agent !== agent);
      if (next.length === rows.length) {                 // SHARING_REVOKE_NOOP — nothing changed ⇒ throw
        const e = new Error('client.sharing.revoke: applied no change'); e.code = 'SHARING_REVOKE_NOOP'; throw e;
      }
      table[resourceUri] = next;
      this.revokes.push({ resourceUri, agent, modes });
      return { resourceUri, agent, modes };
    },
    async list({ resourceUri, agentsToQuery = [] }) {
      return (table[resourceUri] ?? []).filter((r) => r.subject === 'public' || agentsToQuery.includes(r.agent));
    },
  };
}

// A storage-layout style resolver (a real pod injects @onderling/pod-onboarding's sharedRefResourceUri).
const uriForRef = (ref) => `https://alice.pod/group/${ref.sourceCircle}/items/${ref.sourceId}`;

describe('shared-ref cross-circle read — full share → granted-read → revoke-deny loop (ACP genuinely consulted)', () => {
  it('grant admits the reader; revoke on the SAME ACP table denies the SAME reader on the next read', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'secret plan' });
    const sharing = fakeSharing();

    // WRITE + READ bound to the SAME sharing surface / URI map / mode (the one-call composition seam).
    const bob = makeCircleShareEnforcement({ sharing, resourceUriFor: uriForRef, recipient: 'bob' });

    // SHARE — writes the shared-ref into B and lands bob's ACP read grant on A's source resource.
    const r = await shareIntoAudience(stores, {
      itemId: item.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice', recipient: 'bob', onShare: bob.onShare,
    });
    expect(r.ok).toBe(true);
    expect(sharing.has(uriForRef(r.ref), 'bob')).toBe(true);       // the grant genuinely landed in the table

    // GRANTED read → resolves the CANONICAL source item (read in place across circles).
    expect((await resolveSharedRef(stores, r.ref, { policy: bob.policy })).text).toBe('secret plan');

    // REVOKE bob's ACP grant — mutate the SAME table the read gate consults.
    await sharing.revoke({ resourceUri: uriForRef(r.ref), agent: 'bob', modes: ['read'] });
    expect(sharing.revokes).toHaveLength(1);

    // Same reader, same policy, next read → DENIED (null). The grant is re-checked LIVE, not cached at share.
    expect(await resolveSharedRef(stores, r.ref, { policy: bob.policy })).toBeNull();
  });

  it('isolation — granting reader A does not let reader B resolve (deny-by-default for the non-recipient)', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'note', text: 'for bob only' });
    const sharing = fakeSharing();

    const bob = makeCircleShareEnforcement({ sharing, resourceUriFor: uriForRef, recipient: 'bob' });
    const r = await shareIntoAudience(stores, {
      itemId: item.id, fromCircleId: 'A', toCircleId: 'B', recipient: 'bob', onShare: bob.onShare,
    });
    expect(r.ok).toBe(true);

    // bob resolves…
    expect((await resolveSharedRef(stores, r.ref, { policy: bob.policy })).text).toBe('for bob only');
    // …carol, never granted, is denied by the same table (a read gate bound to the SAME sharing surface).
    const carol = makeCircleShareEnforcement({ sharing, resourceUriFor: uriForRef, recipient: 'carol' });
    expect(await resolveSharedRef(stores, r.ref, { policy: carol.policy })).toBeNull();
  });

  it('the gate is the ACP itself, not the memory posture floor: flipping ONLY the ACP flips the outcome', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'x' });
    const sharing = fakeSharing();
    const { ref } = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'B' });

    // makeSharedRefPolicy carries NO posture information — the ONLY thing gating is the ACP table.
    const policy = makeSharedRefPolicy({ sharing, resourceUriFor: uriForRef, recipient: 'bob' });
    expect(await resolveSharedRef(stores, ref, { policy })).toBeNull();          // no grant yet ⇒ deny
    await sharing.grant({ resourceUri: uriForRef(ref), agent: 'bob', modes: ['read'] });
    expect((await resolveSharedRef(stores, ref, { policy })).text).toBe('x');    // grant lands ⇒ resolve
    await sharing.revoke({ resourceUri: uriForRef(ref), agent: 'bob', modes: ['read'] });
    expect(await resolveSharedRef(stores, ref, { policy })).toBeNull();          // revoke ⇒ deny again
  });

  it('a failed sharing surface ⇒ deny, never open (deny-by-default on error)', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'x' });
    const { ref } = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'B' });

    // A sharing surface whose `list` throws (a failed pod ACP query) must resolve to null, not the item.
    const sharing = { list: async () => { throw new Error('pod unreachable'); } };
    const policy = makeSharedRefPolicy({ sharing, resourceUriFor: uriForRef, recipient: 'bob' });
    expect(await resolveSharedRef(stores, ref, { policy })).toBeNull();
  });
});

describe('shared-ref cross-circle read — both policies deny a non-recipient; resolveSharedRef returns null (not a throw)', () => {
  it('makeSharedRefPolicy (ACP) denies a non-recipient → null', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'x' });
    const { ref } = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'B' });
    const sharing = fakeSharing();                                    // empty table ⇒ no grant for anyone
    const policy = makeSharedRefPolicy({ sharing, resourceUriFor: uriForRef, recipient: 'mallory' });
    const got = await resolveSharedRef(stores, ref, { policy });
    expect(got).toBeNull();                                           // null, not a throw, not the item
  });

  it('makePosturePolicy (memory floor) denies a below-floor recipient → null', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'confidential', posture: 5 });
    const { ref } = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'Public', posture: 5 });
    const postureOf = (c) => ({ Public: 0, Secret: 5 }[c] ?? 0);
    const policy = makePosturePolicy({ postureOf, recipient: 'Public' });   // Public (0) < floor (5)
    const got = await resolveSharedRef(stores, ref, { policy });
    expect(got).toBeNull();
  });
});

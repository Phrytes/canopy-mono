// canonicalShare.test.js — objective L: the REVOCABLE CANONICAL cross-circle share.
//
// Hermetic, injected — no live pod. Uses the REAL sealing primitives (generateKeypair, generateGroupKey,
// buildGroupKeyResource, sealWithGroupKey/openWithGroupKey, unwrapGroupKey) so the revoke→deny guarantee is
// exercised against actual crypto, with a FAKE `sharing` surface standing in for the ACP grant/revoke.
import { describe, it, expect, vi } from 'vitest';
import { createCanonicalShare } from '../src/sealing/canonicalShare.js';
import {
  generateKeypair, generateGroupKey, buildGroupKeyResource,
  sealWithGroupKey, openWithGroupKey, unwrapGroupKey,
} from '../src/sealing/index.js';

// Fake ACP surface honouring the SHARING_(GRANT|REVOKE)_NOOP contract: grant/revoke normally mutate an
// in-memory table; a `noop` flag makes revoke THROW a SHARING_REVOKE_NOOP-coded error exactly as the real
// client.sharing does when the SDK applies no change (verified 2026-05-16).
function fakeSharing({ noopRevoke = false } = {}) {
  const table = {};   // resourceUri → Set(agent)
  const grants = []; const revokes = [];
  const key = (uri) => (table[uri] ||= new Set());
  return {
    table, grants, revokes,
    has: (uri, agent) => key(uri).has(agent),
    grant: vi.fn(async ({ resourceUri, agent }) => { key(resourceUri).add(agent); grants.push({ resourceUri, agent }); return { resourceUri, agent }; }),
    revoke: vi.fn(async ({ resourceUri, agent }) => {
      if (noopRevoke) { const e = new Error('client.sharing.revoke: applied no change'); e.code = 'SHARING_REVOKE_NOOP'; throw e; }
      key(resourceUri).delete(agent); revokes.push({ resourceUri, agent }); return { resourceUri, agent };
    }),
  };
}

// A key resource keyStore holding one resource in memory (mirrors controlAgent.test's keyStore).
function memKeyStore(initial = null) {
  let stored = initial;
  return { read: async () => stored, write: async (r) => { stored = r; }, current: () => stored };
}

const RES = 'https://alice.pod/circles/A/items/plan.json';

describe('canonicalShare — share (grant, not copy)', () => {
  it('bootstraps the group-key resource + ACP grant so the recipient opens the canonical item IN PLACE', async () => {
    const controllerKey = generateKeypair();
    const bob = generateKeypair();
    const sharing = fakeSharing();
    const keyStore = memKeyStore();
    const canon = createCanonicalShare({ sharing, keyStore, controllerKey, resourceUri: RES });

    const { keyResource } = await canon.share({ recipient: 'did:bob', recipientKey: bob.publicKey });

    // Bob can unwrap the group key and open the canonical content sealed under it.
    const gk = unwrapGroupKey(keyResource, bob.privateKey);
    const sealed = sealWithGroupKey('canonical plan body', gk);
    expect(openWithGroupKey(sealed, unwrapGroupKey(keyResource, bob.privateKey))).toBe('canonical plan body');
    // The controller stays a recipient (can always re-wrap on the next grant/rotate).
    expect(unwrapGroupKey(keyResource, controllerKey.privateKey)).toBeTruthy();
    // ACP granted Bob read on the CANONICAL resource — no per-recipient copy resource was created.
    expect(sharing.has(RES, 'did:bob')).toBe(true);
    expect(sharing.grant).toHaveBeenCalledOnce();
    expect(sharing.grant.mock.calls[0][0]).toMatchObject({ resourceUri: RES, agent: 'did:bob', modes: ['read'] });
  });

  it('a second canonical share is an O(1) re-wrap of the SAME key at the SAME version; both recipients open it', async () => {
    const controllerKey = generateKeypair();
    const bob = generateKeypair(); const carol = generateKeypair();
    const sharing = fakeSharing();
    const keyStore = memKeyStore();
    const canon = createCanonicalShare({ sharing, keyStore, controllerKey, resourceUri: RES });

    const r1 = (await canon.share({ recipient: 'did:bob', recipientKey: bob.publicKey })).keyResource;
    const r2 = (await canon.share({ recipient: 'did:carol', recipientKey: carol.publicKey, currentRecipients: [bob.publicKey] })).keyResource;

    expect(r2.version).toBe(1);   // grant does not bump the version
    expect(unwrapGroupKey(r2, bob.privateKey)).toBe(unwrapGroupKey(r1, bob.privateKey));   // same group key
    expect(unwrapGroupKey(r2, carol.privateKey)).toBe(unwrapGroupKey(r1, bob.privateKey)); // carol reads it too
  });

  it('derives the resource URI from a shared-ref when none is fixed on the controller', async () => {
    const controllerKey = generateKeypair(); const bob = generateKeypair();
    const sharing = fakeSharing();
    const canon = createCanonicalShare({ sharing, keyStore: memKeyStore(), controllerKey });
    await canon.share({ recipient: 'did:bob', recipientKey: bob.publicKey, ref: { sourceCircle: 'A', sourceId: 'plan' } });
    expect(sharing.has('A/plan', 'did:bob')).toBe(true);
  });

  it('validates its deps and required args', async () => {
    expect(() => createCanonicalShare({})).toThrow(/sharing/);
    expect(() => createCanonicalShare({ sharing: { grant() {}, revoke() {} } })).toThrow(/keyStore/);
    expect(() => createCanonicalShare({ sharing: { grant() {}, revoke() {} }, keyStore: { read() {}, write() {} } })).toThrow(/controllerKey/);
    const canon = createCanonicalShare({ sharing: fakeSharing(), keyStore: memKeyStore(), controllerKey: generateKeypair(), resourceUri: RES });
    await expect(canon.share({ recipientKey: 'k' })).rejects.toThrow(/recipient WebID/);
    await expect(canon.share({ recipient: 'did:bob' })).rejects.toThrow(/sealing public key/);
  });
});

describe('canonicalShare — revoke (rotate + re-grant + ACP revoke) DENIES the revoked recipient', () => {
  it('after revoke: revoked recipient cannot open the NEW key/content; a still-granted recipient is unaffected', async () => {
    const controllerKey = generateKeypair();
    const alice = generateKeypair();   // stays granted
    const bob = generateKeypair();     // gets revoked
    const sharing = fakeSharing();
    const keyStore = memKeyStore();
    const canon = createCanonicalShare({ sharing, keyStore, controllerKey, resourceUri: RES });

    await canon.share({ recipient: 'did:alice', recipientKey: alice.publicKey });
    await canon.share({ recipient: 'did:bob', recipientKey: bob.publicKey, currentRecipients: [alice.publicKey] });
    expect(sharing.has(RES, 'did:bob')).toBe(true);

    // Revoke Bob: rotate to a fresh key sealed to the REMAINING recipients (alice + controller), ACP revoke.
    const { keyResource: rotated } = await canon.revoke({ recipient: 'did:bob', remainingRecipients: [alice.publicKey] });

    expect(rotated.version).toBe(2);                                        // rotated to a new key/version
    expect(() => unwrapGroupKey(rotated, bob.privateKey)).toThrow(/not a recipient/);  // Bob can't get the new key
    expect(unwrapGroupKey(rotated, alice.privateKey)).toBeTruthy();          // Alice still holds it

    // New content sealed under the NEW group key: Alice opens it, Bob CANNOT (he has no path to the new key).
    const newGroupKey = unwrapGroupKey(rotated, alice.privateKey);
    const newSealed = sealWithGroupKey('post-revocation content', newGroupKey);
    expect(openWithGroupKey(newSealed, unwrapGroupKey(rotated, alice.privateKey))).toBe('post-revocation content');
    expect(() => unwrapGroupKey(rotated, bob.privateKey)).toThrow();         // no key ⇒ no open of new content

    // ACP: Bob is denied the resource; Alice keeps it.
    expect(sharing.has(RES, 'did:bob')).toBe(false);
    expect(sharing.has(RES, 'did:alice')).toBe(true);
    expect(sharing.revoke.mock.calls[0][0]).toMatchObject({ resourceUri: RES, agent: 'did:bob', modes: ['read'] });
  });

  it('CAVEAT — rotation does not un-see already-decrypted content: OLD-key ciphertext Bob cached still opens', async () => {
    const controllerKey = generateKeypair();
    const bob = generateKeypair();
    const keyStore = memKeyStore();
    const canon = createCanonicalShare({ sharing: fakeSharing(), keyStore, controllerKey, resourceUri: RES });

    const { keyResource: v1 } = await canon.share({ recipient: 'did:bob', recipientKey: bob.publicKey });
    const oldGroupKey = unwrapGroupKey(v1, bob.privateKey);
    const oldSealed = sealWithGroupKey('content Bob already read', oldGroupKey);
    // Bob decrypts + caches BEFORE revocation.
    const cached = openWithGroupKey(oldSealed, oldGroupKey);
    expect(cached).toBe('content Bob already read');

    await canon.revoke({ recipient: 'did:bob', remainingRecipients: [] });

    // Honest limit: Bob's cached OLD-key plaintext (and old ciphertext under the OLD key he retained) is
    // un-revocable — rotation only governs FUTURE content. `reseal` under the new key is what locks the
    // revoked recipient out of content that must NOT stay readable.
    expect(openWithGroupKey(oldSealed, oldGroupKey)).toBe('content Bob already read');   // still opens with the retained old key
    const resealed = await canon.reseal('content Bob already read');
    expect(() => openWithGroupKey(resealed, oldGroupKey)).toThrow();   // re-sealed under the new key → old key fails
  });

  it('respects the SHARING_REVOKE_NOOP contract — a no-op ACP revoke propagates, never silently "succeeds"', async () => {
    const controllerKey = generateKeypair();
    const bob = generateKeypair();
    const sharing = fakeSharing({ noopRevoke: true });
    const canon = createCanonicalShare({ sharing, keyStore: memKeyStore(), controllerKey, resourceUri: RES });
    await canon.share({ recipient: 'did:bob', recipientKey: bob.publicKey });

    await expect(canon.revoke({ recipient: 'did:bob', remainingRecipients: [] }))
      .rejects.toMatchObject({ code: 'SHARING_REVOKE_NOOP' });
  });
});

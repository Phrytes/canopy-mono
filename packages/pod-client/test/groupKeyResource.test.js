import { describe, it, expect } from 'vitest';
import {
  buildGroupKeyResource, unwrapGroupKey, grantMember, rotateGroupKeyResource,
  unwrapGroupKeyVersion, readableGroupKeys, openSealedAcrossVersions,
} from '../src/sealing/groupKeyResource.js';
import { generateKeypair, generateGroupKey, sealWithGroupKey, openWithGroupKey } from '../src/sealing/index.js';

describe('groupKeyResource — build + unwrap', () => {
  it('every member can unwrap the group key; a non-member cannot', () => {
    const a = generateKeypair(); const b = generateKeypair(); const stranger = generateKeypair();
    const gk = generateGroupKey();
    const res = buildGroupKeyResource({ version: 1, groupKey: gk, recipients: [a.publicKey, b.publicKey] });
    expect(res.version).toBe(1);
    expect(res.members).toBe(2);
    expect(unwrapGroupKey(res, a.privateKey)).toBe(gk);
    expect(unwrapGroupKey(res, b.privateKey)).toBe(gk);
    expect(() => unwrapGroupKey(res, stranger.privateKey)).toThrow(/not a recipient/);
  });
});

describe('groupKeyResource — grant (join, O(1), same key)', () => {
  it('a new member can read content sealed before they joined (same key, same version)', () => {
    const a = generateKeypair(); const c = generateKeypair();
    const gk = generateGroupKey();
    const v1 = buildGroupKeyResource({ version: 1, groupKey: gk, recipients: [a.publicKey] });
    const content = sealWithGroupKey('existing list', gk);     // sealed before c joined

    const v1b = grantMember(v1, { newRecipient: c.publicKey, granterPrivateKey: a.privateKey, currentRecipients: [a.publicKey] });
    expect(v1b.version).toBe(1);                                // grant does NOT bump the version
    expect(v1b.members).toBe(2);
    const cKey = unwrapGroupKey(v1b, c.privateKey);
    expect(cKey).toBe(gk);                                      // same group key
    expect(openWithGroupKey(content, cKey)).toBe('existing list');
  });
});

describe('groupKeyResource — revoke (rotate, forward secrecy)', () => {
  it('rotation gives a new key + version; the departed member loses access to NEW content but keeps OLD', () => {
    const a = generateKeypair(); const b = generateKeypair(); const leaver = generateKeypair();
    const v1 = rotateGroupKeyResource({ previous: null, recipients: [a.publicKey, b.publicKey, leaver.publicKey] });
    expect(v1.version).toBe(1);
    const gk1 = unwrapGroupKey(v1, leaver.privateKey);
    const oldContent = sealWithGroupKey('pre-leave note', gk1);

    // leaver departs → rotate to the remaining members
    const v2 = rotateGroupKeyResource({ previous: v1, recipients: [a.publicKey, b.publicKey] });
    expect(v2.version).toBe(2);
    const gk2 = unwrapGroupKey(v2, a.privateKey);
    expect(gk2).not.toBe(gk1);                                  // fresh key
    const newContent = sealWithGroupKey('post-leave secret', gk2);

    // the leaver can't unwrap v2 (not a recipient) → can't read new content...
    expect(() => unwrapGroupKey(v2, leaver.privateKey)).toThrow(/not a recipient/);
    // ...but their cached v1 key still opens already-downloaded old content (forward, not retroactive)
    expect(openWithGroupKey(oldContent, gk1)).toBe('pre-leave note');
    // a remaining member reads the new content
    expect(openWithGroupKey(newContent, gk2)).toBe('post-leave secret');
  });

  it('versions increment across rotations', () => {
    const a = generateKeypair();
    const v1 = rotateGroupKeyResource({ recipients: [a.publicKey] });
    const v2 = rotateGroupKeyResource({ previous: v1, recipients: [a.publicKey] });
    const v3 = rotateGroupKeyResource({ previous: v2, recipients: [a.publicKey] });
    expect([v1.version, v2.version, v3.version]).toEqual([1, 2, 3]);
  });
});

// ── Phase 3 — historic-key retention: open OLD content across rotations WITHOUT weakening forward secrecy ──
describe('groupKeyResource — historic-key retention (Phase 3)', () => {
  it('retains prior versions on rotate: each retained entry carries THAT version, ascending', () => {
    const a = generateKeypair();
    const v1 = rotateGroupKeyResource({ recipients: [a.publicKey] });
    expect(v1.history).toBeUndefined();                       // v1 has no prior versions
    const v2 = rotateGroupKeyResource({ previous: v1, recipients: [a.publicKey] });
    const v3 = rotateGroupKeyResource({ previous: v2, recipients: [a.publicKey] });
    expect(v2.history.map((h) => h.version)).toEqual([1]);
    expect(v3.history.map((h) => h.version)).toEqual([1, 2]); // full ascending history retained
    expect(v3.version).toBe(3);
  });

  it('CRYPTO 1 — a still-granted recipient opens BOTH pre- and post-rotation content (historic + current)', () => {
    const alice = generateKeypair(); const bob = generateKeypair();  // both present at v1
    const v1 = rotateGroupKeyResource({ previous: null, recipients: [alice.publicKey, bob.publicKey] });
    const gk1 = unwrapGroupKey(v1, alice.privateKey);
    const preRotation = sealWithGroupKey('sealed under v1', gk1);

    // bob leaves → rotate to alice only; the v1 version is retained in history
    const v2 = rotateGroupKeyResource({ previous: v1, recipients: [alice.publicKey] });
    const gk2 = unwrapGroupKey(v2, alice.privateKey);
    expect(gk2).not.toBe(gk1);
    const postRotation = sealWithGroupKey('sealed under v2', gk2);

    // Alice (still granted) resolves + opens BOTH, in place, from the single retained resource.
    expect(openSealedAcrossVersions(preRotation, v2, alice.privateKey)).toBe('sealed under v1');
    expect(openSealedAcrossVersions(postRotation, v2, alice.privateKey)).toBe('sealed under v2');
    // readableGroupKeys exposes exactly her two versions, newest-first.
    expect(readableGroupKeys(v2, alice.privateKey).map((k) => k.version)).toEqual([2, 1]);
  });

  it('CRYPTO 2 — a REVOKED recipient still cannot open post-revocation content (forward secrecy intact)', () => {
    const alice = generateKeypair(); const bob = generateKeypair();   // bob will be revoked
    const v1 = rotateGroupKeyResource({ previous: null, recipients: [alice.publicKey, bob.publicKey] });
    const gk1 = unwrapGroupKey(v1, bob.privateKey);
    const preRevocation = sealWithGroupKey('bob was entitled to this', gk1);

    const v2 = rotateGroupKeyResource({ previous: v1, recipients: [alice.publicKey] });  // bob revoked
    const gk2 = unwrapGroupKey(v2, alice.privateKey);
    const postRevocation = sealWithGroupKey('after bob left', gk2);

    // Bob can still open PRE-revocation content (his entitlement, retained v1) — this is correct, not a leak.
    expect(openSealedAcrossVersions(preRevocation, v2, bob.privateKey)).toBe('bob was entitled to this');
    // ...but he holds NO version that opens POST-revocation content → throws. Forward secrecy preserved.
    expect(readableGroupKeys(v2, bob.privateKey).map((k) => k.version)).toEqual([1]);   // only v1, never v2
    expect(() => unwrapGroupKeyVersion(v2, bob.privateKey, 2)).toThrow(/not a recipient/);
    expect(() => openSealedAcrossVersions(postRevocation, v2, bob.privateKey))
      .toThrow(/no retained group-key version/);
  });

  it('CRYPTO 3 — content sealed under vN resolves to the vN key, never vN+1', () => {
    const alice = generateKeypair();
    const v1 = rotateGroupKeyResource({ previous: null, recipients: [alice.publicKey] });
    const gk1 = unwrapGroupKey(v1, alice.privateKey);
    const v2 = rotateGroupKeyResource({ previous: v1, recipients: [alice.publicKey] });
    const gk2 = unwrapGroupKey(v2, alice.privateKey);
    const v1Content = sealWithGroupKey('v1 body', gk1);

    // The vN key (only) opens vN content; the newer key is authenticated-rejected, not silently mis-decrypted.
    expect(() => openWithGroupKey(v1Content, gk2)).toThrow();               // vN+1 key fails on vN content
    expect(openWithGroupKey(v1Content, gk1)).toBe('v1 body');              // vN key succeeds
    // The version-resolving open picks v1 even though it tries v2 first (newest-first).
    expect(openSealedAcrossVersions(v1Content, v2, alice.privateKey)).toBe('v1 body');
    // The explicit specific-version primitive unwraps exactly the requested version's key.
    expect(unwrapGroupKeyVersion(v2, alice.privateKey, 1)).toBe(gk1);
    expect(unwrapGroupKeyVersion(v2, alice.privateKey, 2)).toBe(gk2);
    expect(() => unwrapGroupKeyVersion(v2, alice.privateKey, 9)).toThrow(/not retained/);
  });

  it('grant carries history forward untouched — a new member gets the CURRENT version only, no historic access', () => {
    const alice = generateKeypair(); const carol = generateKeypair();  // carol joins at v2
    const v1 = rotateGroupKeyResource({ previous: null, recipients: [alice.publicKey] });
    const gk1 = unwrapGroupKey(v1, alice.privateKey);
    const v1Content = sealWithGroupKey('pre-carol history', gk1);
    const v2 = rotateGroupKeyResource({ previous: v1, recipients: [alice.publicKey] });

    // carol is granted onto the CURRENT (v2) version; history (v1 envelope) is retained but NOT re-wrapped to her.
    const v2b = grantMember(v2, { newRecipient: carol.publicKey, granterPrivateKey: alice.privateKey, currentRecipients: [alice.publicKey] });
    expect(v2b.version).toBe(2);
    expect(v2b.history.map((h) => h.version)).toEqual([1]);            // history preserved through grant
    // carol reads current-version content but has NO key for the pre-grant v1 history (conservative default).
    expect(readableGroupKeys(v2b, carol.privateKey).map((k) => k.version)).toEqual([2]);
    expect(() => openSealedAcrossVersions(v1Content, v2b, carol.privateKey))
      .toThrow(/no retained group-key version/);
    // ...while alice (present since v1) still opens that history.
    expect(openSealedAcrossVersions(v1Content, v2b, alice.privateKey)).toBe('pre-carol history');
  });
});

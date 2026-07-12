/**
 * J-SECURITY BREACH SUITE — removed-member key retention (the cryptree gap).
 * PLAN-real-usage-and-deployment.md §7 ("a removed member with old keys →
 * revocation → re-key, the cryptree lesson").
 *
 * This is the scenario the brief flagged as MOST LIKELY a real gap. It is —
 * with an important nuance. The circle's group-key model
 * (`@canopy/pod-client/sealing` `rotateGroupKeyResource`) DOES rotate on
 * member removal, so a removed member is locked out of content sealed AFTER
 * removal (forward secrecy — DEFENDED, green below). BUT the rotation
 * deliberately RETAINS the outgoing version in `history[]`, still wrapped to
 * its original recipients — including the just-removed member. A removed
 * member who CACHED the key resource + old ciphertext before leaving can
 * still unwrap the historic group key and decrypt PRE-removal content
 * forever. There is no backward secrecy / re-encryption of past content.
 *
 * We prove BOTH halves honestly:
 *   • GREEN  — content sealed AFTER removal is unreadable by the ex-member.
 *   • GREEN  — per-circle keys don't cross (no cross-circle decrypt).
 *   • GAP    — a `it.fails`-documented probe: content sealed BEFORE removal
 *              stays readable by the ex-member via the retained `history`
 *              envelope they cached. This is the documented finding, not a
 *              faked pass. See SECURITY-FINDINGS in the task report.
 *
 * Everything here drives the REAL production sealing functions — no
 * re-implemented crypto.
 */
import { describe, it, expect } from 'vitest';
import {
  generateKeypair, generateGroupKey,
  sealWithGroupKey, openWithGroupKey, open, isSealed,
  buildGroupKeyResource, rotateGroupKeyResource,
  unwrapGroupKey, unwrapGroupKeyVersion, openSealedAcrossVersions,
} from '../../src/sealing/index.js';

const recipientsOf = (...members) => members.map((m) => m.publicKey);

describe('§7.5 — removed member, forward secrecy (content sealed AFTER removal)', () => {
  it('DEFENDED: after rotation on removal, the ex-member CANNOT open new content', () => {
    const admin = generateKeypair();
    const alice = generateKeypair();
    const mallory = generateKeypair();   // the member who will be removed

    // v1: circle of {admin, alice, mallory}.
    const gk1 = generateGroupKey();
    let resource = buildGroupKeyResource({
      version: 1, groupKey: gk1, recipients: recipientsOf(admin, alice, mallory),
    });

    // Remove Mallory → rotate to v2 sealed ONLY to {admin, alice}.
    resource = rotateGroupKeyResource({
      previous: resource, recipients: recipientsOf(admin, alice),
    });

    // Admin seals NEW content under the current (v2) key.
    const gk2 = unwrapGroupKey(resource, admin.privateKey);
    const afterCipher = sealWithGroupKey('post-removal secret', gk2);

    // Alice (still a member) opens it.
    expect(openSealedAcrossVersions(afterCipher, resource, alice.privateKey)).toBe('post-removal secret');

    // Mallory holds no v2 key → cannot recover the group key or the content.
    expect(() => unwrapGroupKey(resource, mallory.privateKey)).toThrow(/not a recipient/);
    expect(() => openSealedAcrossVersions(afterCipher, resource, mallory.privateKey)).toThrow();
  });

  it('DEFENDED: the current key resource does not seal the new version to the ex-member', () => {
    const admin = generateKeypair();
    const bob   = generateKeypair();     // removed
    let resource = buildGroupKeyResource({
      version: 1, groupKey: generateGroupKey(), recipients: recipientsOf(admin, bob),
    });
    resource = rotateGroupKeyResource({ previous: resource, recipients: recipientsOf(admin) });
    // Bob cannot unwrap the CURRENT version at all.
    expect(() => unwrapGroupKeyVersion(resource, bob.privateKey, resource.version)).toThrow();
  });
});

describe('§7.5 — per-circle no-cross-seal (a member of circle A cannot read circle B)', () => {
  it('DEFENDED: distinct circle keys → no cross-circle decrypt', () => {
    const a = generateKeypair();
    const gkA = generateGroupKey();
    const gkB = generateGroupKey();
    const cipherB = sealWithGroupKey('circle B private', gkB);
    // A member holding circle A's key cannot open circle B's content.
    expect(() => openWithGroupKey(cipherB, gkA)).toThrow();
    expect(isSealed(cipherB)).toBe(true);
    expect(cipherB).not.toContain('circle B private');
  });
});

/**
 * ── SECURITY FINDING (GAP) — no backward secrecy on removal ──────────────
 *
 * A removed member who cached (a) the key resource at the moment of their
 * membership and (b) any ciphertext sealed while they were a member can
 * STILL decrypt that pre-removal content indefinitely. Rotation on removal
 * retains the outgoing version in `history[]` wrapped to its original
 * recipients (that member included), and no past content is re-encrypted.
 *
 * The probe below reconstructs exactly what a hostile ex-member would have
 * cached and shows the plaintext is still recoverable. It is marked
 * `it.fails` — vitest ASSERTS it throws the "locked out" expectation, i.e.
 * this codifies the gap: the test would go green the day re-keying also
 * denies historic content. Today it does NOT, so the ex-member DOES recover
 * the plaintext and the "should be locked out" expectation fails → the
 * `it.fails` wrapper passes while documenting the open gap. Honest red.
 */
describe('§7.5 — GAP: removed member retains access to PRE-removal content (documented)', () => {
  it.fails('a cached ex-member SHOULD be locked out of pre-removal content, but is NOT (gap)', () => {
    const admin   = generateKeypair();
    const mallory = generateKeypair();

    // v1 while Mallory is a member.
    const gk1 = generateGroupKey();
    const v1Resource = buildGroupKeyResource({
      version: 1, groupKey: gk1, recipients: recipientsOf(admin, mallory),
    });
    // Content sealed BEFORE removal.
    const beforeCipher = sealWithGroupKey('pre-removal secret Mallory saw', gk1);

    // Mallory, being hostile, CACHES the v1 key resource + the ciphertext
    // before she is removed. (An honest client wouldn't retain these, but
    // an attacker keeps their copies — the threat model.)
    const cachedResource = JSON.parse(JSON.stringify(v1Resource));
    const cachedCipher   = beforeCipher;

    // Admin removes Mallory → rotates to v2. (Doesn't matter for the cache.)
    rotateGroupKeyResource({ previous: v1Resource, recipients: recipientsOf(admin) });

    // From her cache, Mallory unwraps the v1 group key and opens the old
    // content. The GAP: this succeeds today.
    const stolenKey = unwrapGroupKey(cachedResource, mallory.privateKey);
    const recovered = openWithGroupKey(cachedCipher, stolenKey);

    // The assertion we WISH held (backward secrecy). It does not — so this
    // throws, and `it.fails` records the gap without faking a pass.
    expect(recovered).not.toBe('pre-removal secret Mallory saw');
  });

  it('GAP corollary: rotation retains the outgoing version wrapped to its original recipients', () => {
    const admin   = generateKeypair();
    const mallory = generateKeypair();
    const v1 = buildGroupKeyResource({
      version: 1, groupKey: generateGroupKey(), recipients: recipientsOf(admin, mallory),
    });
    const v2 = rotateGroupKeyResource({ previous: v1, recipients: recipientsOf(admin) });
    // The retained history entry is still openable by the removed member —
    // this is the mechanism behind the gap above, asserted directly.
    const historicKey = unwrapGroupKeyVersion(v2, mallory.privateKey, 1);
    expect(typeof historicKey).toBe('string');
    expect(historicKey.length).toBeGreaterThan(0);
  });
});

/**
 * PROOF that GroupManager-style proof revocation touches NO content key:
 * documented in the core suite (breach-sealing.test.js) — the sealing group
 * key and the Ed25519 membership proof are separate systems. If an app
 * revokes a proof without driving `controlAgent.removeMember`, content keys
 * are never rotated at all (a strictly worse variant of the gap above).
 */

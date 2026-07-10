import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { AgentIdentity, CapabilityToken } from '@canopy/core';
import { generateKeypair, makeSealer } from '@canopy/pod-client/sealing';
import {
  createCapabilityVerifier, anyVerifier,
} from '../src/adapters/capabilityVerifier.js';
import { uploadBlob, createBlobGatekeeper } from '../src/index.js';
import { makeMemoryBucket, makeAcl } from './helpers.js';

/* ── fixtures: REAL Ed25519 identities + genuinely-signed tokens ─────── */

const makeIdentity = () => new AgentIdentity({ seed: crypto.randomBytes(32) });

const self = makeIdentity(); // a circle member: SELF-ISSUES its own media.read token

/**
 * Issue a real, signed capability token. Default = SELF-ISSUED (issuer ===
 * subject === the signing key) — the media.read model: a self-attestation of
 * key possession. Pass `subject` to build a DELEGATED token (issuer ≠ subject)
 * for the guard tests.
 */
async function issueToken({ skill = 'media.read', expiresIn = 3_600_000, identity = self, subject } = {}) {
  const token = await CapabilityToken.issue(identity, {
    subject:   subject ?? identity.pubKey,   // self-issued unless a subject is forced
    agentId:   'blob-gate',
    skill,
    expiresIn,
  });
  return token.toJSON();
}

describe('createCapabilityVerifier — real signature verification by default', () => {
  it('valid token (object form) => { webId: <subject key> }', async () => {
    const verify = createCapabilityVerifier();
    expect(await verify(await issueToken())).toEqual({ webId: self.pubKey });
  });

  it('valid token (JSON-string wire form) => { webId: <subject key> }', async () => {
    const verify = createCapabilityVerifier();
    expect(await verify(JSON.stringify(await issueToken()))).toEqual({ webId: self.pubKey });
  });

  it('forged signature => null (tampered subject fails the issuer-key check)', async () => {
    const verify = createCapabilityVerifier();
    const mallory = makeIdentity();
    const raw = await issueToken();

    // Mallory swaps herself in as subject — signature no longer matches.
    expect(await verify({ ...raw, subject: mallory.pubKey })).toBeNull();
    // ...or garbles the signature outright.
    expect(await verify({ ...raw, sig: raw.sig.slice(0, -4) + 'AAAA' })).toBeNull();
    // ...or signs with her own key but claims the issuer's.
    const selfSigned = await issueToken({ identity: mallory });
    expect(await verify({ ...selfSigned, issuer: self.pubKey })).toBeNull();
  });

  it('expired token => null (injectable `now` clock)', async () => {
    const raw = await issueToken({ expiresIn: 3_600_000 });
    const verify = createCapabilityVerifier({
      verifySignature: () => true,                 // isolate the expiry check
      now: () => raw.expiresAt + 1,
    });
    expect(await verify(raw)).toBeNull();

    // And with the REAL default clock + signature path: an already-expired grant denies.
    const stale = await issueToken({ expiresIn: -1_000 });
    expect(await createCapabilityVerifier()(stale)).toBeNull();
  });

  it('wrong skill => null; `media.*` prefix and `*` wildcard match correctly', async () => {
    const verify = createCapabilityVerifier(); // requiredSkill defaults to 'media.read'

    expect(await verify(await issueToken({ skill: 'chat.send' }))).toBeNull();
    // 'media' is neither exact nor a prefix pattern — must NOT match 'media.read'.
    expect(await verify(await issueToken({ skill: 'media' }))).toBeNull();
    // Prefix + wildcard grants DO cover the gate's skill.
    expect(await verify(await issueToken({ skill: 'media.*' }))).toEqual({ webId: self.pubKey });
    expect(await verify(await issueToken({ skill: '*' }))).toEqual({ webId: self.pubKey });

    // Prefix correctness the other way: a 'media.*' GATE requirement is a concrete
    // id the token pattern must cover — 'media.rea' prefix-shaped tokens don't.
    const gate = createCapabilityVerifier({ requiredSkill: 'media.thumbnails' });
    expect(await gate(await issueToken({ skill: 'media.*' }))).toEqual({ webId: self.pubKey });
    expect(await gate(await issueToken({ skill: 'media.read' }))).toBeNull();
  });

  it('untrusted issuer => null when a trustedIssuers list is configured', async () => {
    const stranger = makeIdentity();
    const raw = await issueToken({ identity: stranger }); // genuinely signed, wrong circle

    const verify = createCapabilityVerifier({ trustedIssuers: [self.pubKey] });
    expect(await verify(raw)).toBeNull();
    expect(await verify(await issueToken())).toEqual({ webId: self.pubKey });

    // No list configured => any (self-issued) issuer whose signature checks is accepted.
    expect(await createCapabilityVerifier()(raw)).toEqual({ webId: stranger.pubKey });
  });

  it('revoked token => null when isRevoked is injected (TokenRegistry-shaped)', async () => {
    const raw = await issueToken();
    const revoked = new Set([raw.id]);
    const verify = createCapabilityVerifier({ isRevoked: async (id) => revoked.has(id) });

    expect(await verify(raw)).toBeNull();
    revoked.clear();
    expect(await verify(raw)).toEqual({ webId: self.pubKey });
  });

  it('malformed input => null (deny-by-default, never throws)', async () => {
    const verify = createCapabilityVerifier();
    expect(await verify(undefined)).toBeNull();
    expect(await verify(null)).toBeNull();
    expect(await verify('')).toBeNull();
    expect(await verify('not-json')).toBeNull();
    expect(await verify('{"broken')).toBeNull();
    expect(await verify(42)).toBeNull();
    const { sig, ...unsigned } = await issueToken();
    expect(await verify(unsigned)).toBeNull();          // shape: sig missing
    expect(await verify({ ...unsigned, sig: '' })).toBeNull();
  });

  it('a verifySignature / isRevoked seam that throws => null (deny, never leaks)', async () => {
    const raw = await issueToken();
    const sigThrows = createCapabilityVerifier({
      verifySignature: () => { throw new Error('hsm down'); },
    });
    expect(await sigThrows(raw)).toBeNull();

    const revThrows = createCapabilityVerifier({
      isRevoked: async () => { throw new Error('vault down'); },
    });
    expect(await revThrows(raw)).toBeNull();
  });
});

/* ── self-issued guard — the impersonation-safe media.read model ─────── */

describe('createCapabilityVerifier — requireSelfIssued (media.read is self-attestation)', () => {
  it('media.read DELEGATED token (issuer ≠ subject, genuinely signed) => null by default', async () => {
    // Mallory holds a real key; a member DELEGATES media.read to Mallory's key.
    // The token is validly signed by the member — but the actor it would grant is
    // Mallory, chosen by the member, not proven by Mallory. Self-issued default denies.
    const mallory = makeIdentity();
    const delegated = await issueToken({ subject: mallory.pubKey }); // issuer=self, subject=mallory
    expect(await createCapabilityVerifier()(delegated)).toBeNull();
  });

  it('the exploit it closes: nobody can mint a token that reads AS someone else', async () => {
    // Without the guard, `{ issuer: attacker, subject: victim, sig: attacker }`
    // verifies (sig matches issuer) and returns the VICTIM as actor. With it on,
    // issuer ≠ subject denies — forging subject needs the victim's private key.
    const victim = makeIdentity();
    const attacker = makeIdentity();
    const forged = await issueToken({ identity: attacker, subject: victim.pubKey });
    expect(await createCapabilityVerifier()(forged)).toBeNull();
  });

  it('requireSelfIssued: false opts into the delegated model (issuer ≠ subject allowed)', async () => {
    const grantee = makeIdentity();
    const delegated = await issueToken({ subject: grantee.pubKey });
    const verify = createCapabilityVerifier({ requireSelfIssued: false });
    expect(await verify(delegated)).toEqual({ webId: grantee.pubKey }); // the delegated actor
  });

  it('a wildcard/prefix requiredSkill defaults requireSelfIssued OFF (delegation is the point there)', async () => {
    const grantee = makeIdentity();
    const delegated = await issueToken({ skill: '*', subject: grantee.pubKey });
    // requiredSkill '*' — a broad capability that is meant to be delegable.
    const verify = createCapabilityVerifier({ requiredSkill: '*' });
    expect(await verify(delegated)).toEqual({ webId: grantee.pubKey });
    // ...but an explicit true still forces self-issued even for a wildcard gate.
    const strict = createCapabilityVerifier({ requiredSkill: '*', requireSelfIssued: true });
    expect(await strict(delegated)).toBeNull();
  });
});

/* ── anyVerifier — capability OR Solid, first non-null wins ──────────── */

describe('anyVerifier', () => {
  const yes = (webId) => async () => ({ webId });
  const no = async () => null;

  it('first non-null result wins, in order', async () => {
    expect(await anyVerifier(no, yes('a'), yes('b'))('t')).toEqual({ webId: 'a' });
    expect(await anyVerifier(yes('b'), yes('a'))('t')).toEqual({ webId: 'b' });
  });

  it('all-null => null; no verifiers => null', async () => {
    expect(await anyVerifier(no, no)('t')).toBeNull();
    expect(await anyVerifier()('t')).toBeNull();
  });

  it('a throwing verifier is treated as deny; later verifiers still run', async () => {
    const boom = async () => { throw new Error('down'); };
    expect(await anyVerifier(boom, yes('a'))('t')).toEqual({ webId: 'a' });
    expect(await anyVerifier(boom, no)('t')).toBeNull();
  });

  it('accepts capability OR Solid tokens (each verifier denies the other form)', async () => {
    const capability = createCapabilityVerifier();
    const solidish = async (t) => (t === 'solid-jwt' ? { webId: 'https://anne.pod/profile/card#me' } : null);
    const verify = anyVerifier(capability, solidish);

    expect(await verify(JSON.stringify(await issueToken()))).toEqual({ webId: self.pubKey });
    expect(await verify('solid-jwt')).toEqual({ webId: 'https://anne.pod/profile/card#me' });
    expect(await verify('neither')).toBeNull();
  });
});

/* ── composition: a capability token gates a presign end-to-end ──────── */

describe('capability token through createBlobGatekeeper (memory bucket)', () => {
  it('valid capability token + ACL grant => presigned URL to the ciphertext', async () => {
    const bucket = makeMemoryBucket();
    const { ref } = await uploadBlob({
      bytes: new Uint8Array([9, 8, 7]),
      bucket,
      sealer: makeSealer([generateKeypair().publicKey]),
      keyRef: 'urn:key:test',
    });

    const gate = createBlobGatekeeper({
      verifyToken: anyVerifier(createCapabilityVerifier({ trustedIssuers: [self.pubKey] })),
      acl: makeAcl([[self.pubKey, ref]]),   // the SUBJECT key is the ACL actor
      bucket,
    });

    // The wire form: the serialized token travels as the gate's bearer token.
    const res = await gate(JSON.stringify(await issueToken()), ref);
    expect(res.denied).toBeUndefined();
    expect(res.url).toMatch(/^https:\/\/bucket\.example\/presigned\//);
    expect(await bucket.fetchPresigned(res.url)).toBe(bucket.store.get(ref.replace('blob://', '')));

    // A forged token denies at the gate — no URL, no leak.
    const raw = await issueToken();
    const denied = await gate(JSON.stringify({ ...raw, subject: makeIdentity().pubKey }), ref);
    expect(denied.denied).toBe(true);
    expect(denied.url).toBeUndefined();
  });
});

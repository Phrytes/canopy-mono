// sealResolver.test.js — the ONE seal resolver: scheme chosen by policy, sealed once, opened by scheme.
//
// Covers: the scheme-by-policy mapping; a circle-content (group-key) datum a member opens and a non-member
// cannot; a per-resource-CEK share and a pairwise 1:1 each resolving to their scheme + round-tripping; and a
// brokered sealed-forward datum a broker cannot read but the final hop can. All node, no browser, seconds.
import { describe, it, expect } from 'vitest';
import {
  SEAL_SCHEMES, chooseSealScheme, resolveSealStrategy, sealForAudience, openSealedEnvelope,
} from '../src/sealing/sealResolver.js';
import { buildGroupKeyResource } from '../src/sealing/groupKeyResource.js';
import { generateKeypair, generateGroupKey } from '../src/sealing/envelope.js';
import { AgentIdentity, TextPart, signOrigin } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

describe('chooseSealScheme — scheme is named by policy, not by the call site', () => {
  it('maps each policy shape to exactly one scheme', () => {
    expect(chooseSealScheme({ audience: 'circle' })).toBe(SEAL_SCHEMES.GROUP_KEY);
    expect(chooseSealScheme({ audience: 'peer' })).toBe(SEAL_SCHEMES.PAIRWISE);
    expect(chooseSealScheme({ outOfCircle: true })).toBe(SEAL_SCHEMES.PAIRWISE);
    expect(chooseSealScheme({ share: 'scoped' })).toBe(SEAL_SCHEMES.PER_RESOURCE_CEK);
    expect(chooseSealScheme({ revocable: true })).toBe(SEAL_SCHEMES.PER_RESOURCE_CEK);
    expect(chooseSealScheme({ delivery: 'brokered' })).toBe(SEAL_SCHEMES.SEALED_FORWARD);
    expect(chooseSealScheme({ hops: 2 })).toBe(SEAL_SCHEMES.SEALED_FORWARD);
    // storage-at-rest posture axis
    expect(chooseSealScheme({ posture: 'p2' })).toBe(SEAL_SCHEMES.GROUP_KEY);
    expect(chooseSealScheme({ posture: 'p3' })).toBe(SEAL_SCHEMES.PAIRWISE);
    expect(chooseSealScheme({ posture: 'p0' })).toBeNull();
    expect(chooseSealScheme({ posture: 'p1' })).toBeNull();
    expect(chooseSealScheme({})).toBeNull();
  });

  it('an explicit scheme wins and an unknown one throws', () => {
    expect(chooseSealScheme({ scheme: SEAL_SCHEMES.GROUP_KEY, posture: 'p3' })).toBe(SEAL_SCHEMES.GROUP_KEY);
    expect(() => chooseSealScheme({ scheme: 'nope' })).toThrow(/unknown scheme/);
  });

  it('precedence: brokered delivery beats a scoped share beats a peer audience', () => {
    expect(chooseSealScheme({ delivery: 'brokered', share: 'scoped', audience: 'peer' }))
      .toBe(SEAL_SCHEMES.SEALED_FORWARD);
    expect(chooseSealScheme({ share: 'scoped', audience: 'peer' })).toBe(SEAL_SCHEMES.PER_RESOURCE_CEK);
  });
});

describe('group-key — circle content: a member opens it, a non-member cannot', () => {
  it('seals once under the circle group key; every member reads it, a stranger is denied', () => {
    const anne = generateKeypair();
    const bob = generateKeypair();
    const stranger = generateKeypair();
    const resource = buildGroupKeyResource({
      version: 1, groupKey: generateGroupKey(), recipients: [anne.publicKey, bob.publicKey],
    });

    // Anne (a member) seals circle content; the scheme is chosen by policy (audience: 'circle').
    const env = sealForAudience('circle notice: pizza friday', { resource, privateKey: anne.privateKey }, { audience: 'circle' });
    expect(env.scheme).toBe(SEAL_SCHEMES.GROUP_KEY);

    // Bob (a member) opens it via the retained key chain (openSealedAcrossVersions, newest-first).
    expect(openSealedEnvelope(env, { resource, privateKey: bob.privateKey })).toBe('circle notice: pizza friday');
    // A non-member holds no version of the group key → denied.
    expect(() => openSealedEnvelope(env, { resource, privateKey: stranger.privateKey })).toThrow();
  });
});

describe('per-resource-CEK — a scoped, revocable share round-trips under its own key', () => {
  it('resolves to the per-resource-CEK scheme and only that CEK opens it', () => {
    const env = sealForAudience('one scoped doc', { resourceId: 'doc-42' }, { share: 'scoped' });
    expect(env.scheme).toBe(SEAL_SCHEMES.PER_RESOURCE_CEK);
    expect(env.resourceId).toBe('doc-42');
    expect(typeof env.cek).toBe('string');                 // the custody secret is returned, not embedded in `sealed`

    expect(openSealedEnvelope(env, { cek: env.cek })).toBe('one scoped doc');
    expect(() => openSealedEnvelope(env, { cek: generateGroupKey() })).toThrow(); // a different resource's key can't open it
  });
});

describe('pairwise — a 1:1 / out-of-circle recipient set', () => {
  it('resolves to pairwise and only the recipient private key opens it', () => {
    const recipient = generateKeypair();
    const other = generateKeypair();
    const env = sealForAudience('just for you', { recipients: [recipient.publicKey] }, { audience: 'peer' });
    expect(env.scheme).toBe(SEAL_SCHEMES.PAIRWISE);

    expect(openSealedEnvelope(env, { privateKey: recipient.privateKey })).toBe('just for you');
    expect(() => openSealedEnvelope(env, { privateKey: other.privateKey })).toThrow(/not a recipient/);
  });
});

describe('sealed-forward — a brokered hop: the intermediary cannot read, the final hop can', () => {
  it('resolves to sealed-forward and only the addressed hop opens it', async () => {
    const alice = await AgentIdentity.generate(new VaultMemory());
    const carol = await AgentIdentity.generate(new VaultMemory());
    const mallory = await AgentIdentity.generate(new VaultMemory()); // the broker in the middle
    const parts = [TextPart('forward me')];
    const { sig, originTs } = signOrigin(alice, { target: carol.pubKey, skill: 'receive-message', parts });

    const datum = { skill: 'receive-message', parts, origin: alice.pubKey, originSig: sig, originTs };
    const env = sealForAudience(datum, { identity: alice, recipientPubKey: carol.pubKey }, { delivery: 'brokered' });
    expect(env.scheme).toBe(SEAL_SCHEMES.SEALED_FORWARD);

    const opened = openSealedEnvelope(env, { identity: carol, senderPubKey: alice.pubKey });
    expect(opened.skill).toBe('receive-message');
    expect(opened.origin).toBe(alice.pubKey);
    // The broker (Mallory) is not the addressed hop → cannot open.
    expect(() => openSealedEnvelope(env, { identity: mallory, senderPubKey: alice.pubKey })).toThrow();
  });
});

describe('resolveSealStrategy — the injectable { seal, open } form (the SealedPodClient seam)', () => {
  it('group-key + pairwise resolve to working strategies; sealed-forward is not a body strategy', () => {
    const m = generateKeypair();
    const resource = buildGroupKeyResource({ version: 1, groupKey: generateGroupKey(), recipients: [m.publicKey] });
    const gk = resolveSealStrategy({ posture: 'p2' }, { resource, privateKey: m.privateKey });
    expect(gk.scheme).toBe(SEAL_SCHEMES.GROUP_KEY);
    expect(gk.open(gk.seal('hi'))).toBe('hi');

    const pw = resolveSealStrategy({ posture: 'p3' }, { recipients: [m.publicKey], privateKey: m.privateKey });
    expect(pw.scheme).toBe(SEAL_SCHEMES.PAIRWISE);
    expect(pw.open(pw.seal('yo'))).toBe('yo');

    // sealed-forward (in transit, not a resource body) → no body strategy here.
    expect(resolveSealStrategy({ delivery: 'brokered' }, {})).toBeNull();
    // a scheme with no key material → null (fail-safe: caller falls back to a plain client).
    expect(resolveSealStrategy({ posture: 'p2' }, {})).toBeNull();
  });
});

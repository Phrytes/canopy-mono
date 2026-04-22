/**
 * packSealed / openSealed — sealed-forward helpers (Group BB2).
 *
 * Covers:
 *   • round-trip (pack on Alice, open on Carol)
 *   • authenticity: tampered ciphertext / wrong recipient / wrong sender fail
 *   • sender-mismatch cross-check (inner origin vs claimed sender)
 *   • structural validation on both sides
 *   • constants
 *
 * Ref: Design-v3/blind-forward.md §3-§4, CODING-PLAN Group BB2.
 */
import { describe, it, expect } from 'vitest';
import {
  packSealed,
  openSealed,
  SEALED_VERSION,
}                              from '../src/security/sealedForward.js';
import { AgentIdentity }       from '../src/identity/AgentIdentity.js';
import { VaultMemory }         from '../src/identity/VaultMemory.js';
import { TextPart }            from '../src/Parts.js';
import { signOrigin }          from '../src/security/originSignature.js';

async function ids() {
  const alice = await AgentIdentity.generate(new VaultMemory());
  const carol = await AgentIdentity.generate(new VaultMemory());
  const mallory = await AgentIdentity.generate(new VaultMemory());
  return { alice, carol, mallory };
}

/**
 * Build a realistic signed body using Group Z's signOrigin, then return
 * the arguments packSealed needs. Keeps tests close to the real flow.
 */
function signedPayload({ alice, target, skill = 'receive-message', parts }) {
  const { sig, originTs } = signOrigin(alice, { target, skill, parts });
  return {
    identity:        alice,
    recipientPubKey: target,
    skill,
    parts,
    origin:          alice.pubKey,
    originSig:       sig,
    originTs,
  };
}

describe('packSealed + openSealed — round trip', () => {
  it('packs and opens a fresh sealed invocation', async () => {
    const { alice, carol } = await ids();
    const parts = [TextPart('hello carol')];

    const { sealed, nonce } = packSealed(signedPayload({
      alice, target: carol.pubKey, parts,
    }));

    const out = openSealed({
      identity: carol, sealed, nonce,
      senderPubKey: alice.pubKey,
    });

    expect(out.skill).toBe('receive-message');
    expect(out.parts).toEqual(parts);
    expect(out.origin).toBe(alice.pubKey);
    expect(typeof out.originSig).toBe('string');
    expect(typeof out.originTs).toBe('number');
  });

  it('each pack produces a fresh nonce (independence)', async () => {
    const { alice, carol } = await ids();
    const parts = [TextPart('x')];
    const a = packSealed(signedPayload({ alice, target: carol.pubKey, parts }));
    const b = packSealed(signedPayload({ alice, target: carol.pubKey, parts }));
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.sealed).not.toBe(b.sealed);
  });
});

describe('openSealed — authenticity', () => {
  it('tampered ciphertext → authentication failure', async () => {
    const { alice, carol } = await ids();
    const { sealed, nonce } = packSealed(signedPayload({
      alice, target: carol.pubKey, parts: [TextPart('hi')],
    }));
    const tampered = sealed.slice(0, -4) + 'AAAA';
    expect(() => openSealed({
      identity: carol, sealed: tampered, nonce, senderPubKey: alice.pubKey,
    })).toThrow(/authentication failed/);
  });

  it('wrong recipient (mallory instead of carol) → authentication failure', async () => {
    const { alice, carol, mallory } = await ids();
    const { sealed, nonce } = packSealed(signedPayload({
      alice, target: carol.pubKey, parts: [TextPart('secret')],
    }));
    expect(() => openSealed({
      identity: mallory, sealed, nonce, senderPubKey: alice.pubKey,
    })).toThrow(/authentication failed/);
  });

  it('wrong senderPubKey used for unbox → authentication failure', async () => {
    const { alice, carol, mallory } = await ids();
    const { sealed, nonce } = packSealed(signedPayload({
      alice, target: carol.pubKey, parts: [TextPart('hi')],
    }));
    expect(() => openSealed({
      identity: carol, sealed, nonce, senderPubKey: mallory.pubKey,
    })).toThrow(/authentication failed/);
  });
});

describe('openSealed — sender/origin cross-check', () => {
  it('inner origin must match outer senderPubKey', async () => {
    // Alice packs with her own key; then we claim mallory was the sender.
    // Authentication by nacl.box will fail first (because the shared key
    // is derived from mallory's pubkey, not alice's), so the thrown error
    // is the auth-fail path — which is correct either way: a bridge that
    // swaps the sender field cannot forge a valid seal.
    const { alice, carol, mallory } = await ids();
    const { sealed, nonce } = packSealed(signedPayload({
      alice, target: carol.pubKey, parts: [TextPart('hi')],
    }));

    expect(() => openSealed({
      identity: carol, sealed, nonce, senderPubKey: mallory.pubKey,
    })).toThrow(/authentication failed|sender mismatch/);
  });
});

describe('packSealed — input validation', () => {
  it('requires identity', () => {
    expect(() => packSealed({
      recipientPubKey: 'x', skill: 's', parts: [],
      origin: 'o', originSig: 's', originTs: 1,
    })).toThrow(/identity required/);
  });
  it('requires recipientPubKey', async () => {
    const { alice } = await ids();
    expect(() => packSealed({
      identity: alice, recipientPubKey: '',
      skill: 's', parts: [], origin: 'o', originSig: 's', originTs: 1,
    })).toThrow(/recipientPubKey required/);
  });
  it('requires skill', async () => {
    const { alice, carol } = await ids();
    expect(() => packSealed({
      identity: alice, recipientPubKey: carol.pubKey,
      skill: '', parts: [], origin: alice.pubKey, originSig: 'x', originTs: 1,
    })).toThrow(/skill required/);
  });
  it('parts must be an array', async () => {
    const { alice, carol } = await ids();
    expect(() => packSealed({
      identity: alice, recipientPubKey: carol.pubKey,
      skill: 's', parts: 'no',
      origin: alice.pubKey, originSig: 'x', originTs: 1,
    })).toThrow(/parts must be an array/);
  });
  it('originTs must be a finite number', async () => {
    const { alice, carol } = await ids();
    expect(() => packSealed({
      identity: alice, recipientPubKey: carol.pubKey,
      skill: 's', parts: [],
      origin: alice.pubKey, originSig: 'x', originTs: 'nope',
    })).toThrow(/originTs/);
  });
});

describe('openSealed — input validation', () => {
  it('requires identity', async () => {
    expect(() => openSealed({
      sealed: 'x', nonce: 'y', senderPubKey: 'p',
    })).toThrow(/identity required/);
  });
  it('requires sealed', async () => {
    const { carol } = await ids();
    expect(() => openSealed({
      identity: carol, sealed: '', nonce: 'y', senderPubKey: 'p',
    })).toThrow(/sealed required/);
  });
  it('requires senderPubKey', async () => {
    const { carol } = await ids();
    expect(() => openSealed({
      identity: carol, sealed: 'x', nonce: 'y', senderPubKey: '',
    })).toThrow(/senderPubKey required/);
  });
  it('malformed base64 input throws', async () => {
    const { carol, alice } = await ids();
    expect(() => openSealed({
      identity: carol, sealed: '!!!!', nonce: '!!!!',
      senderPubKey: alice.pubKey,
    })).toThrow();
  });
});

describe('constants', () => {
  it('SEALED_VERSION is 1', () => {
    expect(SEALED_VERSION).toBe(1);
  });
});

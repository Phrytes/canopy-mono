/**
 * tunnelSeal — symmetric AEAD helpers for Group CC3b in-tunnel OWs.
 */
import { describe, it, expect } from 'vitest';
import {
  generateTunnelKey,
  sealTunnelOW,
  openTunnelOW,
} from '../src/security/tunnelSeal.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory }   from '../src/identity/VaultMemory.js';
import { packSealed, openSealed } from '../src/security/sealedForward.js';

describe('generateTunnelKey', () => {
  it('produces a distinct 32-byte base64url key each time', () => {
    const a = generateTunnelKey();
    const b = generateTunnelKey();
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(40);
    expect(a).not.toBe(b);
  });
});

describe('sealTunnelOW / openTunnelOW', () => {
  const K = generateTunnelKey();

  it('round-trips an inner OW', () => {
    const inner = { type: 'stream-chunk', parts: [{ type: 'TextPart', text: 'hi' }] };
    const { sealed, nonce } = sealTunnelOW({ key: K, innerOW: inner });
    const opened = openTunnelOW({ key: K, sealed, nonce });
    expect(opened).toEqual(inner);
  });

  it('returns null when opened with the wrong key', () => {
    const inner = { type: 'cancel' };
    const { sealed, nonce } = sealTunnelOW({ key: K, innerOW: inner });
    const K2 = generateTunnelKey();
    expect(openTunnelOW({ key: K2, sealed, nonce })).toBeNull();
  });

  it('returns null when the ciphertext is tampered with', () => {
    const inner = { type: 'task-input', parts: [] };
    const { sealed, nonce } = sealTunnelOW({ key: K, innerOW: inner });
    const bad = sealed.slice(0, -2) + 'AA';
    expect(openTunnelOW({ key: K, sealed: bad, nonce })).toBeNull();
  });

  it('rejects missing args', () => {
    expect(() => sealTunnelOW({})).toThrow(/key required/);
    expect(() => sealTunnelOW({ key: K })).toThrow(/innerOW/);
  });
});

// ── packSealed extras plumbing (used by CC3b to carry tunnelKey / aliceTaskId)
describe('packSealed/openSealed extras round-trip', () => {
  it('preserves extras across seal/open', async () => {
    const alice = await AgentIdentity.generate(new VaultMemory());
    const carol = await AgentIdentity.generate(new VaultMemory());

    const K   = generateTunnelKey();
    const atk = 'alice-task-id-abc';

    const { sealed, nonce } = packSealed({
      identity:        alice,
      recipientPubKey: carol.pubKey,
      skill:           'echo',
      parts:           [{ type: 'TextPart', text: 'hi' }],
      origin:          alice.pubKey,
      originSig:       'sig',
      originTs:        1234,
      extras:          { tunnelKey: K, aliceTaskId: atk },
    });

    const opened = openSealed({
      identity:     carol,
      sealed, nonce,
      senderPubKey: alice.pubKey,
    });

    expect(opened.skill).toBe('echo');
    expect(opened.extras.tunnelKey).toBe(K);
    expect(opened.extras.aliceTaskId).toBe(atk);
  });

  it('core openSealed fields still work when extras is absent', async () => {
    const alice = await AgentIdentity.generate(new VaultMemory());
    const carol = await AgentIdentity.generate(new VaultMemory());

    const { sealed, nonce } = packSealed({
      identity:        alice,
      recipientPubKey: carol.pubKey,
      skill:           'echo',
      parts:           [],
      origin:          alice.pubKey,
      originSig:       'sig',
      originTs:        999,
    });
    const opened = openSealed({
      identity:     carol,
      sealed, nonce,
      senderPubKey: alice.pubKey,
    });
    expect(opened.extras).toEqual({});
  });

  it('refuses to overwrite core fields via extras', async () => {
    const alice = await AgentIdentity.generate(new VaultMemory());
    const carol = await AgentIdentity.generate(new VaultMemory());

    const { sealed, nonce } = packSealed({
      identity:        alice,
      recipientPubKey: carol.pubKey,
      skill:           'echo',
      parts:           [],
      origin:          alice.pubKey,
      originSig:       'sig',
      originTs:        1,
      extras:          { skill: 'ATTACK', extra: 'kept' },
    });
    const opened = openSealed({
      identity:     carol,
      sealed, nonce,
      senderPubKey: alice.pubKey,
    });
    expect(opened.skill).toBe('echo');        // not overwritten
    expect(opened.extras.extra).toBe('kept'); // other extras survive
  });
});

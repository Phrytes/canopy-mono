import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import {
  recipientId, generateKeypair, generateGroupKey, isSealed,
  seal, open, sealWithGroupKey, openWithGroupKey,
  makeSealer, makeOpener, makeGroupSealer, makeGroupOpener,
  sealingPublicKeyFromNetworkKey, sealingKeyPairFromNetworkKey,
} from '../src/sealing/index.js';

const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('sealing — derive a sealing key from a PUBLISHED Ed25519 NETWORK key (out-of-circle recipients)', () => {
  it('the granter (public network key) and the recipient (network secret) derive the SAME sealing public key', () => {
    const kp = nacl.sign.keyPair();
    const fromPublic = sealingPublicKeyFromNetworkKey(b64u(kp.publicKey));
    const fromSecret = sealingKeyPairFromNetworkKey(b64u(kp.secretKey));
    expect(fromSecret.publicKey).toBe(fromPublic);
    expect(fromSecret.recipientId).toBe(recipientId(fromPublic));
  });

  it('round-trips through the REAL envelope: seal to the derived public key, open with the derived private key', () => {
    const kp = nacl.sign.keyPair();
    const pub = sealingPublicKeyFromNetworkKey(b64u(kp.publicKey));
    const { privateKey } = sealingKeyPairFromNetworkKey(b64u(kp.secretKey));
    const sealed = seal('cross-circle body', [pub]);
    expect(open(sealed, privateKey)).toBe('cross-circle body');
  });

  it('a DIFFERENT network identity cannot open it; malformed keys throw', () => {
    const a = nacl.sign.keyPair(); const b = nacl.sign.keyPair();
    const sealed = seal('x', [sealingPublicKeyFromNetworkKey(b64u(a.publicKey))]);
    expect(() => open(sealed, sealingKeyPairFromNetworkKey(b64u(b.secretKey)).privateKey)).toThrow(/not a recipient/);
    expect(() => sealingPublicKeyFromNetworkKey(b64u(new Uint8Array(10)))).toThrow(/32-byte Ed25519/);
    expect(() => sealingKeyPairFromNetworkKey(b64u(new Uint8Array(7)))).toThrow(/32-byte seed or 64-byte/);
  });

  it('accepts either a 32-byte seed or a 64-byte nacl secret key for the recipient derivation', () => {
    const seed = nacl.randomBytes(32);
    const kp = nacl.sign.keyPair.fromSeed(seed);
    const fromSeed = sealingKeyPairFromNetworkKey(b64u(seed));
    const fromSecret = sealingKeyPairFromNetworkKey(b64u(kp.secretKey));
    expect(fromSeed.publicKey).toBe(fromSecret.publicKey);
    expect(fromSeed.publicKey).toBe(sealingPublicKeyFromNetworkKey(b64u(kp.publicKey)));
  });
});

describe('sealing — recipient mode', () => {
  it('round-trips a single recipient', () => {
    const k = generateKeypair();
    const env = seal('hello world', k.publicKey);
    expect(isSealed(env)).toBe(true);
    expect(env).not.toContain('hello world');
    expect(open(env, k.privateKey)).toBe('hello world');
  });

  it('round-trips multiple recipients (each can open the same envelope)', () => {
    const a = generateKeypair(); const b = generateKeypair();
    const env = seal('shared secret', [a.publicKey, b.publicKey]);
    expect(open(env, a.privateKey)).toBe('shared secret');
    expect(open(env, b.privateKey)).toBe('shared secret');
  });

  it('a non-recipient cannot open it', () => {
    const k = generateKeypair(); const stranger = generateKeypair();
    const env = seal('private', k.publicKey);
    expect(() => open(env, stranger.privateKey)).toThrow(/not a recipient/);
  });

  it('open passes plaintext / non-sealed text through unchanged', () => {
    const k = generateKeypair();
    expect(open('just text', k.privateKey)).toBe('just text');
    expect(isSealed('just text')).toBe(false);
  });

  it('recipientId is stable + 8-byte-derived', () => {
    const k = generateKeypair();
    expect(recipientId(k.publicKey)).toBe(k.recipientId);
    expect(recipientId(k.publicKey)).toBe(recipientId(k.publicKey));
  });

  it('seal requires at least one recipient', () => {
    expect(() => seal('x', [])).toThrow(/at least one recipient/);
  });
});

describe('sealing — group-key mode', () => {
  it('round-trips under a shared group key', () => {
    const gk = generateGroupKey();
    const env = sealWithGroupKey('household note', gk);
    expect(isSealed(env)).toBe(true);
    expect(env).not.toContain('household note');
    expect(openWithGroupKey(env, gk)).toBe('household note');
  });

  it('a different group key cannot open it', () => {
    const env = sealWithGroupKey('note', generateGroupKey());
    expect(() => openWithGroupKey(env, generateGroupKey())).toThrow();
  });

  it('the two modes reject each other (clear error, no silent garbage)', () => {
    const k = generateKeypair(); const gk = generateGroupKey();
    expect(() => open(sealWithGroupKey('x', gk), k.privateKey)).toThrow(/group-key envelope/);
    expect(() => openWithGroupKey(seal('x', k.publicKey), gk)).toThrow(/recipient envelope/);
  });

  it('group key is distributed via recipient-mode seal (join → member opens content)', () => {
    // A control-agent generates a group key, seals content under it, and distributes the key by
    // sealing it to each member's public key (the household shared-pod model).
    const gk = generateGroupKey();
    const content = sealWithGroupKey('the shared list', gk);
    const alice = generateKeypair(); const bob = generateKeypair();
    const keyResource = seal(gk, [alice.publicKey, bob.publicKey]);   // /.keys/group-vN.json
    // Bob joins: unwraps the group key from the key resource, then opens the content.
    const bobsGroupKey = open(keyResource, bob.privateKey);
    expect(bobsGroupKey).toBe(gk);
    expect(openWithGroupKey(content, bobsGroupKey)).toBe('the shared list');
  });
});

describe('sealing — closures', () => {
  it('makeSealer/makeOpener + makeGroupSealer/makeGroupOpener', () => {
    const k = generateKeypair();
    const sealer = makeSealer(k.publicKey); const opener = makeOpener(k.privateKey);
    expect(opener(sealer('via closures'))).toBe('via closures');
    const gk = generateGroupKey();
    const gs = makeGroupSealer(gk); const go = makeGroupOpener(gk);
    expect(go(gs('group via closures'))).toBe('group via closures');
  });
});

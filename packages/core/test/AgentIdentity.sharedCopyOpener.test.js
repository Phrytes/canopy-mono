/**
 * AgentIdentity.sharedCopyOpener — the ENCAPSULATED opener seam for SILENT out-of-circle "shared with me"
 * copies. The X25519 sealing derivation + envelope `open` live in the `@onderling/pod-client` ADAPTER, which the
 * kernel must NOT depend up on (invariant #5) — so the kernel exposes a HOLE the app fills with an injected
 * `deriveOpener(networkSecretB64) => opener` builder, and hands it the raw network secret INTERNALLY. This test
 * proves the encapsulation contract WITHOUT pod-client (unresolvable from the kernel):
 *   • the method returns the opener CLOSURE (a function), never key bytes;
 *   • the secret handed to the builder IS this agent's real 64-byte Ed25519 network secret (the counterpart the
 *     sender's `sealingPublicKeyFromNetworkKey(pubKey)` pairs with) — proven deterministically from a mnemonic;
 *   • nothing on the public API surfaces the raw secret / private key.
 */
import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';
import { generateMnemonic } from '../src/identity/Mnemonic.js';
import { mnemonicToSeed } from '../src/identity/Mnemonic.js';
import { encode as b64encode, decode as b64decode } from '../src/crypto/b64.js';

describe('AgentIdentity.sharedCopyOpener — encapsulated opener seam', () => {
  it('returns ONLY the opener closure the injected builder produced (a function, not key bytes)', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const sentinelOpener = (text) => `opened:${text}`;
    let received;
    const deriveOpener = (secretB64) => { received = secretB64; return sentinelOpener; };

    const opener = id.sharedCopyOpener(deriveOpener);
    expect(typeof opener).toBe('function');
    expect(opener).toBe(sentinelOpener);        // exactly the closure the builder returned
    expect(opener('x')).toBe('opened:x');
    // The returned value is a function — NOT raw key material.
    expect(opener).not.toBeInstanceOf(Uint8Array);
    expect(typeof opener).not.toBe('string');
    // A secret WAS handed to the builder (that is how the app derives the sealing key) — a b64 string, not the
    // opener the caller receives. The caller never sees `received`.
    expect(typeof received).toBe('string');
  });

  it('hands the builder THIS agent\'s real 64-byte Ed25519 network secret (sender-pairing counterpart)', async () => {
    // Deterministic identity from a mnemonic so we can independently derive the expected secret.
    const mnemonic = generateMnemonic();
    const id = await AgentIdentity.fromMnemonic(mnemonic, new VaultMemory());
    const expectedSecret = nacl.sign.keyPair.fromSeed(mnemonicToSeed(mnemonic)).secretKey;   // 64 bytes

    let secretB64;
    id.sharedCopyOpener((s) => { secretB64 = s; return (t) => t; });

    const secretBytes = b64decode(secretB64);
    expect(secretBytes.length).toBe(64);                                  // nacl Ed25519 secret key
    expect(b64encode(secretBytes)).toBe(b64encode(expectedSecret));       // it IS our network secret
    // The public half of that secret is exactly `pubKey` — what a sender seals to.
    expect(b64encode(secretBytes.subarray(32))).toBe(id.pubKey);
  });

  it('rejects a missing / non-function builder and a builder that returns a non-function', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    expect(() => id.sharedCopyOpener()).toThrow(/deriveOpener/);
    expect(() => id.sharedCopyOpener(null)).toThrow(/deriveOpener/);
    expect(() => id.sharedCopyOpener(() => 'not-a-function')).toThrow(/opener function/);
  });

  it('does NOT expose the raw network secret anywhere on the public API', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    // No getter/property leaks key bytes: pubKey is public (Ed25519 public), but there is no secret accessor.
    expect(id.secretKey).toBeUndefined();
    expect(id.privateKey).toBeUndefined();
    expect(id.networkSecret).toBeUndefined();
    for (const [, v] of Object.entries(id)) {
      expect(v).not.toBeInstanceOf(Uint8Array);   // no raw key bytes enumerable on the instance
    }
    // The opener seam yields a function — the only way the secret flows is INTO the injected builder.
    expect(typeof id.sharedCopyOpener((s) => (t) => t)).toBe('function');
  });
});

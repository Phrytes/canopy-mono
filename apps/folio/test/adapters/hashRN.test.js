/**
 * hashRN.test.js — adapter against a mocked `expo-crypto` namespace.
 *
 * The mock implements `digestStringAsync(algorithm, data, opts)` using
 * `node:crypto` so we can verify the digest matches what we'd get on a
 * real Expo install.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import { createHashRN } from '../../src/adapters/hashRN.js';
import { hashNode }     from '../../src/adapters/hashNode.js';

/**
 * Build a mock `expo-crypto` namespace.  Honours both UTF8 and BASE64
 * source encodings so the bytes-path of `createHashRN` works.
 */
function buildMockCrypto() {
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256', SHA1: 'SHA-1' },
    CryptoEncoding:        { UTF8: 'utf8', BASE64: 'base64', HEX: 'hex' },

    async digestStringAsync(algorithm, data, opts = {}) {
      if (algorithm !== 'SHA-256') throw new Error(`unsupported algo: ${algorithm}`);
      const enc = opts.encoding ?? 'utf8';
      const h = createHash('sha256');
      if (enc === 'base64') {
        h.update(Buffer.from(String(data), 'base64'));
      } else {
        h.update(String(data ?? ''), 'utf8');
      }
      return h.digest('hex');
    },
  };
}

describe('createHashRN — surface', () => {
  it('rejects calls without a Crypto namespace', () => {
    expect(() => createHashRN({})).toThrow(/Crypto/);
  });
  it('builds an adapter with a sha256() method', () => {
    const Crypto = buildMockCrypto();
    const h = createHashRN({ Crypto });
    expect(typeof h.sha256).toBe('function');
  });
});

describe('hashRN — sha256 correctness vs Node', () => {
  const Crypto = buildMockCrypto();
  const rn   = createHashRN({ Crypto });

  it('matches Node digest for empty input', async () => {
    const a = await rn.sha256('');
    const b = await hashNode.sha256('');
    expect(a).toBe(b);
  });

  it('matches Node digest for a UTF-8 string', async () => {
    const text = '# Hello, world\n— and friends.';
    const a = await rn.sha256(text);
    const b = await hashNode.sha256(text);
    expect(a).toBe(b);
  });

  it('matches Node digest for a Uint8Array', async () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x10, 0x20, 0xff]);
    const a = await rn.sha256(bytes);
    const b = await hashNode.sha256(bytes);
    expect(a).toBe(b);
  });

  it('matches Node digest for a Buffer', async () => {
    const buf = Buffer.from('Folio binary');
    const a = await rn.sha256(buf);
    const b = await hashNode.sha256(buf);
    expect(a).toBe(b);
  });

  it('null and "" produce the same digest', async () => {
    const a = await rn.sha256(null);
    const b = await rn.sha256('');
    expect(a).toBe(b);
  });
});

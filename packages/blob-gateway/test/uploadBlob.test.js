import { describe, it, expect } from 'vitest';
import { generateKeypair, makeSealer, makeOpener, isSealed } from '@onderling/pod-client/sealing';
import { uploadBlob, bytesToB64u, b64uToBytes, BLOB_SCHEME, BLOB_TYPE } from '../src/index.js';
import { makeMemoryBucket } from './helpers.js';

const plaintext = () => new Uint8Array([0, 1, 2, 250, 251, 255, 42, 7]); // includes non-ascii bytes

describe('uploadBlob — client-side encrypt to an untrusted bucket', () => {
  it('stores CIPHERTEXT in the bucket, never the plaintext bytes', async () => {
    const { publicKey } = generateKeypair();
    const bucket = makeMemoryBucket();
    const sealer = makeSealer([publicKey]);

    const { key, ciphertext, manifestLine } = await uploadBlob({
      bytes: plaintext(), bucket, sealer, keyRef: 'urn:key:test',
    });

    const stored = bucket.store.get(key);
    expect(stored).toBe(ciphertext);
    // At-rest = a sealing envelope, NOT the plaintext (or its b64u).
    expect(isSealed(stored)).toBe(true);
    expect(stored).not.toContain(bytesToB64u(plaintext()));
    expect(typeof stored).toBe('string'); // ascii envelope, not raw bytes
  });

  it('returns a cross-pod-ref `embeds` manifest line with the right shape', async () => {
    const { publicKey } = generateKeypair();
    const bucket = makeMemoryBucket();
    const { ref, manifestLine, key } = await uploadBlob({
      bytes: plaintext(), bucket, sealer: makeSealer([publicKey]), keyRef: 'grpkey://res/1',
    });

    expect(manifestLine.type).toBe(BLOB_TYPE);
    expect(manifestLine.ref).toBe(ref);
    expect(ref.startsWith(BLOB_SCHEME)).toBe(true);
    expect(ref).toBe(BLOB_SCHEME + key);
    expect(manifestLine.enc).toMatchObject({ sealed: true, keyRef: 'grpkey://res/1', format: 'fp1' });
    // The manifest carries a POINTER to key material, never the key itself.
    expect(JSON.stringify(manifestLine)).not.toContain(publicKey);
  });

  it('round-trips: presign-fetch the ciphertext + decrypt locally => original bytes', async () => {
    const kp = generateKeypair();
    const bucket = makeMemoryBucket();
    const original = plaintext();

    const { key } = await uploadBlob({
      bytes: original, bucket, sealer: makeSealer([kp.publicKey]), keyRef: 'urn:key:test',
    });

    // Simulate the read path fetch of the ciphertext, then client-side decrypt.
    const url = await bucket.presign(key, { ttl: 60 });
    const fetched = await bucket.fetchPresigned(url); // ciphertext
    const opener = makeOpener(kp.privateKey);
    const roundTripped = b64uToBytes(opener(fetched));

    expect(Array.from(roundTripped)).toEqual(Array.from(original));
  });

  it('refuses to upload if the sealer returns plaintext (invariant guard)', async () => {
    const bucket = makeMemoryBucket();
    const identitySealer = (t) => t; // does NOT seal
    await expect(uploadBlob({ bytes: plaintext(), bucket, sealer: identitySealer }))
      .rejects.toThrow(/refusing to upload plaintext/);
    expect(bucket.store.size).toBe(0);
  });
});

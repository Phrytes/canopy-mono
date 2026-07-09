import { describe, it, expect } from 'vitest';
import {
  generateKeypair, makeSealer, makeOpener, generateGroupKey, makeGroupSealer, makeGroupOpener,
} from '@canopy/pod-client/sealing';
import { uploadBlob, openBlob, createBlobGatekeeper, bytesToB64u } from '../src/index.js';
import { makeMemoryBucket, makeVerifier, makeAcl } from './helpers.js';

const WEBID = 'https://anne.pod/profile/card#me';

const binary = () => new Uint8Array([0, 1, 2, 250, 251, 255, 42, 7]); // includes non-ascii bytes
const text = () => new TextEncoder().encode('hallo blob-gateway — rondje erheen en terug');

/** Upload a blob and stand up a gate that grants WEBID('good-token') read on its ref. */
async function seedReadable(bytes, { sealer }) {
  const bucket = makeMemoryBucket();
  const { ref, manifestLine, key } = await uploadBlob({ bytes, bucket, sealer, keyRef: 'urn:key:test' });
  const gate = createBlobGatekeeper({
    verifyToken: makeVerifier({ 'good-token': WEBID }),
    acl: makeAcl([[WEBID, ref]]),
    bucket,
  });
  return { bucket, gate, ref, manifestLine, key };
}

describe('openBlob — gate-resolved fetch + local decrypt (inverse of uploadBlob)', () => {
  it('round-trips BINARY bytes: uploadBlob -> openBlob => byte-identical', async () => {
    const kp = generateKeypair();
    const original = binary();
    const { bucket, gate, ref } = await seedReadable(original, { sealer: makeSealer([kp.publicKey]) });

    const { bytes, key, url } = await openBlob({
      ref, gate, token: 'good-token', opener: makeOpener(kp.privateKey),
      fetch: bucket.fetchPresigned,
    });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual(Array.from(original));
    expect(ref).toBe('blob://' + key);
    expect(url).toMatch(/^https:\/\/bucket\.example\/presigned\//);
  });

  it('round-trips TEXT bytes under a GROUP key (circle mode), given the manifest line', async () => {
    const groupKey = generateGroupKey();
    const original = text();
    const { bucket, gate, manifestLine } = await seedReadable(original, { sealer: makeGroupSealer(groupKey) });

    // Callers hold the `embeds` manifest line — openBlob accepts it directly.
    const { bytes } = await openBlob({
      ref: manifestLine, gate, token: 'good-token', opener: makeGroupOpener(groupKey),
      fetch: bucket.fetchPresigned,
    });

    expect(new TextDecoder().decode(bytes)).toBe(new TextDecoder().decode(original));
  });

  it('rejects a non-blob ref (never asks the gate for an arbitrary scheme)', async () => {
    const kp = generateKeypair();
    const { bucket, gate } = await seedReadable(binary(), { sealer: makeSealer([kp.publicKey]) });
    const args = { gate, token: 'good-token', opener: makeOpener(kp.privateKey), fetch: bucket.fetchPresigned };

    await expect(openBlob({ ...args, ref: 'https://evil.example/secret' }))
      .rejects.toThrow(/not a blob ref/);
    await expect(openBlob({ ...args, ref: 'blob://' })) // scheme with no bucket key
      .rejects.toThrow(/no bucket key/);
    await expect(openBlob({ ...args, ref: undefined }))
      .rejects.toThrow(/not a blob ref/);
  });

  it('a gatekeeper denial surfaces as a denied error (deny-by-default, no bytes)', async () => {
    const kp = generateKeypair();
    const { bucket, gate, ref } = await seedReadable(binary(), { sealer: makeSealer([kp.publicKey]) });
    const args = { ref, gate, opener: makeOpener(kp.privateKey), fetch: bucket.fetchPresigned };

    await expect(openBlob({ ...args, token: 'forged-token' }))
      .rejects.toThrow(/access denied \(invalid-token\)/);
    await expect(openBlob({ ...args, token: undefined }))
      .rejects.toThrow(/access denied \(no-token\)/);
  });

  it('an ACL deny never reaches the bucket', async () => {
    const kp = generateKeypair();
    const bucket = makeMemoryBucket();
    const { ref } = await uploadBlob({
      bytes: binary(), bucket, sealer: makeSealer([kp.publicKey]), keyRef: 'urn:key:test',
    });
    const gate = createBlobGatekeeper({
      verifyToken: makeVerifier({ 'good-token': WEBID }),
      acl: makeAcl([]), // no grants
      bucket,
    });
    let fetched = 0;
    await expect(openBlob({
      ref, gate, token: 'good-token', opener: makeOpener(kp.privateKey),
      fetch: async (url) => { fetched++; return bucket.fetchPresigned(url); },
    })).rejects.toThrow(/access denied \(acl\)/);
    expect(fetched).toBe(0);
  });

  it('refuses to return PLAINTEXT-at-rest (symmetric with uploadBlob\'s refusal)', async () => {
    const kp = generateKeypair();
    const { bucket, gate, ref, key } = await seedReadable(binary(), { sealer: makeSealer([kp.publicKey]) });
    // Corrupt the bucket: overwrite the object with unsealed content.
    bucket.store.set(key, bytesToB64u(binary()));

    await expect(openBlob({
      ref, gate, token: 'good-token', opener: makeOpener(kp.privateKey),
      fetch: bucket.fetchPresigned,
    })).rejects.toThrow(/refusing to return plaintext/);
  });

  it('an unseal failure (not a recipient) surfaces in the package error style', async () => {
    const kp = generateKeypair();
    const stranger = generateKeypair(); // holds a different private key
    const { bucket, gate, ref } = await seedReadable(binary(), { sealer: makeSealer([kp.publicKey]) });

    await expect(openBlob({
      ref, gate, token: 'good-token', opener: makeOpener(stranger.privateKey),
      fetch: bucket.fetchPresigned,
    })).rejects.toThrow(/unseal failed — .*not a recipient/);
  });

  it('an expired presigned URL surfaces as no-content, not silent undefined', async () => {
    const kp = generateKeypair();
    const bucket = makeMemoryBucket();
    const { ref } = await uploadBlob({
      bytes: binary(), bucket, sealer: makeSealer([kp.publicKey]), keyRef: 'urn:key:test',
    });
    const gate = createBlobGatekeeper({
      verifyToken: makeVerifier({ 'good-token': WEBID }),
      acl: makeAcl([[WEBID, ref]]),
      bucket,
      ttl: -1, // already expired
    });
    await expect(openBlob({
      ref, gate, token: 'good-token', opener: makeOpener(kp.privateKey),
      fetch: bucket.fetchPresigned,
    })).rejects.toThrow(/fetch returned no content/);
  });
});

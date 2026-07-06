import { describe, it, expect } from 'vitest';
import { generateKeypair, makeSealer } from '@canopy/pod-client/sealing';
import { uploadBlob, createBlobGatekeeper } from '../src/index.js';
import { makeMemoryBucket, makeVerifier, makeAcl } from './helpers.js';

const WEBID = 'https://anne.pod/profile/card#me';
const OTHER = 'https://mallory.pod/profile/card#me';

async function seedBlob() {
  const bucket = makeMemoryBucket();
  const { ref, key } = await uploadBlob({
    bytes: new Uint8Array([9, 8, 7]),
    bucket,
    sealer: makeSealer([generateKeypair().publicKey]),
    keyRef: 'urn:key:test',
  });
  return { bucket, ref, key };
}

describe('createBlobGatekeeper — deny-by-default poortwachter', () => {
  it('valid token + ACL allow => short-lived presigned URL', async () => {
    const { bucket, ref } = await seedBlob();
    const gate = createBlobGatekeeper({
      verifyToken: makeVerifier({ 'good-token': WEBID }),
      acl: makeAcl([[WEBID, ref]]),
      bucket,
    });

    const res = await gate('good-token', ref);
    expect(res.denied).toBeUndefined();
    expect(res.url).toMatch(/^https:\/\/bucket\.example\/presigned\//);
    // The URL actually resolves to the stored ciphertext.
    expect(await bucket.fetchPresigned(res.url)).toBe(bucket.store.get(ref.replace('blob://', '')));
  });

  it('no token => denied, no URL', async () => {
    const { bucket, ref } = await seedBlob();
    const gate = createBlobGatekeeper({
      verifyToken: makeVerifier({ 'good-token': WEBID }),
      acl: makeAcl([[WEBID, ref]]),
      bucket,
    });
    const res = await gate(undefined, ref);
    expect(res.denied).toBe(true);
    expect(res.url).toBeUndefined();
  });

  it('invalid token => denied, no URL', async () => {
    const { bucket, ref } = await seedBlob();
    const gate = createBlobGatekeeper({
      verifyToken: makeVerifier({ 'good-token': WEBID }),
      acl: makeAcl([[WEBID, ref]]),
      bucket,
    });
    const res = await gate('forged-token', ref);
    expect(res.denied).toBe(true);
    expect(res.reason).toBe('invalid-token');
    expect(res.url).toBeUndefined();
  });

  it('valid token but ACL deny => denied, no URL, no leak', async () => {
    const { bucket, ref } = await seedBlob();
    const gate = createBlobGatekeeper({
      verifyToken: makeVerifier({ 'mallory-token': OTHER }),
      acl: makeAcl([[WEBID, ref]]), // OTHER is not granted
      bucket,
    });
    const res = await gate('mallory-token', ref);
    expect(res.denied).toBe(true);
    expect(res.reason).toBe('acl');
    expect(res.url).toBeUndefined();
  });

  it('a verifier or acl that throws => denied (never leaks)', async () => {
    const { bucket, ref } = await seedBlob();
    const throwingGate = createBlobGatekeeper({
      verifyToken: async () => { throw new Error('verifier down'); },
      acl: makeAcl([[WEBID, ref]]),
      bucket,
    });
    expect((await throwingGate('t', ref)).denied).toBe(true);

    const aclThrowGate = createBlobGatekeeper({
      verifyToken: makeVerifier({ t: WEBID }),
      acl: { canRead: async () => { throw new Error('acl down'); } },
      bucket,
    });
    const res = await aclThrowGate('t', ref);
    expect(res.denied).toBe(true);
    expect(res.url).toBeUndefined();
  });

  it('a non-blob / arbitrary-scheme ref => denied (gate never presigns arbitrary refs)', async () => {
    const { bucket } = await seedBlob();
    const gate = createBlobGatekeeper({
      verifyToken: makeVerifier({ t: WEBID }),
      acl: { canRead: async () => true }, // even with ACL allow
      bucket,
    });
    const res = await gate('t', 'https://evil.example/secret');
    expect(res.denied).toBe(true);
    expect(res.url).toBeUndefined();
  });

  it('presigned URL is short-lived (ttl honoured)', async () => {
    const { bucket, ref } = await seedBlob();
    const gate = createBlobGatekeeper({
      verifyToken: makeVerifier({ t: WEBID }),
      acl: makeAcl([[WEBID, ref]]),
      bucket,
      ttl: -1, // already expired
    });
    const res = await gate('t', ref);
    expect(res.url).toBeTruthy();
    expect(await bucket.fetchPresigned(res.url)).toBeNull(); // expired => no access
  });
});

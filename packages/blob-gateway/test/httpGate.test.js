import { describe, it, expect } from 'vitest';
import { createHttpGate } from '../src/httpGate.js';
import { uploadBlob } from '../src/index.js';
import { generateKeypair, makeSealer } from '@onderling/pod-client/sealing';
import { makeMemoryBucket, makeVerifier, makeAcl } from './helpers.js';

const WEBID = 'https://anne.pod/profile/card#me';
const OTHER = 'https://mallory.pod/profile/card#me';

async function seed() {
  const bucket = makeMemoryBucket();
  const { ref } = await uploadBlob({
    bytes: new Uint8Array([1, 2, 3]),
    bucket,
    sealer: makeSealer([generateKeypair().publicKey]),
    keyRef: 'urn:key:test',
  });
  return { bucket, ref };
}

async function makeGate() {
  const { bucket, ref } = await seed();
  const handle = createHttpGate({
    verifyToken: makeVerifier({ 'good-token': WEBID }),
    acl: makeAcl([[WEBID, ref]]),
    bucket,
  });
  return { handle, ref };
}

const authReq = (token, ref) => ({
  method: 'GET',
  headers: { authorization: `Bearer ${token}` },
  query: { ref },
});

describe('createHttpGate — HTTP edge over the deny-by-default gatekeeper', () => {
  it('valid request => 200 { url }', async () => {
    const { handle, ref } = await makeGate();
    const res = await handle(authReq('good-token', ref));
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\/bucket\.example\/presigned\//);
  });

  it('parses the ref from the request URL query string too', async () => {
    const { handle, ref } = await makeGate();
    const res = await handle({
      headers: { Authorization: `DPoP good-token` },
      url: `/blob?ref=${encodeURIComponent(ref)}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.url).toBeTruthy();
  });

  it('missing token => 403, no url, no leak', async () => {
    const { handle, ref } = await makeGate();
    const res = await handle({ headers: {}, query: { ref } });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
    expect(res.body.url).toBeUndefined();
  });

  it('invalid token => 403, opaque body (no reason leak)', async () => {
    const { handle, ref } = await makeGate();
    const res = await handle(authReq('forged-token', ref));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
    expect(res.body.reason).toBeUndefined();
    expect(res.body.url).toBeUndefined();
  });

  it('valid token but ACL deny => 403, no url', async () => {
    const { bucket, ref } = await seed();
    const handle = createHttpGate({
      verifyToken: makeVerifier({ 'mallory-token': OTHER }),
      acl: makeAcl([[WEBID, ref]]), // OTHER not granted
      bucket,
    });
    const res = await handle(authReq('mallory-token', ref));
    expect(res.status).toBe(403);
    expect(res.body.url).toBeUndefined();
  });

  it('non-blob / arbitrary-scheme ref => 403 (gate never presigns arbitrary refs)', async () => {
    const { handle } = await makeGate();
    const res = await handle(authReq('good-token', 'https://evil.example/secret'));
    expect(res.status).toBe(403);
    expect(res.body.url).toBeUndefined();
  });

  it('a thrown parse/gate error => 403 (never a 500 leak)', async () => {
    const handle = createHttpGate({ gate: async () => { throw new Error('boom'); } });
    const res = await handle(authReq('good-token', 'blob://k'));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden' });
  });

  it('reads the Authorization header case-insensitively + from a Headers-like', async () => {
    const { handle, ref } = await makeGate();
    const headersLike = { get: (n) => (n.toLowerCase() === 'authorization' ? 'Bearer good-token' : null) };
    const res = await handle({ headers: headersLike, query: { ref } });
    expect(res.status).toBe(200);
  });
});

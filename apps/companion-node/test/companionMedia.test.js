/**
 * companion-node R-media — the MEDIA BLOB EDGE as the companion's SECOND TENANT.
 *
 * Proves the multi-tenant thesis: the SAME companion host process that serves
 * folio over the relay's WebSocket ALSO serves the blob-gateway HTTP edge on the
 * SAME port — mounted additively via `startRelay`'s `blobGate` seam
 * (server.js:254 → blobGateMount.js). A device round-trips a SEALED blob through
 * that relay blob gate, end-to-end, over REAL HTTP.
 *
 * What is REAL here (nothing on the gate path stubbed):
 *   - REAL relay HTTP mount  — booted in-process by `startCompanionNode({ media })`;
 *                              the /blob-gate, /blob-gate/grant, /blob-gate/upload-url
 *                              routes are the genuine `mountBlobGate` handlers.
 *   - REAL capability verify  — `createCapabilityVerifier` (real Ed25519
 *                              CapabilityToken.verify, self-issued, skill=media.read).
 *   - REAL deny-by-default    — the mount's ACL + verifier decide; every denial is an
 *                              opaque 403 { error:'forbidden' } — no URL, no reason.
 *   - REAL sealed-only        — uploadBlob refuses plaintext; openBlob refuses to
 *                              return a non-sealed envelope.
 *   - REAL grant→presign→open  — the device drives the actual /grant + presign-GET
 *                              wire and gets its own bytes back byte-for-byte.
 *
 * The ONE dev stand-in: the in-memory bucket. Its presigned URLs are not
 * HTTP-reachable object URLs, so the sealed STORE is `bucket.put` and the ciphertext
 * FETCH is `bucket.fetchPresigned(url)` — the documented swap-to-R2 seam
 * (mediaEdge.js): a real deploy swaps `bucket` for `createS3Bucket` and the device
 * PUTs/GETs those presigned URLs over HTTP. The gate DECISION — the tenant's actual
 * job — is exercised over real HTTP against the companion's relay port throughout.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { AgentIdentity, CapabilityToken } from '@canopy/core';
import { VaultMemory }                    from '@canopy/vault';
import {
  uploadBlob, openBlob, makeManifestLine, isBlobRef,
} from '@canopy/blob-gateway';
import { generateKeypair, makeSealer, makeOpener, isSealed } from '@canopy/pod-client/sealing';

import { startCompanionNode } from '../src/index.js';

/** ws://host:port → http://host:port (the mount rides the same HTTP server). */
const httpBase = (relayUrl) => relayUrl.replace(/^ws/, 'http');

/** Mint a device's SELF-ISSUED media.read capability token (issuer===subject),
 *  the exact posture the deployed remote media mode uses. */
async function mediaToken(identity, { expiresIn } = {}) {
  const tok = await CapabilityToken.issue(identity, {
    subject: identity.pubKey,     // self-issued: proof-of-possession of the signing key
    agentId: 'blob-gate',
    skill:   'media.read',
    ...(expiresIn ? { expiresIn } : {}),
  });
  return tok.toString();          // Bearer wire form
}

async function postJson(base, path, token, body) {
  const res = await fetch(`${base}${path}`, {
    method:  'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* opaque body may be empty on some paths */ }
  return { status: res.status, json };
}

describe('companion-node R-media — sealed blob round-trip through the 2nd-tenant relay blob gate', () => {
  /** @type {Awaited<ReturnType<typeof startCompanionNode>>} */
  let host;
  let base;

  // The uploader/reader device — its pubKey is the allow-listed uploader AND the
  // ACL actor (self-read grant-on-upload, dev slice of the member+roster model).
  let device;      // AgentIdentity
  let deviceTok;   // its media.read token (wire form)

  // Sealing keypair (the circle's content key, dev slice). The bytes never leave
  // the client unsealed; the bucket only ever holds the envelope.
  const sealKp  = generateKeypair();
  const sealer  = makeSealer([sealKp.publicKey]);
  const opener  = makeOpener(sealKp.privateKey);
  const payload = new Uint8Array([0, 1, 2, 250, 251, 255, 42, 7, 13, 99]); // incl. non-ascii bytes

  beforeAll(async () => {
    device    = await AgentIdentity.generate(new VaultMemory());
    deviceTok = await mediaToken(device);

    // Boot the companion with BOTH tenants: folio (default) + the media edge, with
    // the device allow-listed to upload/grant. Gate OFF keeps this suite focused on
    // the media tenant (the folio invoke-gate is proven by companionGate.test.js).
    host = await startCompanionNode({
      identityVault: new VaultMemory(),
      gate:          false,
      media:         true,
      mediaEdge:     { uploaders: [device.pubKey] },
    });
    base = httpBase(host.relayUrl);

    // The 2nd tenant is composed on the SAME process/port as tenant #1 (folio/WS).
    expect(host.relayUrl).toMatch(/^ws:\/\//);
    expect(host.mediaEdge).toBeTruthy();
    expect(host.mediaEdge.route).toBe('/blob-gate');
    expect(host.relay.blobGate).toBeTruthy();        // the live mount ({route, acl})
    expect(host.relay.blobGate.route).toBe('/blob-gate');
  });

  afterAll(async () => {
    try { await host?.stop(); } catch { /* best-effort */ }
  });

  it('(a) a capability-carrying, SEALED blob round-trips: bytes back match byte-for-byte', async () => {
    const bucket = host.mediaEdge.bucket;

    // 1. Client seals + stores the ciphertext (dev stand-in for presigned-PUT to R2).
    const { ref, manifestLine, key, ciphertext } = await uploadBlob({
      bytes: payload, bucket, sealer, keyRef: 'urn:circle:demo:content-key',
    });
    expect(isBlobRef(ref)).toBe(true);
    expect(isSealed(ciphertext)).toBe(true);                    // sealed-only: envelope, not plaintext
    expect(isSealed(bucket.store.get(key))).toBe(true);         // the bucket holds ONLY the envelope

    // 2. REAL HTTP /upload-url — proves the presign-PUT authorization path for an
    //    allow-listed uploader (a real client would PUT the sealed bytes to this url).
    const up = await postJson(base, '/blob-gate/upload-url', deviceTok, { key });
    expect(up.status).toBe(200);
    expect(typeof up.json.url).toBe('string');

    // 3. REAL HTTP /grant — record the read-ACL (uploader grants itself, dev slice
    //    of grant-the-roster). ACL key is the blob:// ref the gate will check.
    const granted = await postJson(base, '/blob-gate/grant', deviceTok, { key: ref, actors: [device.pubKey] });
    expect(granted.status).toBe(200);
    expect(granted.json).toMatchObject({ ok: true, granted: 1 });

    // 4. REAL open through the mount: openBlob → remote gate (HTTP /blob-gate →
    //    verifier + ACL → presign GET) → fetchPresigned → opener → bytes.
    const gate = async (token, r) => {
      const out = await postJson(base, '/blob-gate', token, { ref: r });
      return out.status === 200 && out.json && out.json.url ? { url: out.json.url } : { denied: true };
    };
    const opened = await openBlob({
      ref: manifestLine, gate, token: deviceTok, opener, fetch: bucket.fetchPresigned,
    });
    expect(Array.from(opened.bytes)).toEqual(Array.from(payload));   // ← bytes back MATCH
  }, 20_000);

  it('(b) deny-by-default: a token-less open returns an opaque 403 (no url, no bytes, no leak)', async () => {
    const bucket = host.mediaEdge.bucket;
    const { ref } = await uploadBlob({ bytes: payload, bucket, sealer, keyRef: 'urn:k' });
    await postJson(base, '/blob-gate/grant', deviceTok, { key: ref, actors: [device.pubKey] });

    // No Authorization header → opaque 403, and CRUCIALLY no url in the body.
    const res = await postJson(base, '/blob-gate', null, { ref });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: 'forbidden' });
    expect(res.json.url).toBeUndefined();
  }, 20_000);

  it('(b) deny-by-default: a valid token for a NON-granted actor → opaque 403, and openBlob yields nothing', async () => {
    const bucket = host.mediaEdge.bucket;
    const { ref, manifestLine } = await uploadBlob({ bytes: payload, bucket, sealer, keyRef: 'urn:k' });
    // Grant ONLY the device; a stranger holds a perfectly valid media.read token
    // but was never granted read on this ref → the ACL denies.
    await postJson(base, '/blob-gate/grant', deviceTok, { key: ref, actors: [device.pubKey] });

    const stranger    = await AgentIdentity.generate(new VaultMemory());
    const strangerTok = await mediaToken(stranger);

    const res = await postJson(base, '/blob-gate', strangerTok, { ref });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: 'forbidden' });

    // …and driving openBlob with that denial gets NO bytes — the denial throws.
    const gate = async (token, r) => {
      const out = await postJson(base, '/blob-gate', token, { ref: r });
      return out.status === 200 && out.json?.url ? { url: out.json.url } : { denied: true };
    };
    await expect(
      openBlob({ ref: manifestLine, gate, token: strangerTok, opener, fetch: bucket.fetchPresigned }),
    ).rejects.toThrow(/denied/i);
  }, 20_000);

  it('(b) deny-by-default: an uploader NOT on the allow-list cannot /grant or /upload-url (403)', async () => {
    const bucket = host.mediaEdge.bucket;
    const { ref, key } = await uploadBlob({ bytes: payload, bucket, sealer, keyRef: 'urn:k' });

    const outsider    = await AgentIdentity.generate(new VaultMemory());
    const outsiderTok = await mediaToken(outsider);   // valid token, but not in `uploaders`

    const grant = await postJson(base, '/blob-gate/grant', outsiderTok, { key: ref, actors: [outsider.pubKey] });
    expect(grant.status).toBe(403);
    expect(grant.json).toEqual({ error: 'forbidden' });

    const up = await postJson(base, '/blob-gate/upload-url', outsiderTok, { key });
    expect(up.status).toBe(403);
    expect(up.json).toEqual({ error: 'forbidden' });

    // Deny-by-default holds: the outsider's self-grant never took, so even its own
    // token opens nothing.
    const res = await postJson(base, '/blob-gate', outsiderTok, { ref });
    expect(res.status).toBe(403);
  }, 20_000);

  it('(c) sealed-only: no unsealed path serves usable content — openBlob refuses a non-sealed envelope', async () => {
    const bucket = host.mediaEdge.bucket;

    // Force a PLAINTEXT object into the bucket + grant + presign it through the REAL
    // mount. The gate happily presigns (it moves opaque bytes) — but openBlob's
    // sealed-only invariant refuses to return the plaintext. There is no unsealed
    // read path that yields content.
    const plainKey = 'plain-object-key';
    await bucket.put(plainKey, 'this-is-not-a-sealed-envelope');
    const ref = makeManifestLine({ key: plainKey, keyRef: 'urn:k', bytes: 0 }).ref;
    await postJson(base, '/blob-gate/grant', deviceTok, { key: ref, actors: [device.pubKey] });

    const presign = await postJson(base, '/blob-gate', deviceTok, { ref });
    expect(presign.status).toBe(200);                 // the gate presigns opaque bytes…

    const gate = async (token, r) => {
      const out = await postJson(base, '/blob-gate', token, { ref: r });
      return out.status === 200 && out.json?.url ? { url: out.json.url } : { denied: true };
    };
    // …but openBlob refuses to hand back anything that is not a sealing envelope.
    await expect(
      openBlob({ ref, gate, token: deviceTok, opener, fetch: bucket.fetchPresigned }),
    ).rejects.toThrow(/sealed envelope/i);

    // And the upload path likewise refuses to accept plaintext (symmetric invariant).
    await expect(
      uploadBlob({ bytes: payload, bucket, sealer: (t) => t /* non-sealing */, keyRef: 'urn:k' }),
    ).rejects.toThrow(/sealed envelope/i);
  }, 20_000);
});

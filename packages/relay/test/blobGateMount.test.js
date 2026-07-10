/**
 * mountBlobGate — integration tests (PLAN-media-infra-deployment P2:
 * the blob-gateway HTTP edge mounted on the relay's HTTP server).
 *
 * Uses a fake verifier + fake bucket (no live Solid / S3), matching the
 * blob-gateway's injected-contract test style.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startRelay } from '../src/server.js';
import { MemoryBlobAclStore, SqliteBlobAclStore } from '../src/blobAclStore.js';

// ── Fakes (injected contracts) ───────────────────────────────────────────────

/** token 'tok-<actor>' → { webId: '<actor>' }; anything else is invalid. */
const fakeVerifyToken = async (token) => {
  if (typeof token === 'string' && token.startsWith('tok-')) {
    return { webId: token.slice(4) };
  }
  return null;
};

/** presign(key, {ttl}) → a recognisable fake URL. */
const fakeBucket = {
  presign: async (key, { ttl } = {}) => `https://fake-bucket.example/${key}?ttl=${ttl}`,
};

const OPAQUE_403 = { error: 'forbidden' };

const get = (port, path, token) => fetch(`http://127.0.0.1:${port}${path}`, {
  headers: token ? { authorization: `Bearer ${token}` } : {},
});

const post = (port, path, token, body) => fetch(`http://127.0.0.1:${port}${path}`, {
  method:  'POST',
  headers: {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    'content-type': 'application/json',
  },
  body: JSON.stringify(body),
});

// ── Presign path (the gate) ──────────────────────────────────────────────────

describe('mountBlobGate — presign path', () => {
  let relay, acl;

  beforeEach(async () => {
    acl   = new MemoryBlobAclStore();
    relay = await startRelay({
      port:     0,
      blobGate: { verifyToken: fakeVerifyToken, bucket: fakeBucket, acl, ttl: 90 },
    });
  });

  afterEach(async () => {
    await relay.stop();
  });

  it('happy path: valid token + granted ref → 200 { url } (presigned, gate ttl)', async () => {
    await acl.grant('blob://k1', 'alice');

    const res = await get(relay.port, '/blob-gate?ref=blob%3A%2F%2Fk1', 'tok-alice');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ url: 'https://fake-bucket.example/k1?ttl=90' });
  });

  it('deny-by-default: no token → opaque 403', async () => {
    await acl.grant('blob://k1', 'alice');
    const res = await get(relay.port, '/blob-gate?ref=blob%3A%2F%2Fk1');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(OPAQUE_403);
  });

  it('deny-by-default: invalid token → opaque 403 (same body — no leak)', async () => {
    await acl.grant('blob://k1', 'alice');
    const res = await get(relay.port, '/blob-gate?ref=blob%3A%2F%2Fk1', 'not-a-token');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(OPAQUE_403);
  });

  it('deny-by-default: valid token, ungranted key → opaque 403 (same body — no leak)', async () => {
    const res = await get(relay.port, '/blob-gate?ref=blob%3A%2F%2Fk1', 'tok-alice');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(OPAQUE_403);
  });

  it('deny-by-default: unknown subpath under the mount → opaque 403', async () => {
    const res = await get(relay.port, '/blob-gate/whatever', 'tok-alice');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(OPAQUE_403);
  });

  it('routes OUTSIDE the mount are unaffected (fall through to the relay handler)', async () => {
    const res = await get(relay.port, '/anything-else');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(await res.text()).toBe('@canopy/relay — WebSocket endpoint only');
  });
});

// ── Grant route ──────────────────────────────────────────────────────────────

describe('mountBlobGate — grant route (uploaders allow-list, deny-by-default)', () => {
  let relay, acl;

  beforeEach(async () => {
    acl   = new MemoryBlobAclStore();
    relay = await startRelay({
      port:     0,
      blobGate: {
        verifyToken: fakeVerifyToken,
        bucket:      fakeBucket,
        acl,
        uploaders:   ['uploader'],   // ONLY this actor may grant
      },
    });
  });

  afterEach(async () => {
    await relay.stop();
  });

  it('an authorised grant lands in the ACL — and the grantee can then presign', async () => {
    const res = await post(relay.port, '/blob-gate/grant', 'tok-uploader', {
      key:    'blob://k1',
      actors: ['alice', 'bob'],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, granted: 2 });

    expect(await acl.check('alice', 'blob://k1')).toBe(true);
    expect(await acl.check('bob',   'blob://k1')).toBe(true);

    // End-to-end: the granted actor gets a presigned URL through the gate.
    const gateRes = await get(relay.port, '/blob-gate?ref=blob%3A%2F%2Fk1', 'tok-alice');
    expect(gateRes.status).toBe(200);
    expect((await gateRes.json()).url).toMatch(/^https:\/\/fake-bucket\.example\/k1/);
  });

  it('a valid token NOT in the uploaders list → opaque 403, no grant recorded', async () => {
    const res = await post(relay.port, '/blob-gate/grant', 'tok-alice', {
      key:    'blob://k1',
      actors: ['alice'],
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(OPAQUE_403);
    expect(await acl.check('alice', 'blob://k1')).toBe(false);
  });

  it('no token / invalid token → opaque 403, no grant recorded', async () => {
    const noTok = await post(relay.port, '/blob-gate/grant', null, { key: 'blob://k1', actors: ['alice'] });
    expect(noTok.status).toBe(403);
    expect(await noTok.json()).toEqual(OPAQUE_403);

    const badTok = await post(relay.port, '/blob-gate/grant', 'garbage', { key: 'blob://k1', actors: ['alice'] });
    expect(badTok.status).toBe(403);
    expect(await badTok.json()).toEqual(OPAQUE_403);

    expect(await acl.check('alice', 'blob://k1')).toBe(false);
  });

  it('malformed bodies → opaque 403 (missing key / empty actors / bad JSON)', async () => {
    for (const body of [{}, { key: 'blob://k1' }, { key: 'blob://k1', actors: [] }, { key: 'blob://k1', actors: [42] }]) {
      const res = await post(relay.port, '/blob-gate/grant', 'tok-uploader', body);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(OPAQUE_403);
    }
    const badJson = await fetch(`http://127.0.0.1:${relay.port}/blob-gate/grant`, {
      method:  'POST',
      headers: { authorization: 'Bearer tok-uploader', 'content-type': 'application/json' },
      body:    '{not json',
    });
    expect(badJson.status).toBe(403);
    expect(await badJson.json()).toEqual(OPAQUE_403);
  });

  it('no uploaders option means NOBODY can grant (deny-by-default)', async () => {
    const bare = await startRelay({
      port:     0,
      blobGate: { verifyToken: fakeVerifyToken, bucket: fakeBucket },
    });
    try {
      const res = await post(bare.port, '/blob-gate/grant', 'tok-uploader', {
        key:    'blob://k1',
        actors: ['alice'],
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(OPAQUE_403);
    } finally {
      await bare.stop();
    }
  });
});

// ── SQLite-backed ACL through the mount ──────────────────────────────────────

describe('mountBlobGate — SQLite ACL round-trip', () => {
  it('grant lands in SQLite and gates a presign; survives store reopen', async () => {
    const dir  = mkdtempSync(join(tmpdir(), 'blob-gate-sqlite-'));
    const file = join(dir, 'blob-acl.sqlite');
    const acl  = new SqliteBlobAclStore({ path: file });
    const relay = await startRelay({
      port:     0,
      blobGate: { verifyToken: fakeVerifyToken, bucket: fakeBucket, acl, uploaders: ['uploader'] },
    });
    try {
      const grant = await post(relay.port, '/blob-gate/grant', 'tok-uploader', {
        key:    'blob://k1',
        actors: ['alice'],
      });
      expect(grant.status).toBe(200);

      const gateRes = await get(relay.port, '/blob-gate?ref=blob%3A%2F%2Fk1', 'tok-alice');
      expect(gateRes.status).toBe(200);

      // Durable: the grant is readable from a fresh store on the same file.
      const reopened = new SqliteBlobAclStore({ path: file });
      expect(await reopened.check('alice', 'blob://k1')).toBe(true);
      expect(await reopened.check('bob',   'blob://k1')).toBe(false);
      await reopened.close();
    } finally {
      await relay.stop();
      await acl.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Backward compatibility: no blobGate → byte-identical relay ───────────────

describe('startRelay — without blobGate (byte-identical behaviour)', () => {
  it('adds no routes and no return-shape fields: every path serves the banner', async () => {
    const relay = await startRelay({ port: 0 });
    try {
      // The optional field is ABSENT, not null — the return shape is unchanged.
      expect('blobGate' in relay).toBe(false);

      // The gate + grant paths are NOT intercepted: the pre-existing handler
      // answers them exactly like any other path (banner, text/plain).
      for (const path of ['/', '/blob-gate?ref=blob%3A%2F%2Fk1', '/blob-gate/grant']) {
        const res = await fetch(`http://127.0.0.1:${relay.port}${path}`, {
          headers: { authorization: 'Bearer tok-alice' },
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/plain');
        expect(await res.text()).toBe('@canopy/relay — WebSocket endpoint only');
      }
    } finally {
      await relay.stop();
    }
  });

  it('static serving stays byte-identical when the gate IS mounted (non-mount paths fall through)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blob-gate-static-'));
    writeFileSync(join(dir, 'index.html'), '<h1>hi</h1>');
    const relay = await startRelay({
      port:           0,
      serveStaticDir: dir,
      blobGate:       { verifyToken: fakeVerifyToken, bucket: fakeBucket },
    });
    try {
      const index = await fetch(`http://127.0.0.1:${relay.port}/`);
      expect(index.status).toBe(200);
      expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(await index.text()).toBe('<h1>hi</h1>');

      const missing = await fetch(`http://127.0.0.1:${relay.port}/nope`);
      expect(missing.status).toBe(404);
      expect(await missing.text()).toBe('Not found: /nope');
    } finally {
      await relay.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Folio.B3 — autoShare unit tests.
 *
 * Covers the four canonical cases (mint on new folder, renew within 7 days,
 * manual revocation re-mints, malformed segment rejection) plus persistence,
 * atomic writes, identity rotation, integration with SyncEngine.runOnce, and
 * shareFolderFor on PathMap.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs }  from 'node:fs';
import { tmpdir }          from 'node:os';
import { join }            from 'node:path';

import { AgentIdentity, PodCapabilityToken } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import {
  parsePath,
  shareFolderName,
  ensureShares,
  listShares,
  loadShares,
  saveShares,
  shouldRenew,
  mintShareToken,
  findShareFolders,
  SHARE_EXPIRY_MS,
  SHARE_RENEW_WINDOW_MS,
  SHARES_FILE_RELPATH,
} from '../src/autoShare.js';

import { PathMap }    from '../src/PathMap.js';
import { SyncEngine } from '../src/SyncEngine.js';

const POD_ROOT = 'https://alice.example/notes/';
const ALICE_WEBID = 'https://alice.example.com/profile/card#me';
const BOB_WEBID   = 'https://bob.example.org/profile/card#me';

// ── Mock PodClient (mirrors SyncEngine.test.js) ────────────────────────────
class MockPodClient {
  constructor(podRoot) {
    this.podRoot = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
    this.store = new Map();
    this.tombstones = new Set();
    this._etagCounter = 0;
  }
  _seed(uri, content, contentType = 'text/markdown') {
    const bytes = typeof content === 'string'
      ? new TextEncoder().encode(content)
      : content;
    this.store.set(uri, {
      content,
      contentType,
      lastModified: new Date().toUTCString(),
      etag: `"e${++this._etagCounter}"`,
      size: bytes.byteLength,
    });
  }
  async read(uri, opts = {}) {
    const r = this.store.get(uri);
    if (!r) {
      const err = new Error(`mock 404: ${uri}`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    let content = r.content;
    if (opts.decode === 'string') {
      if (content instanceof Uint8Array) content = new TextDecoder().decode(content);
    }
    return { ...r, content };
  }
  async write(uri, content, opts = {}) {
    const bytes = content instanceof Uint8Array
      ? content
      : (typeof content === 'string' ? new TextEncoder().encode(content) : new TextEncoder().encode(JSON.stringify(content)));
    const stored = {
      content,
      contentType: opts.contentType || 'application/octet-stream',
      lastModified: new Date().toUTCString(),
      etag: `"e${++this._etagCounter}"`,
      size: bytes.byteLength,
    };
    this.store.set(uri, stored);
    return { uri, ...stored };
  }
  async list(containerUri) {
    const container = containerUri.endsWith('/') ? containerUri : `${containerUri}/`;
    const direct = new Map();
    const nestedContainers = new Set();
    for (const k of this.store.keys()) {
      if (this.tombstones.has(k)) continue;
      if (!k.startsWith(container)) continue;
      const tail = k.slice(container.length);
      if (tail === '') continue;
      const slashIdx = tail.indexOf('/');
      if (slashIdx === -1) {
        direct.set(k, 'resource');
      } else {
        nestedContainers.add(`${container}${tail.slice(0, slashIdx)}/`);
      }
    }
    const entries = [
      ...[...direct.keys()].map((uri) => ({ uri, type: 'resource' })),
      ...[...nestedContainers].map((uri) => ({ uri, type: 'container' })),
    ];
    return { container, entries };
  }
  async delete(uri) { this.store.delete(uri); this.tombstones.delete(uri); }
  async deleteLocal(uri) { this.tombstones.add(uri); }
  on() {} off() {} emit() {}
}

// ── Fixtures ───────────────────────────────────────────────────────────────

let localRoot, pod, identity;

beforeEach(async () => {
  localRoot = await fs.mkdtemp(join(tmpdir(), 'folio-autoshare-'));
  pod = new MockPodClient(POD_ROOT);
  identity = await AgentIdentity.generate(new VaultMemory());
});
afterEach(async () => { await fs.rm(localRoot, { recursive: true, force: true }); });

function newEngine(opts = {}) {
  return new SyncEngine({
    podClient: pod,
    localRoot,
    podRoot: POD_ROOT,
    identity,
    pollIntervalMs: 1_000_000,
    debounceMs: 50,
    ...opts,
  });
}

// ── parsePath ──────────────────────────────────────────────────────────────

describe('parsePath', () => {
  it('returns null for paths with no with- prefix', () => {
    expect(parsePath('recipes/cake.md')).toBeNull();
    expect(parsePath('shared/blog.md')).toBeNull();
    expect(parsePath('top.md')).toBeNull();
    expect(parsePath('')).toBeNull();
  });

  it('extracts a URL-decoded WebID from a top-level segment', () => {
    const seg = `with-${encodeURIComponent(ALICE_WEBID)}`;
    const r = parsePath(`${seg}/recipes/cake.md`);
    expect(r).toBeTruthy();
    expect(r.webid).toBe(ALICE_WEBID);
    expect(r.sharePath).toBe(seg);
    expect(r.rest).toBe('recipes/cake.md');
  });

  it('handles the share folder itself with no rest', () => {
    const seg = `with-${encodeURIComponent(BOB_WEBID)}`;
    const r = parsePath(seg);
    expect(r.webid).toBe(BOB_WEBID);
    expect(r.sharePath).toBe(seg);
    expect(r.rest).toBe('');
  });

  it('rejects a malformed segment (empty WebID)', () => {
    expect(() => parsePath('with-/foo.md')).toThrowError(
      expect.objectContaining({ code: 'AUTO_SHARE_BAD_PATH' }),
    );
    expect(() => parsePath('with-')).toThrowError(
      expect.objectContaining({ code: 'AUTO_SHARE_BAD_PATH' }),
    );
  });

  it('rejects a segment whose decoded WebID is not a URI', () => {
    expect(() => parsePath('with-not-a-uri/foo.md')).toThrowError(
      expect.objectContaining({ code: 'AUTO_SHARE_BAD_PATH' }),
    );
  });

  it('rejects a segment with broken URL encoding', () => {
    expect(() => parsePath('with-%E0%A4%A/foo.md')).toThrowError(
      expect.objectContaining({ code: 'AUTO_SHARE_BAD_PATH' }),
    );
  });

  it('round-trips via shareFolderName', () => {
    const seg = shareFolderName(ALICE_WEBID);
    expect(seg.startsWith('with-')).toBe(true);
    const r = parsePath(`${seg}/sub/note.md`);
    expect(r.webid).toBe(ALICE_WEBID);
    expect(r.sharePath).toBe(seg);
    expect(r.rest).toBe('sub/note.md');
  });
});

// ── PathMap.shareFolderFor ─────────────────────────────────────────────────

describe('PathMap.shareFolderFor', () => {
  const m = new PathMap({ localRoot: '/r', podRoot: POD_ROOT });

  it('returns null for non-share paths', () => {
    expect(m.shareFolderFor('recipes/cake.md')).toBeNull();
    expect(m.shareFolderFor('shared/blog.md')).toBeNull();
    expect(m.shareFolderFor('')).toBeNull();
  });

  it('extracts webid + sharePath from a with-<webid>/ path', () => {
    const seg = shareFolderName(ALICE_WEBID);
    const r = m.shareFolderFor(`${seg}/note.md`);
    expect(r).toEqual({ webid: ALICE_WEBID, sharePath: seg });
  });

  it('propagates AUTO_SHARE_BAD_PATH errors', () => {
    expect(() => m.shareFolderFor('with-/bad.md')).toThrowError(
      expect.objectContaining({ code: 'AUTO_SHARE_BAD_PATH' }),
    );
  });
});

// ── findShareFolders ──────────────────────────────────────────────────────

describe('findShareFolders', () => {
  it('lists every top-level with-<webid>/ folder, skips others', async () => {
    await fs.mkdir(join(localRoot, shareFolderName(ALICE_WEBID)), { recursive: true });
    await fs.mkdir(join(localRoot, shareFolderName(BOB_WEBID)),   { recursive: true });
    await fs.mkdir(join(localRoot, 'recipes'),                    { recursive: true });
    await fs.writeFile(join(localRoot, 'top.md'), 'top');

    const { folders, errors } = await findShareFolders(localRoot);
    const webids = folders.map((f) => f.webid).sort();
    expect(webids).toEqual([ALICE_WEBID, BOB_WEBID].sort());
    expect(errors).toEqual([]);
  });

  it('surfaces malformed segments as errors instead of throwing', async () => {
    await fs.mkdir(join(localRoot, 'with-'),           { recursive: true });
    await fs.mkdir(join(localRoot, 'with-bogus'),       { recursive: true });
    await fs.mkdir(join(localRoot, shareFolderName(ALICE_WEBID)), { recursive: true });

    const { folders, errors } = await findShareFolders(localRoot);
    expect(folders).toHaveLength(1);
    expect(folders[0].webid).toBe(ALICE_WEBID);
    expect(errors.length).toBeGreaterThanOrEqual(2);
    for (const e of errors) expect(e.code).toBe('AUTO_SHARE_BAD_PATH');
  });
});

// ── shouldRenew ────────────────────────────────────────────────────────────

describe('shouldRenew', () => {
  const NOW = 1_700_000_000_000;
  it('renews when no record exists', () => {
    expect(shouldRenew(undefined, 'pk', NOW)).toBe(true);
  });
  it('renews within the 7-day window', () => {
    const rec = { issuer: 'pk', expiresAt: NOW + 6 * 24 * 60 * 60 * 1000 };
    expect(shouldRenew(rec, 'pk', NOW)).toBe(true);
  });
  it('does not renew with > 7 days remaining and matching issuer', () => {
    const rec = { issuer: 'pk', expiresAt: NOW + 30 * 24 * 60 * 60 * 1000 };
    expect(shouldRenew(rec, 'pk', NOW)).toBe(false);
  });
  it('renews when issuer rotated', () => {
    const rec = { issuer: 'old-pk', expiresAt: NOW + 30 * 24 * 60 * 60 * 1000 };
    expect(shouldRenew(rec, 'new-pk', NOW)).toBe(true);
  });
  it('renews when expired', () => {
    const rec = { issuer: 'pk', expiresAt: NOW - 1000 };
    expect(shouldRenew(rec, 'pk', NOW)).toBe(true);
  });
});

// ── ensureShares — happy path: mint on new folder ──────────────────────────

describe('ensureShares — mint on new folder', () => {
  it('mints a fresh PodCapabilityToken for a newly-created with-<webid>/ folder', async () => {
    const seg = shareFolderName(ALICE_WEBID);
    await fs.mkdir(join(localRoot, seg), { recursive: true });
    await fs.writeFile(join(localRoot, seg, 'hello.md'), 'hi');

    const e = newEngine();
    const r = await ensureShares(e, identity);

    expect(r.minted).toBe(1);
    expect(r.renewed).toBe(0);
    expect(r.errors).toEqual([]);

    const rec = Object.values(r.shares)[0];
    expect(rec.webid).toBe(ALICE_WEBID);
    expect(rec.sharePath).toBe(seg);
    expect(rec.issuer).toBe(identity.pubKey);
    expect(rec.token.subject).toBe(ALICE_WEBID);
    expect(rec.token.scopes).toEqual(expect.arrayContaining([
      expect.stringMatching(/^pod\.read:.*\/$/),
      expect.stringMatching(/^pod\.write:.*\/$/),
    ]));
    // Expiry is roughly 90 days out (tolerant slack for test runtime).
    const drift = Math.abs(rec.expiresAt - (Date.now() + SHARE_EXPIRY_MS));
    expect(drift).toBeLessThan(60_000);

    // Token verifies.
    expect(PodCapabilityToken.verify(rec.token)).toBe(true);
  });

  it('persists tokens to <root>/.folio/shares.json (atomic write)', async () => {
    const seg = shareFolderName(ALICE_WEBID);
    await fs.mkdir(join(localRoot, seg), { recursive: true });

    const e = newEngine();
    await ensureShares(e, identity);

    const sharesFile = join(localRoot, SHARES_FILE_RELPATH);
    const raw = await fs.readFile(sharesFile, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(typeof parsed.writtenAt).toBe('number');
    expect(Object.keys(parsed.shares)).toHaveLength(1);

    // tmp file should not linger after a clean write.
    await expect(fs.stat(`${sharesFile}.tmp`)).rejects.toThrow();
  });

  it('is idempotent: a second call without changes does not re-mint', async () => {
    const seg = shareFolderName(ALICE_WEBID);
    await fs.mkdir(join(localRoot, seg), { recursive: true });

    const e = newEngine();
    const r1 = await ensureShares(e, identity);
    expect(r1.minted).toBe(1);

    const r2 = await ensureShares(e, identity);
    expect(r2.minted).toBe(0);
    expect(r2.renewed).toBe(0);

    // The persisted token id must be unchanged across the no-op second call.
    const after = await loadShares(localRoot);
    const recBefore = Object.values(r1.shares)[0];
    const recAfter  = Object.values(after)[0];
    expect(recAfter.token.id).toBe(recBefore.token.id);
  });
});

// ── ensureShares — renewal within 7 days ───────────────────────────────────

describe('ensureShares — renewal within 7 days', () => {
  it('renews a token that expires within the renewal window', async () => {
    const seg = shareFolderName(ALICE_WEBID);
    await fs.mkdir(join(localRoot, seg), { recursive: true });

    const e = newEngine();
    const r1 = await ensureShares(e, identity);
    const before = Object.values(r1.shares)[0];

    // Hand-roll an "expiring soon" record by rewriting shares.json.
    const expiring = {
      ...before,
      expiresAt: Date.now() + 3 * 24 * 60 * 60 * 1000,  // 3 days from now
    };
    const map = { [`${expiring.webid}|${expiring.sharePath}`]: expiring };
    await saveShares(localRoot, map);

    const r2 = await ensureShares(e, identity);
    expect(r2.renewed).toBe(1);
    expect(r2.minted).toBe(0);

    const after = Object.values(r2.shares)[0];
    expect(after.token.id).not.toBe(before.token.id);
    expect(after.expiresAt).toBeGreaterThan(expiring.expiresAt);
    // New expiry is ~90 days out.
    const drift = Math.abs(after.expiresAt - (Date.now() + SHARE_EXPIRY_MS));
    expect(drift).toBeLessThan(60_000);
  });

  it('does NOT renew a token comfortably past the 7-day window', async () => {
    const seg = shareFolderName(ALICE_WEBID);
    await fs.mkdir(join(localRoot, seg), { recursive: true });

    const e = newEngine();
    await ensureShares(e, identity);
    const r2 = await ensureShares(e, identity);
    expect(r2.renewed).toBe(0);
  });
});

// ── ensureShares — manual revocation re-mints ──────────────────────────────

describe('ensureShares — manual revocation re-mints', () => {
  it('a user deleting the entry from shares.json causes the next sync to re-mint', async () => {
    const seg = shareFolderName(ALICE_WEBID);
    await fs.mkdir(join(localRoot, seg), { recursive: true });

    const e = newEngine();
    const r1 = await ensureShares(e, identity);
    expect(r1.minted).toBe(1);

    // Manual revocation: wipe the entry.
    await saveShares(localRoot, {});

    const r2 = await ensureShares(e, identity);
    expect(r2.minted).toBe(1);
    expect(r2.renewed).toBe(0);

    const final = await loadShares(localRoot);
    expect(Object.keys(final)).toHaveLength(1);
  });

  it('a deleted shares.json file triggers a fresh mint (treated as ENOENT → empty)', async () => {
    const seg = shareFolderName(ALICE_WEBID);
    await fs.mkdir(join(localRoot, seg), { recursive: true });

    const e = newEngine();
    await ensureShares(e, identity);

    // Nuke the persisted file entirely.
    await fs.rm(join(localRoot, SHARES_FILE_RELPATH));

    const r2 = await ensureShares(e, identity);
    expect(r2.minted).toBe(1);
  });
});

// ── ensureShares — malformed-segment rejection ─────────────────────────────

describe('ensureShares — malformed-segment rejection', () => {
  it('does not mint anything for malformed segments and surfaces errors', async () => {
    await fs.mkdir(join(localRoot, 'with-'),    { recursive: true });
    await fs.mkdir(join(localRoot, 'with-bogus'), { recursive: true });

    const e = newEngine();
    const r = await ensureShares(e, identity);
    expect(r.minted).toBe(0);
    expect(r.renewed).toBe(0);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
    for (const err of r.errors) expect(err.code).toBe('AUTO_SHARE_BAD_PATH');

    // Nothing got persisted because no valid folder existed.
    await expect(fs.access(join(localRoot, SHARES_FILE_RELPATH))).rejects.toThrow();
  });

  it('mints valid folders even when malformed siblings exist', async () => {
    await fs.mkdir(join(localRoot, 'with-'), { recursive: true });
    await fs.mkdir(join(localRoot, shareFolderName(ALICE_WEBID)), { recursive: true });

    const e = newEngine();
    const r = await ensureShares(e, identity);
    expect(r.minted).toBe(1);
    expect(r.errors.length).toBeGreaterThanOrEqual(1);
    expect(r.errors[0].code).toBe('AUTO_SHARE_BAD_PATH');
  });
});

// ── ensureShares — identity rotation ───────────────────────────────────────

describe('ensureShares — identity rotation', () => {
  it('re-issues all tokens under the new key when identity rotates', async () => {
    const seg = shareFolderName(ALICE_WEBID);
    await fs.mkdir(join(localRoot, seg), { recursive: true });

    const e = newEngine();
    const r1 = await ensureShares(e, identity);
    const oldRecord = Object.values(r1.shares)[0];

    // Rotate to a new identity.
    const newIdentity = await AgentIdentity.generate(new VaultMemory());
    expect(newIdentity.pubKey).not.toBe(identity.pubKey);
    e.setIdentity(newIdentity);

    const r2 = await ensureShares(e, newIdentity);
    expect(r2.renewed).toBe(1);
    const newRecord = Object.values(r2.shares)[0];
    expect(newRecord.issuer).toBe(newIdentity.pubKey);
    expect(newRecord.token.id).not.toBe(oldRecord.token.id);
    // PodCapabilityToken doesn't expose retroactive revocation; the old
    // token is still verifiable in isolation (verification check only
    // fails on expiry, which we did not modify).  Spec: "Old tokens
    // remain valid until expiry; we don't revoke retroactively."
    expect(PodCapabilityToken.verify(oldRecord.token)).toBe(true);
    expect(PodCapabilityToken.verify(newRecord.token)).toBe(true);
  });
});

// ── ensureShares — pod URI shape + scope shape ─────────────────────────────

describe('ensureShares — pod URI + scope shape', () => {
  it('builds a pod URI that ends with / and a container scope (read+write)', async () => {
    const seg = shareFolderName(ALICE_WEBID);
    await fs.mkdir(join(localRoot, seg), { recursive: true });

    const e = newEngine();
    const r = await ensureShares(e, identity);
    const rec = Object.values(r.shares)[0];

    expect(rec.podUri.endsWith('/')).toBe(true);
    expect(rec.podUri.startsWith(POD_ROOT)).toBe(true);
    expect(rec.token.pod).toBe(POD_ROOT);

    // Both scopes present, both container-scoped, both have the same path.
    const scopes = rec.token.scopes;
    expect(scopes).toHaveLength(2);
    const readScope  = scopes.find((s) => s.startsWith('pod.read:'));
    const writeScope = scopes.find((s) => s.startsWith('pod.write:'));
    expect(readScope).toBeTruthy();
    expect(writeScope).toBeTruthy();
    expect(readScope.endsWith('/')).toBe(true);
    expect(writeScope.endsWith('/')).toBe(true);
    expect(readScope.split(':')[1]).toBe(writeScope.split(':')[1]);
  });
});

// ── mintShareToken (direct) ───────────────────────────────────────────────

describe('mintShareToken', () => {
  it('issues a verifiable token signed by the given identity', async () => {
    const rec = await mintShareToken(identity, {
      webid:       ALICE_WEBID,
      sharePath:   shareFolderName(ALICE_WEBID),
      podRoot:     POD_ROOT,
      sharePodUri: `${POD_ROOT}with-...%/`,
    });
    expect(rec.token.subject).toBe(ALICE_WEBID);
    expect(rec.token.issuer).toBe(identity.pubKey);
    expect(rec.expiresAt).toBeGreaterThan(rec.issuedAt);
    expect(PodCapabilityToken.verify(rec.token)).toBe(true);
  });
});

// ── SyncEngine integration ────────────────────────────────────────────────

describe('SyncEngine.runOnce — calls ensureShares', () => {
  it('after a successful runOnce, with-<webid>/ folder gets a token', async () => {
    const seg = shareFolderName(ALICE_WEBID);
    await fs.mkdir(join(localRoot, seg), { recursive: true });
    await fs.writeFile(join(localRoot, seg, 'hi.md'), 'hi');

    const e = newEngine();
    await e.runOnce();

    const shares = await e.shares();
    expect(shares).toHaveLength(1);
    expect(shares[0].webid).toBe(ALICE_WEBID);
    expect(shares[0].path).toBe(seg);
    expect(typeof shares[0].expires).toBe('number');
  });

  it('engine.shares() returns persisted records on a fresh engine instance', async () => {
    const seg = shareFolderName(BOB_WEBID);
    await fs.mkdir(join(localRoot, seg), { recursive: true });

    const e1 = newEngine();
    await e1.runOnce();
    await e1.stop();

    const e2 = newEngine();
    const shares = await e2.shares();
    expect(shares).toHaveLength(1);
    expect(shares[0].webid).toBe(BOB_WEBID);
  });

  it('without an identity, ensureShares is a no-op (existing engines still work)', async () => {
    const seg = shareFolderName(ALICE_WEBID);
    await fs.mkdir(join(localRoot, seg), { recursive: true });

    const e = new SyncEngine({
      podClient: pod,
      localRoot,
      podRoot: POD_ROOT,
      pollIntervalMs: 1_000_000,
      debounceMs: 50,
      // identity intentionally omitted
    });
    await e.runOnce();
    await expect(fs.access(join(localRoot, SHARES_FILE_RELPATH))).rejects.toThrow();
  });

  it('does not re-mint an unchanged folder on subsequent runOnce calls', async () => {
    const seg = shareFolderName(ALICE_WEBID);
    await fs.mkdir(join(localRoot, seg), { recursive: true });

    const e = newEngine();
    await e.runOnce();
    const before = await loadShares(localRoot);
    const beforeId = Object.values(before)[0].token.id;

    await e.runOnce();
    const after = await loadShares(localRoot);
    const afterId = Object.values(after)[0].token.id;
    expect(afterId).toBe(beforeId);
  });
});

// ── listShares (from autoShare directly) ──────────────────────────────────

describe('listShares', () => {
  it('returns an empty array when no shares.json exists', async () => {
    const r = await listShares(localRoot);
    expect(r).toEqual([]);
  });

  it('lists every share with the public-API shape', async () => {
    const seg = shareFolderName(ALICE_WEBID);
    await fs.mkdir(join(localRoot, seg), { recursive: true });
    const e = newEngine();
    await ensureShares(e, identity);

    const r = await listShares(localRoot);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      webid:    ALICE_WEBID,
      path:     seg,
      issuer:   identity.pubKey,
    });
    expect(typeof r[0].expires).toBe('number');
    expect(typeof r[0].issuedAt).toBe('number');
    expect(typeof r[0].podUri).toBe('string');
  });
});

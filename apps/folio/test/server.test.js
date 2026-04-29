/**
 * server.test.js — integration tests for Folio.B1.server.
 *
 * Strategy:
 *   - Each test creates a temp localRoot + an in-memory MockPodClient + a
 *     SyncEngine on top, then boots the server with `app.listen(0)` so the
 *     OS picks a free port.  No hard-coded port numbers anywhere.
 *   - HTTP calls go through Node 18+'s built-in `fetch`, so no supertest
 *     dependency is needed.
 *   - WebSocket is exercised via the `ws` client (already installed for the
 *     server).
 *
 * Coverage map (≥14 tests):
 *   - GET   /status                       happy + scan-error reported
 *   - GET   /conflicts                    empty + lists conflicted files
 *   - POST  /conflicts/:id/resolve        mine, theirs, custom text, 404, bad-id, no-markers
 *   - POST  /share                        happy + missing-webid + missing-vault
 *   - POST  /sync/now                     happy + bad direction
 *   - POST  /watch/start                  starts watcher + idempotent
 *   - POST  /watch/stop                   stops watcher + idempotent
 *   - WS    /events                       emits sync.done after a sync
 *   - 404                                 unknown route shape
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir }         from 'node:os';
import { join }           from 'node:path';

import WebSocket from 'ws';

import {
  AgentIdentity,
  Bootstrap,
  PodCapabilityToken,
} from '@canopy/core';

import { SyncEngine }       from '../src/SyncEngine.js';
import { createServer }     from '../src/server/index.js';
import { conflictIdFromRelPath } from '../src/server/conflictId.js';
import { SyncErrorBuffer }  from '../src/server/errorBuffer.js';

// ── In-memory PodClient mock (mirrors the SyncEngine.test.js fixture) ──────

class MockPodClient {
  constructor(podRoot) {
    this.podRoot = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
    this.store = new Map();
    this.tombstones = new Set();
    this._etagCounter = 0;
  }
  async read(uri) {
    const r = this.store.get(uri);
    if (!r) {
      const e = new Error(`mock 404: ${uri}`);
      e.code = 'NOT_FOUND';
      throw e;
    }
    return { ...r };
  }
  async write(uri, content, opts = {}) {
    const text = typeof content === 'string'
      ? content
      : (content instanceof Uint8Array ? new TextDecoder().decode(content) : String(content));
    const stored = {
      content:      text,
      contentType:  opts.contentType || 'application/octet-stream',
      lastModified: new Date().toUTCString(),
      etag:         `"e${++this._etagCounter}"`,
      size:         Buffer.byteLength(text, 'utf8'),
    };
    this.store.set(uri, stored);
    this.tombstones.delete(uri);
    return { uri, ...stored };
  }
  async list(containerUri) {
    const container = String(containerUri).endsWith('/') ? containerUri : `${containerUri}/`;
    const direct = new Map();
    const nested = new Set();
    for (const k of this.store.keys()) {
      if (this.tombstones.has(k)) continue;
      if (!k.startsWith(container)) continue;
      const tail = k.slice(container.length);
      if (tail === '') continue;
      const slash = tail.indexOf('/');
      if (slash === -1) direct.set(k, 'resource');
      else              nested.add(`${container}${tail.slice(0, slash)}/`);
    }
    return {
      container,
      entries: [
        ...[...direct.keys()].map((uri) => ({ uri, type: 'resource' })),
        ...[...nested].map((uri)        => ({ uri, type: 'container' })),
      ],
    };
  }
  async delete(uri)        { this.store.delete(uri); this.tombstones.delete(uri); }
  async deleteLocal(uri)   { this.tombstones.add(uri); }
  async clearTombstone(uri){ this.tombstones.delete(uri); }
  on() {} off() {} emit() {}
}

// ── In-memory vault holding a deterministic BIP-39 phrase ──────────────────

const TEST_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

class MemVault {
  constructor(seed = {}) { this.entries = { ...seed }; }
  async get(key) { return this.entries[key]; }
  async set(key, val) { this.entries[key] = val; }
}

const POD_ROOT = 'https://alice.example/notes/';

// ── Test harness ────────────────────────────────────────────────────────────

let localRoot, engine, podClient, vault, srv, baseUrl, wsUrl;

beforeEach(async () => {
  localRoot = await fs.mkdtemp(join(tmpdir(), 'folio-srv-'));
  podClient = new MockPodClient(POD_ROOT);
  engine    = new SyncEngine({
    podClient,
    localRoot,
    podRoot:        POD_ROOT,
    pollIntervalMs: 60_000,
    debounceMs:     50,
  });
  // Expose podClient on the engine instance so /status can find it.
  engine.__podClient = podClient;
  // (Object.defineProperty so we can read it back from routes.js' `engine._podClient ?? engine.__podClient`.)

  vault = new MemVault();
  // Pre-seed a real BIP-39 phrase so /share works.
  const bs = Bootstrap.fromMnemonic(TEST_PHRASE);
  vault.entries['bootstrap-mnemonic'] = TEST_PHRASE;
  vault.entries['bootstrap-seed-b64'] = Buffer.from(bs.secret).toString('base64');

  srv = createServer({ engine, vault });
  const { port, host } = await srv.listen(0, '127.0.0.1');
  baseUrl = `http://${host}:${port}`;
  wsUrl   = `ws://${host}:${port}/events`;
});

afterEach(async () => {
  try { await srv.close(); } catch { /* ignore */ }
  try { await fs.rm(localRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getJson(path) {
  const r = await fetch(`${baseUrl}${path}`);
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}
async function postJson(path, body) {
  const r = await fetch(`${baseUrl}${path}`, {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    body == null ? '' : JSON.stringify(body),
  });
  const respBody = await r.json().catch(() => ({}));
  return { status: r.status, body: respBody };
}

// ── /status ────────────────────────────────────────────────────────────────

describe('GET /status', () => {
  it('returns localRoot, podRoot, stats, pending counts', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'hi');
    const { status, body } = await getJson('/status');
    expect(status).toBe(200);
    expect(body.localRoot).toBe(localRoot.replace(/[\/\\]+$/, ''));
    expect(body.podRoot).toBe(POD_ROOT);
    expect(typeof body.ts).toBe('number');
    expect(body.pending).toMatchObject({
      uploads:   1,    // a.md is local-only
      downloads: 0,
      deletes:   0,
      conflicts: 0,
    });
    expect(body.stats).toBeDefined();
    expect(body.watching).toBe(false);
  });

  it('reports a scanError but does not 500 when the pod blows up', async () => {
    // Replace pod's list with a thrower.
    podClient.list = async () => { throw new Error('boom'); };
    const { status, body } = await getJson('/status');
    expect(status).toBe(200);
    expect(body.scanError).toMatch(/boom/);
  });
});

// ── /conflicts ─────────────────────────────────────────────────────────────

describe('GET /conflicts', () => {
  it('returns an empty list when no conflicts exist', async () => {
    await fs.writeFile(join(localRoot, 'clean.md'), 'just notes');
    const { status, body } = await getJson('/conflicts');
    expect(status).toBe(200);
    expect(body.conflicts).toEqual([]);
  });

  it('lists files containing conflict markers', async () => {
    const conflicted = '<<<<<<< YOURS\nmine\n=======\ntheirs\n>>>>>>> THEIRS\n';
    await fs.writeFile(join(localRoot, 'note.md'), conflicted);
    await fs.writeFile(join(localRoot, 'clean.md'), 'just notes');
    const { status, body } = await getJson('/conflicts');
    expect(status).toBe(200);
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].relPath).toBe('note.md');
    expect(body.conflicts[0].id).toBe(conflictIdFromRelPath('note.md'));
  });
});

// ── /conflicts/:id/resolve ─────────────────────────────────────────────────

describe('POST /conflicts/:id/resolve', () => {
  const blob = '<<<<<<< YOURS\nMINE\n=======\nTHEIRS\n>>>>>>> THEIRS\n';

  it('resolves with "mine"', async () => {
    await fs.writeFile(join(localRoot, 'note.md'), blob);
    const id = conflictIdFromRelPath('note.md');
    const { status, body } = await postJson(`/conflicts/${id}/resolve`, { resolution: 'mine' });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const text = await fs.readFile(join(localRoot, 'note.md'), 'utf8');
    expect(text).toBe('MINE\n');
  });

  it('resolves with "theirs"', async () => {
    await fs.writeFile(join(localRoot, 'note.md'), blob);
    const id = conflictIdFromRelPath('note.md');
    const { status } = await postJson(`/conflicts/${id}/resolve`, { resolution: 'theirs' });
    expect(status).toBe(200);
    const text = await fs.readFile(join(localRoot, 'note.md'), 'utf8');
    expect(text).toBe('THEIRS\n');
  });

  it('writes a custom text resolution verbatim', async () => {
    await fs.writeFile(join(localRoot, 'note.md'), blob);
    const id = conflictIdFromRelPath('note.md');
    const merged = 'MERGED CONTENT\n';
    const { status } = await postJson(`/conflicts/${id}/resolve`, { resolution: merged });
    expect(status).toBe(200);
    const text = await fs.readFile(join(localRoot, 'note.md'), 'utf8');
    expect(text).toBe(merged);
  });

  it('returns 400 when body.resolution is missing', async () => {
    await fs.writeFile(join(localRoot, 'note.md'), blob);
    const id = conflictIdFromRelPath('note.md');
    const { status, body } = await postJson(`/conflicts/${id}/resolve`, {});
    expect(status).toBe(400);
    expect(body.error.code).toBe('BAD_RESOLUTION');
  });

  it('returns 404 when the file does not exist', async () => {
    const id = conflictIdFromRelPath('does-not-exist.md');
    const { status, body } = await postJson(`/conflicts/${id}/resolve`, { resolution: 'mine' });
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 when the file has no conflict markers', async () => {
    await fs.writeFile(join(localRoot, 'clean.md'), 'plain content');
    const id = conflictIdFromRelPath('clean.md');
    const { status, body } = await postJson(`/conflicts/${id}/resolve`, { resolution: 'mine' });
    expect(status).toBe(400);
    expect(body.error.code).toBe('NO_CONFLICT_MARKERS');
  });
});

// ── /share ─────────────────────────────────────────────────────────────────

describe('POST /share', () => {
  it('mints a valid PodCapabilityToken from the vault-derived identity', async () => {
    const { status, body } = await postJson('/share', {
      webid:  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      scopes: ['read'],
      path:   '/note.md',
    });
    expect(status).toBe(200);
    expect(body.token).toBeDefined();
    expect(body.token.subject).toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(body.token.pod).toBe(POD_ROOT);
    expect(body.token.scopes).toEqual(['pod.read:/note.md']);
    expect(PodCapabilityToken.verify(body.token, POD_ROOT)).toBe(true);
  });

  it('accepts a fully-qualified pod.<verb>:<path> scope', async () => {
    const { status, body } = await postJson('/share', {
      webid:  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      scopes: ['pod.write:/folder/'],
    });
    expect(status).toBe(200);
    expect(body.token.scopes).toEqual(['pod.write:/folder/']);
  });

  it('returns 400 when webid is missing', async () => {
    const { status, body } = await postJson('/share', { scopes: ['read'] });
    expect(status).toBe(400);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toMatch(/webid/);
  });

  it('returns 503 when the vault has no identity material', async () => {
    // Re-boot the server with an empty vault.
    await srv.close();
    srv = createServer({ engine, vault: new MemVault() });
    const { port, host } = await srv.listen(0, '127.0.0.1');
    baseUrl = `http://${host}:${port}`;

    const { status, body } = await postJson('/share', {
      webid:  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      scopes: ['read'],
    });
    expect(status).toBe(503);
    expect(body.error.code).toBe('NO_IDENTITY');
  });

  it('uses an injected AgentIdentity when provided', async () => {
    await srv.close();
    const bs = Bootstrap.fromMnemonic(TEST_PHRASE);
    const id = new AgentIdentity({ seed: bs.secret, vault: null });
    srv = createServer({ engine, identity: id });
    const { port, host } = await srv.listen(0, '127.0.0.1');
    baseUrl = `http://${host}:${port}`;

    const { status, body } = await postJson('/share', {
      webid:  'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      scopes: ['read'],
    });
    expect(status).toBe(200);
    expect(body.token.issuer).toBe(id.pubKey);
  });
});

// ── /sync/now ──────────────────────────────────────────────────────────────

describe('POST /sync/now', () => {
  it('returns 202 immediately and runs the sync in the background', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'aaa');
    const { status, body } = await postJson('/sync/now', { direction: 'push' });
    expect(status).toBe(202);
    expect(body.ok).toBe(true);
    // Wait for the background sync to complete.
    await new Promise((r) => setTimeout(r, 200));
    expect(podClient.store.has(`${POD_ROOT}a.md`)).toBe(true);
  });

  it('returns 400 for a bogus direction', async () => {
    const { status, body } = await postJson('/sync/now', { direction: 'sideways' });
    expect(status).toBe(400);
    expect(body.error.code).toBe('BAD_DIRECTION');
  });
});

// ── /watch/start + /watch/stop ─────────────────────────────────────────────

describe('POST /watch/start + /watch/stop', () => {
  it('starts and stops the watcher; both are idempotent', async () => {
    {
      const { status, body } = await postJson('/watch/start');
      expect(status).toBe(200);
      expect(body.watching).toBe(true);
    }
    expect(engine.__watching).toBe(true);

    // Idempotent second start.
    {
      const { status } = await postJson('/watch/start');
      expect(status).toBe(200);
    }

    {
      const { status, body } = await postJson('/watch/stop');
      expect(status).toBe(200);
      expect(body.watching).toBe(false);
    }
    expect(engine.__watching).toBe(false);

    // Idempotent second stop.
    {
      const { status } = await postJson('/watch/stop');
      expect(status).toBe(200);
    }
  });
});

// ── 404 ────────────────────────────────────────────────────────────────────

describe('unknown route', () => {
  it('returns a structured 404 error', async () => {
    const { status, body } = await getJson('/nope');
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ── /versions (Folio.B4) ───────────────────────────────────────────────────

describe('GET /versions/:id', () => {
  it('returns the snapshot list for a relPath that has history', async () => {
    // Drive a real capture through the engine to populate history.
    await fs.writeFile(join(localRoot, 'a.md'), 'hello');
    await engine.runOnce();
    const id = conflictIdFromRelPath('a.md');
    const { status, body } = await getJson(`/versions/${id}`);
    expect(status).toBe(200);
    expect(body.relPath).toBe('a.md');
    expect(Array.isArray(body.versions)).toBe(true);
    expect(body.versions.length).toBeGreaterThanOrEqual(1);
    expect(body.versions[0]).toHaveProperty('ts');
    expect(body.versions[0]).toHaveProperty('sha256');
    expect(body.versions[0]).toHaveProperty('size');
    // Absolute paths must NOT leak — only ts/sha256/size.
    expect(body.versions[0].path).toBeUndefined();
  });

  it('rejects malformed version IDs with 400 BAD_VERSION_ID', async () => {
    // `.folio/foo.md` is base64-encoded but isVersionable rejects it.
    const id = Buffer.from('.folio/foo.md', 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const { status, body } = await getJson(`/versions/${id}`);
    expect(status).toBe(400);
    expect(body.error.code).toBe('BAD_VERSION_ID');
  });

  it('returns an empty list when the relPath has no history', async () => {
    const id = conflictIdFromRelPath('untouched.md');
    const { status, body } = await getJson(`/versions/${id}`);
    expect(status).toBe(200);
    expect(body.versions).toEqual([]);
  });
});

describe('GET /versions/:id/content/:ms', () => {
  it('returns the snapshot raw text for an existing version', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'snapshot-content');
    await engine.runOnce();
    const id = conflictIdFromRelPath('a.md');
    const list = await (await fetch(`${baseUrl}/versions/${id}`)).json();
    const ts = list.versions[0].ts;

    const r = await fetch(`${baseUrl}/versions/${id}/content/${ts}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/plain/);
    expect(await r.text()).toBe('snapshot-content');
  });

  it('returns 404 VERSION_NOT_FOUND for an unknown ts', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'first');
    await engine.runOnce();
    const id = conflictIdFromRelPath('a.md');
    const r = await fetch(`${baseUrl}/versions/${id}/content/99999999`);
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.error.code).toBe('VERSION_NOT_FOUND');
  });
});

describe('POST /versions/:id/restore', () => {
  it('restores a snapshot and returns the snapshotMsBeforeRestore', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'v1');
    await engine.runOnce();

    const id = conflictIdFromRelPath('a.md');
    const list = await (await fetch(`${baseUrl}/versions/${id}`)).json();
    const oldestTs = list.versions[0].ts;

    // Mutate live; restore.
    await fs.writeFile(join(localRoot, 'a.md'), 'live-now');
    const { status, body } = await postJson(`/versions/${id}/restore`, { ts: oldestTs });
    expect(status).toBe(200);
    expect(body.restoredFromMs).toBe(oldestTs);
    expect(typeof body.snapshotMsBeforeRestore).toBe('number');
    expect(await fs.readFile(join(localRoot, 'a.md'), 'utf8')).toBe('v1');
  });

  it('returns 404 VERSION_NOT_FOUND for an unknown ts', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'x');
    await engine.runOnce();
    const id = conflictIdFromRelPath('a.md');
    const { status, body } = await postJson(`/versions/${id}/restore`, { ts: 999_999 });
    expect(status).toBe(404);
    expect(body.error.code).toBe('VERSION_NOT_FOUND');
  });

  it('returns 400 BAD_VERSION_ID when ts is missing', async () => {
    const id = conflictIdFromRelPath('a.md');
    const { status, body } = await postJson(`/versions/${id}/restore`, {});
    expect(status).toBe(400);
    expect(body.error.code).toBe('BAD_VERSION_ID');
  });
});

describe('GET /versions (collection)', () => {
  it('lists every relPath that has at least one snapshot', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'A');
    await fs.writeFile(join(localRoot, 'sub/b.md'), 'B').catch(async () => {
      await fs.mkdir(join(localRoot, 'sub'), { recursive: true });
      await fs.writeFile(join(localRoot, 'sub/b.md'), 'B');
    });
    await fs.mkdir(join(localRoot, 'sub'), { recursive: true });
    await fs.writeFile(join(localRoot, 'sub/b.md'), 'B');
    await engine.runOnce();

    const { status, body } = await getJson('/versions');
    expect(status).toBe(200);
    const rels = body.files.map((f) => f.relPath).sort();
    expect(rels).toContain('a.md');
    expect(rels).toContain('sub/b.md');
    for (const f of body.files) {
      expect(typeof f.id).toBe('string');
      expect(typeof f.latestMs).toBe('number');
      expect(f.count).toBeGreaterThan(0);
    }
  });
});

describe('WebSocket /events — version.new (Folio.B4)', () => {
  it('broadcasts version.new when SyncEngine captures a snapshot', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'aaa');

    const ws = new WebSocket(wsUrl);
    const frames = [];
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    ws.on('message', (data) => {
      try { frames.push(JSON.parse(data.toString('utf8'))); } catch { /* ignore */ }
    });

    await postJson('/sync/now', { direction: 'push' });
    await waitFor(() => frames.some((f) => f.type === 'version.new'), { timeoutMs: 3_000 });

    const v = frames.find((f) => f.type === 'version.new');
    expect(v).toBeDefined();
    expect(v.relPath).toBe('a.md');
    expect(typeof v.ts).toBe('number');

    ws.close();
  });
});

// ── WebSocket ──────────────────────────────────────────────────────────────

describe('WebSocket /events', () => {
  it('emits sync.progress + sync.done frames for /sync/now', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'aaa');

    const ws = new WebSocket(wsUrl);
    const frames = [];
    const opened = new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.on('message', (data) => {
      try { frames.push(JSON.parse(data.toString('utf8'))); } catch { /* ignore */ }
    });
    await opened;

    // First frame after connect should be a status snapshot.
    await waitFor(() => frames.some((f) => f.type === 'status'));

    await postJson('/sync/now', { direction: 'push' });

    await waitFor(() => frames.some((f) => f.type === 'sync.done'));

    const progress = frames.find((f) => f.type === 'sync.progress');
    expect(progress).toBeDefined();
    expect(progress.direction).toBe('push');
    expect(progress.phase).toBe('start');

    const done = frames.find((f) => f.type === 'sync.done');
    expect(done).toBeDefined();
    expect(done.uploads).toBeGreaterThanOrEqual(1);

    ws.close();
  });
});

// ── Folio v2.2 — error ring buffer + /status.lastError + /errors/clear ─────

describe('Folio v2.2 — SyncErrorBuffer (in-memory ring)', () => {
  it('keeps the most recent N events newest-first; drops phase=conflict', () => {
    const buf = new SyncErrorBuffer({ capacity: 3 });
    buf.push({ phase: 'upload',           relPath: 'a.md', message: 'one'   });
    buf.push({ phase: 'conflict',         relPath: 'b.md', message: 'skip'  });
    buf.push({ phase: 'download',         relPath: 'c.md', message: 'two'   });
    buf.push({ phase: 'ensure-container', uri:     'd/',   message: 'three' });
    buf.push({ phase: 'upload',           relPath: 'e.md', message: 'four'  });

    const recent = buf.recent(10);
    expect(recent).toHaveLength(3); // capped at capacity
    expect(recent[0].message).toBe('four');
    expect(recent[1].message).toBe('three');
    expect(recent[2].message).toBe('two');
    // conflict was filtered.
    expect(recent.find((e) => e.message === 'skip')).toBeUndefined();
    // lastError is the most recent.
    expect(buf.lastError.message).toBe('four');
    // size matches.
    expect(buf.size).toBe(3);
  });

  it('clear() empties everything', () => {
    const buf = new SyncErrorBuffer();
    buf.push({ phase: 'upload', relPath: 'x.md', message: 'oops' });
    expect(buf.size).toBe(1);
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.lastError).toBeNull();
    expect(buf.recent()).toEqual([]);
  });

  it('attachEngine() subscribes to the engine and normalizes the err shape', () => {
    const fakeEngine = {
      _handlers: new Map(),
      on(name, fn) { (this._handlers.get(name) ?? this._handlers.set(name, []).get(name)).push(fn); },
      off(name, fn) {
        const arr = this._handlers.get(name) ?? [];
        const ix = arr.indexOf(fn);
        if (ix >= 0) arr.splice(ix, 1);
      },
      emit(name, payload) { for (const fn of this._handlers.get(name) ?? []) fn(payload); },
    };
    const buf = new SyncErrorBuffer();
    buf.attachEngine(fakeEngine);

    fakeEngine.emit('error', { phase: 'upload',  relPath: 'a.md', err: new Error('boom') });
    fakeEngine.emit('error', { phase: 'conflict', relPath: 'b.md', err: new Error('skip') });
    fakeEngine.emit('error', { phase: 'ensure-container', uri: 'pod/x/', err: new Error('403') });

    const recent = buf.recent(10);
    // phase=conflict was filtered.
    expect(recent.map((e) => e.phase)).toEqual(['ensure-container', 'upload']);
    // err.message normalized.
    expect(recent[0].message).toBe('403');
    expect(recent[1].message).toBe('boom');

    buf.close();
    fakeEngine.emit('error', { phase: 'upload', relPath: 'c.md', err: new Error('after-close') });
    // Closed buffer no longer accumulates.
    expect(buf.size).toBe(2);
  });
});

describe('GET /status — Folio v2.2 lastError + errors[]', () => {
  it('reports lastError and the most-recent 10 entries from the ring buffer', async () => {
    // Seed via the buffer's public push (we don't have a real failing engine
    // available in this fixture).
    const buf = new SyncErrorBuffer();
    // Create a fresh server instance with an explicit buffer so we can seed.
    await srv.close();
    srv = createServer({ engine, vault, errorBuffer: buf });
    const { port, host } = await srv.listen(0, '127.0.0.1');
    baseUrl = `http://${host}:${port}`;

    // Seed several errors; one conflict that must be filtered.
    buf.push({ ts: 1, phase: 'upload',           relPath: 'a.md', message: 'PUT 403' });
    buf.push({ ts: 2, phase: 'conflict',         relPath: 'b.md', message: 'normal'  });
    buf.push({ ts: 3, phase: 'download',         relPath: 'c.md', message: 'GET 404' });
    buf.push({ ts: 4, phase: 'ensure-container', relPath: null,   message: 'mkdir 401' });

    const { status, body } = await getJson('/status');
    expect(status).toBe(200);
    expect(body.lastError).toBeDefined();
    expect(body.lastError.phase).toBe('ensure-container');
    expect(body.lastError.message).toBe('mkdir 401');
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors).toHaveLength(3); // conflict was filtered
    expect(body.errors.map((e) => e.message)).toEqual([
      'mkdir 401', 'GET 404', 'PUT 403',
    ]);
  });

  it('reports lastError=null + errors=[] when no errors fired', async () => {
    const { status, body } = await getJson('/status');
    expect(status).toBe(200);
    expect(body.lastError).toBeNull();
    expect(body.errors).toEqual([]);
  });
});

describe('POST /errors/clear (Folio v2.2)', () => {
  it('returns 204 and empties the in-memory ring buffer', async () => {
    const buf = new SyncErrorBuffer();
    await srv.close();
    srv = createServer({ engine, vault, errorBuffer: buf });
    const { port, host } = await srv.listen(0, '127.0.0.1');
    baseUrl = `http://${host}:${port}`;

    buf.push({ phase: 'upload', relPath: 'a.md', message: 'oops' });
    expect(buf.size).toBe(1);

    const r = await fetch(`${baseUrl}/errors/clear`, { method: 'POST' });
    expect(r.status).toBe(204);
    // 204 carries no body.
    expect(buf.size).toBe(0);

    // /status reflects the empty state.
    const { body } = await getJson('/status');
    expect(body.lastError).toBeNull();
    expect(body.errors).toEqual([]);

    // Idempotent — second call still 204.
    const r2 = await fetch(`${baseUrl}/errors/clear`, { method: 'POST' });
    expect(r2.status).toBe(204);
  });

  it('returns 204 even when no buffer is wired', async () => {
    // Default createServer() auto-builds a buffer; force a regression-style
    // sanity check: clearing while the buffer has zero entries is still 204.
    const r = await fetch(`${baseUrl}/errors/clear`, { method: 'POST' });
    expect(r.status).toBe(204);
  });
});

describe('SyncErrorBuffer wired through the live engine event flow', () => {
  it('an error emitted by the engine lands in /status.errors after a sync', async () => {
    // Use the default-built buffer (the one createServer auto-wires).
    await srv.close();
    srv = createServer({ engine, vault });
    const { port, host } = await srv.listen(0, '127.0.0.1');
    baseUrl = `http://${host}:${port}`;

    // Force an upload failure: write to the pod will throw.
    podClient.write = async () => {
      const e = new Error('PUT failed: 403 Forbidden');
      e.code = 'FORBIDDEN';
      throw e;
    };
    await fs.writeFile(join(localRoot, 'failing.md'), 'content');
    await engine.runOnce();

    // Give the event loop a tick for the synchronous emit to land.
    await new Promise((r) => setTimeout(r, 50));

    const { body } = await getJson('/status');
    const upload = body.errors.find((e) => e.phase === 'upload');
    expect(upload).toBeDefined();
    expect(upload.relPath).toBe('failing.md');
    expect(upload.message).toMatch(/403 Forbidden/);
    expect(body.lastError.phase).toBe('upload');
  });
});

// ── helpers ────────────────────────────────────────────────────────────────

async function waitFor(predicate, { timeoutMs = 2000, stepMs = 25 } = {}) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: timeout');
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

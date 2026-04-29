/**
 * Indexer.test.js — unit tests for the BFS pod walker + resource upsert path.
 *
 * Uses the duplicated FsBackedMockPodClient from `_podFactory.js` so
 * tests don't import from Folio.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { Db }           from '../src/Db.js';
import { search }       from '../src/Search.js';
import { indexSource, indexOne, isTextContentType } from '../src/Indexer.js';
import { FsBackedMockPodClient } from '../src/cli/_podFactory.js';

let db;
let pod;
let source;

const POD_ROOT = 'https://alice.example/';

beforeEach(async () => {
  db = Db.open(':memory:');
  source = db.addSource({ name: 'alice', podRoot: POD_ROOT });
  pod = new FsBackedMockPodClient(POD_ROOT);
});

async function seed(uri, body, contentType = 'text/markdown') {
  await pod.write(uri, body, { contentType });
}

describe('isTextContentType', () => {
  it('accepts text/* and structured-suffix variants', () => {
    expect(isTextContentType('text/plain')).toBe(true);
    expect(isTextContentType('text/markdown')).toBe(true);
    expect(isTextContentType('text/html; charset=utf-8')).toBe(true);
    expect(isTextContentType('application/json')).toBe(true);
    expect(isTextContentType('application/xml')).toBe(true);
    expect(isTextContentType('application/ld+json')).toBe(true);
    expect(isTextContentType('application/atom+xml')).toBe(true);
    expect(isTextContentType('application/javascript')).toBe(true);
  });
  it('rejects binary content types', () => {
    expect(isTextContentType('image/jpeg')).toBe(false);
    expect(isTextContentType('application/octet-stream')).toBe(false);
    expect(isTextContentType('application/zip')).toBe(false);
    expect(isTextContentType('')).toBe(false);
    expect(isTextContentType(null)).toBe(false);
  });
});

describe('indexSource — fresh walk', () => {
  it('walks an empty pod and reports zero stats', async () => {
    const stats = await indexSource({ db, source, podClient: pod });
    expect(stats.scanned).toBe(0);
    expect(stats.inserted).toBe(0);
  });

  it('indexes top-level + nested resources', async () => {
    await seed(`${POD_ROOT}note.md`, 'top level');
    await seed(`${POD_ROOT}sub/inner.md`, 'inner level');
    await seed(`${POD_ROOT}sub/deeper/leaf.md`, 'leaf level');

    const stats = await indexSource({ db, source, podClient: pod });
    expect(stats.scanned).toBe(3);
    expect(stats.inserted).toBe(3);
    expect(stats.unchanged).toBe(0);
    expect(stats.ftsIndexed).toBe(3);
  });

  it('skips unchanged resources on second indexSource (sha256 match)', async () => {
    await seed(`${POD_ROOT}note.md`, 'first');
    const r1 = await indexSource({ db, source, podClient: pod });
    expect(r1.inserted).toBe(1);

    const r2 = await indexSource({ db, source, podClient: pod });
    expect(r2.inserted).toBe(0);
    expect(r2.updated).toBe(0);
    expect(r2.unchanged).toBe(1);
  });

  it('updates resources when bytes change', async () => {
    await seed(`${POD_ROOT}note.md`, 'first');
    await indexSource({ db, source, podClient: pod });

    await seed(`${POD_ROOT}note.md`, 'second');
    const stats = await indexSource({ db, source, podClient: pod });
    expect(stats.unchanged).toBe(0);
    expect(stats.updated).toBe(1);
    expect(db.countResources(source.id)).toBe(1);

    // FTS reflects the new body.
    expect(search(db, 'first').length).toBe(0);
    expect(search(db, 'second').length).toBe(1);
  });

  it('--force re-indexes even when sha256 matches', async () => {
    await seed(`${POD_ROOT}note.md`, 'unchanged');
    await indexSource({ db, source, podClient: pod });

    const stats = await indexSource({ db, source, podClient: pod, force: true });
    expect(stats.unchanged).toBe(0);
    expect(stats.updated).toBe(1);
  });

  it('records binary resources without writing an FTS row', async () => {
    await seed(`${POD_ROOT}photo.jpg`, '\xFF\xD8\xFF\xE0', 'image/jpeg');
    const stats = await indexSource({ db, source, podClient: pod });
    expect(stats.scanned).toBe(1);
    expect(stats.inserted).toBe(1);
    expect(stats.ftsIndexed).toBe(0);
    expect(stats.ftsSkippedBinary).toBe(1);

    // No FTS hit even on the rel-path column.
    expect(search(db, 'photo').length).toBe(0);
  });

  it('updates the source last_indexed timestamp', async () => {
    expect(db.getSourceById(source.id).lastIndexed).toBeNull();
    await indexSource({ db, source, podClient: pod });
    expect(db.getSourceById(source.id).lastIndexed).toBeGreaterThan(0);
  });

  it('emits onProgress events for resources', async () => {
    await seed(`${POD_ROOT}a.md`, 'one');
    await seed(`${POD_ROOT}b.md`, 'two');
    const events = [];
    await indexSource({ db, source, podClient: pod, onProgress: (e) => events.push(e) });
    const resources = events.filter((e) => e.kind === 'resource');
    expect(resources.length).toBe(2);
  });

  it('indexes JSON content as text', async () => {
    await seed(`${POD_ROOT}config.json`, '{"a":"hello"}', 'application/json');
    const stats = await indexSource({ db, source, podClient: pod });
    expect(stats.ftsIndexed).toBe(1);
    expect(search(db, 'hello').length).toBe(1);
  });

  it('continues past per-resource read errors', async () => {
    // Seed valid + a "phantom" URI that the listing would expose but
    // read() throws on.  We monkey-patch the mock's read() to fail for
    // one specific URI.
    await seed(`${POD_ROOT}good.md`, 'good content');
    await seed(`${POD_ROOT}bad.md`,  'bad content');
    const origRead = pod.read.bind(pod);
    pod.read = async (uri, opts) => {
      if (uri.endsWith('bad.md')) throw new Error('boom');
      return origRead(uri, opts);
    };
    const stats = await indexSource({ db, source, podClient: pod });
    expect(stats.scanned).toBe(2);
    expect(stats.inserted).toBe(1);
    expect(stats.errors).toBe(1);
  });
});

describe('indexSource — multi-source isolation', () => {
  it('each source gets its own resource rows', async () => {
    const podB = new FsBackedMockPodClient('https://bob.example/');
    const sourceB = db.addSource({ name: 'bob', podRoot: 'https://bob.example/' });

    await pod.write(`${POD_ROOT}note.md`, 'alice content', { contentType: 'text/markdown' });
    await podB.write('https://bob.example/note.md', 'bob content', { contentType: 'text/markdown' });

    await indexSource({ db, source, podClient: pod });
    await indexSource({ db, source: sourceB, podClient: podB });

    expect(db.countResources(source.id)).toBe(1);
    expect(db.countResources(sourceB.id)).toBe(1);
    expect(db.countResources()).toBe(2);
  });
});

describe('indexOne — single-resource path', () => {
  it('inserts a fresh resource', async () => {
    await pod.write(`${POD_ROOT}n.md`, 'body', { contentType: 'text/plain' });
    const listing = await pod.list(POD_ROOT);
    const ent = listing.entries.find((e) => e.uri.endsWith('n.md'));
    const r = await indexOne({ db, source, podClient: pod, entry: ent });
    expect(r.inserted).toBe(true);
    expect(r.fts).toBe('indexed');
  });

  it('reports unchanged on identical sha256', async () => {
    await pod.write(`${POD_ROOT}n.md`, 'body', { contentType: 'text/plain' });
    const ent = (await pod.list(POD_ROOT)).entries.find((e) => e.uri.endsWith('n.md'));
    await indexOne({ db, source, podClient: pod, entry: ent });
    const r = await indexOne({ db, source, podClient: pod, entry: ent });
    expect(r.unchanged).toBe(true);
    expect(r.fts).toBe('skip');
  });

  it('truncates oversized text bodies (>5MB) and reports fts="truncated"', async () => {
    // 5 MB + 1 KB.  Build a deterministic-ish big string.
    const chunk = 'lorem ipsum '.repeat(1024); // ~12 KB
    let big = '';
    while (big.length < 5 * 1024 * 1024 + 1024) big += chunk;
    await pod.write(`${POD_ROOT}big.md`, big, { contentType: 'text/markdown' });

    const ent = (await pod.list(POD_ROOT)).entries.find((e) => e.uri.endsWith('big.md'));
    const r = await indexOne({ db, source, podClient: pod, entry: ent });
    expect(r.fts).toBe('truncated');

    // The full body's size + sha256 are recorded; FTS is a 5MB slice.
    const row = db.getResource(source.id, ent.uri);
    expect(row.size).toBeGreaterThanOrEqual(5 * 1024 * 1024);
    const ftsBody = db.getFtsContent(row.id);
    expect(ftsBody.length).toBeLessThanOrEqual(5 * 1024 * 1024);
  });
});

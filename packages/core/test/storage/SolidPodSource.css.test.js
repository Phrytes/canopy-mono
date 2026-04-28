/**
 * SolidPodSource — Community Solid Server integration tests.
 *
 * These tests run against a real CSS instance.  Set:
 *   CSS_URL=http://localhost:3000/<pod-name>/    (the pod root, with trailing /)
 *
 * Optionally:
 *   CSS_FETCH_AUTH_HEADER=...   — value to set on Authorization for every request
 *
 * If `CSS_URL` is unset all tests in this file are skipped.  We do NOT
 * spin CSS up here — see `coding-plans/track-A-pod-substrate.md` §Test
 * infrastructure for setup details.
 *
 * We assume the pod is configured with public read+write+delete on a
 * scratch container (e.g. `/scratch/`).  The default scratch path is
 * `scratch/`; override with `CSS_SCRATCH=<relative-path-with-trailing-slash>`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SolidPodSource } from '../../src/storage/SolidPodSource.js';

const CSS_URL  = process.env.CSS_URL;
const SCRATCH  = process.env.CSS_SCRATCH ?? 'scratch/';
const HAS_CSS  = !!CSS_URL;

// Vitest accepts `describe.skipIf`; fall back to a manual skip for older versions.
const describeIf = HAS_CSS ? describe : describe.skip;

describeIf('SolidPodSource against CSS', () => {
  let source;
  let fetchFn;
  let testKey;
  const created = [];

  beforeAll(() => {
    if (process.env.CSS_FETCH_AUTH_HEADER) {
      const auth = process.env.CSS_FETCH_AUTH_HEADER;
      fetchFn = (url, init = {}) =>
        fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: auth } });
    } else {
      fetchFn = (url, init) => fetch(url, init);
    }
    source  = new SolidPodSource({ podUrl: CSS_URL, fetch: fetchFn });
    testKey = `${SCRATCH}podsource-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
  });

  afterAll(async () => {
    for (const uri of created.reverse()) {
      try { await source.delete(uri); } catch { /* best-effort cleanup */ }
    }
  });

  it('write → read round-trips a text file', async () => {
    const body = 'hello from podsource css test';
    const written = await source.write(testKey, body, { contentType: 'text/plain' });
    created.push(testKey);
    expect(written.uri).toMatch(testKey);
    expect(written.contentType).toBe('text/plain');

    const read = await source.read(testKey);
    expect(new TextDecoder().decode(read.content)).toBe(body);
    expect(read.contentType).toMatch(/^text\/plain/);
  });

  it('exists is true for written resource, false for missing', async () => {
    const key = `${SCRATCH}exists-${Date.now()}.txt`;
    await source.write(key, 'x', { contentType: 'text/plain' });
    created.push(key);

    expect(await source.exists(key)).toBe(true);
    expect(await source.exists(`${SCRATCH}does-not-exist-${Date.now()}.txt`)).toBe(false);
  });

  it('list returns the container entries', async () => {
    const a = `${SCRATCH}list-a-${Date.now()}.txt`;
    const b = `${SCRATCH}list-b-${Date.now()}.txt`;
    await source.write(a, 'a', { contentType: 'text/plain' });
    await source.write(b, 'b', { contentType: 'text/plain' });
    created.push(a, b);

    const result = await source.list(SCRATCH);
    const uris = result.entries.map(e => e.uri);
    expect(uris.some(u => u.endsWith(a.split('/').pop()))).toBe(true);
    expect(uris.some(u => u.endsWith(b.split('/').pop()))).toBe(true);
  });

  it('delete removes the resource and a follow-up read 404s', async () => {
    const key = `${SCRATCH}del-${Date.now()}.txt`;
    await source.write(key, 'gone', { contentType: 'text/plain' });
    await source.delete(key);
    await expect(source.read(key)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('read on missing → NOT_FOUND', async () => {
    const key = `${SCRATCH}never-${Date.now()}.txt`;
    await expect(source.read(key)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('If-Match conflict surfaces as CONFLICT', async () => {
    const key = `${SCRATCH}ifmatch-${Date.now()}.txt`;
    await source.write(key, 'one', { contentType: 'text/plain' });
    created.push(key);

    // Stale etag → 412 expected
    await expect(
      source.write(key, 'two', { contentType: 'text/plain', ifMatch: '"definitely-not-current"' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

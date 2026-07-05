/**
 * sealedPodDataSource — Community Solid Server integration test (env-gated).
 *
 * A real write→read round-trip of the sealed pod-backed DataSource against a live pod. Set:
 *   CSS_URL=http://localhost:3000/<pod-name>/    (the pod root, trailing /)
 * Optionally:
 *   CSS_FETCH_AUTH_HEADER=...   — Authorization value applied to every request
 *   CSS_SCRATCH=scratch/        — a writable scratch container (default `scratch/`)
 *
 * If `CSS_URL` is unset the whole file is skipped (mirrors SolidPodSource.css.test.js). This proves the
 * SAME assembly the app uses (SolidPodSource + createSealedPodClient) works over LDP: the key-holder reads
 * plaintext back, and the host stores a sealed envelope (ciphertext-at-rest on a real pod).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SolidPodSource } from '../src/SolidPodSource.js';
import { createSealedPodDataSource, podGroupPrefix } from '../src/sealedPodDataSource.js';
import { generateGroupKey, isSealed } from '../src/sealing/index.js';

const CSS_URL = process.env.CSS_URL;
const SCRATCH = process.env.CSS_SCRATCH ?? 'scratch/';
const HAS_CSS = !!CSS_URL;
const describeIf = HAS_CSS ? describe : describe.skip;

describeIf('createSealedPodDataSource against CSS', () => {
  let fetchFn;
  let source;
  let ds;
  const created = [];

  beforeAll(() => {
    if (process.env.CSS_FETCH_AUTH_HEADER) {
      const auth = process.env.CSS_FETCH_AUTH_HEADER;
      fetchFn = (url, init = {}) =>
        fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: auth } });
    } else {
      fetchFn = (url, init) => fetch(url, init);
    }
    source = new SolidPodSource({ podUrl: CSS_URL, fetch: fetchFn });
    ds = createSealedPodDataSource({ podSource: source, posture: 'p2', groupKey: generateGroupKey() });
  });

  afterAll(async () => {
    for (const uri of created.reverse()) {
      try { await source.delete(uri); } catch { /* best-effort cleanup */ }
    }
  });

  it('sealed write → read round-trips plaintext; the pod holds ciphertext; list + delete work', async () => {
    // Absolute pod URIs (SolidPodSource refuses non-http logical schemes) — the shape a pod-backed
    // CircleItemStore produces via rootPrefix = podGroupPrefix(CSS_URL).
    const container = `${CSS_URL}${SCRATCH}l1b-${Date.now()}/`;
    const uri = `${container}01.json`;
    const plaintext = JSON.stringify({ id: '01', type: 'list-item', text: 'milk, bread, soap' });
    // podGroupPrefix is exercised here as the documented rootPrefix formula (not needed for the raw round-trip).
    expect(podGroupPrefix(CSS_URL)).toMatch(/\/group\/$/);

    await ds.write(uri, plaintext);
    created.push(uri);

    // Host view: the raw bytes on the pod are a sealed envelope, not the plaintext.
    const rawBytes = (await source.read(uri)).content;
    const rawStr = new TextDecoder().decode(rawBytes);
    expect(isSealed(rawStr)).toBe(true);
    expect(rawStr).not.toContain('milk');

    // Key-holder view: the DataSource opens it back to the exact plaintext.
    expect(await ds.read(uri)).toBe(plaintext);

    // list returns the resource URI under the container.
    const keys = await ds.list(container);
    expect(keys).toContain(uri);

    // delete removes it; a subsequent read is null.
    await ds.delete(uri);
    expect(await ds.read(uri)).toBeNull();
  });
});

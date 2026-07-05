/**
 * DataSource PORT conformance harness.
 *
 * Given a factory that produces a fresh, empty `DataSource` adapter, assert it
 * satisfies the port (packages/core/src/storage/DataSource.js): the CRUD-over-
 * paths contract (read→null on miss, write create/overwrite, delete no-op on
 * miss, list-by-prefix) and, optionally, the structured `query`.
 *
 * "Implement the port + pass this harness = compatible with the @canopy SDK."
 */
import { expect } from 'vitest';
import { DataSource } from '../../src/storage/DataSource.js';

export const REQUIRED_DATASOURCE_METHODS = Object.freeze([
  'read', 'write', 'delete', 'list', 'query',
]);

/**
 * @param {() => (DataSource | Promise<DataSource>)} makeSource — yields a fresh, empty source.
 * @param {object} [opts]
 * @param {string} [opts.label='DataSource']
 * @param {boolean} [opts.supportsQuery=false] — also exercise `query()`.
 */
export async function assertDataSourceConformance(makeSource, { label = 'DataSource', supportsQuery = false } = {}) {
  const src = await makeSource();

  // ── 1. Shape ──────────────────────────────────────────────────────────────
  expect(src, `${label}: must be a DataSource instance`).toBeInstanceOf(DataSource);
  for (const m of REQUIRED_DATASOURCE_METHODS) {
    expect(typeof src[m], `${label}: must expose method ${m}()`).toBe('function');
  }

  // ── 2. read() on a missing path returns null ──────────────────────────────
  expect(await src.read('conf/missing'), `${label}: read() of absent path is null`).toBe(null);

  // ── 3. write() then read() round-trips ────────────────────────────────────
  await src.write('conf/a.txt', 'alpha');
  expect(await src.read('conf/a.txt'), `${label}: read() returns written value`).toBe('alpha');

  // ── 4. write() overwrites ─────────────────────────────────────────────────
  await src.write('conf/a.txt', 'beta');
  expect(await src.read('conf/a.txt'), `${label}: write() overwrites`).toBe('beta');

  // ── 5. list(prefix) returns only prefixed paths ───────────────────────────
  await src.write('conf/b.txt', 'b-val');
  await src.write('other/c.txt', 'c-val');
  const listed = await src.list('conf/');
  expect(listed, `${label}: list() includes prefixed paths`)
    .toEqual(expect.arrayContaining(['conf/a.txt', 'conf/b.txt']));
  expect(listed, `${label}: list() excludes non-prefixed paths`).not.toContain('other/c.txt');

  // ── 6. delete() removes; delete() of a missing path is a no-op ────────────
  await src.delete('conf/a.txt');
  expect(await src.read('conf/a.txt'), `${label}: delete() removes the path`).toBe(null);
  // delete() of an absent path must resolve, not throw.
  await src.delete('conf/missing');

  // ── 7. (optional) query() by filter ───────────────────────────────────────
  if (supportsQuery) {
    await src.write('q/1', JSON.stringify({ type: 'note', tag: 'x' }));
    await src.write('q/2', JSON.stringify({ type: 'note', tag: 'y' }));
    const rows = await src.query({ type: 'note', tag: 'x' });
    expect(Array.isArray(rows), `${label}: query() returns an array`).toBe(true);
    expect(rows.length, `${label}: query() matches exactly one row`).toBe(1);
  }
}

/**
 * StorageBackend PORT conformance harness.
 *
 * Given a factory that produces a fresh, empty `StorageBackend` adapter, assert
 * it satisfies the port (packages/core/src/storage/StorageBackend.js): the
 * ciphertext-only put/get/list contract (get→null on miss, put create/overwrite,
 * list-by-prefix) AND the defining property — the backend holds only the exact
 * bytes it was handed, never plaintext it invented.
 *
 * "Implement the port + pass this harness = a store the seal can gate."
 */
import { expect } from 'vitest';
import { StorageBackend } from '../storage/StorageBackend.js';

/** The three method names every StorageBackend adapter must expose; checked by the harness. */
export const REQUIRED_STORAGE_BACKEND_METHODS = Object.freeze(['put', 'get', 'list']);

/**
 * Conformance harness asserting a StorageBackend adapter satisfies the port: the
 * ciphertext-only put/get/list contract (get null on miss, overwrite, prefix
 * list) and that a stored ciphertext round-trips byte-for-byte (the backend is a
 * blind carrier — it neither decodes nor mutates what it holds). Uses vitest's
 * expect, so it must run inside a vitest test.
 * @param {() => (StorageBackend | Promise<StorageBackend>)} makeBackend — yields a fresh, empty backend.
 * @param {object} [opts]
 * @param {string} [opts.label='StorageBackend']
 * @param {boolean} [opts.requireInstance=true] — assert the adapter is a StorageBackend subclass.
 */
export async function assertStorageBackendConformance(makeBackend, { label = 'StorageBackend', requireInstance = true } = {}) {
  const backend = await makeBackend();

  // ── 1. Shape ──────────────────────────────────────────────────────────────
  if (requireInstance) {
    expect(backend, `${label}: must be a StorageBackend instance`).toBeInstanceOf(StorageBackend);
  }
  for (const m of REQUIRED_STORAGE_BACKEND_METHODS) {
    expect(typeof backend[m], `${label}: must expose method ${m}()`).toBe('function');
  }

  // ── 2. get() on a missing ref returns null ────────────────────────────────
  expect(await backend.get('conf/missing'), `${label}: get() of absent ref is null`).toBe(null);

  // ── 3. put() then get() round-trips the ciphertext byte-for-byte ──────────
  const ciphertext = 'fp1:conf-opaque-ciphertext-blob';
  await backend.put('conf/a', ciphertext);
  expect(await backend.get('conf/a'), `${label}: get() returns the exact stored ciphertext`).toBe(ciphertext);

  // ── 4. put() overwrites ───────────────────────────────────────────────────
  await backend.put('conf/a', 'fp1:conf-second-blob');
  expect(await backend.get('conf/a'), `${label}: put() overwrites`).toBe('fp1:conf-second-blob');

  // ── 5. list(prefix) returns only prefixed refs ────────────────────────────
  await backend.put('conf/b', 'fp1:conf-b');
  await backend.put('other/c', 'fp1:other-c');
  const listed = await backend.list('conf/');
  expect(listed, `${label}: list() includes prefixed refs`)
    .toEqual(expect.arrayContaining(['conf/a', 'conf/b']));
  expect(listed, `${label}: list() excludes non-prefixed refs`).not.toContain('other/c');
}

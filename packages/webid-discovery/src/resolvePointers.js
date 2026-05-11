/**
 * resolvePointers — given a set of WebID-profile pointers, fetch each
 * pointed-at resource via a caller-supplied `read` function.
 *
 * The `read` contract is intentionally minimal: `read(uri) → Promise<bytes
 * | object | null>`.  Typical callers pass:
 *   - The pseudo-pod's `read` method (substrate-side, will eventually be
 *     the canonical path once pseudo-pod V0 ships).
 *   - A `pod-client`'s `fetch` method wrapped to return bytes.
 *   - For tests: an in-memory `Map`-backed shim.
 *
 * Returns `{ storageMapping?, agentRegistry?, auditLog? }` — each present
 * only if the corresponding pointer was supplied AND the read succeeded.
 * `read` errors per-pointer are caught + surfaced via the `onError`
 * callback (if supplied) but do not fail the overall call.
 */

/**
 * @param {{ storageMappingUri?: string, agentRegistryUri?: string, auditLogUri?: string }} pointers
 * @param {object} opts
 * @param {(uri: string) => Promise<*>} opts.read
 * @param {(err: Error, key: string, uri: string) => void} [opts.onError]
 * @returns {Promise<{ storageMapping?: *, agentRegistry?: *, auditLog?: * }>}
 */
export async function resolvePointers(pointers, { read, onError } = {}) {
  if (!pointers || typeof pointers !== 'object') {
    throw Object.assign(
      new Error('resolvePointers: `pointers` is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (typeof read !== 'function') {
    throw Object.assign(
      new Error('resolvePointers: `read` must be a function'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  // Map from pointer-key to result-key (drop the "Uri" suffix).
  const KEY_MAP = Object.freeze({
    storageMappingUri: 'storageMapping',
    agentRegistryUri:  'agentRegistry',
    auditLogUri:       'auditLog',
  });

  const entries = Object.entries(KEY_MAP)
    .filter(([k]) => typeof pointers[k] === 'string' && pointers[k].length > 0);

  const out = {};
  await Promise.all(entries.map(async ([pointerKey, resultKey]) => {
    const uri = pointers[pointerKey];
    try {
      const value = await read(uri);
      if (value !== undefined && value !== null) out[resultKey] = value;
    } catch (err) {
      if (typeof onError === 'function') onError(err, resultKey, uri);
    }
  }));

  return out;
}

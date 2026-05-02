/**
 * hashNode — the default `HashAdapter` for SyncEngine + helpers.
 *
 * Wraps `node:crypto.createHash('sha256')`.  Returns a Promise so the
 * call site is identical to `hashRN.sha256` (which has to be async to
 * use `expo-crypto.digestStringAsync`).
 *
 * See `./index.js` for the HashAdapter contract.
 */

import { createHash } from 'node:crypto';

/**
 * Build a fresh Node `HashAdapter`.
 *
 * @returns {import('./index.js').HashAdapter}
 */
export function createHashNode() {
  return {
    async sha256(input) {
      const h = createHash('sha256');
      if (input == null) {
        h.update('');
      } else if (typeof input === 'string') {
        h.update(input, 'utf8');
      } else if (Buffer.isBuffer(input)) {
        h.update(input);
      } else if (input instanceof Uint8Array) {
        h.update(Buffer.from(input));
      } else {
        // Defensive fallback — stringify weird input.
        h.update(String(input), 'utf8');
      }
      return h.digest('hex');
    },
  };
}

/** Default singleton. */
export const hashNode = createHashNode();

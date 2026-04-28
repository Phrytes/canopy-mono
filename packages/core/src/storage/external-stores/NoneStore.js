/**
 * NoneStore — the v1 default `ExternalStore`.
 *
 * Locked per Track A Q-A.2 (2026-04-28): apps must explicitly supply a real
 * `ExternalStore` adapter (S3, IPFS, …) when they want
 * `writeWithConvention` to handle content above the convention threshold.
 * Until they do, every `put`/`get`/`delete`/`exists` call throws a typed
 * error so the misconfiguration is loud.
 *
 * The error carries `.code = 'EXTERNAL_STORE_NOT_CONFIGURED'`.  Track A5
 * maps this onto `ConventionError`.
 *
 * Implements the `ExternalStore` interface documented in `./index.js`.
 */

const MESSAGE =
  'NoneStore: external store not configured. Supply a real adapter to writeWithConvention if you need to store content above the threshold.';

function notConfigured() {
  return Object.assign(new Error(MESSAGE), {
    code: 'EXTERNAL_STORE_NOT_CONFIGURED',
  });
}

export class NoneStore {
  /** @returns {Promise<string>} never — always throws */
  async put(_blob, _opts) {                 // eslint-disable-line no-unused-vars
    throw notConfigured();
  }

  /** @returns {Promise<Uint8Array>} never — always throws */
  async get(_uri) {                          // eslint-disable-line no-unused-vars
    throw notConfigured();
  }

  /** @returns {Promise<void>} never — always throws */
  async delete(_uri) {                       // eslint-disable-line no-unused-vars
    throw notConfigured();
  }

  /** @returns {Promise<boolean>} never — always throws */
  async exists(_uri) {                       // eslint-disable-line no-unused-vars
    throw notConfigured();
  }
}

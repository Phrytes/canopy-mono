/**
 * SolidVault — Vault implementation backed by a Solid Pod.
 *
 * Stores encrypted key/value pairs under /vault/{key}.enc on the pod.
 * Values are encrypted with nacl.secretbox before upload; key is derived
 * from the OIDC access token + a static salt stored alongside.
 *
 * Peer dependency: @inrupt/solid-client
 *
 * STUB — throws NOT_IMPLEMENTED until Solid integration is complete.
 */
import { Vault } from '../identity/Vault.js';

export class SolidVault extends Vault {
  #podUrl;
  #credential;

  /**
   * @param {object} opts
   * @param {string} opts.podUrl
   * @param {string} opts.credential — vault key for OIDC token
   */
  constructor({ podUrl, credential }) {
    super();
    this.#podUrl    = podUrl;
    this.#credential = credential;
  }

  async get()    { this.#notImpl(); }
  async set()    { this.#notImpl(); }
  async delete() { this.#notImpl(); }

  #notImpl() {
    throw Object.assign(
      new Error('SolidVault: @inrupt/solid-client integration not yet implemented'),
      { code: 'NOT_IMPLEMENTED' },
    );
  }
}

/**
 * SolidPodSource — DataSource backed by a Solid Pod.
 *
 * Peer dependency: @inrupt/solid-client
 * Install: npm install @inrupt/solid-client @inrupt/solid-client-authn-browser
 *
 * STUB — throws NOT_IMPLEMENTED until Group H/solid integration is complete.
 */
import { DataSource } from './DataSource.js';

export class SolidPodSource extends DataSource {
  #podUrl;
  #credential;

  /**
   * @param {object} opts
   * @param {string} opts.podUrl     — base URL of the Solid Pod (e.g. https://pod.example.org/)
   * @param {string} opts.credential — vault key storing the OIDC access token
   */
  constructor({ podUrl, credential }) {
    super();
    this.#podUrl    = podUrl;
    this.#credential = credential;
  }

  get podUrl() { return this.#podUrl; }

  async read()   { this.#notImpl(); }
  async write()  { this.#notImpl(); }
  async delete() { this.#notImpl(); }
  async list()   { this.#notImpl(); }
  async query()  { this.#notImpl(); }

  #notImpl() {
    throw Object.assign(
      new Error('SolidPodSource: @inrupt/solid-client integration not yet implemented'),
      { code: 'NOT_IMPLEMENTED' },
    );
  }
}

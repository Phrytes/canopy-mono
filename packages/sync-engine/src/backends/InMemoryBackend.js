/**
 * InMemoryBackend — Map-keyed by target URI.  For tests + non-pod
 * scenarios.  Pod-backed substrate consumers wrap @canopy/pod-client
 * (Track A — when mature) in a Backend that has the same shape.
 */

export class InMemoryBackend {
  /** @type {Map<string, object>} */
  #records = new Map();

  async put(uri, record) {
    this.#records.set(uri, JSON.parse(JSON.stringify(record)));
  }

  async get(uri) {
    const r = this.#records.get(uri);
    return r ? JSON.parse(JSON.stringify(r)) : null;
  }

  async delete(uri) {
    this.#records.delete(uri);
  }

  async list() {
    return [...this.#records.keys()];
  }
}

/**
 * PersonGraph — cross-source Person records for archive-style apps.
 *
 * Per L1h sketch: H7's hardest data-model problem.  The same person
 * appears as alice@example.com in Gmail, +31612345678 in WhatsApp,
 * etc.  Substrate aggregates identifiers into a single Person record;
 * apps query by any identifier and get all related observations.
 *
 * V0: in-memory; auto-link on identifier collision (same email
 * across sources → same Person); manual `link()` for user-asserted
 * merges.  Person ids are stable ULIDs.
 */

import { ulid } from './ulid.js';

export class PersonGraph {
  /** @type {Map<string, object>} */
  #people = new Map();

  /** @type {Map<string, string>}  identifierKey → personId */
  #idIndex = new Map();

  /**
   * Observe an identifier.  Auto-links when the identifier matches
   * an existing Person.
   *
   * @param {object} args
   * @param {{kind: string, value: string}} args.identifier
   * @param {object} [args.observedIn]                   {source, sourceId}
   * @returns {Promise<object>} the Person the observation merged into
   */
  async observe({ identifier, observedIn }) {
    if (!identifier?.kind || !identifier?.value) {
      throw new TypeError('observe: identifier {kind, value} required');
    }
    const key = this.#identifierKey(identifier);
    let personId = this.#idIndex.get(key);
    if (!personId) {
      personId = ulid();
      this.#people.set(personId, {
        id:          personId,
        identifiers: [{ ...identifier }],
        observations: observedIn ? [{ ...observedIn, identifier: { ...identifier } }] : [],
      });
      this.#idIndex.set(key, personId);
    } else if (observedIn) {
      const p = this.#people.get(personId);
      p.observations.push({ ...observedIn, identifier: { ...identifier } });
    }
    return this.#clone(this.#people.get(personId));
  }

  /**
   * Manually link a list of identifiers as belonging to the same
   * Person.  If any of the identifiers already maps to a Person,
   * all others get merged into it.  Otherwise a new Person is created.
   *
   * @param {Array<{kind: string, value: string}>} identifiers
   * @param {object} [meta]                   {confidence?, source?}
   * @returns {Promise<object>}
   */
  async link(identifiers, meta) {
    if (!Array.isArray(identifiers) || identifiers.length < 2) {
      throw new TypeError('link: at least 2 identifiers required');
    }
    // Find any existing person ids any of the identifiers map to.
    const existingPersonIds = new Set();
    for (const id of identifiers) {
      const pid = this.#idIndex.get(this.#identifierKey(id));
      if (pid) existingPersonIds.add(pid);
    }

    let canonical;
    if (existingPersonIds.size === 0) {
      const id = ulid();
      this.#people.set(id, {
        id, identifiers: [], observations: [], linkMeta: meta ? [{ ...meta }] : [],
      });
      canonical = this.#people.get(id);
    } else if (existingPersonIds.size === 1) {
      canonical = this.#people.get([...existingPersonIds][0]);
    } else {
      // Merge all into the first; remap idIndex of the rest.
      const ids = [...existingPersonIds];
      canonical = this.#people.get(ids[0]);
      for (let i = 1; i < ids.length; i++) {
        const other = this.#people.get(ids[i]);
        canonical.identifiers.push(...other.identifiers);
        canonical.observations.push(...other.observations);
        for (const id of other.identifiers) {
          this.#idIndex.set(this.#identifierKey(id), canonical.id);
        }
        this.#people.delete(ids[i]);
      }
    }

    // Add any new identifiers + index them.
    for (const id of identifiers) {
      const k = this.#identifierKey(id);
      if (!canonical.identifiers.some((existing) => this.#identifierKey(existing) === k)) {
        canonical.identifiers.push({ ...id });
      }
      this.#idIndex.set(k, canonical.id);
    }
    if (meta) {
      canonical.linkMeta = canonical.linkMeta ?? [];
      canonical.linkMeta.push({ ...meta });
    }
    return this.#clone(canonical);
  }

  /**
   * Find a Person by any of their identifiers.
   *
   * @param {{kind: string, value: string}} identifier
   * @returns {Promise<object|null>}
   */
  async findByIdentifier(identifier) {
    const id = this.#idIndex.get(this.#identifierKey(identifier));
    if (!id) return null;
    return this.#clone(this.#people.get(id));
  }

  /**
   * Find Persons by display-name fragment (case-insensitive).
   *
   * Substrate doesn't separately track display names — it returns
   * Persons whose any name-shaped identifier (kind starting with 'name')
   * contains the substring.  Apps that want richer name-search build
   * on top of L1i (pod-search).
   *
   * @param {string} name
   * @returns {Promise<object[]>}
   */
  async findByName(name) {
    const lower = name.toLowerCase();
    const matches = [];
    for (const p of this.#people.values()) {
      const hasNameMatch = p.identifiers.some(
        (id) => id.kind.startsWith('name') && id.value.toLowerCase().includes(lower),
      );
      if (hasNameMatch) matches.push(this.#clone(p));
    }
    return matches;
  }

  /**
   * Number of Person records.
   */
  get size() { return this.#people.size; }

  /**
   * @returns {Promise<object[]>}
   */
  async list() {
    return [...this.#people.values()].map((p) => this.#clone(p));
  }

  #identifierKey({ kind, value }) {
    return `${kind}:${value}`;
  }

  #clone(p) {
    return JSON.parse(JSON.stringify(p));
  }
}

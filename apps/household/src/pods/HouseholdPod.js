/**
 * HouseholdPod — pod operations against the *shared* household pod.
 *
 * Wraps `@onderling/pod-client.PodClient` with the conventions specific to
 * the household pod's directory layout (Q-H2.6 lock).  All members of the
 * household read+write here via the household group key; the bot's pod
 * (BotPod) and per-member pods (MemberPod) are separate concerns.
 *
 * Directory layout (under `podRoot`, which already points at `/household/`
 * on the underlying pod — see programming-plan.md § Pod schema):
 *
 *   config.json
 *   groceries/open/<ulid>.json
 *   groceries/done/yyyy-mm/<ulid>.json
 *   errands/open/<ulid>.json
 *   errands/done/yyyy-mm/<ulid>.json
 *   repairs/open/<ulid>.json
 *   repairs/done/yyyy-mm/<ulid>.json
 *   schedule/open/<ulid>.json
 *   schedule/done/yyyy-mm/<ulid>.json
 *   refs/<ulid>.json                        # ItemRef cross-pod pointers
 *
 * **Type → collection mapping** (one of the small decisions this module
 * owns).  The collection names are pluralised (mostly) so the pod's
 * directory listing reads naturally; `'schedule'` is already plural-ish
 * so we leave it.  This follows the layout in
 * `track-H-app-household.md` § "Pod schema → Hybrid pod from v0".
 *
 *   shopping → 'groceries'
 *   errand   → 'errands'
 *   repair   → 'repairs'
 *   schedule → 'schedule'
 *
 * Adding a new ItemType requires extending `TYPE_TO_COLLECTION` AND
 * documenting the new collection in the design doc.
 *
 * The household pod does NOT keep per-collection indices; `listOpen`
 * walks the relevant `open/` directory via `PodClient.list()` and
 * fetches each item with `PodClient.read()`.  Phase 2 prioritises
 * correctness over latency; if cross-pod listing turns out to be too
 * slow at v1 scale, we can layer a cache later (see HYBRID-POD-NOTES.md
 * "Cross-pod listing latency").
 *
 * @see apps/household/src/pods/routingTable.js — decides whether an item
 *      goes here or onto a member pod.
 * @see apps/household/docs/HYBRID-POD-NOTES.md
 */

/**
 * @typedef {import('../types.js').Item} Item
 * @typedef {import('../types.js').ItemType} ItemType
 * @typedef {import('../types.js').ItemRef} ItemRef
 * @typedef {import('../types.js').HouseholdConfig} HouseholdConfig
 */

/**
 * Single source of truth for the type-name → collection-name mapping.
 * Frozen so a typo elsewhere can't silently rewrite it.
 */
export const TYPE_TO_COLLECTION = Object.freeze({
  shopping: 'groceries',
  errand:   'errands',
  repair:   'repairs',
  schedule: 'schedule',
});

const ALL_COLLECTIONS = Object.freeze(Object.values(TYPE_TO_COLLECTION));

/**
 * Pad a number to two digits.  `2026, 4 → '2026-04'`.
 */
function yyyymm(ms) {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

export class HouseholdPod {
  #pod;
  #root;

  /**
   * @param {object} args
   * @param {import('@onderling/pod-client').PodClient} args.podClient
   *   Already configured against the shared household pod root + auth.
   * @param {string} args.podRoot
   *   Pod URL where this household's data lives, e.g.
   *   `https://pod.example/household/`.  A trailing `/` is enforced.
   */
  constructor({ podClient, podRoot } = {}) {
    if (!podClient) throw new Error('HouseholdPod: podClient is required');
    if (!podRoot)   throw new Error('HouseholdPod: podRoot is required');
    this.#pod  = podClient;
    this.#root = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
  }

  /** Pod URL (with trailing slash). */
  get podRoot() { return this.#root; }

  // ── path helpers ────────────────────────────────────────────────────

  /** Resolve a path under the pod root.  Strips a leading slash so the
   *  result is always `<root><relative>` — `podRoot` is authoritative. */
  #resolve(rel) {
    const stripped = rel.startsWith('/') ? rel.slice(1) : rel;
    return `${this.#root}${stripped}`;
  }

  /** `<root>config.json` */
  #pathForConfig() { return this.#resolve('config.json'); }

  /** `<root><collection>/open/<id>.json` */
  #pathForOpenItem(item) {
    const collection = this.#collectionFor(item.type);
    return this.#resolve(`${collection}/open/${item.id}.json`);
  }

  /** `<root><collection>/done/<yyyy-mm>/<id>.json` */
  #pathForDoneItem(item, completedAt) {
    const collection = this.#collectionFor(item.type);
    return this.#resolve(`${collection}/done/${yyyymm(completedAt)}/${item.id}.json`);
  }

  /** `<root><collection>/open/` — for listing. */
  #containerForOpen(collection) {
    return this.#resolve(`${collection}/open/`);
  }

  /** `<root><collection>/done/` — for searching done items. */
  #containerForDone(collection) {
    return this.#resolve(`${collection}/done/`);
  }

  /** `<root>refs/<id>.json` */
  #pathForRef(refId) { return this.#resolve(`refs/${refId}.json`); }

  /** `<root>refs/` */
  #containerForRefs() { return this.#resolve('refs/'); }

  /**
   * @param {ItemType} type
   * @returns {string}
   */
  #collectionFor(type) {
    const c = TYPE_TO_COLLECTION[type];
    if (!c) throw new Error(`HouseholdPod: unknown item type '${type}'`);
    return c;
  }

  // ── config ──────────────────────────────────────────────────────────

  /**
   * Read /household/config.json.  Returns `null` if the household pod
   * has not been initialised yet (404).
   * @returns {Promise<HouseholdConfig|null>}
   */
  async readConfig() {
    try {
      const res = await this.#pod.read(this.#pathForConfig(), { decode: 'json' });
      return res.content;
    } catch (err) {
      if (err?.code === 'NOT_FOUND') return null;
      throw err;
    }
  }

  /**
   * Write /household/config.json (creates or overwrites).
   * @param {HouseholdConfig} config
   */
  async writeConfig(config) {
    await this.#pod.write(this.#pathForConfig(), config, {
      contentType: 'application/json',
    });
  }

  // ── items ───────────────────────────────────────────────────────────

  /**
   * Add an open item to its collection.  Path:
   * `<root><collection>/open/<id>.json`.
   *
   * @param {Item} item
   * @returns {Promise<{ uri: string }>}
   */
  async addItem(item) {
    if (!item || !item.id || !item.type) {
      throw new Error('HouseholdPod.addItem: item.id and item.type are required');
    }
    const uri = this.#pathForOpenItem(item);
    await this.#pod.write(uri, item, { contentType: 'application/json' });
    return { uri };
  }

  /**
   * List all open items (across collections).  Walks each `open/`
   * container via `PodClient.list()` and fetches the parsed Item via
   * `PodClient.read()`.  Sorted by `addedAt` ASC (stable for equal
   * timestamps via id tiebreaker — ULIDs are time-prefixed so this
   * matches addedAt ordering anyway).
   *
   * @param {{ type?: ItemType }} [filter]
   * @returns {Promise<Array<Item>>}
   */
  async listOpen(filter = {}) {
    const collections = filter.type
      ? [this.#collectionFor(filter.type)]
      : [...ALL_COLLECTIONS];

    /** @type {Array<Item>} */
    const items = [];
    for (const collection of collections) {
      const container = this.#containerForOpen(collection);
      let entries = [];
      try {
        const res = await this.#pod.list(container);
        entries = res.entries || [];
      } catch (err) {
        // A never-written collection has no container yet; treat as empty.
        if (err?.code === 'NOT_FOUND') continue;
        throw err;
      }
      for (const e of entries) {
        if (!e.uri.endsWith('.json')) continue;
        try {
          const r = await this.#pod.read(e.uri, { decode: 'json' });
          if (r?.content) items.push(r.content);
        } catch (err) {
          // Best-effort: a deleted-mid-read or malformed entry doesn't
          // poison the whole listing.  Surface non-NOT_FOUND errors.
          if (err?.code !== 'NOT_FOUND') throw err;
        }
      }
    }
    items.sort((a, b) => {
      if (a.addedAt !== b.addedAt) return a.addedAt - b.addedAt;
      // Stable secondary sort by id (ULID) for determinism.
      return (a.id ?? '').localeCompare(b.id ?? '');
    });
    return items;
  }

  /**
   * Move an open item to `done/yyyy-mm/<id>.json` and set `completedAt`.
   * Implemented as: read open → write done (with completedAt) → delete
   * open.  If the item doesn't exist, throws.
   *
   * Note: this is two PodClient writes and one delete; on a partial
   * failure the open + done copies could both exist for a moment.
   * Acceptable per Q-H2.6 (best-effort consistency); cleanup is a
   * future concern.  See HYBRID-POD-NOTES.md.
   *
   * @param {string} itemId
   * @returns {Promise<Item>} the archived item (with completedAt set)
   */
  async markComplete(itemId) {
    const found = await this.#findOpenItem(itemId);
    if (!found) {
      throw new Error(`HouseholdPod.markComplete: id not found: ${itemId}`);
    }
    const { item, openUri } = found;
    const completedAt = Date.now();
    const archived = { ...item, completedAt };
    const doneUri = this.#pathForDoneItem(archived, completedAt);
    await this.#pod.write(doneUri, archived, { contentType: 'application/json' });
    await this.#pod.delete(openUri);
    return archived;
  }

  /**
   * Hard-delete an open item.  Use sparingly — `markComplete` is
   * usually preferred so the item lives on in the `done/` archive.
   *
   * @param {string} itemId
   */
  async remove(itemId) {
    const found = await this.#findOpenItem(itemId);
    if (!found) {
      throw new Error(`HouseholdPod.remove: id not found: ${itemId}`);
    }
    await this.#pod.delete(found.openUri);
  }

  /**
   * Single-item read by id.  Searches `open/` first, then `done/`.
   * Returns `null` if not found in either.
   *
   * @param {string} itemId
   * @returns {Promise<Item|null>}
   */
  async getById(itemId) {
    const open = await this.#findOpenItem(itemId);
    if (open) return open.item;
    const done = await this.#findDoneItem(itemId);
    if (done) return done.item;
    return null;
  }

  // ── refs ────────────────────────────────────────────────────────────

  /**
   * Write an `ItemRef` (cross-pod reference) under `<root>refs/<id>.json`.
   * Used by the orchestrator when an item lives on a member's pod but
   * the household pod needs to know about it (Q-H2.6 lock).
   *
   * @param {ItemRef} ref
   */
  async writeRef(ref) {
    if (!ref?.id) throw new Error('HouseholdPod.writeRef: ref.id is required');
    await this.#pod.write(this.#pathForRef(ref.id), ref, {
      contentType: 'application/json',
    });
  }

  /**
   * Read all `ItemRef`s under `<root>refs/`.  Optionally filter by type.
   * Sorted by `addedAt` ASC for parity with `listOpen`.
   *
   * @param {{ type?: ItemType }} [filter]
   * @returns {Promise<Array<ItemRef>>}
   */
  async listRefs(filter = {}) {
    const container = this.#containerForRefs();
    let entries = [];
    try {
      const res = await this.#pod.list(container);
      entries = res.entries || [];
    } catch (err) {
      if (err?.code === 'NOT_FOUND') return [];
      throw err;
    }
    /** @type {Array<ItemRef>} */
    const refs = [];
    for (const e of entries) {
      if (!e.uri.endsWith('.json')) continue;
      try {
        const r = await this.#pod.read(e.uri, { decode: 'json' });
        if (!r?.content) continue;
        if (filter.type && r.content.type !== filter.type) continue;
        refs.push(r.content);
      } catch (err) {
        if (err?.code !== 'NOT_FOUND') throw err;
      }
    }
    refs.sort((a, b) => {
      if ((a.addedAt ?? 0) !== (b.addedAt ?? 0)) return (a.addedAt ?? 0) - (b.addedAt ?? 0);
      return (a.id ?? '').localeCompare(b.id ?? '');
    });
    return refs;
  }

  // ── internals ───────────────────────────────────────────────────────

  /**
   * Walk all collections' `open/` containers looking for an item whose
   * id matches.  Returns `{ item, openUri }` or `null`.  We check by
   * URI suffix first (cheap) and only `read()` the match.
   */
  async #findOpenItem(itemId) {
    for (const collection of ALL_COLLECTIONS) {
      const container = this.#containerForOpen(collection);
      let entries = [];
      try {
        const res = await this.#pod.list(container);
        entries = res.entries || [];
      } catch (err) {
        if (err?.code === 'NOT_FOUND') continue;
        throw err;
      }
      const match = entries.find((e) => e.uri.endsWith(`/${itemId}.json`));
      if (!match) continue;
      try {
        const r = await this.#pod.read(match.uri, { decode: 'json' });
        return { item: r.content, openUri: match.uri };
      } catch (err) {
        if (err?.code === 'NOT_FOUND') continue;
        throw err;
      }
    }
    return null;
  }

  /**
   * Walk all collections' `done/` archives (recursive — yyyy-mm
   * sub-containers) looking for an item whose id matches.  Returns
   * `{ item, doneUri }` or `null`.
   */
  async #findDoneItem(itemId) {
    for (const collection of ALL_COLLECTIONS) {
      const container = this.#containerForDone(collection);
      let entries = [];
      try {
        const res = await this.#pod.list(container, { recursive: true });
        entries = res.entries || [];
      } catch (err) {
        if (err?.code === 'NOT_FOUND') continue;
        throw err;
      }
      const match = entries.find((e) => e.uri.endsWith(`/${itemId}.json`));
      if (!match) continue;
      try {
        const r = await this.#pod.read(match.uri, { decode: 'json' });
        return { item: r.content, doneUri: match.uri };
      } catch (err) {
        if (err?.code === 'NOT_FOUND') continue;
        throw err;
      }
    }
    return null;
  }
}

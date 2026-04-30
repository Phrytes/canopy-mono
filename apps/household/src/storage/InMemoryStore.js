/**
 * InMemoryStore — Map-backed `Store` implementation for Phase 1.
 *
 * Implements the interface jsdoc'd in `./Store.js`.  Phase 2 swaps in
 * `HybridPodStore` (same shape).  No persistence here: every restart
 * is a fresh state.
 *
 * Defensive copies: every read returns a clone so callers can't
 * mutate the store by holding the returned reference.
 *
 * IDs are ULIDs — Crockford-base32 of (48-bit ms timestamp + 80 bits
 * of crypto randomness).  ~26 chars, lexicographically sortable by
 * creation time, collision-resistant.  We roll our own (~30 LOC) to
 * avoid a top-level dep per CLAUDE.md; only `globalThis.crypto` is
 * required (Node ≥19 + browsers + RN have it).
 */

// Crockford base32 alphabet — excludes I, L, O, U for human legibility.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generate a ULID.  Time prefix (10 chars) + randomness (16 chars).
 * https://github.com/ulid/spec
 *
 * @returns {string} 26-char ULID
 */
export function ulid() {
  const now = Date.now();
  // Encode 48-bit timestamp into 10 base32 chars, MSB first.
  let timeStr = '';
  let t = now;
  for (let i = 9; i >= 0; i--) {
    timeStr = CROCKFORD[t % 32] + timeStr;
    t = Math.floor(t / 32);
  }
  // 16 chars of randomness ≈ 80 bits; we draw 10 bytes and mod each.
  const rand = new Uint8Array(16);
  globalThis.crypto.getRandomValues(rand);
  let randStr = '';
  for (let i = 0; i < 16; i++) {
    randStr += CROCKFORD[rand[i] % 32];
  }
  return timeStr + randStr;
}

/**
 * @implements {import('./Store.js').Store}
 */
export class InMemoryStore {
  /** @type {Map<string, import('../types.js').Item>} */
  #items = new Map();

  /**
   * @param {import('./Store.js').AddItemArgs} args
   * @returns {Promise<import('../types.js').Item>}
   */
  async addItem({ type, text, addedBy, source, dueAt }) {
    /** @type {import('../types.js').Item} */
    const item = {
      id: ulid(),
      type,
      text,
      addedBy,
      addedAt: Date.now(),
      claimedBy: null,
      completedAt: null,
      source,
      ...(dueAt !== undefined ? { dueAt } : {}),
    };
    this.#items.set(item.id, item);
    return { ...item };
  }

  /**
   * @param {import('./Store.js').ListFilter} [filter]
   * @returns {Promise<Array<import('../types.js').Item>>}
   */
  async listOpen({ type, since } = {}) {
    return [...this.#items.values()]
      .filter((i) => i.completedAt === null)
      .filter((i) => !type || i.type === type)
      .filter((i) => since === undefined || i.addedAt >= since)
      .map((i) => ({ ...i }));
  }

  /**
   * @param {string} itemId
   * @returns {Promise<import('../types.js').Item>}
   */
  async markComplete(itemId) {
    const existing = this.#items.get(itemId);
    if (!existing) {
      throw new Error(`InMemoryStore.markComplete: id not found: ${itemId}`);
    }
    const updated = { ...existing, completedAt: Date.now() };
    this.#items.set(itemId, updated);
    return { ...updated };
  }

  /**
   * @param {string} itemId
   * @returns {Promise<void>}
   */
  async remove(itemId) {
    this.#items.delete(itemId);
  }

  /**
   * @param {string} itemId
   * @returns {Promise<import('../types.js').Item|null>}
   */
  async getById(itemId) {
    const found = this.#items.get(itemId);
    return found ? { ...found } : null;
  }
}

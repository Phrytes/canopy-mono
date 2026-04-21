/**
 * PeerGraph — registry of known peers with indexed queries and events.
 *
 * PeerRecord shape:
 * {
 *   pubKey?:       string,   // Ed25519 base64url  (null for A2A-only)
 *   url?:          string,   // HTTPS A2A URL      (null for native-only)
 *   type:          'native' | 'a2a' | 'hybrid',
 *   label?:        string,
 *   reachable:     boolean,  // default true
 *   lastSeen?:     number,   // unix-ms
 *   groups?:       string[],
 *   tier?:         string,   // trust tier from TrustRegistry
 *   skills?:       string[], // known skill IDs
 *   discoverable?: boolean,  // share this peer during gossip (default true)
 *   transports?:   Record<string, object>,  // name → config
 *   latency?:      Record<string, number>,  // transportName → lastLatencyMs
 * }
 *
 * storageBackend must implement: get(key), set(key, value), delete(key), list() → string[]
 * Pass null (or omit) to use a plain in-memory Map.
 */
import { Emitter } from '../Emitter.js';

export class PeerGraph extends Emitter {
  #backend;

  /**
   * @param {object} [opts]
   * @param {object|null} [opts.storageBackend]  — key-value store (Vault-compatible)
   */
  constructor({ storageBackend = null } = {}) {
    super();
    // If no backend, use an in-memory Map that mimics the Vault interface.
    this.#backend = storageBackend ?? new MapBackend();
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  /**
   * Insert or merge a peer record.  The `pubKey` or `url` field is used as
   * the primary key.
   *
   * @param {object} record
   * @returns {Promise<object>}  the merged record
   */
  async upsert(record) {
    const id = record.pubKey ?? record.url;
    if (!id) throw new Error('PeerRecord must have pubKey or url');

    const existing = await this.#load(id) ?? {};
    const isNew    = !existing.pubKey && !existing.url;

    const merged = {
      type:          'native',
      reachable:     true,
      discoverable:  true,
      ...existing,
      ...record,
      // Array fields: merge without duplicates.
      groups: _mergeArrays(existing.groups, record.groups),
      skills: _mergeArrays(existing.skills, record.skills),
      // Nested objects: shallow-merge.
      transports: { ...(existing.transports ?? {}), ...(record.transports ?? {}) },
      latency:    { ...(existing.latency    ?? {}), ...(record.latency    ?? {}) },
      lastSeen:   record.lastSeen ?? existing.lastSeen ?? Date.now(),
    };

    await this.#save(id, merged);

    if (isNew) this.emit('added', merged);
    return merged;
  }

  /**
   * @param {string} pubKeyOrUrl
   * @returns {Promise<object|null>}
   */
  async get(pubKeyOrUrl) {
    return this.#load(pubKeyOrUrl);
  }

  /**
   * @returns {Promise<object[]>}
   */
  async all() {
    const keys = (await this.#backend.list()).filter(k => k.startsWith('peer:'));
    return Promise.all(keys.map(k => this.#loadRaw(k)));
  }

  /**
   * Delete a peer record.
   * @param {string} pubKeyOrUrl
   */
  async remove(pubKeyOrUrl) {
    const record = await this.#load(pubKeyOrUrl);
    if (!record) return;
    await this.#backend.delete(`peer:${pubKeyOrUrl}`);
    this.emit('removed', record);
  }

  // ── Filtered queries ───────────────────────────────────────────────────────

  /** @returns {Promise<object[]>}  peers that have the given skill */
  async withSkill(skillId, opts = {}) {
    const { includeA2A = true } = opts;
    const all = await this.all();
    return all.filter(p => {
      if (!includeA2A && p.type === 'a2a') return false;
      return p.skills?.includes(skillId);
    });
  }

  /** @returns {Promise<object[]>}  peers in the given group */
  async inGroup(groupId) {
    const all = await this.all();
    return all.filter(p => p.groups?.includes(groupId));
  }

  /** @returns {Promise<object[]>}  peers currently marked reachable */
  async reachable() {
    const all = await this.all();
    return all.filter(p => p.reachable !== false);
  }

  /**
   * @param {number} n
   * @returns {Promise<object[]>}  top-n peers by minimum latency
   */
  async fastest(n) {
    const all = await this.all();
    const ranked = all
      .filter(p => p.latency && Object.keys(p.latency).length > 0)
      .map(p => ({
        peer: p,
        minLatency: Math.min(...Object.values(p.latency)),
      }))
      .sort((a, b) => a.minLatency - b.minLatency);
    return ranked.slice(0, n).map(r => r.peer);
  }

  /** @returns {Promise<object[]>}  peers with type 'a2a' or 'hybrid' */
  async a2aAgents() {
    const all = await this.all();
    return all.filter(p => p.type === 'a2a' || p.type === 'hybrid');
  }

  /**
   * Peers that can handle the given capability constraints.
   *
   * @param {object} opts
   * @param {string}  [opts.skill]      — must expose this skill
   * @param {boolean} [opts.streaming]  — must support streaming
   * @param {string}  [opts.mode]       — 'bidi' excludes A2A peers
   * @returns {Promise<object[]>}
   */
  async canHandle(opts = {}) {
    const { skill, streaming, mode } = opts;
    let peers = await this.all();

    if (skill)     peers = peers.filter(p => p.skills?.includes(skill));
    if (streaming) peers = peers.filter(p => p.type !== 'a2a');
    if (mode === 'bidi' || mode === 'session' || mode === 'bulk') {
      peers = peers.filter(p => p.type !== 'a2a');
    }
    return peers;
  }

  // ── Update helpers ─────────────────────────────────────────────────────────

  /**
   * @param {string}  pubKeyOrUrl
   * @param {boolean} reachable
   */
  async setReachable(pubKeyOrUrl, reachable) {
    const record = await this.#load(pubKeyOrUrl);
    if (!record) return;
    const was = record.reachable;
    record.reachable = reachable;
    if (reachable) record.lastSeen = Date.now();
    await this.#save(pubKeyOrUrl, record);
    if (reachable  && !was)  this.emit('reachable',   record);
    if (!reachable && was)   this.emit('unreachable',  record);
  }

  /**
   * @param {string} pubKey
   * @param {string} transportName
   * @param {number} latencyMs
   */
  async updateLatency(pubKey, transportName, latencyMs) {
    const record = await this.#load(pubKey);
    if (!record) return;
    record.latency              = record.latency ?? {};
    record.latency[transportName] = latencyMs;
    record.lastSeen             = Date.now();
    await this.#save(pubKey, record);
  }

  /**
   * @param {string} pubKey
   * @param {string} tier
   */
  async updateTier(pubKey, tier) {
    const record = await this.#load(pubKey);
    if (!record) return;
    const old     = record.tier;
    record.tier   = tier;
    await this.#save(pubKey, record);
    if (old !== tier) this.emit('tiered', record, old, tier);
  }

  // ── Export / import ────────────────────────────────────────────────────────

  /**
   * Export all records as JSON (no secrets — no private keys).
   * @returns {Promise<object[]>}
   */
  async export() {
    return this.all();
  }

  /**
   * Merge an external record array (e.g. received via gossip).
   * @param {object[]} records
   */
  async import(records) {
    for (const r of records) await this.upsert(r);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  async #load(id) {
    return this.#loadRaw(`peer:${id}`);
  }

  async #loadRaw(key) {
    const raw = await this.#backend.get(key);
    return raw ? JSON.parse(raw) : null;
  }

  async #save(id, record) {
    await this.#backend.set(`peer:${id}`, JSON.stringify(record));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _mergeArrays(a = [], b = []) {
  const combined = [...(a ?? []), ...(b ?? [])];
  return [...new Set(combined)];
}

/** Fallback in-memory key-value store. */
class MapBackend {
  #map = new Map();
  async get(k)         { return this.#map.get(k) ?? null; }
  async set(k, v)      { this.#map.set(k, v); }
  async delete(k)      { this.#map.delete(k); }
  async list()         { return [...this.#map.keys()]; }
  async has(k)         { return this.#map.has(k); }
}

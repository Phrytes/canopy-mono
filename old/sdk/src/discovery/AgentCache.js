/**
 * AgentCache — local registry of known agents and their capabilities.
 *
 * Persists to localStorage in browser environments so the known network
 * survives page refreshes. Falls back to in-memory in Node.js.
 *
 * Each entry:
 * {
 *   id:        string          — transport address (PeerJS id, NKN addr, etc.)
 *   label:     string          — human-readable name
 *   card:      A2A AgentCard   — full agent card including skills
 *   lastSeen:  ISO timestamp
 *   connected: boolean         — currently connected
 * }
 */

const STORAGE_KEY = 'agent_cache_v1';
const MAX_AGE_MS  = 7 * 24 * 60 * 60 * 1000;   // forget agents unseen for 7 days

export class AgentCache {
  constructor() {
    this._cache = new Map();
    this._listeners = [];
    this._load();
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  get(id)         { return this._cache.get(id) ?? null; }
  has(id)         { return this._cache.has(id); }
  all()           { return Array.from(this._cache.values()); }
  connected()     { return this.all().filter(e => e.connected); }

  /** Return all connected agents that have a given skill. */
  withSkill(skillId) {
    return this.connected().filter(e =>
      e.card?.skills?.some(s => s.id === skillId)
    );
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  upsert(id, updates) {
    const existing = this._cache.get(id) ?? { id, label: id.slice(0, 12) + '…', card: null, lastSeen: null, connected: false };
    const entry    = { ...existing, ...updates, id, lastSeen: new Date().toISOString() };
    this._cache.set(id, entry);
    this._save();
    this._notify(entry);
    return entry;
  }

  setConnected(id, connected) {
    if (this._cache.has(id)) {
      this._cache.get(id).connected = connected;
      this._notify(this._cache.get(id));
    }
  }

  remove(id) {
    this._cache.delete(id);
    this._save();
  }

  // ── Events ────────────────────────────────────────────────────────────────

  /** Called whenever any entry is added or updated. */
  onChange(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(l => l !== fn); };
  }

  // ── Serialisation ─────────────────────────────────────────────────────────

  /** Returns a lightweight list suitable for sharing with other agents. */
  toShareable(excludeId = null) {
    return this.all()
      .filter(e => e.id !== excludeId)
      .map(({ id, label, card }) => ({ id, label, card }));
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _notify(entry) {
    for (const fn of this._listeners) fn(entry);
  }

  _save() {
    try {
      const data = JSON.stringify(Array.from(this._cache.entries()));
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, data);
    } catch { /* quota exceeded or SSR */ }
  }

  _load() {
    try {
      const raw = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const entries  = JSON.parse(raw);
      const cutoff   = Date.now() - MAX_AGE_MS;
      for (const [id, entry] of entries) {
        if (new Date(entry.lastSeen).getTime() < cutoff) continue;  // prune stale
        entry.connected = false;   // all offline until proven otherwise
        this._cache.set(id, entry);
      }
    } catch { /* corrupted storage */ }
  }
}

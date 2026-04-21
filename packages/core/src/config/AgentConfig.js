/**
 * AgentConfig — layered runtime configuration.
 *
 * Layers (lowest → highest priority):
 *   defaults → blueprint → file (YAML/JSON) → developer overrides → runtime set()
 *
 * All layers are plain objects; they are deep-merged at construction time.
 * Runtime set() changes can be reset() back to the merged static value.
 *
 * Usage:
 *   const cfg = new AgentConfig({ overrides: { resources: { maxConnections: 10 } } });
 *   cfg.get('resources.maxConnections')   // → 10
 *   cfg.set('resources.maxConnections', 5)
 *   cfg.reset('resources.maxConnections') // back to 10
 *   cfg.on('changed', (path, oldVal, newVal) => {})
 */
import { Emitter } from '../Emitter.js';

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS = {
  resources: {
    maxConnections:  50,
    maxPendingTasks: 10,
    perGroup:        {},
  },
  discovery: {
    discoverable:           true,
    acceptIntroductions:    'from-trusted', // 'always' | 'from-trusted' | 'never'
    acceptHelloFromTier0:   true,
    gossip: {
      enabled:            false,
      interval:           3600,
      maxPeersPerRound:   5,
      minTrustTier:       1,
    },
    ping: {
      interval:                   300,
      timeout:                    5000,
      failuresBeforeUnreachable:  3,
    },
    capRefreshTtl:    3600,
    a2aCardFreshness: 3600,
    peerCleanup: {
      unreachableAfterDays:   30,
      expiredProofGraceDays:   7,
      maxGraphSize:          1000,
    },
  },
  policy: {
    ping:            'always',
    messaging:       'on-request',
    streaming:       'negotiated',
    taskAccept:      'on-request',
    transportFilter: null,          // null = all transports allowed
    allowRelayFor:   'never',       // opt-in: 'never' | 'trusted' | 'group:X' | 'always'
  },
  a2a: {
    enabled:       false,
    serveHttp:     false,
    httpPort:      3000,
    allowInsecure: false,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function _deepMerge(base, ...layers) {
  const result = _clone(base);
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    _mergeInto(result, layer);
  }
  return result;
}

function _mergeInto(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) &&
        target[k] !== null && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      _mergeInto(target[k], v);
    } else {
      target[k] = _clone(v);
    }
  }
}

function _clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(_clone);
  return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, _clone(val)]));
}

function _getPath(obj, path) {
  return path.split('.').reduce((acc, k) => (acc != null ? acc[k] : undefined), obj);
}

function _setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

function _deletePath(obj, path) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null) return;
    cur = cur[keys[i]];
  }
  delete cur[keys[keys.length - 1]];
}

// ── AgentConfig ───────────────────────────────────────────────────────────────

export class AgentConfig extends Emitter {
  #static;    // merged defaults + blueprint + file + overrides (immutable baseline)
  #runtime;   // runtime set() overrides (plain object, sparse)

  /**
   * @param {object} [opts]
   * @param {object} [opts.file]       — parsed agent file config section
   * @param {object} [opts.blueprint]  — resolved blueprint defaults
   * @param {object} [opts.overrides]  — developer overrides (highest static priority)
   */
  constructor({ file = {}, blueprint = {}, overrides = {} } = {}) {
    super();
    this.#static  = _deepMerge(DEFAULTS, blueprint, file, overrides);
    this.#runtime = {};
  }

  /**
   * Read a config value by dot-path.
   * Runtime overrides take precedence over static layers.
   * @param {string} path  e.g. 'resources.maxConnections'
   */
  get(path) {
    const rtVal = _getPath(this.#runtime, path);
    if (rtVal !== undefined) return rtVal;
    return _getPath(this.#static, path);
  }

  /**
   * Set a runtime override. Fires 'changed' event.
   * @param {string} path
   * @param {*}      value
   */
  set(path, value) {
    const old = this.get(path);
    _setPath(this.#runtime, path, value);
    if (old !== value) this.emit('changed', path, old, value);
    return this;
  }

  /**
   * Remove a runtime override, reverting to the static baseline.
   * @param {string} path
   */
  reset(path) {
    const old = this.get(path);
    _deletePath(this.#runtime, path);
    const newVal = this.get(path);
    if (old !== newVal) this.emit('changed', path, old, newVal);
    return this;
  }

  /** Snapshot of the full effective config (no secrets). */
  snapshot() {
    return _deepMerge(this.#static, this.#runtime);
  }

  /** Replace the static baseline (e.g. after loading a new file). Re-emits changed for any diffs. */
  _reload({ file = {}, blueprint = {}, overrides = {} } = {}) {
    this.#static  = _deepMerge(DEFAULTS, blueprint, file, overrides);
    this.#runtime = {};
    this.emit('reloaded');
  }
}

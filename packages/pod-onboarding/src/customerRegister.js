/**
 * createCustomerRegister — operator-side register of provisioned pod
 * *instances*.
 *
 * ## Why it lives in `@canopy/pod-onboarding` (not `@canopy/agent-registry`)
 *
 * `@canopy/agent-registry` is a *per-user, per-pod* substrate: it tracks
 * one user's agents/devices inside a single pod resource and implements
 * core's `ActorResolver` ("which of MY agents is this?"). The customer
 * register answers a different question in a different trust domain:
 * "which customers have we provisioned, to which pods, and what is each
 * instance's lifecycle status?" — an OPERATOR/fleet view spanning many
 * customers and pods. Folding it into `agent-registry` would conflate
 * "my devices in my pod" with "our provisioned customer fleet" — exactly
 * the drift `CLAUDE.md` warns against. It belongs with the provisioning
 * substrate that produces the instances it tracks: `pod-onboarding`.
 *
 * ## Store + clock are injected (testable in-memory)
 *
 * `store` is a StorageBackend/Map-shaped KV. Default is a fresh `Map`.
 * `now` is an injected clock (`() => isoString`) so `provisionedAt` is
 * deterministic under test — no hidden `Date.now()`.
 *
 * OUT of scope (report/defer): real billing, live pod writes, deploy/ops
 * provisioning (org roadmap §5). This is a substrate ledger, nothing more.
 */

/** Valid instance lifecycle states. */
export const CUSTOMER_STATUS = Object.freeze({
  provisioning: 'provisioning',
  active:       'active',
  suspended:    'suspended',
  retired:      'retired',
});

const VALID_STATUSES = new Set(Object.values(CUSTOMER_STATUS));

const KEY_PREFIX = 'customer/';

function _invalid(msg) {
  return Object.assign(new Error(msg), { code: 'INVALID_ARGUMENT' });
}

function _requireString(val, name) {
  if (typeof val !== 'string' || val.length === 0) {
    throw _invalid(`createCustomerRegister: ${name} is required`);
  }
}

/**
 * Normalise a `store` into a small async KV surface. Supports:
 *   - a `Map`-shaped store (`get`/`set`/`delete`/`keys`)
 *   - a `StorageBackend`   (`get` → `{bytes}` / `put` / `delete` / `list`)
 */
function _normaliseStore(store) {
  const s = store ?? new Map();
  const isBackend = typeof s.put === 'function' && typeof s.list === 'function';
  if (isBackend) {
    return {
      async read(key) {
        const rec = await s.get(key);
        return rec ? rec.bytes : undefined;
      },
      async write(key, val) { await s.put(key, val); },
      async remove(key) { await s.delete(key); },
      async keys() { return s.list(KEY_PREFIX); },
    };
  }
  // Map-shaped.
  return {
    async read(key) { return s.get(key); },
    async write(key, val) { s.set(key, val); },
    async remove(key) { if (typeof s.delete === 'function') s.delete(key); },
    async keys() {
      const out = [];
      for (const k of s.keys()) if (String(k).startsWith(KEY_PREFIX)) out.push(k);
      return out;
    },
  };
}

/**
 * @typedef {object} CustomerInstance
 * @property {string} customerId
 * @property {string} podUri
 * @property {string} agentWebid
 * @property {'provisioning'|'active'|'suspended'|'retired'} status
 * @property {string} provisionedAt   ISO timestamp (from the injected clock)
 */

/**
 * @param {object} [opts]
 * @param {object} [opts.store]  StorageBackend/Map-shaped store. Default: new Map().
 * @param {() => string} [opts.now]  injected clock. Default: ISO-now.
 */
export function createCustomerRegister({ store, now = () => new Date().toISOString() } = {}) {
  const kv = _normaliseStore(store);
  const keyFor = (customerId) => `${KEY_PREFIX}${customerId}`;

  /**
   * Register (or upsert) a provisioned instance. First registration
   * stamps `provisionedAt` + `status: 'provisioning'`; a re-register of
   * the same customer refreshes `podUri`/`agentWebid` but preserves the
   * original `provisionedAt` and current `status` (idempotent upsert).
   *
   * @param {{ customerId: string, podUri: string, agentWebid: string }} entry
   * @returns {Promise<CustomerInstance>}
   */
  async function register({ customerId, podUri, agentWebid } = {}) {
    _requireString(customerId, 'customerId');
    _requireString(podUri, 'podUri');
    _requireString(agentWebid, 'agentWebid');

    const existing = await kv.read(keyFor(customerId));
    const record = {
      customerId,
      podUri,
      agentWebid,
      status:        existing?.status ?? CUSTOMER_STATUS.provisioning,
      provisionedAt: existing?.provisionedAt ?? now(),
    };
    await kv.write(keyFor(customerId), record);
    return { ...record };
  }

  /**
   * Fetch one instance. Unknown customer → `null`.
   * @param {string} customerId
   * @returns {Promise<CustomerInstance|null>}
   */
  async function get(customerId) {
    if (typeof customerId !== 'string' || customerId.length === 0) return null;
    const rec = await kv.read(keyFor(customerId));
    return rec ? { ...rec } : null;
  }

  /**
   * List every registered instance (sorted by customerId for stability).
   * @returns {Promise<CustomerInstance[]>}
   */
  async function list() {
    const keys = await kv.keys();
    const out = [];
    for (const k of keys) {
      const rec = await kv.read(k);
      if (rec) out.push({ ...rec });
    }
    out.sort((a, b) => (a.customerId < b.customerId ? -1 : a.customerId > b.customerId ? 1 : 0));
    return out;
  }

  /**
   * Transition an instance's lifecycle status. Unknown status →
   * INVALID_ARGUMENT; unknown customer → UNKNOWN_CUSTOMER.
   *
   * @param {string} customerId
   * @param {'provisioning'|'active'|'suspended'|'retired'} status
   * @returns {Promise<CustomerInstance>}
   */
  async function setStatus(customerId, status) {
    _requireString(customerId, 'customerId');
    if (!VALID_STATUSES.has(status)) {
      throw _invalid(
        `setStatus: unknown status '${status}' (expected one of ${[...VALID_STATUSES].join(', ')})`,
      );
    }
    const rec = await kv.read(keyFor(customerId));
    if (!rec) {
      throw Object.assign(
        new Error(`setStatus: unknown customer '${customerId}'`),
        { code: 'UNKNOWN_CUSTOMER', customerId },
      );
    }
    const next = { ...rec, status };
    await kv.write(keyFor(customerId), next);
    return { ...next };
  }

  return { register, get, list, setStatus };
}

/**
 * @canopy/secure-agent — signed activity / audit log.
 *
 * Wires A.6 from the v0.7 security roadmap.  Append-only,
 * Ed25519-signed, hash-chained log of security-relevant events.
 *
 * # Entry format (canonical JSON, sorted keys)
 *
 *   {
 *     v:      1,
 *     id:     uuid,
 *     ts:     unix-ms,
 *     actor:  pubKey of signer,
 *     event:  'identity.rotate' | 'mute.add' | 'caps.issue' | ...
 *     subject?: arbitrary string (target of the action)
 *     data?:    { ...event-specific payload },
 *     prev:   base64url-sha256 of previous entry-with-sig, or null for the head
 *     sig:    base64url Ed25519 sig over canonical(entry-without-sig)
 *   }
 *
 * # Why chain hashes?
 *
 * A signed entry alone catches forgery: nobody can mint an entry
 * without the signer's key.  But a HOLDER of the log can still
 * silently drop or reorder entries.  The `prev` link makes that
 * tamper-evident: flipping or removing any past entry changes its
 * hash, which mismatches the next entry's `prev`.  Replaying the
 * chain at verify() detects this.
 *
 * # Storage
 *
 * The log keeps its entries in memory (cheap; ~200 bytes per entry).
 * Persistence is opt-in via opts.vault + opts.vaultKey.  Pod-side
 * mirroring is the app's concern — pass `audit.serialize()` to your
 * pod writer.
 *
 * Layer: substrate.  Platform-neutral.
 */

import { AgentIdentity, canonicalize, b64encode, b64decode, genId } from '@canopy/core';
import { sha256 } from '@noble/hashes/sha2.js';

export const AUDIT_VERSION = 1;

/**
 * Build an AuditLog bound to an identity (for signing) + optional
 * persistence (vault slot).
 *
 * @param {object} args
 * @param {AgentIdentity} args.identity
 * @param {object}        [args.vault]      VaultMemory | VaultLocalStorage | VaultIndexedDB
 * @param {string|null}   [args.vaultKey]   persistence slot; null → in-memory
 * @returns {Promise<AuditLog>}
 */
export async function loadAuditLog({ identity, vault, vaultKey = null } = {}) {
  if (!identity || typeof identity.sign !== 'function') {
    throw new Error('loadAuditLog: identity with .sign() required');
  }
  const entries = [];
  if (vaultKey && vault) {
    try {
      const raw = await vault.get(vaultKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const e of parsed) if (e && typeof e === 'object') entries.push(e);
        }
      }
    } catch {
      // Corrupt slot → start fresh; next persist overwrites.
    }
  }
  return new AuditLog({ identity, vault, vaultKey, entries });
}

export class AuditLog {
  #identity;
  #vault;
  #key;
  #entries;

  constructor({ identity, vault, vaultKey, entries }) {
    this.#identity = identity;
    this.#vault    = vault   ?? null;
    this.#key      = vaultKey ?? null;
    this.#entries  = entries ?? [];
  }

  /** Current chain length. */
  get size() { return this.#entries.length; }

  /** Read-only snapshot of all entries (most-recent last). */
  entries() { return this.#entries.map((e) => ({ ...e })); }

  /** Most-recent entry, or null. */
  head() { return this.#entries.length ? { ...this.#entries.at(-1) } : null; }

  /**
   * Append a new signed entry.  Computes prev-link from the current
   * head + signs with the bound identity.  Persists if a vault key
   * was supplied.
   *
   * @param {object} args
   * @param {string} args.event             event-type key (e.g. 'mute.add')
   * @param {string} [args.subject]         optional target identifier
   * @param {object} [args.data]            optional event-specific payload
   * @param {number} [args.now]             clock override (tests)
   * @returns {Promise<object>}             the appended entry
   */
  async append(args = {}) {
    if (typeof args.event !== 'string' || !args.event) {
      throw new Error('AuditLog.append: event (string) required');
    }
    const prev = this.#entries.length ? this.#hashEntry(this.#entries.at(-1)) : null;
    const body = {
      v:      AUDIT_VERSION,
      id:     genId(),
      ts:     typeof args.now === 'number' ? args.now : Date.now(),
      actor:  this.#identity.pubKey,
      event:  args.event,
      prev,
    };
    if (args.subject != null) body.subject = args.subject;
    if (args.data    != null) body.data    = args.data;
    const sigBytes = this.#identity.sign(canonicalize(body));
    const entry    = { ...body, sig: b64encode(sigBytes) };
    this.#entries.push(entry);
    await this.#persist();
    return { ...entry };
  }

  /**
   * Verify the entire chain: every entry's signature + every prev-link.
   * Returns `{ ok: true }` on success.  On failure: `{ ok: false,
   * brokenAt, reason }` — `brokenAt` is the index of the first bad
   * entry; `reason` is a stable code.
   *
   * Failure codes:
   *   'bad-shape'   — required field missing
   *   'bad-sig'     — Ed25519 verification failed
   *   'bad-prev'    — prev-hash doesn't match previous entry's hash
   *
   * @returns {{ ok: true } | { ok: false, brokenAt: number, reason: string }}
   */
  verify() {
    let prev = null;
    for (let i = 0; i < this.#entries.length; i++) {
      const e = this.#entries[i];
      if (!e || typeof e !== 'object')                return { ok: false, brokenAt: i, reason: 'bad-shape' };
      const { sig, ...body } = e;
      if (typeof sig !== 'string' || !sig)            return { ok: false, brokenAt: i, reason: 'bad-shape' };
      if (body.v !== AUDIT_VERSION)                   return { ok: false, brokenAt: i, reason: 'bad-shape' };
      if (typeof body.actor !== 'string' || !body.actor) return { ok: false, brokenAt: i, reason: 'bad-shape' };
      if (typeof body.event !== 'string' || !body.event) return { ok: false, brokenAt: i, reason: 'bad-shape' };
      if (typeof body.ts    !== 'number')             return { ok: false, brokenAt: i, reason: 'bad-shape' };
      if (body.prev !== prev)                         return { ok: false, brokenAt: i, reason: 'bad-prev' };
      let sigBytes;
      try { sigBytes = b64decode(sig); }
      catch { return { ok: false, brokenAt: i, reason: 'bad-sig' }; }
      if (!AgentIdentity.verify(canonicalize(body), sigBytes, body.actor)) {
        return { ok: false, brokenAt: i, reason: 'bad-sig' };
      }
      prev = this.#hashEntry(e);
    }
    return { ok: true };
  }

  /** Serialize the chain to a JSON string for pod-side persistence. */
  serialize() { return JSON.stringify(this.#entries); }

  /**
   * Replace the in-memory chain from a serialized string.  Does NOT
   * verify automatically — call verify() after.  Useful for restoring
   * from a pod or peer-shared audit log.
   */
  async loadSerialized(str) {
    const parsed = JSON.parse(str);
    if (!Array.isArray(parsed)) throw new Error('AuditLog.loadSerialized: expected array');
    this.#entries = parsed;
    await this.#persist();
  }

  /** Filter helper: return entries whose event matches a string or RegExp. */
  filter(pattern) {
    const match = (e) => {
      if (typeof pattern === 'string') return e.event === pattern;
      if (pattern instanceof RegExp)   return pattern.test(e.event);
      return true;
    };
    return this.#entries.filter(match).map((e) => ({ ...e }));
  }

  /** Drop all entries (and persisted slot).  Use with care. */
  async clear() {
    this.#entries = [];
    await this.#persist();
  }

  // ── internal ──────────────────────────────────────────────────────

  #hashEntry(entry) {
    const bytes = new TextEncoder().encode(canonicalize(entry));
    return b64encode(sha256(bytes));
  }

  async #persist() {
    if (!this.#key || !this.#vault) return;
    await this.#vault.set(this.#key, JSON.stringify(this.#entries));
  }
}

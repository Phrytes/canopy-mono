/**
 * ┌─ PORT ──────────────────────────────────────────────────────────────────────┐
 * │ `ActorResolver` is the interface a third-party actor-registry adapter          │
 * │ implements to stay compatible with the @canopy SDK. Unlike Transport/          │
 * │ DataSource it is a STRUCTURAL (duck-typed) interface, not a base class — there  │
 * │ is no class to `extend`; an adapter is any object matching the `@typedef`       │
 * │ below. "Compatible" = *satisfies this port*: expose a `resolve()` (and,         │
 * │ optionally, `register()`/`revoke()`). Reference adapter:                        │
 * │ `createInMemoryActorResolver()` (this file); the substrate impl lives in        │
 * │ `@canopy/agent-registry`. Prove conformance with                              │
 * │ `assertActorResolverConformance()` (test/conformance/actorResolverConformance.js).│
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * ActorResolver — an interface (contract) for resolving agent identifiers.
 *
 * Core defines the **shape**; the actual implementation lives in
 * `@canopy/agent-registry` (forthcoming) — that substrate reads the
 * canonical agent-registry pod resource and resolves between three
 * identifier kinds:
 *
 *   - pubKey         (base64url) — the agent's Ed25519 pubkey
 *   - webid          (URI)        — the user's WebID URI
 *   - agentUri       (URI)        — the agent's URI on the WebID profile
 *                                   (e.g. `https://anne.pod/profile#me/agent/laptop`)
 *                                   OR `pseudo-pod://<deviceId>/agent` for
 *                                   no-pod users (§II.8 of the plan).
 *
 * Strict layering (locked 2026-05-11): core defines the interface but
 * never imports `@canopy/agent-registry`. Apps + facades wire the
 * resolver into core consumers (`PolicyEngine`, `CapabilityToken.verify`)
 * by **dependency injection**.
 *
 * Standardisation Phase 50.9.1 — see
 * `Project Files/SDK/core-v2-coding-plan-2026-05-11.md`.
 */

/**
 * @typedef {object} ActorRecord
 * @property {string}      pubKey   — Ed25519 pubkey (base64url)
 * @property {string|null} webid    — WebID URI, or null for no-pod agents
 * @property {string}      agentUri — URI form (WebID-rooted or pseudo-pod://)
 * @property {string}      role     — 'human' | 'device' | 'bot'
 * @property {object}      [capabilities] — substrate-defined extras
 * @property {string|null} [revokedAt]    — ISO timestamp if revoked
 */

/**
 * @typedef {object} ActorResolver
 *
 * @property {(identifier: string) => Promise<ActorRecord|null> | ActorRecord|null}
 *   resolve  — look up an agent by **any** of its identifiers (pubKey,
 *              webid, or agentUri). Returns the canonical record on hit,
 *              `null` on miss. May be async; sync impls return the value
 *              directly.
 *
 * @property {(record: ActorRecord) => Promise<void> | void}
 *   [register] — optional: register a new agent. Implementations that
 *                are read-only (e.g. cached snapshots) may omit this.
 *
 * @property {(identifier: string) => Promise<void> | void}
 *   [revoke]   — optional: mark an agent as revoked.
 */

/**
 * Tiny in-memory `ActorResolver` for tests + minimal apps that don't
 * need a substrate. Maps an identifier (any of pubKey / webid / agentUri)
 * to a single `ActorRecord`. Mutations are synchronous.
 *
 * Apps that need a real resolver (backed by `@canopy/agent-registry`)
 * use the substrate's `makeActorResolver(registry)` factory instead.
 *
 * @returns {ActorResolver & { all(): ActorRecord[], clear(): void }}
 */
export function createInMemoryActorResolver() {
  /** @type {Map<string, ActorRecord>} */
  const byIdentifier = new Map();
  /** @type {Set<ActorRecord>} */
  const records      = new Set();

  function _indexRecord(record) {
    if (record.pubKey)   byIdentifier.set(record.pubKey, record);
    if (record.webid)    byIdentifier.set(record.webid, record);
    if (record.agentUri) byIdentifier.set(record.agentUri, record);
    records.add(record);
  }

  return {
    resolve(identifier) {
      if (typeof identifier !== 'string') return null;
      return byIdentifier.get(identifier) ?? null;
    },
    register(record) {
      _indexRecord(record);
    },
    revoke(identifier) {
      const r = byIdentifier.get(identifier);
      if (r) r.revokedAt = new Date().toISOString();
    },
    all() { return [...records]; },
    clear() { byIdentifier.clear(); records.clear(); },
  };
}

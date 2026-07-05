/**
 * ActorResolver PORT conformance harness.
 *
 * `ActorResolver` is a STRUCTURAL (duck-typed) port — an object shape, not a
 * base class (see packages/core/src/permissions/ActorResolver.js). This harness
 * asserts an implementation satisfies the shape: a required `resolve()` that
 * returns `null` on a miss and the canonical record on a hit by ANY of its
 * identifiers, plus the optional `register()`/`revoke()` when present.
 *
 * "Implement the port + pass this harness = compatible with the @canopy SDK."
 */
import { expect } from 'vitest';

/**
 * @param {() => (object | Promise<object>)} makeResolver — yields a fresh resolver.
 * @param {object} [opts]
 * @param {string} [opts.label='ActorResolver']
 */
export async function assertActorResolverConformance(makeResolver, { label = 'ActorResolver' } = {}) {
  const r = await makeResolver();

  // ── 1. Shape: resolve() is required ───────────────────────────────────────
  expect(typeof r.resolve, `${label}: must expose resolve()`).toBe('function');

  // ── 2. resolve() of an unknown / non-string identifier is null ────────────
  expect(await r.resolve('nobody://unknown'), `${label}: resolve() miss is null`).toBe(null);
  expect(await r.resolve(undefined), `${label}: resolve() of a non-string is null`).toBe(null);

  // ── 3. If register() exists, a registered record resolves by every id ─────
  if (typeof r.register === 'function') {
    const record = {
      pubKey:   'PUBKEY_CONF',
      webid:    'https://anne.example/profile#me',
      agentUri: 'https://anne.example/profile#me/agent/laptop',
      role:     'device',
    };
    await r.register(record);
    for (const id of [record.pubKey, record.webid, record.agentUri]) {
      const hit = await r.resolve(id);
      expect(hit, `${label}: resolve('${id}') returns the record`).toBeTruthy();
      expect(hit.pubKey, `${label}: resolved record is canonical`).toBe(record.pubKey);
    }

    // ── 4. If revoke() exists, it stamps revokedAt ──────────────────────────
    if (typeof r.revoke === 'function') {
      await r.revoke(record.pubKey);
      const revoked = await r.resolve(record.pubKey);
      expect(revoked?.revokedAt, `${label}: revoke() marks revokedAt`).toBeTruthy();
    }
  }
}

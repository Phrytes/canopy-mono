/**
 * circleSealingIdentity — a per-circle member sealing keypair (S4, pod foundation).
 *
 * The P3 sealing substrate gives every member a stable X25519 **sealing** keypair
 * (distinct from the transport/NKN identity) used to wrap/unwrap a circle's group
 * key. This thin wrapper scopes `@onderling/pod-client` `createMemberSealingIdentity`
 * PER CIRCLE, so each circle keeps its own sealing key in the app vault. Pure
 * composition — the vault `store` is injected, so it's fully unit-testable offline
 * (no pod, no OIDC). The producer-side control-agent wiring + a real-pod verify are
 * later, env-gated phases (REMAINING-WORK §4 E2).
 */
import { createMemberSealingIdentity } from '@onderling/pod-client';

/**
 * @param {object} deps
 * @param {string} deps.circleId               the circle this sealing identity belongs to.
 * @param {{ get: Function, set: Function }} deps.store  a vault-shaped key/value store.
 * @param {string} [deps.keyPrefix]            vault key prefix (default `cc.circle-sealing-id`).
 * @returns {{ ensure: Function, publicKey: Function, rosterEntry: Function }}
 */
export function createCircleSealingIdentity({ circleId, store, keyPrefix = 'cc.circle-sealing-id' } = {}) {
  if (!circleId) throw new Error('createCircleSealingIdentity: circleId is required');
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
    throw new Error('createCircleSealingIdentity: a vault-shaped store (get/set) is required');
  }
  // Per-circle key so two circles never share a sealing identity (forward-isolation).
  return createMemberSealingIdentity({ store, key: `${keyPrefix}:${circleId}` });
}

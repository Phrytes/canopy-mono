/**
 * upgradeToTwoPods — V0 stub.
 *
 * The full design (functional design §4.2.2) is:
 *   1. Provision a second pod via OIDC.
 *   2. Build a migration plan listing all `sharing/*` resources
 *      that need to move.
 *   3. Lazily migrate (rewrite refs as they're touched); explicit
 *      copies for non-touched resources.
 *   4. Update the storage-mapping config to point `sharing/*` at
 *      the new pod.
 *   5. Update the WebID profile predicates.
 *
 * V0 deliberately doesn't ship this — ref-rewriting is open
 * (functional design §4.3.6) and gets pinned in P5 alongside the
 * two-pod policy work.
 *
 * Standardisation Phase 52.5 — see plan §52.5.3.
 */

export async function upgradeToTwoPods() {
  throw Object.assign(
    new Error(
      'upgradeToTwoPods is not yet implemented in V0. ' +
      'Ref-rewriting + migration semantics pin during P5. ' +
      'See substrates-v2-functional-design §4.2.5 + §4.3.6.',
    ),
    { code: 'NOT_IMPLEMENTED' },
  );
}

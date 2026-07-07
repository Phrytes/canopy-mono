/**
 * circleShareEnforcement — the PLATFORM-NEUTRAL assembly of a circle's cross-circle SHARE enforcement binder
 * (cluster K · objective L). Both shells (web `circleApp.js`, mobile `circlePods.js`) resolve their platform
 * pod objects — the ACP `sharing` surface, the content seal `strategy`, the signed-in `podRoot`, the circle's
 * `controlAgent`, this device's per-circle `idKey` — and hand them here; this module composes the SAME
 * `makeCircleShareEnforcement` (+ best-effort `createCanonicalShare`) from them. Living once here is invariant
 * #1 (logic in shared src) / #2 (web≡mobile by construction): neither shell forks the assembly.
 *
 * It imports the substrate (`@canopy/item-store`, `@canopy/pod-client`, `@canopy/pod-onboarding`) but nothing
 * platform-specific (no DOM, no RN, no session objects) — those stay in the shells, which pass only plain deps.
 *
 * Returns the enforcement `{ onShare, onShareCanonical, revokeCanonical, policy }` when the pod path is ACTIVE
 * (a signed-in `podRoot`, a real ACP `sharing` with grant+list, AND a resolved seal `strategy`); otherwise
 * null so the caller degrades to the in-memory `shared-ref` behaviour (no grant/seal/read-gate) — the additive
 * fallback both platforms share.
 */
import { makeCircleShareEnforcement } from '@canopy/item-store';
import { createCanonicalShare } from '@canopy/pod-client';
import { makeResourceUriResolver, sharedRefResourceUri } from '@canopy/pod-onboarding/resourceUri';

/**
 * @param {object} deps
 * @param {{grant?:Function, list?:Function, revoke?:Function}} [deps.sharing]  the pod's ACP sharing surface
 *        (web: `prod.podClient.sharing`; mobile: the same). Requires grant+list to activate the pod path.
 * @param {{open?:Function}|null} [deps.strategy]  the circle's CONTENT seal/open strategy (p2/p3). null → no path.
 * @param {string} [deps.podRoot]  the signed-in real-pod root (the `resourceUriFor` base). Absent → null.
 * @param {{keyStore?:object, members?:Function}|null} [deps.controlAgent]  the circle's control agent — its
 *        group-key resource (`keyStore`) + live origin roster (`members()`) feed the canonical controller.
 * @param {{publicKey?:string, privateKey?:string}|null} [deps.idKey]  this device's per-circle sealing identity
 *        (already a group-key recipient) — the canonical controller key. Absent ⇒ no canonical hooks.
 * @returns {object|null}  the enforcement binder, or null when the pod path is inactive.
 */
export function buildCircleShareEnforcement({ sharing, strategy, podRoot, controlAgent, idKey } = {}) {
  if (!podRoot) return null;                                   // not signed in → memory path
  // Require BOTH a real ACP sharing surface AND a resolved seal strategy (p2/p3). p0/p1 or an unprovisioned
  // group key → null (decline the pod path rather than grant against plaintext).
  if (!sharing || typeof sharing.grant !== 'function' || typeof sharing.list !== 'function' || !strategy) {
    return null;
  }
  const resourceUriFor = sharedRefResourceUri(makeResourceUriResolver({ podUri: podRoot }));

  // objective L — the CANONICAL controller (share=grant/re-wrap, revoke=rotate), built best-effort from the
  // control agent's group-key resource + this device's sealing identity (already a recipient, so it can
  // unwrap-to-re-wrap on every grant). A circle whose control agent / sealing identity isn't resolvable simply
  // skips the canonical hooks (the copy/closed postures are unaffected).
  let canonicalShare;
  try {
    if (controlAgent?.keyStore && idKey?.publicKey && idKey?.privateKey && typeof sharing.revoke === 'function') {
      canonicalShare = createCanonicalShare({
        sharing,
        keyStore: controlAgent.keyStore,
        controllerKey: { publicKey: idKey.publicKey, privateKey: idKey.privateKey },
        resourceUriFor,
      });
    }
  } catch { canonicalShare = undefined; }

  // Enforcement `seal` is OMITTED on purpose: the cross-circle recipient re-seal (copy postures) is layered
  // ABOVE this binder in `shareItemAcrossCircles`. On read, `open: strategy.open` unseals a group-key source;
  // `composeReaderOpen` (in circleShare) adds the reader's own opener. `currentRecipients` re-wraps the group
  // key to the origin members PLUS the outside recipient on a canonical grant (never drops the origin members).
  return makeCircleShareEnforcement({
    sharing, resourceUriFor, open: strategy.open,
    canonicalShare,
    currentRecipients: () => {
      try { return (controlAgent?.members?.() ?? []).map((m) => m.publicKey).filter(Boolean); }
      catch { return []; }
    },
  });
}

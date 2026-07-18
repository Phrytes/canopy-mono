/**
 * circleConsent — the JOIN-TIME consent model over a circle's freedom template (B).
 *
 * resolves the effective capability set as `admin-template ∩ user-opt-outs`. The admin side
 * (the freedom template `policy.capabilities`) + the member side (`override.capabilityOptOuts`) already
 * meet at the gate (`capabilityGate.effectiveCapabilities`). What was missing is the JOIN-TIME surface:
 * a joiner should, at join, review the circle's OPT-OUTABLE capabilities and record their opt-outs so
 * the effective set reflects them from the very first dispatch.
 *
 * This is the pure model behind that surface — a thin, testable projection of the shared
 * `buildCapabilityMatrix` (in `@onderling/app-manifest`), kept OUT of the wizard's DOM so web and mobile
 * render the SAME model by construction (invariants #1–2). No new dep edge: it composes the same
 * matrix builder the override sheet + the gate already use, so the three agree by construction.
 *
 *   - `buildJoinConsentModel(sources, policy)`  → the list a joiner reviews: the ENABLED, OPT-OUTABLE
 *     caps (admin freedom 'optional' OR a privacy floor). Mandatory caps (required, un-floored) and
 *     admin-disabled caps are excluded — they can't be declined.
 *   - `optOutsFromDeclined(model, declinedKeys)` → the validated `capabilityOptOuts` array to write into
 *     the member's prefs: ONLY keys that are opt-outable in the model survive (a mandatory / unknown key
 *     can never be recorded as an opt-out, so the gate can't drop a cap the admin made mandatory).
 *   - `hasConsentChoices(model)` → whether the join consent step has anything to show (else a no-op).
 */
import { buildCapabilityMatrix } from '@onderling/app-manifest';

/** An empty consent model — no opt-outable caps → the join consent step renders nothing. */
export const EMPTY_CONSENT_MODEL = Object.freeze({ items: [], keys: [] });

/**
 * Build the join-time consent model from the merged manifest `sources` + the circle's admin `policy`
 * (its freedom template + enabled apps). Returns the OPT-OUTABLE capabilities a joiner may decline.
 *
 * @param {Array<{manifest:object}>} sources  merged manifest sources (as fed to the gate/override sheet)
 * @param {{ apps?: string[]|null, capabilities?: object }} [policy]  admin policy (apps==null ⇒ all apps)
 * @param {{ optOuts?: string[]|Set<string> }} [opts]  the member's already-declined keys (pre-checks the UI)
 * @returns {{ items: Array<{key,app,atom,noun,privacyFloor,consequence,optedOut}>, keys: string[] }}
 */
export function buildJoinConsentModel(sources, policy = {}, { optOuts } = {}) {
  if (!Array.isArray(sources) || sources.length === 0) return { items: [], keys: [] };
  const matrix = buildCapabilityMatrix(sources, {
    enabledApps: Array.isArray(policy?.apps) && policy.apps.length ? policy.apps : null,
    template:    (policy?.capabilities && typeof policy.capabilities === 'object') ? policy.capabilities : {},
    optOuts:     optOuts || [],
  });
  const items = matrix
    .filter((r) => r.enabled && r.optOutable)   // only caps a member MAY decline (optional OR privacy floor)
    .map((r) => ({
      key:          r.key,
      app:          r.app,
      atom:         r.atom,
      noun:         r.noun,
      privacyFloor: r.privacyFloor,
      consequence:  r.consequence,
      optedOut:     r.optedOut,
    }));
  return { items, keys: items.map((i) => i.key) };
}

/** The set of opt-outable keys in a model (the ONLY keys a member is allowed to decline). */
function allowedKeys(model) {
  if (Array.isArray(model?.keys)) return new Set(model.keys);
  if (Array.isArray(model?.items)) return new Set(model.items.map((i) => i.key));
  return new Set();
}

/**
 * Turn the joiner's declined keys into the validated `capabilityOptOuts` array to record in prefs.
 * A key survives ONLY if it is opt-outable in `model` — a mandatory / non-opt-outable / unknown key is
 * dropped, so a member can never opt out of a cap the admin made required. De-duped, order-stable.
 *
 * @param {object} model  from buildJoinConsentModel
 * @param {string[]|Set<string>} declinedKeys  the caps the joiner unchecked
 * @returns {string[]}
 */
export function optOutsFromDeclined(model, declinedKeys = []) {
  const allowed = allowedKeys(model);
  const declined = declinedKeys instanceof Set ? [...declinedKeys] : (Array.isArray(declinedKeys) ? declinedKeys : []);
  const out = [];
  const seen = new Set();
  for (const k of declined) {
    if (typeof k === 'string' && allowed.has(k) && !seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

/** True when the consent model has at least one opt-outable cap to show the joiner. */
export function hasConsentChoices(model) {
  return !!model && Array.isArray(model.items) && model.items.length > 0;
}

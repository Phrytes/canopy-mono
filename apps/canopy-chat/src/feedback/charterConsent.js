// Charter consent (participant side) — the pure logic behind the feedback requested-attributes
// consent step (property-layer Phase 3; plans/NOTE-property-layer-design.md §7 row 3).
//
// Given a project's declared charter (config.charter = { version?, attributes:[{key,purpose}] } —
// the PM's request), this produces: the consent items to render, an immutable LOCAL disclosure
// (coarse values + per-attribute share toggles, default-WITHHOLD), and exactly what rides the
// contribution — the released coarse attributes + the charterHash — plus an on-device rare-combo
// WARNING. It REUSES @canopy/attribute-charter (the built substrate) — no reimplementation and
// no UI/transport here; the shell renders from these + hands the released values to the send path.
//
// (The values are held in a feedback-local disclosure profile today. Lifting them onto the shared
// agent-registry profile graph — so place/age are curated ONCE and reused across apps — is the
// tracked next integration, design §7 "the load-bearing decision".)
import {
  createCharter, charterHash,
  createDisclosureProfile, setValue, setEnabled, releasedValues, enabledSharedKeys,
  disclosureWarning, bucketsFor,
} from '@canopy/attribute-charter';

/** Validate + build the charter a project declared (null when the project has none). */
export function charterFromConfig(projectId, cfgCharter) {
  if (!cfgCharter || !Array.isArray(cfgCharter.attributes) || cfgCharter.attributes.length === 0) return null;
  return createCharter({ projectId, version: cfgCharter.version ?? 1, attributes: cfgCharter.attributes });
}

/** The rows a consent UI renders: each requested attribute + its purpose + its allowed buckets. */
export function consentItems(charter) {
  return (charter?.attributes ?? []).map((a) => ({ key: a.key, purpose: a.purpose, buckets: bucketsFor(a.key) ?? null }));
}

/** A fresh, share-nothing local disclosure for a project (default-withhold). */
export function emptyConsent(projectId) {
  return createDisclosureProfile({ projectId });
}

/** Set a coarse value for an attribute (immutable). Does NOT enable sharing — that's a separate opt-in. */
export function setConsentValue(profile, key, value) {
  return setValue(profile, key, value);
}

/** Enable/disable sharing an attribute (immutable; default withheld). */
export function toggleConsent(profile, key, on) {
  return setEnabled(profile, key, on === true);
}

/**
 * What this consent will actually attach to a contribution: the released coarse attributes (only
 * charter-requested + enabled + valid) and the charterHash. Withheld attributes are ABSENT.
 * @returns {{ attributes: object, charterHash: string }}
 */
export function consentRelease(profile, charter) {
  return { attributes: releasedValues(profile, charter), charterHash: charterHash(charter) };
}

/**
 * The on-device low-leak warning: is the participant's enabled combo likely rare in a cohort of ~n?
 * `n` (approximate cohort size) may be absent → the warning is inert (warn:false).
 */
export function consentWarning(profile, charter, n) {
  return disclosureWarning({ enabledKeys: enabledSharedKeys(profile, charter), n });
}

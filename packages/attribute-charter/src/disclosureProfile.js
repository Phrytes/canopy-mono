/**
 * The participant's disclosure profile — a reusable, LOCAL-only record of the
 * coarse values they've chosen, plus a per-attribute enabled flag. Set once,
 * reused + re-confirmable each round. Stored on the device (localStorage /
 * AsyncStorage) by the caller; the values NEVER leave the device except the
 * enabled ones on an actual release.
 *
 * Design rules (plans/NOTE-requested-attributes-charter.md §3):
 *   - default = WITHHOLD. A fresh profile shares nothing.
 *   - withholding is INVISIBLE — a released record simply lacks the field; there
 *     is never a "withheld" marker (that would itself be a signal).
 *   - only values for keys the charter actually requests are ever released.
 *
 * A miniature of the named-profiles portability idea (see the identity note):
 * one local, user-owned bundle of coarse self-description, reused per project.
 *
 * All functions are pure transforms over a plain serialisable object.
 */
import { isVocabKey, isValidValue } from './vocabulary.js';
import { charterKeys } from './charter.js';

/**
 * A fresh, empty (share-nothing) profile for a project.
 * @param {{projectId: string, charterVersion?: number}} args
 */
export function createDisclosureProfile({ projectId, charterVersion = 1 } = {}) {
  if (typeof projectId !== 'string' || !projectId) {
    throw new TypeError('createDisclosureProfile: projectId required');
  }
  return { projectId, charterVersion, values: {}, enabled: {} };
}

/**
 * Set the coarse value for an attribute (does NOT enable sharing it — that is a
 * separate, deliberate opt-in). Returns a new profile; rejects fine/unknown values.
 */
export function setValue(profile, key, value) {
  if (!isVocabKey(key)) throw new RangeError(`setValue: unknown attribute key ${JSON.stringify(key)}`);
  if (!isValidValue(key, value)) throw new RangeError(`setValue: value ${JSON.stringify(value)} is not a coarse allowed value for ${key}`);
  return { ...profile, values: { ...profile.values, [key]: value } };
}

/**
 * Enable/disable sharing an attribute. Default (absent) = withheld. Enabling a
 * key with no value set is a no-op on release (nothing to share) but is allowed
 * so the UI can toggle before entering a value.
 */
export function setEnabled(profile, key, on) {
  if (!isVocabKey(key)) throw new RangeError(`setEnabled: unknown attribute key ${JSON.stringify(key)}`);
  return { ...profile, enabled: { ...profile.enabled, [key]: on === true } };
}

/** The keys this profile is currently set to share (enabled AND has a valid value). */
export function enabledSharedKeys(profile, charter) {
  const requested = new Set(charterKeys(charter));
  return Object.keys(profile?.values ?? {}).filter((key) =>
    requested.has(key) &&
    profile.enabled?.[key] === true &&
    isValidValue(key, profile.values[key]),
  );
}

/**
 * The values that will actually be released for this charter: only keys that are
 * (a) requested by the charter, (b) enabled, and (c) hold a valid coarse value.
 * Withheld keys are simply ABSENT — no marker. Returns a plain `{key: value}`.
 */
export function releasedValues(profile, charter) {
  const out = {};
  for (const key of enabledSharedKeys(profile, charter)) {
    out[key] = profile.values[key];
  }
  return out;
}

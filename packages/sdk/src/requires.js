/**
 * @onderling/sdk/requires — the declarative capability vocabulary + validator.
 *
 * 's seam for (`@onderling/app-scaffold`): an app declares WHICH SDK
 * slices it needs as a `requires: [...]` list drawn from a small, fixed
 * vocabulary — the sub-path/extension names — and a validator checks
 * that list against the vocabulary (unknown → error) and, optionally, an
 * `available` set (the slices actually wired/present).
 *
 *     import { CAPABILITIES, validateRequires } from '@onderling/sdk/requires';
 *
 *     validateRequires(['core', 'vault']);
 *     // → { ok: true, missing: [], unknown: [] }
 *
 *     validateRequires(['core', 'blockchain']);
 *     // → { ok: false, unknown: [{ capability: 'blockchain', code: '…UNKNOWN…' }], missing: [] }
 *
 *     validateRequires(['core', 'pod'], { available: ['core'] });
 *     // → { ok: false, missing: [{ capability: 'pod', code: '…MISSING…' }], unknown: [] }
 *
 * Diagnostics carry stable CODES (not free-text message strings) so a caller
 * can branch on them without string-matching.
 */

/**
 * The capability vocabulary — the sub-path / extension names. This is
 * the closed set a `requires` list may draw from.
 *
 *   - 'core'       → @onderling/sdk/core       (the kernel base)
 *   - 'transports' → @onderling/sdk/transports (default network transports)
 *   - 'vault'      → @onderling/sdk/vault      (default Vault family)
 *   - 'pod'        → @onderling/sdk/pod        (default pod-client extension)
 *   - 'high'       → @onderling/sdk/high       (createAgent/connectSkill/wireSkill)
 *
 * @type {ReadonlyArray<'core'|'transports'|'vault'|'pod'|'high'>}
 */
export const CAPABILITIES = Object.freeze(['core', 'transports', 'vault', 'pod', 'high']);

/**
 * Stable diagnostic codes for {@link validateRequires} findings. Codes, not
 * strings — a consumer branches on these, never on message text.
 */
export const REQUIRES_CODES = Object.freeze({
  /** A requested capability is not in the {@link CAPABILITIES} vocabulary. */
  UNKNOWN: 'ERR_REQUIRES_UNKNOWN_CAPABILITY',
  /** A known capability is not present in the `available` set. */
  MISSING: 'ERR_REQUIRES_MISSING_CAPABILITY',
});

/**
 * @typedef {object} RequiresFinding
 * @property {string} capability  the offending capability name
 * @property {string} code        a {@link REQUIRES_CODES} code
 */

/**
 * @typedef {object} RequiresResult
 * @property {boolean} ok       true iff `unknown` and `missing` are both empty
 * @property {RequiresFinding[]} unknown  capabilities not in the vocabulary
 * @property {RequiresFinding[]} missing  known capabilities absent from `available`
 */

/**
 * Validate an app's declared `requires` against the capability vocabulary
 * and (optionally) the wired/available set.
 *
 * Semantics:
 *   1. UNKNOWN — any requested capability not in {@link CAPABILITIES} is
 *      reported in `unknown` with code {@link REQUIRES_CODES.UNKNOWN}.
 *   2. MISSING — when an `available` set is supplied, any KNOWN requested
 *      capability not in it is reported in `missing` with code
 *      {@link REQUIRES_CODES.MISSING}. An unknown capability is only ever
 *      reported as `unknown`, never also as `missing`.
 *   3. `ok` is true iff both lists are empty.
 *
 * If `available` is omitted, only the vocabulary check runs (nothing can be
 * `missing`). Order and duplicates in `requires` are preserved in the output.
 *
 * @param {ReadonlyArray<string>} requires  the app's declared capability list
 * @param {object} [opts]
 * @param {ReadonlyArray<string>} [opts.available]  the wired/present slices;
 *        omit to skip the presence check.
 * @returns {RequiresResult}
 */
export function validateRequires(requires, { available } = {}) {
  if (!Array.isArray(requires)) {
    throw new TypeError('validateRequires: `requires` must be an array of capability names');
  }
  if (available !== undefined && !Array.isArray(available)) {
    throw new TypeError('validateRequires: `available` must be an array of capability names when given');
  }

  const known         = new Set(CAPABILITIES);
  const availableSet  = available === undefined ? null : new Set(available);

  const unknown = [];
  const missing = [];

  for (const capability of requires) {
    if (!known.has(capability)) {
      unknown.push({ capability, code: REQUIRES_CODES.UNKNOWN });
      continue;   // unknown is never also reported as missing
    }
    if (availableSet && !availableSet.has(capability)) {
      missing.push({ capability, code: REQUIRES_CODES.MISSING });
    }
  }

  return { ok: unknown.length === 0 && missing.length === 0, missing, unknown };
}

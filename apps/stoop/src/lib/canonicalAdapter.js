/**
 * canonicalAdapter — Stoop's legacy item-type vocabulary → canonical
 * `@canopy/item-types` shape.
 *
 * Stoop's `postRequest` writes items with legacy types: `ask`,
 * `offer`, `lend`, `request`, `report` (plus a handful of bespoke
 * admin types like `membership-code`, `group-rules`). The canonical
 * taxonomy uses author's-stance types (`offer` / `request` / `claim`)
 * with a `kind` subfield carrying the verb direction.
 *
 * This adapter is a **read-only translator** used for warn-only
 * canonical validation — Stoop's actual stored items keep the
 * legacy shape. Migration to canonical writes is separate, larger
 * work (touches every read-site filter). Until then, this helper
 * lets us catch shape drift without disturbing live data.
 *
 * Standardisation Phase 52.7.2 — see
 * `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`.
 */

import { validateCanonical, schema } from '@canopy/item-types';

/**
 * Is `kind` a valid canonical `kind` for `type`? Reads the canonical
 * schema's enum (single source of truth — no duplicated lists).
 * Defensive: an unknown type / missing enum → treat as valid so we
 * never regress a write on a schema-shape surprise.
 */
function _canonicalKindOk(type, kind) {
  try {
    const en = schema?.(type)?.properties?.kind?.enum;
    if (!Array.isArray(en)) return true;
    return en.includes(kind);
  } catch {
    return true;
  }
}

/**
 * Map a legacy Stoop item to the canonical shape. Returns `null`
 * when the type isn't part of the canonical adoption (admin types
 * like `membership-code` skip validation, matching how Tasks's
 * `addTask` only validates `task` items).
 *
 * @param {object} item        — a Stoop item as written by postRequest
 * @returns {object | null}
 */
export function toCanonicalShape(item) {
  if (!item || typeof item !== 'object' || typeof item.type !== 'string') return null;

  const mapping = STOOP_TYPE_MAPPING[item.type];
  if (!mapping) return null;       // bespoke type — skip canonical validation

  return {
    ...item,
    type: mapping.type,
    // Honour an existing `kind` if the item already has one; otherwise
    // fill in the default for this Stoop UI button.
    kind: typeof item.kind === 'string' ? item.kind : mapping.defaultKind,
  };
}

/**
 * Validate a Stoop item against the canonical schema using the
 * translator. Returns `{ok, errors?, skipped?}`:
 *   - `{ok: true}` — canonically valid (under the translator's lens).
 *   - `{ok: false, errors}` — translator mapped it, but validation failed.
 *   - `{skipped: true}` — type isn't part of canonical adoption (bespoke).
 *
 * Designed for warn-only adoption sites. Never throws.
 */
export function validateStoopItem(item) {
  try {
    const adapted = toCanonicalShape(item);
    if (!adapted) return { skipped: true };
    return validateCanonical(adapted);
  } catch (_err) {
    return { skipped: true };
  }
}

/**
 * Stoop-legacy → canonical type+kind mapping table.
 *
 * `defaultKind` is what the translator fills in when the Stoop item
 * doesn't carry an explicit `kind` (today none of them do — the kind
 * lives in the legacy `type` field). Apps that grow a direction-pick
 * UX can set `item.kind` directly to override.
 *
 * Calls deliberately deferred to the canonical taxonomy:
 *  - `report`              — admin moderation, not a shared-resource
 *                            type. Stays bespoke; skipped from validation.
 *  - `membership-code` etc. — Stoop's group-management plumbing,
 *                             outside the canonical scope by design.
 */
export const STOOP_TYPE_MAPPING = Object.freeze({
  // "Aanbod" button → "I have something to give"
  'offer':   { type: 'offer',   defaultKind: 'give' },
  // "Te leen" button → "I have something to lend (with return)"
  'lend':    { type: 'offer',   defaultKind: 'lend' },
  // "Vragen" button → "I want to borrow" (most common buurt case;
  // grow the UI later to let users pick `share` for consumables or
  // `receive` for gift-asks).
  'ask':     { type: 'request', defaultKind: 'borrow' },
  // V0 legacy fallback — generic "request"; left under-specified
  // until the UI splits this further.
  'request': { type: 'request', defaultKind: 'other' },
});

/**
 * Translate a UI-vocab `intent` (and optional `kind` override) into
 * the **canonical draft fields** for an item write. Used by
 * postRequest's cut-over from `type: a.kind` (legacy) to
 * `{type, kind}` (canonical). Phase 52.7.2 cut-over (2026-05-14).
 *
 * Behaviour:
 *
 *   - Canonical intents (`ask` / `offer` / `lend` / `request`) →
 *     `{type, kind}` from STOOP_TYPE_MAPPING. Caller-supplied
 *     `kindOverride` wins over `defaultKind` so a future UI
 *     sub-choice (e.g. "Lenen / Iets klein om te delen / Iets
 *     gratis krijgen") can pin the canonical kind directly.
 *
 *   - Bespoke intents (`report`, `membership-code`, `group-rules`,
 *     etc.) → `{type: intent}` only, no `kind` field. The translator
 *     mapping doesn't cover these; they stay in their legacy shape.
 *     This is the same set that `toCanonicalShape` returns `null`
 *     for during validation.
 *
 *   - Unknown / missing intent → `{type: 'request'}` (the historic
 *     V0 default). Caller-supplied `kindOverride` is preserved.
 *
 * @param {string|undefined|null} intent
 * @param {string|undefined|null} kindOverride
 * @returns {{type: string, kind?: string}}
 */
export function intentToCanonicalDraft(intent, kindOverride) {
  if (typeof intent !== 'string' || intent.length === 0) {
    // Legacy V0 default — no intent supplied. Only carry `kind` if it
    // is a valid canonical request kind (else omit — a bad override
    // must not produce a /kind enum violation).
    return (typeof kindOverride === 'string' && kindOverride.length > 0
            && _canonicalKindOk('request', kindOverride))
      ? { type: 'request', kind: kindOverride }
      : { type: 'request' };
  }
  const mapping = STOOP_TYPE_MAPPING[intent];
  if (mapping) {
    // A caller-supplied kind wins ONLY if it's valid for the mapped
    // canonical type; otherwise fall back to the always-valid
    // defaultKind. (Composers historically passed the UI verb as
    // `kind`, e.g. 'ask', which is not a canonical request kind →
    // the recurring `item-types[request]: /kind enum` warn.)
    const wanted = (typeof kindOverride === 'string' && kindOverride.length > 0)
      ? kindOverride
      : mapping.defaultKind;
    const kind = _canonicalKindOk(mapping.type, wanted) ? wanted : mapping.defaultKind;
    return { type: mapping.type, kind };
  }
  // Bespoke intent — pass through verbatim. The translator's
  // `toCanonicalShape` returns `null` for these, and `validateStoopItem`
  // returns `{skipped: true}`.
  return typeof kindOverride === 'string' && kindOverride.length > 0
    ? { type: intent, kind: kindOverride }
    : { type: intent };
}

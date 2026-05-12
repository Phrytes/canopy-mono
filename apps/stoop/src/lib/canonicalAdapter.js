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

import { validateCanonical } from '@canopy/item-types';

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

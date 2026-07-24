// mediaProperty.js — the `media` property type: a persona attribute whose VALUE is a
// SEALED MEDIA REF, not bytes. A profile picture is just another property on the profile
// graph (profileProperties.js) governed by the SAME per-(context,key) disclosure policy
// as any attribute (disclosure.js) — the value here is only the SHAPE + validation,
// pointing at @onderling/item-types' canonical `media` item-type (no new media surface).
//
// The value mirrors a `media` item's `source` line (packages/item-types/src/types/media.js
// → MEDIA_SCHEMA.source): the embeds-shaped `{ type, ref, enc }` storage pointer, where
// `ref` is a `blob://<key>` (or other) ref and `enc` is blob-gateway's opaque sealing
// metadata `{ sealed:true, keyRef, format, bytes, mime?, width?, height?, thumb? }`
// (packages/blob-gateway/src/ref.js). NO inline bytes — the pod holds the manifest line;
// the sealed bytes are fetched on demand behind the blob gateway's deny-by-default gate.
// This is EXACTLY the shape chat photos already ride (the `media-card` embed's
// pointer→media→source chain, apps/basis/src/core/handlers/mediaEmbed.js), so a profile
// picture reuses the sealed-media surface with NO new mechanism.
//
// Pure — web ≡ mobile, no I/O. Like drivers.js / location.js: the store keeps the value
// opaque; this module is the only place that knows a media property's internal shape.

import { descriptor } from './propertyVocabulary.js';

/** The canonical profile-picture property key — a media-typed persona attribute. */
export const PROFILE_PICTURE_KEY = 'profilePicture';

/**
 * True iff `v` is a well-formed SEALED media ref — the value a media-typed property holds.
 * Mirrors item-types' MEDIA_SCHEMA.source contract: an object with a non-empty string
 * `type` + `ref`, plus `enc` sealing metadata whose `sealed` flag is `true` (a sealing
 * envelope, never inline plaintext bytes). A full `media` item (`{type:'media', source}`)
 * is unwrapped to its `source` line. Rejects strings/numbers/arrays, a plain object with
 * no ref, an UNSEALED ref (`enc.sealed !== true` — inline/plaintext), and a ref missing
 * its `enc` sealing line.
 *
 * This is the media type's VALIDATION — the counterpart to isDriverValue / isLocationValue.
 *
 * @param {*} v
 * @returns {boolean}
 */
export function isSealedMediaRef(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  // Accept a full canonical `media` item too — unwrap to its embeds-shaped source line.
  const src = (v.type === 'media' && v.source && typeof v.source === 'object' && !Array.isArray(v.source))
    ? v.source
    : v;
  if (!src || typeof src !== 'object' || Array.isArray(src)) return false;
  if (typeof src.type !== 'string' || !src.type) return false;   // the embeds-entry `type` (e.g. 'blob')
  if (typeof src.ref !== 'string' || !src.ref) return false;     // 'blob://<key>' / 'https://…' / 'urn:dec:item:…'
  if (!src.enc || typeof src.enc !== 'object' || Array.isArray(src.enc)) return false;  // sealing metadata line
  if (src.enc.sealed !== true) return false;                     // SEALED only — never inline/plaintext bytes
  return true;
}

/**
 * A property-vocabulary descriptor for a media-typed key. Type `media`, NO coarseness
 * ladder — a picture is all-or-nothing per context (you disclose the whole sealed ref or
 * none of it; there is no "coarser" picture), like a driver. It flows through the profile
 * own/inherit graph like any property and is disclosed by disclosure.js EXACTLY like a
 * text attribute: `enabled` → the sealed ref is released whole (no coarsen fn → value
 * as-is); withheld → ABSENT (default-withhold, no marker). `sensitivity` defaults to
 * `normal` (a chosen presented self), overridable.
 *
 * @param {string} key
 * @param {{sensitivity?:string}} [opts]
 */
export function mediaDescriptor(key, { sensitivity = 'normal' } = {}) {
  return descriptor({ key, type: 'media', ladder: null, coarsen: null, sensitivity });
}

/** The descriptor for the canonical `profilePicture` property (media-typed). */
export function profilePictureDescriptor() {
  return mediaDescriptor(PROFILE_PICTURE_KEY);
}

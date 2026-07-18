/**
 * profileSync — pure helpers used by ProfileMineScreen + ProfileOtherScreen.
 *
 * Stoop V3 Phase 40.15 (2026-05-08).
 *
 *   - `formatLocationLine(location)` — renders a `{cell, label, source}`
 *     blob as a one-line string for the ProfileScreen location row.
 *   - `mergeSkillUpdate(prevSkills, updated)` — replaces / appends a
 *     skill entry by `categoryId` (matches the SDK's addMySkill
 *     semantics so the screen can optimistically update before the
 *     skill round-trip finishes).
 *   - `removeSkill(prevSkills, categoryId)` — drops one entry.
 *   - `avatarToUri(avatarBlob)` — turns a Phase 40.5 picker result
 *     `{mime, dataB64, ...}` into the data-URI shape avatars use.
 *
 * No I/O, no React. Tests live next to the file.
 */

/**
 * @param {object|null|undefined} location
 * @returns {string|null}  the line to render under the "Location" label,
 *   or null when no location is set
 */
export function formatLocationLine(location) {
  if (!location || typeof location !== 'object') return null;
  if (typeof location.label === 'string' && location.label.length > 0) {
    return `${location.label} (${location.cell ?? '?'})`;
  }
  if (typeof location.cell === 'string' && location.cell.length > 0) {
    return location.cell;
  }
  return null;
}

/**
 * @param {Array<object>} prevSkills
 * @param {object} updated  must include `categoryId`
 * @returns {Array<object>}
 */
export function mergeSkillUpdate(prevSkills, updated) {
  if (!updated || typeof updated.categoryId !== 'string') return prevSkills.slice();
  const filtered = (prevSkills ?? []).filter((s) => s.categoryId !== updated.categoryId);
  filtered.push({
    categoryId:   updated.categoryId,
    freeTags:     Array.isArray(updated.freeTags) ? updated.freeTags : [],
    availability: updated.availability ?? null,
    radius:       updated.radius ?? null,
    status:       updated.status ?? 'active',
  });
  return filtered;
}

/**
 * @param {Array<object>} prevSkills
 * @param {string} categoryId
 * @returns {Array<object>}
 */
export function removeSkill(prevSkills, categoryId) {
  if (typeof categoryId !== 'string' || !categoryId) return (prevSkills ?? []).slice();
  return (prevSkills ?? []).filter((s) => s.categoryId !== categoryId);
}

/**
 * Turn an `imagePicker.pickAvatarImage` result into a data: URI the
 * avatar UI can render directly. Avatars travel in the MemberMap as
 * a URL string (typically `mem://stoop/avatars/<webid>.<ext>` once
 * the cache adapter is wired); for V3 we accept either a fully-formed
 * data: URI or pass through any string.
 *
 * @param {object|null} avatarBlob   `{mime, dataB64}` from the picker
 * @returns {string|null}
 */
export function avatarToUri(avatarBlob) {
  if (!avatarBlob) return null;
  if (typeof avatarBlob === 'string') return avatarBlob;
  if (typeof avatarBlob.dataB64 === 'string' && typeof avatarBlob.mime === 'string') {
    return `data:${avatarBlob.mime};base64,${avatarBlob.dataB64}`;
  }
  return null;
}

/**
 * Pull the user's profile fields out of the SDK's `getMyProfile` shape.
 * Matches the slot names the ProfileMineScreen renders against.
 *
 * @param {object} raw   the result of useSkill('getMyProfile').call({})
 * @returns {{
 *   handle: string|null,
 *   displayName: string|null,
 *   avatarUri: string|null,
 *   offerings: Array<object>,
 *   holidayMode: boolean,
 *   location: object|null,
 * }}
 */
export function unpackProfile(raw) {
  const me = raw?.me ?? raw ?? {};
  // Read-accept: prefer the new `offerings` field, fall back to the
  // legacy `skills` field on an un-migrated blob.
  const offerings = Array.isArray(me.offerings) ? me.offerings
    : (Array.isArray(me.skills) ? me.skills : []);
  return {
    handle:      typeof me.handle      === 'string' ? me.handle      : null,
    displayName: typeof me.displayName === 'string' ? me.displayName : null,
    avatarUri:   typeof me.avatarUrl   === 'string' ? me.avatarUrl   : null,
    offerings,
    holidayMode: me.holidayMode === true,
    location:    me.location && typeof me.location === 'object' ? me.location : null,
  };
}

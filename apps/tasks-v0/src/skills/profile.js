/**
 * profile — canonical user-skills profile + per-crew skill vocabulary
 * + per-crew member-skills projection + per-crew posture (Phase 3).
 *
 * Canonical user profile lives at `mem://user/profile/skills.json`
 * — intentionally NOT app-namespaced so Stoop, Tasks, Folio etc. can
 * read the same blob. When a pod is attached via the localStoreBundle,
 * the CachingDataSource forwards reads/writes through to
 * `<user-pod>/profile/skills.json` (same path, same shape).
 *
 * Per-crew vocabulary lives at `mem://tasks/crews/<circleId>/skills.json`.
 * Per-crew member projection at `mem://tasks/crews/<circleId>/skills/<webid-encoded>.json`.
 * Per-crew posture at `mem://user/posture/<circleId>.json`.
 *
 * Schemas (all optional fields nullable):
 *
 *   CanonicalProfile = {
 *     schemaVersion: 1,
 *     skills: SkillEntry[],
 *     updatedAt: epoch-ms,
 *   }
 *
 *   SkillEntry = {
 *     tag:         <canonical lowercase string — `normaliseTag(...)`>,
 *     categoryId:  <one of TAXONOMY.categories[*].id> | null,
 *     level?:      <free string: 'beginner' | 'advanced' | 'expert' | ...>,
 *     lastUsed?:   epoch-ms,
 *   }
 *
 *   CrewVocabulary = {
 *     schemaVersion: 1,
 *     skills: VocabEntry[],
 *   }
 *
 *   VocabEntry = SkillEntry & {
 *     label?:       <human label, taxonomy-aligned when categoryId is set>,
 *     description?: <free text>,
 *   }
 *
 *   CrewMemberSkills = {
 *     webid: string,
 *     skills: SkillEntry[],
 *     updatedAt: epoch-ms,
 *   }
 *
 *   CrewPosture = {
 *     tags: { [tag]: 'always' | 'negotiable' | 'never' },
 *     updatedAt: epoch-ms,
 *   }
 *
 * The helpers are pure functions over a `core.DataSource` — apps wire
 * the `CachingDataSource` from their `buildBundle()` so reads work
 * offline and writes deferred-flush through to the pod (when one is
 * attached).
 *
 * The `prefilledFormShape({...})` helper computes the UI's three
 * lists (prefilled / vocabSuggestions / freeFormFromProfile) by
 * intersecting the user's canonical profile with the crew's
 * vocabulary. The UI defaults `prefilled` to selected and the other
 * two to unselected.
 */

import { defineSkill } from '@canopy/core';
import { TAXONOMY, normaliseTag, isKnownCategory } from '@canopy/identity-resolver';

import { argsFromParts } from '../bundleResolver.js';

// ── Path helpers ───────────────────────────────────────────────────────────

const CANONICAL_PROFILE_PATH = 'mem://user/profile/skills.json';

function _crewVocabPath(circleId, root = 'mem://tasks/crews/') {
  return `${root}${circleId}/skills.json`;
}

function _crewMemberSkillsPath(circleId, webid, root = 'mem://tasks/crews/') {
  // URL-encode webid so it's safe as a path segment.
  return `${root}${circleId}/skills/${encodeURIComponent(webid)}.json`;
}

function _posturePath(circleId, root = 'mem://user/posture/') {
  return `${root}${circleId}.json`;
}

// ── Read / write helpers ───────────────────────────────────────────────────

async function _safeRead(dataSource, path) {
  if (!dataSource?.read) {
    throw new TypeError('profile: dataSource with .read() required');
  }
  let raw;
  try {
    raw = await dataSource.read(path);
  } catch {
    return null;
  }
  if (raw == null) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function _safeWrite(dataSource, path, value) {
  if (!dataSource?.write) {
    throw new TypeError('profile: dataSource with .write() required');
  }
  await dataSource.write(path, value);
}

// ── Skill-entry normalisation ──────────────────────────────────────────────

function _normaliseSkillEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const rawTag = String(raw.tag ?? '').toLowerCase().trim();
  if (!rawTag) return null;

  // Opportunistically use the multilingual dictionary: if `rawTag` is
  // a known token (NL "fiets" / EN "bicycle"), promote to the canonical
  // tag + auto-derive categoryId. Otherwise keep the lowercase input
  // verbatim — apps support free-form tags beyond the taxonomy.
  const dictHit = normaliseTag(rawTag);   // returns {tag, category} | null
  const tag = dictHit?.tag ?? rawTag;

  let categoryId = null;
  if (raw.categoryId && isKnownCategory(raw.categoryId)) {
    categoryId = raw.categoryId;
  } else if (dictHit?.category) {
    categoryId = dictHit.category;
  }

  const out = { tag, categoryId };
  if (raw.level && typeof raw.level === 'string') out.level = raw.level;
  if (Number.isFinite(raw.lastUsed)) out.lastUsed = raw.lastUsed;
  return out;
}

function _normaliseSkillList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const n = _normaliseSkillEntry(r);
    if (!n) continue;
    if (seen.has(n.tag)) continue;     // dedupe by tag
    seen.add(n.tag);
    out.push(n);
  }
  return out;
}

function _normaliseVocabEntry(raw) {
  const base = _normaliseSkillEntry(raw);
  if (!base) return null;
  if (raw.label && typeof raw.label === 'string') base.label = raw.label;
  if (raw.description && typeof raw.description === 'string') base.description = raw.description;
  return base;
}

function _normalisePostureTags(rawTags) {
  const tags = {};
  if (!rawTags || typeof rawTags !== 'object') return tags;
  for (const [k, v] of Object.entries(rawTags)) {
    if (v !== 'always' && v !== 'negotiable' && v !== 'never') continue;
    const rawTag = String(k).toLowerCase().trim();
    if (!rawTag) continue;
    const dictHit = normaliseTag(rawTag);
    const tag = dictHit?.tag ?? rawTag;
    tags[tag] = v;
  }
  return tags;
}

function _normaliseVocabList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const n = _normaliseVocabEntry(r);
    if (!n) continue;
    if (seen.has(n.tag)) continue;
    seen.add(n.tag);
    out.push(n);
  }
  return out;
}

// ── Public read/write API ──────────────────────────────────────────────────

/**
 * Read the user's canonical skills profile from
 * `mem://user/profile/skills.json` (or whichever path the app
 * supplies). Returns `null` when the blob is absent — apps treat
 * that as "first run, prefilled list is empty".
 *
 * @param {object} args
 * @param {object} args.dataSource
 * @param {string} [args.path]   — override the default canonical path
 * @returns {Promise<{schemaVersion, skills, updatedAt} | null>}
 */
export async function readCanonicalProfile({ dataSource, path = CANONICAL_PROFILE_PATH }) {
  const raw = await _safeRead(dataSource, path);
  if (!raw) return null;
  return {
    schemaVersion: 1,
    skills:        _normaliseSkillList(raw.skills),
    updatedAt:     Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
  };
}

/**
 * Write the canonical profile. **Caller must obtain user opt-in
 * before calling** — see Pod-data-sharing caution principles.
 *
 * @param {object} args
 * @param {object} args.dataSource
 * @param {SkillEntry[]} args.skills
 * @param {string} [args.path]
 * @param {number} [args.now]
 */
export async function writeCanonicalProfile({
  dataSource,
  skills,
  path = CANONICAL_PROFILE_PATH,
  now,
}) {
  const blob = {
    schemaVersion: 1,
    skills:        _normaliseSkillList(skills),
    updatedAt:     Number.isFinite(now) ? now : Date.now(),
  };
  await _safeWrite(dataSource, path, blob);
  return blob;
}

/**
 * Read a crew's skill vocabulary.
 *
 * @param {object} args
 * @param {object} args.dataSource
 * @param {string} args.circleId
 * @param {string} [args.rootContainer]
 * @returns {Promise<{schemaVersion, skills} | null>}
 */
export async function readCrewVocabulary({ dataSource, circleId, rootContainer }) {
  if (typeof circleId !== 'string' || !circleId) {
    throw new TypeError('readCrewVocabulary: circleId required');
  }
  const raw = await _safeRead(dataSource, _crewVocabPath(circleId, rootContainer));
  if (!raw) return null;
  return {
    schemaVersion: 1,
    skills:        _normaliseVocabList(raw.skills),
  };
}

/**
 * Write a crew's skill vocabulary (admin/coordinator-gated by the
 * caller — the helper does NO authz on its own).
 */
export async function writeCrewVocabulary({
  dataSource, circleId, skills, rootContainer,
}) {
  const blob = {
    schemaVersion: 1,
    skills:        _normaliseVocabList(skills),
  };
  await _safeWrite(dataSource, _crewVocabPath(circleId, rootContainer), blob);
  return blob;
}

/**
 * Read the per-crew skill projection for a given member webid.
 */
export async function readMyCrewSkills({
  dataSource, circleId, webid, rootContainer,
}) {
  if (typeof circleId !== 'string' || !circleId) {
    throw new TypeError('readMyCrewSkills: circleId required');
  }
  if (typeof webid !== 'string' || !webid) {
    throw new TypeError('readMyCrewSkills: webid required');
  }
  const raw = await _safeRead(dataSource, _crewMemberSkillsPath(circleId, webid, rootContainer));
  if (!raw) return null;
  return {
    webid,
    skills:    _normaliseSkillList(raw.skills),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
  };
}

/** Write the per-crew skill projection for a member. */
export async function writeMyCrewSkills({
  dataSource, circleId, webid, skills, rootContainer, now,
}) {
  const blob = {
    webid,
    skills:    _normaliseSkillList(skills),
    updatedAt: Number.isFinite(now) ? now : Date.now(),
  };
  await _safeWrite(dataSource, _crewMemberSkillsPath(circleId, webid, rootContainer), blob);
  return blob;
}

/**
 * Read the user's posture for a crew (per-tag willingness:
 * 'always' | 'negotiable' | 'never').
 */
export async function readPostureForCrew({
  dataSource, circleId, postureRoot,
}) {
  if (typeof circleId !== 'string' || !circleId) {
    throw new TypeError('readPostureForCrew: circleId required');
  }
  const raw = await _safeRead(dataSource, _posturePath(circleId, postureRoot));
  if (!raw) return null;
  const tags = _normalisePostureTags(raw.tags);
  return {
    tags,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
  };
}

/** Write the per-crew posture file. */
export async function writePostureForCrew({
  dataSource, circleId, posture, postureRoot, now,
}) {
  const tags = _normalisePostureTags(posture?.tags);
  const blob = {
    tags,
    updatedAt: Number.isFinite(now) ? now : Date.now(),
  };
  await _safeWrite(dataSource, _posturePath(circleId, postureRoot), blob);
  return blob;
}

// ── UI prefilled-form helper ───────────────────────────────────────────────

/**
 * Build the three-list UI shape for "edit my skills for this crew":
 *
 *   - `prefilled`: tags the user has on their canonical profile.
 *     Each entry is annotated with `inCrewVocabulary` (whether the
 *     crew explicitly lists this tag).
 *   - `vocabSuggestions`: tags the crew lists that the user does NOT
 *     have on their canonical profile (suggest enabling).
 *   - `taxonomyHints`: TAXONOMY categories with no user-claimed tag
 *     and no crew-vocab entry — surfaced as a "consider adding"
 *     row in the UI. Optional; the UI may ignore.
 *
 * Pure function — no I/O.
 *
 * @param {object} args
 * @param {{schemaVersion, skills, updatedAt} | null} args.canonicalProfile
 * @param {{schemaVersion, skills} | null} args.crewVocabulary
 * @param {object} [args.taxonomy]   — defaults to the shipped TAXONOMY
 * @returns {{prefilled, vocabSuggestions, taxonomyHints}}
 */
export function prefilledFormShape({
  canonicalProfile,
  crewVocabulary,
  taxonomy = TAXONOMY,
} = {}) {
  const profileSkills = canonicalProfile?.skills ?? [];
  const vocabSkills   = crewVocabulary?.skills   ?? [];

  const profileByTag = new Map(profileSkills.map((s) => [s.tag, s]));
  const vocabByTag   = new Map(vocabSkills.map((s) => [s.tag, s]));

  // 1) Prefilled — user's canonical skills, each annotated with whether
  //    the crew vocabulary lists this tag.
  const prefilled = profileSkills.map((s) => {
    const v = vocabByTag.get(s.tag);
    return {
      ...s,
      inCrewVocabulary: !!v,
      label:       v?.label ?? null,
      description: v?.description ?? null,
    };
  });

  // 2) Vocab suggestions — crew tags the user hasn't claimed.
  const vocabSuggestions = vocabSkills
    .filter((v) => !profileByTag.has(v.tag))
    .map((v) => ({ ...v }));

  // 3) Taxonomy hints — top-level categories not represented by either.
  const claimedCategoryIds = new Set([
    ...profileSkills.map((s) => s.categoryId).filter(Boolean),
    ...vocabSkills.map((v) => v.categoryId).filter(Boolean),
  ]);
  const taxonomyHints = (taxonomy?.categories ?? [])
    .filter((c) => !claimedCategoryIds.has(c.id))
    .map((c) => ({
      categoryId: c.id,
      label:      c.label?.en ?? c.id,
      hint:       c.hint?.en  ?? '',
    }));

  return { prefilled, vocabSuggestions, taxonomyHints };
}

// ── Skill registration ─────────────────────────────────────────────────────

/**
 * Build the Phase 3 skills the agent registers.
 *
 * Two skills:
 *
 *   - `getMySkillsFormShape({circleId?})` — UI calls this to populate
 *     the edit-skills form. The args.circleId field is optional: when
 *     omitted, the resolved crew's own circleId is used. Returns
 *     `{prefilled, vocabSuggestions, taxonomyHints, canonicalProfile,
 *     crewVocabulary}` for the UI.
 *
 *   - `editMySkillsForCrew({circleId?, skills, persistToCanonicalProfile?})`
 *     — UI calls this on submit. Always writes the per-crew member
 *     projection. If `persistToCanonicalProfile` is true, also writes
 *     the canonical profile (caller must have surfaced the opt-in
 *     checkbox per pod-data-sharing caution principles).
 *
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 * @param {string} [args.canonicalPath]
 * @param {string} [args.crewRoot]          — crew root container override
 * @param {string} [args.postureRoot]
 */
export function buildProfileSkills({
  bundleResolver,
  canonicalPath = CANONICAL_PROFILE_PATH,
  crewRoot,
  postureRoot,
} = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildProfileSkills: bundleResolver(parts, ctx) required');
  }

  return [
    defineSkill('getMySkillsFormShape', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      const circleId = (typeof a.circleId === 'string' && a.circleId) ? a.circleId : crew.circleId;
      if (typeof circleId !== 'string' || !circleId) {
        return { error: 'circleId required' };
      }
      const [canonicalProfile, crewVocabulary] = await Promise.all([
        readCanonicalProfile({ dataSource: crew.dataSource, path: canonicalPath }),
        readCrewVocabulary({ dataSource: crew.dataSource, circleId, rootContainer: crewRoot }),
      ]);
      return {
        canonicalProfile,
        crewVocabulary,
        ...prefilledFormShape({ canonicalProfile, crewVocabulary }),
      };
    }, {
      description: 'Read the prefilled-form shape for editing my skills in a crew.',
    }),

    defineSkill('editMySkillsForCrew', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'circleId required' };
      const a = argsFromParts(parts);
      const webid = from ?? a.webid;
      const circleId = (typeof a.circleId === 'string' && a.circleId) ? a.circleId : crew.circleId;
      if (typeof circleId !== 'string' || !circleId) {
        return { error: 'circleId required' };
      }
      if (!Array.isArray(a.skills)) {
        return { error: 'skills array required' };
      }
      if (typeof webid !== 'string' || !webid) {
        return { error: 'webid required (from envelope or args)' };
      }

      // Always write the per-crew projection.
      const projection = await writeMyCrewSkills({
        dataSource:    crew.dataSource,
        circleId,
        webid,
        skills:        a.skills,
        rootContainer: crewRoot,
      });

      // Optional canonical-profile mirror — opt-in per pod-data-sharing
      // caution principles. Caller surfaces the checkbox.
      let canonicalProfile = null;
      if (a.persistToCanonicalProfile === true) {
        canonicalProfile = await writeCanonicalProfile({
          dataSource: crew.dataSource,
          skills: a.skills,
          path:   canonicalPath,
        });
      }

      return { projection, canonicalProfile };
    }, {
      description: 'Submit my edited skill list for a crew (and optionally mirror to canonical profile).',
    }),
  ];
}

export {
  CANONICAL_PROFILE_PATH,
};

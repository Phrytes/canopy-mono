/**
 * createGroup — state-machine helpers lifted from
 * src/web/wizards/createGroupWizard.js (#231.2d, 2026-05-24).
 *
 * Zero DOM — pure value transforms + policy catalogs + the
 * finalSubmit substrate chain.  The web wizard's render layer
 * keeps the DOM construction (5 steps + success screen);
 * canopy-chat-mobile's RN wizard imports these helpers verbatim.
 */

// 5.5a — Step 3 captures the structured v2 rules doc instead of a
// single free-text field.  The renderers iterate `RULES_QUESTIONS`
// (purpose is handled by Step 1; the rules step shows the other five).
import {
  DEFAULT_RULES_DOC, buildRulesDoc, RULES_FIELDS,
} from '../../v2/circleRules.js';
// 5.5c — Step 4 captures the v2 skill list (the four axes per skill).
// `normalizeSkill` coerces partial rows; `DEFAULT_SKILL` seeds a new row.
import { SKILL_AXES, DEFAULT_SKILL, normalizeSkill } from '../../v2/circleSkills.js';
export { SKILL_AXES };
// β.4 — kind-aware "+ new circle" templates.  Picking a kind in Step 1
// pre-fills the policy axes (features / revealPolicy / pod / llmTool /
// agents / consensusRequired) with the matching template's defaults
// for any axis the user hasn't already overridden.
import { applyTemplate, KRING_KINDS } from '../../v2/kringTemplates.js';
export { KRING_KINDS };

/* ─── Policy catalogs ───────────────────────────────────────── */

export const ACCESS_POLICIES = Object.freeze([
  { id: 'invite-only', label: 'Invite only (admins issue invites)' },
  { id: 'request',     label: 'Request to join (admins approve)' },
  { id: 'open',        label: 'Open (anyone with the buurt id joins)' },
]);

export const LEAVE_POLICIES = Object.freeze([
  { id: 'anyone',       label: 'Anyone can leave at any time' },
  { id: 'notify-first', label: 'Leavers notify the buurt before going' },
]);

export const CONFLICT_POLICIES = Object.freeze([
  { id: 'admin-decides', label: 'Admin decides' },
  { id: 'mediation',     label: 'Mediation by two random members' },
  { id: 'vote',          label: 'Member vote' },
]);

export const STORAGE_POLICIES = Object.freeze([
  { id: 'no-pod',        label: 'No pod (local state only — simplest)' },
  { id: 'decentralised', label: 'Decentralised (per-member pods sync)' },
  { id: 'centralised',   label: 'Centralised (one group pod — needs URI)' },
  { id: 'hybrid',        label: 'Hybrid (per-member + group pod — needs URI)' },
]);

export const KEY_ROTATION_MODES = Object.freeze([
  { id: 'admin-only',         label: 'Admin-only (rotation requires admin action)' },
  { id: 'peer-distributable', label: 'Peer-distributable (any active member can rotate)' },
]);

// 5.5c — Skills is now its own step between Rules and Tech.  Renderers
// drive their step machinery off `STEP_NAMES.length`, so adding here
// promotes Tech→5 and Review→6 without touching the increment logic.
export const STEP_NAMES = Object.freeze(['Identity', 'Governance', 'Rules', 'Skills', 'Tech', 'Review']);

/** A fresh blank skill row for the wizard's "+ Add skill" affordance. */
export function newSkillRow() {
  return { ...DEFAULT_SKILL };
}

/* ─── Helpers ───────────────────────────────────────────────── */

/** Slugify a free-form name into a buurt-id candidate. */
export function slugify(s) {
  return String(s ?? '').toLowerCase().trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

/** Validate a buurt id: lowercase, digits, _ / -; 3-30 chars. */
export function isValidSlug(s) {
  return typeof s === 'string'
    && /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])?$/.test(s);
}

/** Lookup a policy-option label by id, falling back to the id itself. */
export function labelOf(options, id) {
  return options.find((o) => o.id === id)?.label ?? id;
}

/**
 * β.4 — pick a kind and pre-fill policy axes from `kringTemplates`.
 *
 * Returns a new state object (does NOT mutate the input).  The merge
 * preserves every axis the user has already set — picking a kind only
 * fills the gaps.  Switching kinds is therefore essentially a no-op
 * for axes the previous kind already filled (see kringTemplates.js
 * header for the design call).
 *
 * @param {object} state — current wizard state
 * @param {string} kind  — kind picked (household / buurt / vriendenkring / team)
 * @returns {object} new state with `kind` + policy axes filled
 */
export function setKind(state, kind) {
  return applyTemplate(state, kind);
}

/* ─── Initial state ─────────────────────────────────────────── */

export function initialState() {
  return {
    step: 1,                          // 1..5
    // Step 1 — identity & purpose
    name:                  '',
    groupId:               '',
    purpose:               '',
    tags:                  '',
    // β.4 — kind picker.  Set via `setKind(state, kind)` which also
    // pre-fills the policy axes from the matching template.  Unset by
    // default so the wizard renders the picker before any template
    // applies.
    kind:                  null,
    // Step 2 — members & governance
    additionalAdmins:      '',
    accessPolicy:          'invite-only',
    leavePolicy:           'anyone',
    // Step 3 — rules & conflict
    // 5.5a — structured v2 rules doc (purpose syncs from Step 1 at submit).
    rulesDoc:              { ...DEFAULT_RULES_DOC },
    conflictPolicy:        'mediation',
    // Step 4 — skills (5.5c): a list of `{name,openness,posture,status,radius}`
    // rows; rows without a name are dropped at submit.
    skills:                [],
    // Step 4 — tech & storage
    keyRotationMode:       'admin-only',
    rotationDays:          30,
    inviteExpiresInHours:  1,
    storagePolicy:         'no-pod',
    groupPodUri:           '',
    // Submission
    submitting:            false,
    submitError:           null,
    successResult:         null,
  };
}

/* ─── Rules object + submit ────────────────────────────────── */

/**
 * Build the rules object from wizard state.  Shared by finalSubmit
 * (sent to substrate) and the invite-URL encoder (shipped to joiner).
 * Pure function — no side effects, easy to test.
 */
export function buildRulesObjectFromState(state) {
  const additionalAdmins = String(state.additionalAdmins ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const tags = String(state.tags ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  // 5.5a — Step 1's `purpose` is the canonical one-liner; it lives in
  // the rules doc too so joiners see it in the consent screen.
  const doc = buildRulesDoc({ ...state.rulesDoc, purpose: state.purpose });
  const rules = {
    tags:              tags.length > 0 ? tags : undefined,
    additionalAdmins:  additionalAdmins.length > 0 ? additionalAdmins : undefined,
    accessPolicy:      state.accessPolicy,
    leavePolicy:       state.leavePolicy,
    conflictPolicy:    state.conflictPolicy,
  };
  for (const k of RULES_FIELDS) {
    if (doc[k]) rules[k] = doc[k];
  }
  // 5.5c — embed normalised skills (drop unnamed rows) in the rules
  // blob.  createGroupV2 spreads the blob verbatim, so the substrate
  // persists them under the group-rules item without needing its own
  // skills arg (a dedicated substrate slot is a follow-up).
  if (Array.isArray(state.skills) && state.skills.length > 0) {
    const named = state.skills.map(normalizeSkill).filter((s) => s.name.trim() !== '');
    if (named.length > 0) rules.skills = named;
  }
  for (const k of Object.keys(rules)) {
    if (rules[k] === undefined) delete rules[k];
  }
  return rules;
}

/**
 * Encode the substrate's `{groupId, code, expiresAt, adminNkn?, rules?}`
 * result into a `stoop-invite://<base64url-of-JSON>` URL the joiner
 * can paste into `/join-group`.  Lifted from web/createGroupWizard.js
 * 2026-05-27 so the mobile success-screen can reuse it.
 *
 * @param {{ groupId: string, code: string, expiresAt?: number, adminNkn?: string, rules?: object }} result
 * @returns {string}
 */
export function encodeMembershipCodeUrl(result) {
  const payload = {
    kind:      'membershipCode',
    groupId:   result.groupId,
    code:      result.code,
    expiresAt: result.expiresAt,
    ...(result.adminNkn ? { adminNkn: result.adminNkn } : {}),
    ...(result.rules    ? { rules:    result.rules    } : {}),
  };
  const json = JSON.stringify(payload);
  if (typeof globalThis.btoa !== 'function') return `stoop-invite://${json}`;
  const b64 = globalThis.btoa(json)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `stoop-invite://${b64}`;
}

/**
 * Final submission: build the `rules` blob from collected fields +
 * call createGroupV2.  Mutates state.submitting / state.submitError
 * / state.successResult.  Returns `{result?, state}`.
 *
 * On success: caller can post-process the result (the original web
 * wizard adds adminNkn + rules into the result before stashing as
 * successResult; mobile may do the same in its own wrapper).
 */
export async function finalSubmit({ state, callSkill }) {
  state.submitting  = true;
  state.submitError = null;
  try {
    const rules  = buildRulesObjectFromState(state);
    const result = await callSkill('stoop', 'createGroupV2', {
      groupId:              state.groupId,
      name:                 state.name,
      rules,
      keyRotationMode:      state.keyRotationMode,
      rotationDays:         state.rotationDays,
      inviteExpiresInHours: state.inviteExpiresInHours,
      storagePolicy:        state.storagePolicy,
      ...(state.groupPodUri ? { groupPodUri: state.groupPodUri } : {}),
    });
    if (result?.error) throw new Error(result.error);
    return { result, state };
  } catch (err) {
    state.submitError = err?.message ?? String(err);
    state.submitting  = false;
    return { state };
  }
}

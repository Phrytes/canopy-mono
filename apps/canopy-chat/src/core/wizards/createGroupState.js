/**
 * createGroup — state-machine helpers lifted from
 * src/web/wizards/createGroupWizard.js (#231.2d, 2026-05-24).
 *
 * Zero DOM — pure value transforms + policy catalogs + the
 * finalSubmit substrate chain.  The web wizard's render layer
 * keeps the DOM construction (5 steps + success screen);
 * canopy-chat-mobile's RN wizard imports these helpers verbatim.
 */

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

export const STEP_NAMES = Object.freeze(['Identity', 'Governance', 'Rules', 'Tech', 'Review']);

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

/* ─── Initial state ─────────────────────────────────────────── */

export function initialState() {
  return {
    step: 1,                          // 1..5
    // Step 1 — identity & purpose
    name:                  '',
    groupId:               '',
    purpose:               '',
    tags:                  '',
    // Step 2 — members & governance
    additionalAdmins:      '',
    accessPolicy:          'invite-only',
    leavePolicy:           'anyone',
    // Step 3 — rules & conflict
    rulesText:             '',
    conflictPolicy:        'mediation',
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
  const rules = {
    purpose:           state.purpose || undefined,
    tags:              tags.length > 0 ? tags : undefined,
    additionalAdmins:  additionalAdmins.length > 0 ? additionalAdmins : undefined,
    accessPolicy:      state.accessPolicy,
    leavePolicy:       state.leavePolicy,
    rulesText:         state.rulesText || undefined,
    conflictPolicy:    state.conflictPolicy,
  };
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

/**
 * joinGroup — state-machine helpers lifted from
 * src/web/wizards/joinGroupWizard.js (#231.2c, 2026-05-24).
 *
 * Zero DOM — pure parsing + validation + a multi-step substrate
 * chain.  The web wizard's render layer keeps the DOM construction;
 * canopy-chat-mobile's RN wizard can import these helpers verbatim.
 *
 * `globalThis.atob` is used in decodeInvite for base64 decoding —
 * present on both browser AND Hermes (RN), so this stays portable
 * without an explicit polyfill check.
 */

/* ─── Locale strings ────────────────────────────────────────── */

/**
 * Privacy notice text shown in step 2.  Bilingual constant; the
 * caller passes `lang: 'nl' | 'en'` (defaults to 'en') to pick.
 * Future #213 sweep moves these into the locale JSON; for now they
 * live here for surface-parity with the original web wizard.
 */
export const PRIVACY_NOTICE = Object.freeze({
  nl: `Lid worden van een buurt betekent dat andere
leden je posts kunnen zien, je kunnen aanspreken en — afhankelijk van
groepsregels — kunnen oordelen over conflicten. Buurt-admins hebben
geen toegang tot je privé-chats, alleen tot wat je publiek post.`,
  en: `Joining a buurt means other members can see
your posts, contact you, and — depending on group rules — weigh in on
conflicts. Buurt admins have no access to your private chats, only to
what you post publicly.`,
});

export function privacyNoticeFor(lang) {
  return PRIVACY_NOTICE[lang] ?? PRIVACY_NOTICE.en;
}

/* ─── Handle helpers ───────────────────────────────────────── */

/**
 * Suggest 3 handle candidates based on the user's existing display
 * name.  Used to populate clickable chips below the handle input.
 */
export function handleSuggestions(existingDisplayName) {
  const base = String(existingDisplayName ?? 'me').toLowerCase().replace(/[^a-z0-9]/g, '-');
  return [
    base,
    `${base}-${Math.floor(Math.random() * 90 + 10)}`,
    `${base}.${new Date().getFullYear()}`,
  ];
}

/** Validate a buurt handle: lowercase, digits, _ / -; 3-30 chars. */
export function isValidHandle(handle) {
  return typeof handle === 'string'
    && /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])?$/.test(handle);
}

/* ─── Invite decoding ───────────────────────────────────────── */

/**
 * Decode an invite arg (URL form OR pre-decoded object) and write
 * the result into `state.invite` / `state.inviteParseError`.
 *
 * Supports three URL forms (slash-arg parsers sometimes mangle "://"):
 *   - `stoop-invite://<base64url>`  (canonical)
 *   - `stoop-invite:<base64url>`
 *   - `stoop-invite/<base64url>`
 *
 * And accepts a JSON-encoded invite directly (starts with `{`).
 *
 * Mutates state in place; no return value.
 */
export function decodeInvite(invite, state) {
  if (!invite) {
    state.inviteParseError = 'No invite supplied — type /join-group <invite-url>.';
    return;
  }
  if (typeof invite === 'object') {
    state.invite = invite;
    return;
  }
  const PREFIX = 'stoop-invite://';
  let str = String(invite).trim();
  if (str.startsWith(PREFIX)) {
    str = str.slice(PREFIX.length);
  } else if (str.startsWith('stoop-invite:')) {
    str = str.replace(/^stoop-invite:[/]*/i, '');
  } else if (str.startsWith('stoop-invite/')) {
    str = str.replace(/^stoop-invite[/]+/i, '');
  }
  try {
    if (str.startsWith('{')) {
      state.invite = JSON.parse(str);
      return;
    }
    const padded = str.replace(/-/g, '+').replace(/_/g, '/')
                       + '=='.slice(0, (4 - str.length % 4) % 4);
    if (typeof globalThis.atob !== 'function') {
      throw new Error('no base64 decoder available (browser/RN only)');
    }
    const bin = globalThis.atob(padded);
    try {
      state.invite = JSON.parse(bin);
    } catch {
      const snippet = bin.slice(0, 50).replace(/[^\x20-\x7e]/g, '·');
      throw new Error(`base64 decoded to non-JSON: "${snippet}…" — likely the URL was corrupted in transit (paste mangled?).  Try copy-pasting the full URL again.`);
    }
  } catch (err) {
    state.inviteParseError = `Bad invite: ${err.message ?? err}`;
  }
}

/* ─── Rules text ────────────────────────────────────────────── */

/**
 * 5.5b — extract a v2 structured rules doc from an embedded rules
 * blob, OR null when the blob carries no structured fields (older
 * invites that only set `rulesText`).  When non-null, the renderer
 * surfaces the doc as per-section answers (board 3C); when null, it
 * falls back to `state.rulesText` (the summary).
 */
export function extractRulesDoc(rules) {
  if (!rules || typeof rules !== 'object') return null;
  const docFields = ['purpose', 'admins', 'agreements', 'conflict', 'admission', 'leaving', 'responsibility'];
  const hit = docFields.some(
    (k) => typeof rules[k] === 'string' && rules[k].trim() !== '',
  );
  if (!hit) return null;
  const out = {};
  for (const k of docFields) out[k] = typeof rules[k] === 'string' ? rules[k] : '';
  return out;
}

/**
 * Format a rules object as readable text — same layout the
 * getGroupRules adapter uses.  Pure transform; keeps the joiner's
 * pre-join display consistent with what /group-rules shows post-join.
 */
export function summariseEmbeddedRules(r) {
  if (r?.rulesText && String(r.rulesText).trim()) return String(r.rulesText);
  const parts = [];
  if (r?.purpose)        parts.push(`Purpose: ${r.purpose}`);
  if (r?.accessPolicy)   parts.push(`Access: ${r.accessPolicy}`);
  if (r?.leavePolicy)    parts.push(`Leave: ${r.leavePolicy}`);
  if (r?.conflictPolicy) parts.push(`Conflict resolution: ${r.conflictPolicy}`);
  if (Array.isArray(r?.tags) && r.tags.length)
    parts.push(`Tags: ${r.tags.join(', ')}`);
  if (Array.isArray(r?.additionalAdmins) && r.additionalAdmins.length)
    parts.push(`Extra admins: ${r.additionalAdmins.join(', ')}`);
  return parts.length > 0
    ? parts.join('\n')
    : '(no rules set; defaults apply)';
}

/**
 * Fetch the group rules — embedded in the invite first, then fall
 * back to the substrate getGroupRules.  Mutates state.rulesText
 * (or state.rulesError on failure); returns the mutated state.
 */
export async function fetchGroupRules({ state, callSkill }) {
  const embedded = state.invite?.rules;
  if (embedded && typeof embedded === 'object') {
    // 5.5b — surface the v2 structured doc when the invite carries it.
    state.rulesDoc  = extractRulesDoc(embedded);
    state.rulesText = summariseEmbeddedRules(embedded);
    return state;
  }
  try {
    const reply = await callSkill('stoop', 'getGroupRules', { groupId: state.invite.groupId });
    state.rulesDoc  = extractRulesDoc(reply?.rules ?? reply ?? null);
    state.rulesText = reply?.rules ?? reply?.message ?? '(no rules set for this group)';
  } catch (err) {
    state.rulesError = err?.message ?? String(err);
  }
  return state;
}

/* ─── Initial state + final-submit chain ───────────────────── */

export function initialState() {
  return {
    step:             1,            // 1..3
    invite:           null,         // decoded invite object
    inviteParseError: null,
    rulesText:        null,
    rulesDoc:         null,      // 5.5b — structured v2 doc; null → fallback to rulesText
    rulesError:       null,
    rulesAccepted:    false,
    privacyAccepted:  false,
    shareAddress:     true,         // mesh-consent default ON (Slice 4)
    handle:           '',
    submitting:       false,
    submitError:      null,
  };
}

/**
 * Final submission chain.  Two paths depending on invite.kind.
 * Mutates state.submitting / state.submitError.  Returns
 * `{result?, state}` so the caller can react to success.
 *
 * Path A — kind:'membershipCode': setMyHandle → redeemMembershipCode
 *   → (on invalid-or-expired-code) sendPeerRedeem fallback →
 *   recordRemoteRedemption mirror.
 *
 * Path B — legacy GroupManager invite: redeemInviteWithGate →
 *   setMyHandle → redeemInvite.
 */
export async function finalSubmit({ state, callSkill, sendPeerRedeem }) {
  state.submitting  = true;
  state.submitError = null;
  try {
    const result = await runFinalSubmitChain(state, callSkill, sendPeerRedeem);
    state.submitting = false;
    return { result, state };
  } catch (err) {
    state.submitError = err?.message ?? String(err);
    state.submitting  = false;
    return { state };
  }
}

async function runFinalSubmitChain(state, callSkill, sendPeerRedeem) {
  const inv = state.invite;

  if (inv?.kind === 'membershipCode' && inv.code && inv.groupId) {
    // Path A — membershipCode.
    const handle = await callSkill('stoop', 'setMyHandle', { handle: state.handle });
    if (handle?.ok === false || handle?.error) {
      throw new Error(handle.error ?? "Couldn't set handle.");
    }
    const redeem = await callSkill('stoop', 'redeemMembershipCode', {
      groupId: inv.groupId, code: inv.code,
    });
    // Cross-instance fallback.
    if (redeem?.error === 'invalid-or-expired-code' && inv.adminNkn && typeof sendPeerRedeem === 'function') {
      const peerReply = await sendPeerRedeem({
        adminNkn:    inv.adminNkn,
        groupId:     inv.groupId,
        code:        inv.code,
        shareCard:   !!state.shareAddress,
        peerDisplay: state.handle,
      });
      if (!peerReply || peerReply.error) {
        throw new Error(peerReply?.error
          ?? "Admin's substrate did not confirm the code. They may be offline — try again, or ask for a fresh code.");
      }
      await callSkill('stoop', 'recordRemoteRedemption', {
        groupId:     inv.groupId,
        code:        inv.code,
        codeId:      peerReply.codeId ?? null,
        expiresAt:   peerReply.validUntil ?? null,
        confirmedBy: inv.adminNkn,
        ...(inv.rules && typeof inv.rules === 'object' ? { rules: inv.rules } : {}),
      });
      return {
        ok:      true,
        message: `✓ Joined buurt "${inv.groupId}" as ${state.handle} (confirmed by admin over peer-bridge).`,
        groupId: inv.groupId,
        handle:  state.handle,
      };
    }
    if (redeem?.ok === false || redeem?.error) {
      throw new Error(redeem.error ?? "Couldn't redeem code.");
    }
    return {
      ok:      true,
      message: `✓ Joined buurt "${inv.groupId}" as ${state.handle}.`,
      groupId: inv.groupId,
      handle:  state.handle,
    };
  }

  // Path B — legacy GroupManager invite.
  const gate = await callSkill('stoop', 'redeemInviteWithGate', {
    invite:          inv,
    privacyAccepted: state.privacyAccepted,
    rulesAccepted:   state.rulesAccepted,
  });
  if (gate?.ok === false || gate?.error) {
    throw new Error(gate.error ?? 'Gate refused the redeem.');
  }
  const handle = await callSkill('stoop', 'setMyHandle', { handle: state.handle });
  if (handle?.ok === false || handle?.error) {
    throw new Error(handle.error ?? "Couldn't set handle.");
  }
  const redeem = await callSkill('stoop', 'redeemInvite', { invite: inv });
  if (redeem?.ok === false || redeem?.error) {
    throw new Error(redeem.error ?? "Couldn't redeem invite.");
  }
  return {
    ok:      true,
    message: `✓ Joined buurt "${inv.groupId}" as ${state.handle}.`,
    groupId: inv.groupId,
    handle:  state.handle,
  };
}

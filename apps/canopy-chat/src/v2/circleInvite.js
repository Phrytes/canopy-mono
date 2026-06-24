/**
 * canopy-chat v2 — circle invite/join glue (OBJ-2 membership, no-pod).
 *
 * v2 builds ON the classic shell: this module is THIN glue over the already-shared
 * membership core (`src/core/wizards/*State.js`) + stoop skills, so web and mobile
 * surface the SAME two operations without re-implementing any logic:
 *
 *   - buildCircleInviteUri  — an admin reads the circle's current membership code
 *     (`stoop.getCurrentMembershipCode`), stamps its peer address, and encodes a
 *     `stoop-invite://…` URI (the QR payload) via the classic `encodeMembershipCodeUrl`.
 *   - joinCircleFromInvite  — a joiner decodes a scanned/pasted invite and runs the
 *     classic `finalSubmit` chain (local redeem → peer-bridge fallback). No pod.
 *
 * `callSkill` here is the RAW 3-arg form `(appOrigin, opId, args)` — the same the
 * classic wizards use. `sendPeerRedeem` is the host's joiner-side peer-redeem sender
 * (request/response correlated by the shell); pass it through unchanged.
 */

import { encodeMembershipCodeUrl } from '../core/wizards/createGroupState.js';
import { initialState, decodeInvite, finalSubmit } from '../core/wizards/joinGroupState.js';

/**
 * Build a `stoop-invite://` URI for an EXISTING circle so the admin can show it as a QR.
 * Admin-gated by the substrate (getCurrentMembershipCode returns {error:'admin-only'} otherwise).
 *
 * @param {{ callSkill:Function, circleId:string, adminPeerAddr?:string|null }} a
 * @returns {Promise<{uri:string, expiresAt?:number} | {error:string}>}
 */
export async function buildCircleInviteUri({ callSkill, circleId, adminPeerAddr = null } = {}) {
  if (typeof callSkill !== 'function' || !circleId) return { error: 'missing-args' };
  let res;
  try { res = await callSkill('stoop', 'getCurrentMembershipCode', { groupId: circleId }); }
  catch (err) { res = { error: err?.message || 'code-fetch-failed' }; }
  let code = res?.code;
  let expiresAt = res?.expiresAt;
  if (!code) {
    // A non-'no-code' error (e.g. admin-only) is terminal — don't try to mint. Otherwise there's simply
    // no ACTIVE code (expired, or the circle predates code-minting) → mint a fresh one (admin-gated;
    // surfaces 'admin-only' itself if the caller can't). So an invite always works for an admin.
    if (res?.error && res.error !== 'no-code') return { error: res.error };
    let rot;
    try { rot = await callSkill('stoop', 'rotateMyGroupCode', { groupId: circleId }); }
    catch (err) { rot = { error: err?.message || 'rotate-failed' }; }
    if (!rot?.code) return { error: rot?.error || 'no-code' };
    code = rot.code; expiresAt = rot.expiresAt;
  }
  const invite = { groupId: circleId, code, expiresAt, ...(adminPeerAddr ? { adminPeerAddr } : {}) };
  return { uri: encodeMembershipCodeUrl(invite), expiresAt };
}

/**
 * Join a circle from a scanned/pasted invite URI, reusing the classic no-pod join chain.
 *
 * @param {{ inviteUri:(string|object), callSkill:Function, sendPeerRedeem?:Function,
 *           handle:string, shareAddress?:boolean }} a
 * @returns {Promise<{ ok:true, circleId:string, message?:string, handle?:string } | { error:string }>}
 */
export async function joinCircleFromInvite({ inviteUri, callSkill, sendPeerRedeem, handle, shareAddress = true } = {}) {
  const h = String(handle ?? '').trim();
  if (!h) return { error: 'handle-required' };
  const state = initialState();
  decodeInvite(inviteUri, state);
  if (state.inviteParseError) return { error: state.inviteParseError };
  if (!state.invite || !state.invite.groupId) return { error: 'bad-invite' };
  state.handle = h;
  state.shareAddress = shareAddress !== false;
  const { result, state: out } = await finalSubmit({ state, callSkill, sendPeerRedeem });
  if (!result) return { error: out?.submitError || 'join-failed' };
  return { ok: true, circleId: result.groupId, message: result.message, handle: result.handle };
}

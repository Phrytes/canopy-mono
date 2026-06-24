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
  catch (err) { return { error: err?.message || 'code-fetch-failed' }; }
  if (!res || res.error || !res.code) return { error: res?.error || 'no-code' };
  const invite = {
    groupId:   circleId,
    code:      res.code,
    expiresAt: res.expiresAt,
    ...(adminPeerAddr ? { adminPeerAddr } : {}),
  };
  return { uri: encodeMembershipCodeUrl(invite), expiresAt: res.expiresAt };
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

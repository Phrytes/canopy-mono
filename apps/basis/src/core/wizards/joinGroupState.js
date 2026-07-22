/**
 * joinGroup — state-machine helpers lifted from
 * src/web/wizards/joinGroupWizard.js (2026-05-24).
 *
 * Zero DOM — pure parsing + validation + a multi-step substrate
 * chain.  The web wizard's render layer keeps the DOM construction;
 * basis-mobile's RN wizard can import these helpers verbatim.
 *
 * `globalThis.atob` is used in decodeInvite for base64 decoding —
 * present on both browser AND Hermes (RN), so this stays portable
 * without an explicit polyfill check.
 */

import { normalizeDriverKind } from '@onderling/agent-registry';

import { buildJoinConsentModel, optOutsFromDeclined } from '../../v2/circleConsent.js';

/* ─── Locale strings ────────────────────────────────────────── */

/**
 * Privacy notice text shown in step 2.  Bilingual constant; the
 * caller passes `lang: 'nl' | 'en'` (defaults to 'en') to pick.
 * Future sweep moves these into the locale JSON; for now they
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

/* ─── Peer-address population from an invite ─────────────────── */

/**
 * Populate an app-owned PeerGraph with the ADMIN's per-transport wire
 * addresses carried in a decoded invite, so the secure router's
 * `addressesOf(adminPubKey)` resolves the transport-appropriate address for
 * the redeem handshake — the relay address (the Ed25519 pubKey) AND the NKN
 * native address — instead of the send path degrading to the bare pubKey (a
 * string NKN can't route). Call after `decodeInvite`, BEFORE the peer redeem
 * send, so `route → addressFor` picks the relay tier and addresses it right.
 *
 * The invite carries `adminPeerAddr` (the pubKey = relay wire address) and,
 * when the admin had NKN up at invite time, `adminNknAddr` (the native
 * address). The PeerGraph is keyed by `pubKey`, so the admin's canonical id
 * here is `adminPeerAddr`; `transports` shallow-merges on upsert and
 * `addressesOf` reads a string value directly, so we store the flat shape
 * `{ relay: <pubKey>, nkn: <native> }` (nkn omitted for a relay-only admin).
 *
 * Additive + best-effort: no invite / no adminPeerAddr / no graph → no-op
 * (returns null); never throws into the join flow.
 *
 * @param {{ peerGraph:{upsert:Function}, invite:object }} a
 * @returns {Promise<object|null>} the merged peer record, or null when skipped
 */
export async function populateAdminAddressesFromInvite({ peerGraph, invite } = {}) {
  const adminPeerAddr = invite?.adminPeerAddr;
  if (!adminPeerAddr || !peerGraph || typeof peerGraph.upsert !== 'function') return null;
  const transports = { relay: adminPeerAddr };
  if (invite?.adminNknAddr) transports.nkn = invite.adminNknAddr;
  try {
    return await peerGraph.upsert({ pubKey: adminPeerAddr, transports });
  } catch {
    return null;   // population must never block the join
  }
}

/* ─── Rules text ────────────────────────────────────────────── */

/**
 * 5.5b — extract a v2 structured rules doc from an embedded rules
 * blob, OR null when the blob carries no structured fields (older
 * invites that only set `rulesText`).  When non-null, the renderer
 * surfaces the doc as per-section answers; when null, it
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

/* ─── Consent-at-join (B) ─────────────────────────── */

/**
 * build the join-time capability CONSENT MODEL from the invite's embedded freedom
 * template (`invite.capabilities` + `invite.apps`) and the host-injected manifest `sources`. Sets
 * `state.consentModel` (the opt-outable caps the joiner reviews) and resets `state.capabilityOptOuts`
 * to whatever the model already records. Pure — the shared model both web + RN wizards render.
 *
 * Additive: with no embedded template OR no sources, the model is empty and the consent step is a
 * no-op (a joiner who opts out of nothing behaves exactly as before).
 *
 * @param {{state:object, sources?:Array<{manifest:object}>}} a
 * @returns {object} the mutated state
 */
export function buildJoinConsent({ state, sources } = {}) {
  const inv = state?.invite;
  const template = (inv?.capabilities && typeof inv.capabilities === 'object' && !Array.isArray(inv.capabilities))
    ? inv.capabilities : {};
  // Consent-at-join surfaces the admin's PER-CAP freedom choices. With no authored template there is
  // nothing template-driven to review — stay a no-op (an un-configured circle is default-on today).
  if (Object.keys(template).length === 0) {
    state.consentModel = { items: [], keys: [] };
    state.capabilityOptOuts = [];
    return state;
  }
  const policy = { apps: Array.isArray(inv?.apps) ? inv.apps : null, capabilities: template };
  state.consentModel = buildJoinConsentModel(Array.isArray(sources) ? sources : [], policy, {
    optOuts: state.capabilityOptOuts,
  });
  // Keep only still-valid opt-outs (a template change could have made a previously-declined cap mandatory).
  state.capabilityOptOuts = optOutsFromDeclined(state.consentModel, state.capabilityOptOuts);
  return state;
}

/**
 * record/clear the joiner's decision for one capability. `declined === true` opts out
 * (adds the key); `false` opts back in (removes it). Only opt-outable keys in the consent model survive
 * (`optOutsFromDeclined` drops anything mandatory/unknown), so a mandatory cap can never be declined.
 */
export function setConsentDecline(state, key, declined) {
  const cur = new Set(Array.isArray(state?.capabilityOptOuts) ? state.capabilityOptOuts : []);
  if (declined) cur.add(key); else cur.delete(key);
  state.capabilityOptOuts = optOutsFromDeclined(state.consentModel, [...cur]);
  return state;
}

/* ─── Persona selection (property layer · join-with-persona) ── */

/**
 * Load the user's personas for the join picker — the registry profiles
 * (`role: 'profile'`, incl. the always-present `default`). Pure read; on any
 * failure returns `[]` so the picker simply offers nothing (join minimally).
 * The shape is `[{ id, name }]`, freshest curation surfaced by the agents skill.
 *
 * @param {{callSkill:Function}} a
 * @returns {Promise<Array<{id:string,name:string}>>}
 */
export async function loadPersonas({ callSkill } = {}) {
  try {
    const reply = await callSkill('agents', 'listAgents', {});
    const rows = Array.isArray(reply?.agents) ? reply.agents : [];
    return rows
      .filter((a) => a && a.role === 'profile')
      .map((a) => ({ id: a.agentId, name: a.name || a.agentId }));
  } catch {
    return [];
  }
}

/**
 * Record the joiner's persona choice. `null` (the protective default) means
 * "join minimally — disclose no background"; a profile id means "join AS this
 * persona, sharing what it discloses in THIS circle" (finalSubmit computes the
 * release). Only the identity part; the disclosure itself stays default-withhold.
 */
export function setPersona(state, personaId) {
  state.persona = (typeof personaId === 'string' && personaId.length) ? personaId : null;
  return state;
}

/* ─── Charter-driven skill-sharing default (fold-in phase C) ──── */

/**
 * Skills→property fold-in phase C (NOTE-skills-properties-audit, "charter-driven
 * default"). When the joined circle is ABOUT skills-matching — signalled by
 * `invite.offeringsMatching: true`, embedded at invite-build from the circle's board-8
 * skill record (`offeringsMatchingEnabled`, @onderling/kring-host/circleOfferings) — the
 * disclosure default for the persona's skill keys flips from withhold to enabled at
 * the COARSE rung `'category'` (only the taxonomy category is released, never the
 * text/tags). NEVER silent: the wizard renders this as a visible pre-checked line
 * the joiner can uncheck. Circles without the signal (incl. all older invites)
 * keep the protective default-withhold.
 *
 * Call after decodeInvite; mutates + returns state.
 */
export function applyCharterOfferingsDefault(state) {
  // Read-accept: new invites carry `offeringsMatching`; older invites embed
  // the legacy `skillsMatching` field. Both mean the same charter signal.
  const on = state?.invite?.offeringsMatching === true
          || state?.invite?.skillsMatching   === true;
  state.offeringsMatching = on;
  state.shareOfferingsAtJoin = on;
  return state;
}

/** Record the joiner's (un)check of the pre-checked skill-sharing line. */
export function setShareOfferingsAtJoin(state, on) {
  state.shareOfferingsAtJoin = on === true;
  return state;
}

/** The coarse rung the join-time default discloses offerings at (OFFERING_LADDER's coarsest). */
export const OFFERINGS_JOIN_RUNG = 'category';

/**
 * Enact the accepted skill-sharing default for `contextId` (the joined circle):
 * enable disclosure at the coarse `'category'` rung for every skill-kind driver
 * key on the effective persona (the chosen one, else `'default'` — the charter
 * default must also work for a first-join user who never made personas). No-op
 * unless `state.shareOfferingsAtJoin` is true. Best-effort per key; returns the
 * keys enabled so finalSubmit can fold them into the join release.
 *
 * @param {{state:object, callSkill:Function, contextId:string}} a
 * @returns {Promise<string[]>} the enabled skill keys
 */
export async function applyOfferingsDisclosureAtJoin({ state, callSkill, contextId } = {}) {
  if (state?.shareOfferingsAtJoin !== true || typeof callSkill !== 'function' || !contextId) return [];
  const personaId = state.persona ?? 'default';
  let drivers = {};
  try { drivers = (await callSkill('agents', 'getProfileDrivers', { id: personaId }))?.drivers ?? {}; }
  catch { return []; }
  const keys = Object.entries(drivers)
    // offering-kind drivers (legacy `skill` kind read-accepted / normalized)
    .filter(([, v]) => normalizeDriverKind(v?.kind) === 'offering')
    .map(([k]) => k);
  const enabled = [];
  for (const key of keys) {
    try {
      const r = await callSkill('agents', 'setProfileDisclosure', {
        id: personaId, contextId, key, enabled: true, rung: OFFERINGS_JOIN_RUNG,
      });
      if (r?.ok !== false) enabled.push(key);
    } catch { /* best-effort — one failed key must not block the join */ }
  }
  return enabled;
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
    shareAddress:     true,         // mesh-consent default ON
    // the join-time capability consent (opt-outable caps + this joiner's declines).
    consentModel:     { items: [], keys: [] },
    capabilityOptOuts: [],
    handle:           '',
    // Property layer — join-with-persona. `null` = join minimally (disclose no
    // background); a profile id = join AS that persona (its per-circle disclosure
    // applies). `personas` is the picker's option list, lazily loaded. Protective
    // default: null (first join discloses nothing regardless — this is the label).
    persona:          null,
    personas:         [],
    // Fold-in phase C — charter-driven skill-sharing default. `offeringsMatching`
    // mirrors the invite's embedded circle signal; `shareOfferingsAtJoin` is the
    // joiner's decision on the visible pre-checked line (applyCharterOfferingsDefault
    // pre-checks it ONLY for a matching circle; otherwise both stay false =
    // default-withhold).
    offeringsMatching:    false,
    shareOfferingsAtJoin: false,
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
    // carry the joiner's declined caps out with the success envelope so the host records
    // them into the member's prefs (`override.capabilityOptOuts`), feeding the gate's admin ∩ user set.
    if (result && Array.isArray(state.capabilityOptOuts) && state.capabilityOptOuts.length) {
      result.capabilityOptOuts = [...state.capabilityOptOuts];
    }
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
    // Fold-in phase C — enact the ACCEPTED charter-driven skill-sharing default BEFORE the
    // release is computed, so the coarse (category-rung) skill keys ride the same join release.
    // The effective persona falls back to 'default' when joining minimally: the accepted skills
    // default must still work for a joiner who never made personas (setShareOfferingsAtJoin(false)
    // — unchecking the visible line — keeps everything withheld, exactly as before).
    await applyOfferingsDisclosureAtJoin({ state, callSkill, contextId: inv.groupId });
    // Property layer — join AS a chosen persona: release what that persona discloses in THIS circle
    // (getPersonaRelease) and carry it so the roster records it. No persona / nothing disclosed → absent (withhold).
    let personaProperties;
    const releasePersona = state.persona ?? (state.shareOfferingsAtJoin === true ? 'default' : null);
    if (releasePersona) {
      try { personaProperties = (await callSkill('agents', 'getPersonaRelease', { id: releasePersona, contextId: inv.groupId }))?.released; }
      catch { personaProperties = undefined; }
    }
    const personaArg = (personaProperties && Object.keys(personaProperties).length) ? { personaProperties } : {};
    const redeem = await callSkill('stoop', 'redeemMembershipCode', {
      groupId: inv.groupId, code: inv.code, ...personaArg,
    });
    // Cross-instance fallback.
    if (redeem?.error === 'invalid-or-expired-code' && inv.adminPeerAddr && typeof sendPeerRedeem === 'function') {
      const peerReply = await sendPeerRedeem({
        adminPeerAddr:    inv.adminPeerAddr,
        groupId:     inv.groupId,
        code:        inv.code,
        shareCard:   !!state.shareAddress,
        peerDisplay: state.handle,
        ...personaArg,
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
        confirmedBy: inv.adminPeerAddr,
        ...(inv.rules && typeof inv.rules === 'object' ? { rules: inv.rules } : {}),
      });
      return {
        ok:      true,
        message: `✓ Joined circle "${inv.groupId}" as ${state.handle} (confirmed by admin over peer-bridge).`,
        groupId: inv.groupId,
        handle:  state.handle,
      };
    }
    if (redeem?.ok === false || redeem?.error) {
      throw new Error(redeem.error ?? "Couldn't redeem code.");
    }
    return {
      ok:      true,
      message: `✓ Joined circle "${inv.groupId}" as ${state.handle}.`,
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
    message: `✓ Joined circle "${inv.groupId}" as ${state.handle}.`,
    groupId: inv.groupId,
    handle:  state.handle,
  };
}

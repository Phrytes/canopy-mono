// groupKeyResource.js — versioned group-key distribution for a shared (household) pod.
//
// A key resource carries the CURRENT group key (for one version) sealed to every current member in a single
// recipient-mode envelope — the multi-recipient envelope IS the distribution. It lives on the pod
// (e.g. `/.keys/group-vN.json`), so offline members learn keys by READING the pod (reconnect → read →
// unwrap with the local private key). No out-of-band push.
//
//   • grant (join)  = re-seal the SAME group key to +1 member, same version — O(1), the new member can
//                     read all content under this version. (Or rotate, if forward-join secrecy is wanted.)
//   • revoke (leave) = rotate to a NEW group key + a new version, sealed to the REMAINING members. Forward
//                     secrecy: the departed keep cached old-version ciphertext but can't read new content.
//
// ── HISTORIC-KEY RETENTION (Phase 3) ────────────────────────────────────────────────────────────────────
// On rotate we do NOT discard the outgoing version: it is APPENDED to a `history` array, each entry being
// THAT version's group key still wrapped to THAT version's recipient set. This lets a CURRENT recipient open
// content that was sealed under an OLDER key version (before a rotation they lived through) — WITHOUT
// weakening forward secrecy:
//   • Each version's envelope defines exactly who can unwrap that version's key = who was a recipient AT that
//     version. A recipient revoked at the V→V+1 rotation is ABSENT from V+1's envelope (current `sealed`) and
//     from every later one, so they cannot unwrap the V+1 key and cannot read content sealed under it. Retaining
//     V's envelope gives them only V's key — for V's (pre-revocation) content, which they were already entitled
//     to and could already open. Forward secrecy = "no access to content sealed AFTER revocation" is intact.
//   • Content is NOT tagged with its key version (see `sealWithGroupKey` — a group-key envelope is
//     `{v:2, gk:1, body}` with no version field). Version resolution is therefore by AUTHENTICATED TRIAL:
//     XSalsa20-Poly1305 (secretbox) is authenticated, so a wrong-version key throws on open and never yields a
//     false plaintext. `openSealedAcrossVersions` tries the reader's unwrappable versions newest-first; content
//     sealed under vN opens with the vN key and is rejected by every other version's key. This is deterministic
//     and correct; an explicit version tag would only save the O(versions) trial (see report / flagged option).
//
// Pure (no pod I/O): the control-agent (key-holder) reads/writes the resource; it owns the member roster
// (public keys), since the envelope stores only recipientIds, not the keys.

import { seal, open, generateGroupKey, isSealed, openWithGroupKey } from './envelope.js';

/** Build the key resource for `version`: the group key sealed to every current member's public key.
 *  `history` (optional) carries retained prior versions forward untouched — set only by grant/rotate. */
export function buildGroupKeyResource({ version = 1, groupKey, recipients, history } = {}) {
  const pubs = [...new Set((Array.isArray(recipients) ? recipients : [recipients]).filter(Boolean))];
  if (pubs.length === 0) throw new Error('buildGroupKeyResource: at least one recipient public key required');
  if (!groupKey) throw new Error('buildGroupKeyResource: groupKey required');
  const res = { v: 1, version, members: pubs.length, sealed: seal(groupKey, pubs) };
  if (Array.isArray(history) && history.length) res.history = history;
  return res;
}

/** Unwrap the CURRENT-version group key from a resource with a member's private key. Throws if the caller is
 *  not a recipient of the current version. (For an older version use `unwrapGroupKeyVersion`.) */
export function unwrapGroupKey(resource, privateKey) {
  if (!resource || typeof resource.sealed !== 'string') throw new Error('unwrapGroupKey: invalid key resource');
  return open(resource.sealed, privateKey);
}

/** The current version's envelope + every retained historic one, as `{version, sealed}`, newest-first. */
function versionEnvelopes(resource) {
  if (!resource || typeof resource.sealed !== 'string') return [];
  const hist = Array.isArray(resource.history) ? resource.history : [];
  return [
    { version: resource.version, sealed: resource.sealed },
    ...[...hist].reverse(),
  ];
}

/** Unwrap a SPECIFIC version's group key. Gated on membership of THAT version: `open` throws
 *  'not a recipient' if the caller was not a recipient of the requested version's envelope. `version`
 *  defaults to the current version (identical to `unwrapGroupKey`). Throws if the version isn't retained. */
export function unwrapGroupKeyVersion(resource, privateKey, version) {
  if (!resource || typeof resource.sealed !== 'string') throw new Error('unwrapGroupKeyVersion: invalid key resource');
  if (version == null || version === resource.version) return open(resource.sealed, privateKey);
  const entry = (Array.isArray(resource.history) ? resource.history : []).find((h) => h && h.version === version);
  if (!entry || typeof entry.sealed !== 'string') throw new Error(`unwrapGroupKeyVersion: version ${version} is not retained`);
  return open(entry.sealed, privateKey);   // throws 'not a recipient' if the caller wasn't in this version
}

/** Every group-key version the caller CAN unwrap (current + retained history), as `{version, groupKey}`,
 *  newest-first. A version the caller is NOT a recipient of is silently skipped — so the returned set is
 *  exactly the caller's entitlement (a revoked recipient gets only the pre-revocation versions they held). */
export function readableGroupKeys(resource, privateKey) {
  const out = [];
  for (const env of versionEnvelopes(resource)) {
    try { out.push({ version: env.version, groupKey: open(env.sealed, privateKey) }); }
    catch { /* not a recipient of this version — omit it */ }
  }
  return out;
}

/** Open a group-key-sealed item across retained versions, resolving the version by AUTHENTICATED TRIAL.
 *  Tries the caller's unwrappable keys newest-first; the secretbox auth tag guarantees only the key the
 *  content was sealed under succeeds (any other version throws). Returns plaintext, or throws if no version
 *  the caller holds opens it — which is exactly the forward-secrecy denial for post-revocation content.
 *  Non-sealed text passes through unchanged (mirrors `open`/`openWithGroupKey`). */
export function openSealedAcrossVersions(sealedText, resource, privateKey) {
  if (!isSealed(sealedText)) return sealedText;
  const keys = readableGroupKeys(resource, privateKey);
  if (keys.length === 0) throw new Error('openSealedAcrossVersions: caller holds no group-key version for this resource');
  for (const { groupKey } of keys) {
    try { return openWithGroupKey(sealedText, groupKey); } catch { /* wrong version — try the next */ }
  }
  throw new Error('openSealedAcrossVersions: no retained group-key version the caller holds opens this content');
}

/** grant — add a member to the CURRENT version: a current holder unwraps the group key and re-seals the
 *  SAME key to the expanded roster (same version). `currentRecipients` = the roster's public keys. Retained
 *  history is carried forward UNTOUCHED — a new member gets the current version only, never retroactive
 *  access to historic (pre-join) versions (the conservative "normal new member" default). */
export function grantMember(resource, { newRecipient, granterPrivateKey, currentRecipients }) {
  if (!newRecipient) throw new Error('grantMember: newRecipient public key required');
  const groupKey = unwrapGroupKey(resource, granterPrivateKey);
  const recipients = [...(currentRecipients || []), newRecipient];
  return buildGroupKeyResource({ version: resource.version, groupKey, recipients, history: resource.history });
}

/** revoke / rotate — a NEW group key + version, sealed to the given roster (omit the departed member to
 *  revoke). The OUTGOING version is APPENDED to `history` (retained, still wrapped to its own recipients) so
 *  remaining recipients can still open pre-rotation content; the revoked recipient — absent from the new
 *  version — cannot open content sealed under it (forward secrecy). `previous` supplies the version to
 *  increment AND the history to extend; pass `null` for a fresh v1 (no history). */
export function rotateGroupKeyResource({ previous = null, recipients, groupKey } = {}) {
  const prev = previous && Number.isInteger(previous.version) ? previous.version : 0;
  let history;
  if (previous && typeof previous.sealed === 'string') {
    const prior = Array.isArray(previous.history) ? previous.history : [];
    history = [...prior, { version: previous.version, members: previous.members, sealed: previous.sealed }];
  }
  return buildGroupKeyResource({ version: prev + 1, groupKey: groupKey || generateGroupKey(), recipients, history });
}

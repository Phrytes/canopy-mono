/**
 * qrScanner — payload classifier for QR codes scanned via expo-camera.
 *
 * Stoop V3 Phase 40.6 (2026-05-08).
 *
 * The mobile QR-scan UX needs to recognise three distinct payload
 * shapes so the user lands on the right flow:
 *
 *   1. **Invite QR** — what `/onboard.html?invite=<json>` puts in
 *      its query string. The scanned content is either the full URL
 *      or just the JSON payload.
 *   2. **Contact-share QR** — `stoop-contact://...` URI per
 *      `apps/stoop/src/skills/index.js`'s `getContactShareQr` skill.
 *   3. **Recovery code** — 12 or 24 BIP-39 words, space-separated.
 *
 * `classifyQrPayload(text)` returns
 *   `{ kind, payload }` on success, or `{ kind: 'unknown' }` on no
 *   match. Callers use `kind` to drive the UI hint + the next-step
 *   navigation.
 *
 * Pure JS, no Expo deps; the camera component (Phase 40.10) calls
 * this on each barcode-detected callback.
 */

const STOOP_INVITE_PATH = 'onboard.html';
const STOOP_CONTACT_SCHEME = 'stoop-contact://';

const BIP39_WORD_COUNTS = new Set([12, 15, 18, 21, 24]);

/**
 * @typedef {object} ClassifiedInvite
 * @property {'invite'} kind
 * @property {object}   payload   parsed invite token (`{groupId, secret, ...}`)
 *
 * @typedef {object} ClassifiedContact
 * @property {'contact'} kind
 * @property {string}    payload   the full `stoop-contact://...` URI
 *
 * @typedef {object} ClassifiedRecovery
 * @property {'recovery'} kind
 * @property {string[]}   payload   array of BIP-39 words
 *
 * @typedef {object} ClassifiedUnknown
 * @property {'unknown'} kind
 *
 * @typedef {ClassifiedInvite | ClassifiedContact | ClassifiedRecovery | ClassifiedUnknown} Classified
 */

/**
 * @param {string} text   raw scanned barcode text
 * @returns {Classified}
 */
export function classifyQrPayload(text) {
  if (typeof text !== 'string' || text.length === 0) return { kind: 'unknown' };
  const trimmed = text.trim();

  // 1. Invite: either a `?invite=<json>` URL fragment or the bare JSON.
  const invite = _tryClassifyInvite(trimmed);
  if (invite) return invite;

  // 2. stoop-contact:// URI.
  if (trimmed.startsWith(STOOP_CONTACT_SCHEME)) {
    return { kind: 'contact', payload: trimmed };
  }

  // 3. Recovery phrase: BIP-39 word count, lowercase ASCII.
  const recovery = _tryClassifyRecovery(trimmed);
  if (recovery) return recovery;

  return { kind: 'unknown' };
}

// ── Internals ────────────────────────────────────────────────────────────────

function _tryClassifyInvite(text) {
  // URL form: an `?invite=<encoded-json>` query, anywhere in the URL.
  const inviteMatch = /[?&]invite=([^&#]+)/i.exec(text);
  if (inviteMatch) {
    try {
      const decoded = decodeURIComponent(inviteMatch[1]);
      const parsed  = JSON.parse(decoded);
      if (_looksLikeInvite(parsed)) return { kind: 'invite', payload: parsed };
    } catch { /* fall through */ }
  }
  // Path form: `/onboard.html?invite=...` — already covered by the
  // regex above since onboard.html doesn't have other invite-shaped
  // params.  Bare JSON form: starts with `{` and parses.
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (_looksLikeInvite(parsed)) return { kind: 'invite', payload: parsed };
    } catch { /* fall through */ }
  }
  return null;
}

function _looksLikeInvite(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (typeof obj.groupId !== 'string' || obj.groupId.length === 0) return false;
  // Stoop's design uses **membership codes** (`{groupId, code,
  // expiresAt}`) — share-secret semantics, no signature.  We also
  // accept the legacy GroupManager-issued shape (`{groupId,
  // signature, ...}`) so QR codes from non-Stoop apps that ride the
  // identity-resolver onboarding skills still classify; the scan
  // routing decides which redeem flow each shape goes to.
  if (typeof obj.code      === 'string') return true;
  if (typeof obj.signature === 'string') return true;
  return false;
}

function _tryClassifyRecovery(text) {
  // BIP-39 phrase: word count in {12, 15, 18, 21, 24}, all words
  // lowercase ASCII letters.  We don't validate against the BIP-39
  // wordlist here (the substrate's `validateMnemonic` does the deep
  // check after the user confirms); the QR classifier just disambiguates.
  const words = text.split(/\s+/).filter(Boolean);
  if (!BIP39_WORD_COUNTS.has(words.length)) return null;
  if (!words.every((w) => /^[a-z]+$/.test(w) && w.length >= 3 && w.length <= 8)) return null;
  return { kind: 'recovery', payload: words };
}

export const _internal = {
  STOOP_CONTACT_SCHEME,
  STOOP_INVITE_PATH,
  BIP39_WORD_COUNTS,
  _tryClassifyInvite,
  _tryClassifyRecovery,
};

/**
 * qrClassifiers — Tasks-mobile's QR payload taxonomy.
 *
 * Phase 41.3.2 (2026-05-09).
 *
 * Plugged into the substrate's `classifyQrPayload(text, classifiers)`
 * dispatcher (Phase 41.0 L4 lift). Each classifier returns either a
 * shape-specific payload or `null` to fall through to the next.
 *
 * Recognised payloads:
 *   1. tasks://invite?token=<base64url-json>     → invite payload (auto-redeem)
 *   2. tasks://bot-token?...                     → cap-token-bound bot binding
 *                                                  (Phase 41.13 — admin issue)
 *   3. tasks://contact?uri=<urlencoded-uri>      → contact-share URI
 *   4. BIP-39 12/24-word recovery phrase         → mnemonic restore
 *   5. (future) tasks://circle-config             → multi-circle bootstrap
 */

import { parseTokenParam } from '@onderling/react-native/deepLinks';
import { looksLikeMnemonic, mnemonicWords } from '@onderling/react-native/mnemonic';

const SCHEME      = 'tasks:';
const CONTACT_URI = 'tasks-contact://';

/** Pull `?key=value` query out of a string. Local helper. */
function _parseQuery(query) {
  const out = {};
  if (!query) return out;
  for (const pair of query.split('&')) {
    if (pair.length === 0) continue;
    const eq = pair.indexOf('=');
    const k = eq >= 0 ? pair.slice(0, eq) : pair;
    const v = eq >= 0 ? pair.slice(eq + 1) : '';
    if (!k) continue;
    try { out[decodeURIComponent(k)] = decodeURIComponent(v); }
    catch { out[k] = v; }
  }
  return out;
}

/**
 * Pull `?<param>=<value>` from a `tasks://<path>?...` URL — bypasses
 * the substrate's `parseDeepLink` dispatcher (which is for navigation
 * routing, not QR classification) but uses the same query-parser
 * shape internally.
 */
function _queryFromTasksUrl(text, path) {
  const lower = text.toLowerCase();
  if (!lower.startsWith(SCHEME)) return null;
  const after = text.slice(SCHEME.length).replace(/^\/\//, '');
  const [pathRaw, queryRaw = ''] = after.split('?');
  const cleanPath = pathRaw.replace(/^\/+/, '').replace(/\/+$/, '');
  if (cleanPath.toLowerCase() !== path) return null;
  return _parseQuery(queryRaw);
}

// ── Invite ──────────────────────────────────────────────────────────────────

function classifyInvite(text) {
  // URL form: `tasks://invite?token=<base64url-json>` (or raw JSON).
  const query = _queryFromTasksUrl(text, 'invite');
  if (query?.token) {
    const t = parseTokenParam(query.token, _looksLikeInvite);
    if (t) return { token: t };
  }
  // Bare-JSON form (web → QR sometimes embeds JSON directly).
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (_looksLikeInvite(parsed)) return { token: parsed };
    } catch { /* not JSON */ }
  }
  return null;
}

function _looksLikeInvite(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (typeof obj.groupId !== 'string' || obj.groupId.length === 0) return false;
  // Accept either signed (`signature`) or short-code (`code`) shapes.
  return typeof obj.signature === 'string' || typeof obj.code === 'string';
}

// ── Bot token (Phase 41.13) ────────────────────────────────────────────────

function classifyBotToken(text) {
  const query = _queryFromTasksUrl(text, 'bot-token');
  if (!query) return null;
  // Required: chatId + webid + tokenBlob
  if (!query.chatId || !query.webid || !query.tokenBlob) return null;
  return {
    chatId:    query.chatId,
    webid:     query.webid,
    tokenBlob: query.tokenBlob,
  };
}

// ── Contact share ──────────────────────────────────────────────────────────

function classifyContact(text) {
  // Accept both `tasks-contact://...` URIs and `tasks://contact?uri=...`.
  if (text.startsWith(CONTACT_URI)) {
    return { uri: text };
  }
  const query = _queryFromTasksUrl(text, 'contact');
  if (query?.uri) return { uri: query.uri };
  return null;
}

// ── Mnemonic recovery phrase ───────────────────────────────────────────────

function classifyRecovery(text) {
  if (!looksLikeMnemonic(text)) return null;
  return { words: mnemonicWords(text) };
}

// ── Public — the classifier list passed to the substrate dispatcher ────────

export const TASKS_CLASSIFIERS = Object.freeze([
  { kind: 'invite',    classify: classifyInvite },
  { kind: 'bot-token', classify: classifyBotToken },
  { kind: 'contact',   classify: classifyContact },
  { kind: 'recovery',  classify: classifyRecovery },
]);

export const _internal = {
  SCHEME,
  CONTACT_URI,
  classifyInvite,
  classifyBotToken,
  classifyContact,
  classifyRecovery,
  _parseQuery,
  _looksLikeInvite,
};

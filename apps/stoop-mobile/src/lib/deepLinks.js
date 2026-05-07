/**
 * deepLinks — Stoop V3 Phase 40.11.
 *
 * `parseDeepLink(url)` turns a `stoop://...` URL into an action object the
 * App's deep-link handler can dispatch through `useNavigation()`.
 * `actionToNavigation(action)` turns it into the `(routeName, params)`
 * pair to pass to `nav.navigate`.
 *
 * Recognised paths:
 *
 *   stoop://invite?token=<base64url-json>     → OnboardScan with pendingInvite
 *   stoop://contact?uri=<urlencoded-stoop-contact-uri>
 *                                             → Contacts with pendingContact
 *   stoop://chat?thread=<id>&peer=<peerId>    → ChatThread
 *   stoop://post?id=<id>                      → ItemDetail
 *   stoop://group?id=<gid>                    → Group
 *   stoop://auth/callback?code=...            → SignIn (OIDC redirect catch)
 *   stoop://welcome  | stoop:// (root)         → Welcome
 *   stoop://feed                              → Feed
 *
 * Unrecognised URLs return `{kind: 'unknown', url}` so the caller can
 * surface a soft warning (or ignore them). The classifier is pure,
 * synchronous, and never throws.
 *
 * The auth/callback route is a placeholder for the OIDC redirect
 * (Phase 40.3 wires the actual session-completion logic) — having
 * the route present at parse-time lets the deep-link handler swallow
 * the URL cleanly instead of falling through to "unknown."
 */

import { ROUTES } from '../navigation.js';

const SCHEME = 'stoop:';

/**
 * @typedef {object} ParsedDeepLink
 * @property {'invite'|'contact'|'chat'|'post'|'group'|'auth_callback'|'welcome'|'feed'|'unknown'} kind
 * @property {object} [params]
 * @property {string} [url]
 */

/**
 * @param {string} input
 * @returns {ParsedDeepLink}
 */
export function parseDeepLink(input) {
  if (typeof input !== 'string' || input.length === 0) return { kind: 'unknown', url: '' };
  const trimmed = input.trim();

  if (!trimmed.toLowerCase().startsWith('stoop:')) return { kind: 'unknown', url: trimmed };

  // Strip scheme + optional `//` so URL parsing works without a real host.
  const afterScheme = trimmed.slice(SCHEME.length).replace(/^\/\//, '');
  const [pathRaw, queryRaw = ''] = afterScheme.split('?');
  const path  = pathRaw.replace(/^\/+/, '').replace(/\/+$/, '');
  const query = _parseQuery(queryRaw);

  if (path === '' || path === 'welcome') {
    return { kind: 'welcome', params: query, url: trimmed };
  }
  if (path === 'feed') {
    return { kind: 'feed', params: query, url: trimmed };
  }

  if (path === 'invite') {
    const token = _parseInviteToken(query.token);
    return token
      ? { kind: 'invite', params: { token }, url: trimmed }
      : { kind: 'unknown', url: trimmed };
  }

  if (path === 'contact') {
    if (typeof query.uri !== 'string' || query.uri.length === 0) {
      return { kind: 'unknown', url: trimmed };
    }
    return { kind: 'contact', params: { uri: query.uri }, url: trimmed };
  }

  if (path === 'chat') {
    if (!query.thread && !query.peer) return { kind: 'unknown', url: trimmed };
    return { kind: 'chat', params: { thread: query.thread, peer: query.peer }, url: trimmed };
  }

  if (path === 'post') {
    if (!query.id) return { kind: 'unknown', url: trimmed };
    return { kind: 'post', params: { id: query.id }, url: trimmed };
  }

  if (path === 'group') {
    if (!query.id) return { kind: 'unknown', url: trimmed };
    return { kind: 'group', params: { id: query.id }, url: trimmed };
  }

  if (path === 'auth/callback') {
    return { kind: 'auth_callback', params: query, url: trimmed };
  }

  return { kind: 'unknown', url: trimmed };
}

/**
 * Map a parsed action onto a `(routeName, params)` pair the
 * `useNavigation().navigate` API expects.  Returns `null` for
 * `unknown`.
 *
 * @param {ParsedDeepLink} action
 * @returns {{ name: string, params?: object } | null}
 */
export function actionToNavigation(action) {
  if (!action || typeof action !== 'object') return null;
  switch (action.kind) {
    // Pre-shell entry stack
    case 'welcome':       return { name: ROUTES.Welcome,        params: action.params };
    case 'invite':        return { name: ROUTES.OnboardScan,    params: { pendingInvite:  action.params?.token } };
    case 'auth_callback': return { name: ROUTES.SignIn,         params: action.params };

    // Tab shell — drop directly into a tab via nested-navigation params.
    case 'feed':          return { name: ROUTES.Shell, params: { screen: ROUTES.Feed,        params: action.params } };
    case 'contact':       return { name: ROUTES.Shell, params: { screen: ROUTES.Contacts,    params: { pendingContact: action.params?.uri } } };

    // Detail screens — push over the shell.
    case 'chat':          return {
      name: ROUTES.ChatThread,
      params: { threadId: action.params?.thread, peerId: action.params?.peer },
    };
    case 'post':          return { name: ROUTES.ItemDetail,     params: { itemId:  action.params?.id } };
    case 'group':         return { name: ROUTES.Group,          params: { groupId: action.params?.id } };
    default:              return null;
  }
}

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

function _parseInviteToken(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  // Accept both raw JSON tokens (already URL-decoded by _parseQuery)
  // and base64url-encoded JSON.  Web's invite QRs ship raw JSON.
  try {
    const parsed = JSON.parse(raw);
    if (_looksLikeInvite(parsed)) return parsed;
  } catch { /* not JSON — try base64url */ }

  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
    const b64 = padded + '='.repeat((4 - padded.length % 4) % 4);
    // `atob` is available in RN (Hermes shim) and Node 18+; works across both.
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    if (_looksLikeInvite(parsed)) return parsed;
  } catch { /* fall through */ }

  return null;
}

function _looksLikeInvite(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return typeof obj.groupId === 'string' && typeof obj.signature === 'string';
}

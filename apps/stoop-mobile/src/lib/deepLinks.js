/**
 * deepLinks — Stoop's binding of the lifted deep-link dispatcher.
 *
 * Lifted to `@onderling/react-native/deepLinks` 2026-05-09 (Phase
 * 41.0.b A6). The substrate ships the generic `parseDeepLink({scheme,
 * parsers, defaultPath})` + `parseQuery` + `parseTokenParam` helpers;
 * Stoop's per-path parsers + `actionToNavigation` (the route-table
 * mapping, app-specific) stay here.
 *
 * Stoop V3 Phase 40.11 — recognised paths:
 *
 *   stoop://invite?token=<base64url-json>     → OnboardScan with pendingInvite
 *   stoop://contact?uri=<urlencoded-uri>      → Contacts with pendingContact
 *   stoop://chat?thread=<id>&peer=<peerId>    → ChatThread
 *   stoop://post?id=<id>                      → ItemDetail
 *   stoop://group?id=<gid>                    → Group
 *   stoop://auth/callback?code=...            → SignIn (OIDC redirect)
 *   stoop://welcome  | stoop:// (root)        → Welcome
 *   stoop://feed                              → Feed
 */

import {
  parseDeepLink as _parseDeepLink,
  parseTokenParam,
} from '@onderling/react-native/deepLinks';
import { ROUTES } from '../navigation.js';

const SCHEME = 'stoop:';

const STOOP_PARSERS = {
  welcome: (query) => ({ kind: 'welcome', params: query }),
  feed:    (query) => ({ kind: 'feed',    params: query }),

  invite: (query) => {
    const token = parseTokenParam(query.token, _looksLikeInvite);
    return token ? { kind: 'invite', params: { token } } : null;
  },

  contact: (query) => {
    if (typeof query.uri !== 'string' || query.uri.length === 0) return null;
    return { kind: 'contact', params: { uri: query.uri } };
  },

  chat: (query) => {
    if (!query.thread && !query.peer) return null;
    return { kind: 'chat', params: { thread: query.thread, peer: query.peer } };
  },

  post: (query) => {
    if (!query.id) return null;
    return { kind: 'post', params: { id: query.id } };
  },

  group: (query) => {
    if (!query.id) return null;
    return { kind: 'group', params: { id: query.id } };
  },

  'auth/callback': (query) => ({ kind: 'auth_callback', params: query }),
};

/**
 * @param {string} input
 * @returns {{kind: string, params?: object, url?: string}}
 */
export function parseDeepLink(input) {
  return _parseDeepLink(input, {
    scheme:      SCHEME,
    parsers:     STOOP_PARSERS,
    defaultPath: 'welcome',
  });
}

/**
 * Map a parsed action onto a `(routeName, params)` pair `nav.navigate`
 * expects. Returns `null` for `unknown`.
 */
export function actionToNavigation(action) {
  if (!action || typeof action !== 'object') return null;
  switch (action.kind) {
    case 'welcome':       return { name: ROUTES.Welcome,        params: action.params };
    case 'invite':        return { name: ROUTES.OnboardScan,    params: { pendingInvite:  action.params?.token } };
    case 'auth_callback': return { name: ROUTES.SignIn,         params: action.params };
    case 'feed':          return { name: ROUTES.Shell, params: { screen: ROUTES.Feed,        params: action.params } };
    case 'contact':       return { name: ROUTES.Shell, params: { screen: ROUTES.Contacts,    params: { pendingContact: action.params?.uri } } };
    case 'chat':          return {
      name: ROUTES.ChatThread,
      params: { threadId: action.params?.thread, peerId: action.params?.peer },
    };
    case 'post':          return { name: ROUTES.ItemDetail,     params: { itemId:  action.params?.id } };
    case 'group':         return { name: ROUTES.Group,          params: { groupId: action.params?.id } };
    default:              return null;
  }
}

function _looksLikeInvite(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return typeof obj.groupId === 'string' && typeof obj.signature === 'string';
}

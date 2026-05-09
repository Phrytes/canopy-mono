/**
 * deepLinks — Tasks-mobile's binding of the substrate's plug-in
 * deep-link dispatcher (Phase 41.0.b A6 lift).
 *
 * Phase 41.15.3 (2026-05-09).
 *
 * Recognised paths:
 *   - tasks://welcome  | tasks://       → Welcome
 *   - tasks://auth/callback?code=...    → AuthCallback (Phase 41.15)
 *   - tasks://invite?token=<base64url>  → OnboardScan with prefilled invite
 *   - tasks://post?id=<taskId>          → TaskDetail
 *   - tasks://crew?id=<crewId>          → Workspace (after setActiveCrew)
 *
 * `actionToNavigation(action)` maps the parsed action to a
 * `(routeName, params)` pair that nav.navigate consumes.
 */

import {
  parseDeepLink as _parseDeepLink,
  parseTokenParam,
} from '@canopy/react-native/deepLinks';
import { ROUTES } from '../navigation.js';

const SCHEME = 'tasks:';

const TASKS_PARSERS = {
  welcome: (query) => ({ kind: 'welcome', params: query }),
  workspace: (query) => ({ kind: 'workspace', params: query }),

  invite: (query) => {
    const token = parseTokenParam(query.token, _looksLikeInvite);
    return token ? { kind: 'invite', params: { token } } : null;
  },

  'auth/callback': (query) => ({ kind: 'auth_callback', params: query }),

  post: (query) => {
    if (!query.id) return null;
    return { kind: 'post', params: { id: query.id } };
  },

  crew: (query) => {
    if (!query.id) return null;
    return { kind: 'crew', params: { id: query.id } };
  },
};

/**
 * @param {string} input
 * @returns {{kind: string, params?: object, url?: string}}
 */
export function parseDeepLink(input) {
  return _parseDeepLink(input, {
    scheme:      SCHEME,
    parsers:     TASKS_PARSERS,
    defaultPath: 'welcome',
  });
}

/**
 * Map a parsed action onto a `(routeName, params)` pair.
 *
 * Returns null for `unknown`. The active-crew side-effect for the
 * `crew` kind is the caller's responsibility (App.js's listener
 * handles it).
 *
 * @param {{kind: string, params?: object}} action
 * @returns {{ name: string, params?: object } | null}
 */
export function actionToNavigation(action) {
  if (!action || typeof action !== 'object') return null;
  switch (action.kind) {
    case 'welcome':       return { name: ROUTES.Welcome,        params: action.params };
    case 'workspace':     return { name: ROUTES.Workspace,      params: action.params };
    case 'invite':        return { name: ROUTES.OnboardScan,    params: { pendingInvite: action.params?.token } };
    case 'auth_callback': return { name: ROUTES.AuthCallback,   params: action.params };
    case 'post':          return { name: ROUTES.TaskDetail,     params: { id: action.params?.id } };
    case 'crew':          return { name: ROUTES.Workspace,      params: { crewId: action.params?.id } };
    default:              return null;
  }
}

function _looksLikeInvite(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (typeof obj.groupId !== 'string' || obj.groupId.length === 0) return false;
  return typeof obj.signature === 'string' || typeof obj.code === 'string';
}

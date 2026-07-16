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
 *   - tasks://circle?id=<circleId>          → Workspace (after setActiveCircle)
 *
 * `actionToNavigation(action)` maps the parsed action to a
 * `(routeName, params)` pair that nav.navigate consumes.
 */

import {
  parseDeepLink as _parseDeepLink,
  parseTokenParam,
} from '@onderling/react-native/deepLinks';
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

  circle: (query) => {
    if (!query.id) return null;
    return { kind: 'circle', params: { id: query.id } };
  },

  // Phase 41.18.4 — appeal deep-link:
  //   tasks://appeal?taskId=<taskId>[&circleId=<circleId>]
  appeal: (query) => {
    if (!query.taskId) return null;
    return { kind: 'appeal', params: {
      taskId: query.taskId,
      circleId: query.circleId ?? null,
    } };
  },

  // Phase 41.18.4 — generic chat-thread deep-link:
  //   tasks://chat?threadId=<id>[&counterparty=<webid>]
  chat: (query) => {
    if (!query.threadId) return null;
    return { kind: 'chat', params: {
      threadId:     query.threadId,
      counterparty: query.counterparty ?? null,
    } };
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
 * Returns null for `unknown`. The active-circle side-effect for the
 * `circle` kind is the caller's responsibility (App.js's listener
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
    case 'circle':          return { name: ROUTES.Workspace,      params: { circleId: action.params?.id } };
    case 'appeal':        return { name: ROUTES.ChatThread,     params: {
      threadId:        `appeal:${action.params?.taskId}`,
      appealForTaskId: action.params?.taskId,
    } };
    case 'chat':          return { name: ROUTES.ChatThread,     params: {
      threadId:     action.params?.threadId,
      counterparty: action.params?.counterparty,
    } };
    default:              return null;
  }
}

function _looksLikeInvite(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (typeof obj.groupId !== 'string' || obj.groupId.length === 0) return false;
  return typeof obj.signature === 'string' || typeof obj.code === 'string';
}

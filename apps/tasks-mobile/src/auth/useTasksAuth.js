/**
 * useTasksAuth — tasks-mobile's binding of the substrate's
 * useOidcSignIn hook.
 *
 * Phase 41.15 (2026-05-09).
 *
 * The substrate hook is generic over the per-app scheme + DCR cache
 * key namespace. Tasks-mobile binds it to `'tasks'` so the redirect
 * URI is `tasks://auth/callback` and SecureStore keys live under
 * `tasks-oidc-*`.
 */

import { useOidcSignIn } from '@canopy/oidc-session-rn/hook';

const DEFAULT_ISSUER = 'https://login.inrupt.com';

export function useTasksAuth({ issuer = DEFAULT_ISSUER, onWarning } = {}) {
  return useOidcSignIn({
    issuer,
    scheme:     'tasks',
    path:       'auth/callback',
    clientName: 'Tasks (mobile)',
    onWarning,
  });
}

export const TASKS_OIDC_DEFAULT_ISSUER = DEFAULT_ISSUER;

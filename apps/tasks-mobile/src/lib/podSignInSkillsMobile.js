/**
 * podSignInSkillsMobile — register the four Slice-5 pod-sign-in
 * skills on tasks-mobile's meshAgent, reusing the SHARED
 * `apps/tasks-v0/src/lib/podSignIn.js` orchestration with the
 * device-specific OIDC session injected.
 *
 * M1-S5 (2026-05-18). Mirrors:
 *   - tasks-v0 Slice 5 skill ids + return shapes (so screens stay
 *     portable; stoop-mobile's ProfileMineScreen also consumes
 *     `podSignInStatus` / `signOutOfPod`).
 *   - stoop-mobile's proven RN pattern: PKCE via the
 *     `@onderling/oidc-session-rn` hook (already wired through
 *     `useTasksAuth` + `ServiceContext.attachPod`), then
 *     `OidcSessionRN.adoptTokens(tokens)`.
 *
 * Platform parity: the genuinely shareable post-auth orchestration —
 * `derivePodRoot` → `SolidPodSource` → `dataSource.attachInner` →
 * status/sign-out — lives in the shared `podSignIn.js`. This module
 * injects only the device-specific session via the additive
 * `sessionFactory` seam (web keeps the Node `createSolidAuthNode`
 * default; zero web behaviour change).
 *
 * Skill surface (identical to tasks-v0 Slice 5):
 *   - `startPodSignIn({issuer, redirectUrl})`
 *   - `completePodSignIn({tokens})`     ← RN: tokens from the hook
 *   - `signOutOfPod()`
 *   - `podSignInStatus()`
 *
 * The RN flow does NOT use `startPodSignIn`'s browser redirect — the
 * `useTasksAuth` hook runs PKCE in the system browser and yields
 * tokens, which `completePodSignIn({tokens})` adopts. `startPodSignIn`
 * is still registered for skill-surface parity (it returns a
 * structured "use the RN hook" error on RN since `OidcSessionRN`
 * has no `.start()`); screens drive sign-in through `useTasksAuth`.
 *
 * The active circle's local-store bundle cache is the
 * `CachingDataSource` the shared module attaches the pod inner to —
 * we present it as `circle.dataSource` so podSignIn.js's
 * `attachInner`/`hasInner` calls land on the same cache
 * `ServiceContext.attachPod` uses (single source of pod-attach
 * truth on mobile).
 */

import { defineSkill, DataPart } from '@onderling/core';
import {
  startPodSignIn,
  completePodSignIn,
  signOutOfPod,
  podSignInStatus,
} from '@onderling-app/tasks-v0/lib/podSignIn';

function _args(parts) {
  if (!Array.isArray(parts)) return {};
  const dp = parts.find((p) => p?.type === 'DataPart');
  return dp?.data ?? {};
}

/**
 * Build the four pod-sign-in skill definitions.
 *
 * @param {object} args
 * @param {() => object|null} args.podCircleProvider
 *   Returns a `circle`-shaped object `{dataSource, oidcSession?,
 *   oidcVault?}` whose `dataSource` is the active local-store bundle
 *   cache (CachingDataSource). Returning `null` yields a structured
 *   `{ok:false}` (no pod cache available — e.g. cache:false).
 *   ServiceContext keeps a single mutable holder so the same object
 *   carries `oidcSession` across the start/complete/status/signout
 *   calls (mirrors tasks-v0's per-circle `circle.oidcSession` slot).
 * @param {() => object} args.sessionFactory
 *   Builds the device OIDC session (an `OidcSessionRN`-shaped
 *   object exposing `adoptTokens`/`isAuthenticated`/
 *   `getAuthenticatedFetch`/`webid`/`logout`). Injected into the
 *   shared podSignIn.js via its additive seam.
 * @param {(opts: {podUrl: string, fetch: Function}) => object} args.dataSourceFactory
 *   Builds the pod-backed DataSource (a `SolidPodSource`). Injected
 *   so the RN build does not pull `@onderling/pod-client` at parse time
 *   under vitest.
 * @returns {Array<object>}
 */
export function buildPodSignInSkillsMobile({
  podCircleProvider,
  sessionFactory,
  dataSourceFactory,
} = {}) {
  if (typeof podCircleProvider !== 'function') {
    throw new TypeError('buildPodSignInSkillsMobile: podCircleProvider required');
  }
  if (typeof sessionFactory !== 'function') {
    throw new TypeError('buildPodSignInSkillsMobile: sessionFactory required');
  }

  const NO_CIRCLE = { ok: false, error: 'no pod-capable circle (bundle cache unavailable)' };

  return [
    /**
     * startPodSignIn({issuer, redirectUrl})
     * Registered for skill-surface parity with tasks-v0 Slice 5.
     * On RN the PKCE flow is the `useTasksAuth` hook, not a browser
     * redirect — calling this returns the shared module's structured
     * error (OidcSessionRN has no `.start()`). Screens use the hook.
     */
    defineSkill('startPodSignIn', async ({ parts }) => {
      const circle = podCircleProvider();
      if (!circle) return NO_CIRCLE;
      const a = _args(parts);
      return startPodSignIn({
        circle,
        issuer:      a.issuer,
        redirectUrl: a.redirectUrl,
        sessionFactory,
      });
    }, {
      description: 'Begin Solid OIDC sign-in (RN: prefer the useTasksAuth hook).',
      visibility:  'authenticated',
    }),

    /**
     * completePodSignIn({tokens})
     * RN path: `tokens` is the token set the `useTasksAuth` PKCE
     * flow produced. The shared module adopts them onto the injected
     * OidcSessionRN, derives the pod root, builds a SolidPodSource,
     * and attaches it to the bundle cache.
     */
    defineSkill('completePodSignIn', async ({ parts }) => {
      const circle = podCircleProvider();
      if (!circle) return NO_CIRCLE;
      const a = _args(parts);
      return completePodSignIn({
        circle,
        tokens:      a.tokens,
        callbackUrl: a.callbackUrl,   // web-shaped callers still work
        sessionFactory,
        dataSourceFactory,
      });
    }, {
      description: 'Complete OIDC sign-in + attach the pod DataSource to the bundle cache.',
      visibility:  'authenticated',
    }),

    /**
     * signOutOfPod()
     * Detaches the pod inner + clears the OIDC session. Local cache
     * is preserved so the user keeps working offline.
     */
    defineSkill('signOutOfPod', async () => {
      const circle = podCircleProvider();
      if (!circle) return { ok: true };   // nothing attached → no-op success
      return signOutOfPod({ circle });
    }, {
      description: 'Sign out of the pod; local cache is preserved.',
      visibility:  'authenticated',
    }),

    /**
     * podSignInStatus() → {signedIn, webid?, podAttached}
     * Read-only. Same return shape stoop-mobile's ProfileMineScreen
     * consumes.
     */
    defineSkill('podSignInStatus', async () => {
      const circle = podCircleProvider();
      if (!circle) return { signedIn: false };
      return podSignInStatus({ circle });
    }, {
      description: 'Read-only Solid pod sign-in status.',
      visibility:  'authenticated',
    }),
  ];
}

// Re-export DataPart so callers building skill-call args from RN
// don't need a second @onderling/core import path.
export { DataPart };

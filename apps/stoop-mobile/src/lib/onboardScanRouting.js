/**
 * onboardScanRouting — pure helper from OnboardScanScreen.
 *
 * Maps a `classifyQrPayload` result onto a navigation action; lifted
 * out of the screen so it's testable without rendering.
 */

import { ROUTES } from '../navigation.js';

/**
 * @param {{navigate: (name: string, params?: object) => unknown}} navigation
 * @param {{kind: 'invite'|'contact'|'recovery'|'unknown', payload?: any}} classified
 * @param {object} [routeParams]   passed-through `route.params`
 *
 * @returns {string|null}   the route name navigated to (or null on unknown).
 */
export function routeForKind(navigation, classified, routeParams = {}) {
  if (!navigation || typeof navigation.navigate !== 'function') return null;
  switch (classified?.kind) {
    case 'invite':
      // Route to OnboardJoinScreen which self-seeds the local
      // membership-code item, calls redeemMembershipCode, and
      // registers the group via svc.addGroup. The screen auto-runs
      // the join attempt on mount + handles error / retry inline.
      navigation.navigate(ROUTES.OnboardJoin, {
        ...routeParams,
        invite: classified.payload,
      });
      return ROUTES.OnboardJoin;
    case 'contact':
      navigation.navigate(ROUTES.Shell, {
        screen: ROUTES.Contacts,
        params: { ...routeParams, pendingContact: classified.payload },
      });
      return ROUTES.Shell;
    case 'recovery':
      navigation.navigate(ROUTES.OnboardRestore, {
        ...routeParams,
        prefilledMnemonic: Array.isArray(classified.payload)
          ? classified.payload.join(' ')
          : '',
      });
      return ROUTES.OnboardRestore;
    default:
      return null;
  }
}

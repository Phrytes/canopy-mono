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
      // Land in the Feed tab inside the shell with the invite stashed
      // for the redeem flow.
      navigation.navigate(ROUTES.Shell, {
        screen: ROUTES.Feed,
        params: { ...routeParams, pendingInvite: classified.payload },
      });
      return ROUTES.Shell;
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

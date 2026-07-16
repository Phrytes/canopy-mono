/**
 * push — re-export of the lifted push helpers.
 *
 * `setupPush` + `requestPushPermission` moved to
 * `@onderling/react-native/push` 2026-05-09 (Phase 41.0 L6). The new
 * `usePushOptIn` hook is also available there.
 *
 * The shim does the static `expo-notifications` import here so test-time
 * `vi.mock('expo-notifications', ...)` (set up in test/setup.js) is
 * picked up: the substrate's no-args fallback would otherwise dynamically
 * import the real ESM module which vitest can't parse.
 */

import * as ExpoNotifications from 'expo-notifications';
import {
  setupPush as _setupPush,
  requestPushPermission as _requestPushPermission,
  usePushOptIn as _usePushOptIn,
} from '@onderling/react-native/push';

export function setupPush(args = {}) {
  return _setupPush(args);
}

export function requestPushPermission({ NotificationsModule } = {}) {
  return _requestPushPermission({ NotificationsModule: NotificationsModule ?? ExpoNotifications });
}

export function usePushOptIn(args = {}) {
  return _usePushOptIn({ ...args, NotificationsModule: args.NotificationsModule ?? ExpoNotifications });
}

/**
 * ExpoNotificationsAdapter — concrete PushAdapter wrapping `expo-notifications`.
 *
 * Q-E.1 locked 2026-04-28: Expo Notifications is the v1 push provider.
 * The Expo SDK can run with the Expo push proxy OR with direct APNs/FCM
 * credentials — that's a runtime config, not a coupling.
 *
 * ── Peer dependency ─────────────────────────────────────────────────────────
 * `expo-notifications` is intentionally NOT a dependency of
 * `@canopy/react-native`.  Apps that use this adapter must install it
 * themselves (Expo apps usually already have it):
 *
 *   npx expo install expo-notifications
 *
 * Importing this file outside an Expo runtime will fail at module load time —
 * that's by design.  Apps that don't use push should not import this file.
 *
 * ── API surface used ────────────────────────────────────────────────────────
 *   - Notifications.getPermissionsAsync()       → current permission status
 *   - Notifications.requestPermissionsAsync()   → prompt + status
 *   - Notifications.getExpoPushTokenAsync({projectId?}) → { data: '<token>' }
 *   - Notifications.addNotificationReceivedListener(handler) → subscription
 *
 * The "received" listener fires while the app is foregrounded.  Background
 * delivery uses a separate path (`addNotificationResponseReceivedListener`
 * + a background task) which is intentionally out of scope here — apps that
 * need background wake will compose their own response handler and forward
 * to MobilePushBridge.#dispatch via a small shim.
 */
import * as Notifications from 'expo-notifications';
import { Platform }       from 'react-native';

import { PushAdapter }      from './PushAdapter.js';
import { presentLocalWith } from '../../push/presentLocal.js';

export class ExpoNotificationsAdapter extends PushAdapter {
  #subscriptions = [];

  /**
   * @param {object} [opts]
   * @param {string} [opts.projectId] — EAS project ID for Expo push tokens.
   */
  async register({ projectId } = {}) {
    const { status: prev } = await Notifications.getPermissionsAsync();
    let status = prev;
    if (status !== 'granted') {
      const { status: requested } = await Notifications.requestPermissionsAsync();
      status = requested;
    }
    if (status !== 'granted') {
      throw Object.assign(
        new Error('Push permission denied'),
        { code: 'PUSH_PERMISSION_DENIED' },
      );
    }
    const tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return {
      token:    tokenResult.data,
      platform: Platform.OS,            // 'ios' | 'android' | 'web'
    };
  }

  onNotification(handler) {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      try {
        handler({
          data:       notification.request?.content?.data ?? {},
          foreground: true,
        });
      } catch (err) {
        // Swallow — handler errors shouldn't bring down the listener.
        // eslint-disable-next-line no-console
        console.warn('[ExpoNotificationsAdapter] handler threw:', err);
      }
    });
    this.#subscriptions.push(sub);
    return () => {
      const idx = this.#subscriptions.indexOf(sub);
      if (idx >= 0) this.#subscriptions.splice(idx, 1);
      sub.remove?.();
    };
  }

  async unregister() {
    for (const sub of this.#subscriptions) sub.remove?.();
    this.#subscriptions.length = 0;
  }

  /**
   * Present a LOCAL notification immediately.  Delegates to the shared
   * `presentLocalWith` logic (which also backs `presentLocalNotification`),
   * so the local-notify behaviour lives in exactly one place.
   * @param {{ title?: string, body?: string, data?: object }} [notification]
   * @returns {Promise<boolean>}
   */
  async presentLocal(notification) {
    return presentLocalWith(Notifications, notification);
  }
}

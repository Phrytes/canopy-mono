/**
 * PushAdapter — interface bridging native push services (APNs/FCM/Expo) to the SDK.
 * @abstract
 *
 * Implementations:
 *   - ExpoNotificationsAdapter — v1 default, wraps `expo-notifications`.
 *   - APNsAdapter / FCMAdapter — direct, future v2.
 *
 * Adapter contract:
 *   - `register(opts)` requests OS-level permission and returns a device-bound
 *     push token plus the platform that minted it.  Throws with
 *     `code: 'PUSH_PERMISSION_DENIED'` if the user denies.
 *   - `onNotification(handler)` subscribes to incoming notifications.  The
 *     returned function unsubscribes.  Handler receives
 *     `{ data: object, foreground: boolean }`.
 *   - `unregister()` is idempotent — tears down listeners.
 *
 * Notifications received via these adapters are routed through MobilePushBridge
 * to either a matching skill on the local Agent (when `data.skillId` is set)
 * or a generic `'push'` event on the Agent for app-level handling.
 */
export class PushAdapter {
  /**
   * Request permissions + obtain a device-specific push token.
   * @param {object} [opts]
   * @returns {Promise<{ token: string, platform: 'ios'|'android'|'web' }>}
   * @throws {Error} with code 'PUSH_PERMISSION_DENIED' if user denies.
   */
  // eslint-disable-next-line no-unused-vars
  async register(opts) {
    throw new Error('PushAdapter.register() not implemented');
  }

  /**
   * Subscribe to incoming notifications.  Called by MobilePushBridge.
   * @param {(notification: { data: object, foreground: boolean }) => void} handler
   * @returns {() => void} unsubscribe
   */
  // eslint-disable-next-line no-unused-vars
  onNotification(handler) {
    throw new Error('PushAdapter.onNotification() not implemented');
  }

  /** Tear down listeners; idempotent. */
  async unregister() {
    throw new Error('PushAdapter.unregister() not implemented');
  }
}

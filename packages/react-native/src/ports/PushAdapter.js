/**
 * PushAdapter — port bridging native push services (APNs/FCM/Expo) to the SDK.
 * @abstract
 *
 * ── Ports-and-adapters boundary ─────────────────────────────────────────────
 * This is one of the three named ports under `@onderling/react-native/ports`
 * (with {@link BackgroundAdapter} and {@link SecureStore}). It is the shared,
 * platform-neutral CONTRACT; the per-platform native code lives in concretes:
 *   - ExpoNotificationsAdapter — v1 default, wraps `expo-notifications`.
 *   - APNsAdapter / FCMAdapter — direct, future v2 (the iOS/Android slots).
 *   - MockPushAdapter          — device-free testing.
 *
 * (Re-homed here from `transport/pushAdapters/PushAdapter.js` in the RN
 * ports-and-adapters formalization — that old path now re-exports this class,
 * so nothing that imported it breaks.)
 *
 * Adapter contract:
 *   - `register(opts)` requests OS-level permission and returns a device-bound
 *     push token plus the platform that minted it.  Throws with
 *     `code: 'PUSH_PERMISSION_DENIED'` if the user denies.
 *   - `onNotification(handler)` subscribes to incoming notifications.  The
 *     returned function unsubscribes.  Handler receives
 *     `{ data: object, foreground: boolean }`.
 *   - `unregister()` is idempotent — tears down listeners.
 *   - `presentLocal({ title, body, data })` shows a LOCAL notification
 *     immediately (no server round-trip) — the mobile counterpart to web's
 *     `showLocalNotification`.  Resolves `false` when notifications aren't
 *     granted/available.
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

  /**
   * Present a LOCAL notification immediately (no server push) — the mobile
   * counterpart to web's `showLocalNotification`, used by the verify-summary
   * nudge (self-poll/self-notify).  Resolves `false` when notifications aren't
   * granted/available.
   * @param {object} [notification]
   * @param {string} [notification.title]
   * @param {string} [notification.body]
   * @param {object} [notification.data]
   * @returns {Promise<boolean>}
   */
  // eslint-disable-next-line no-unused-vars
  async presentLocal(notification) {
    throw new Error('PushAdapter.presentLocal() not implemented');
  }
}

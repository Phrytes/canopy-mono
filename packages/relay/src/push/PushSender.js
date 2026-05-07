/**
 * PushSender — outbound push notification primitive (server-side).
 * @abstract
 *
 * Pairs with the device-side `MobilePushBridge` in `@canopy/react-native`:
 *   - device registers via Expo/APNs/FCM, gets a token, ships it to the relay
 *     with `{type: 'register-push-token'}`.
 *   - relay stores the token in `PushTokenRegistry`.
 *   - when a message lands for an offline peer with a registered token, the
 *     relay calls `pushSender.send(token, payload)`.
 *   - device wakes; `MobilePushBridge` dispatches the payload to a skill or
 *     emits a generic `push` event.
 *
 * Implementations:
 *   - `ExpoPushSender` — calls Expo's HTTP push API. Default for v0; works
 *     with both Expo push tokens and direct APNs/FCM tokens routed via Expo.
 *   - Future direct APNs / FCM senders for apps that bring their own
 *     Apple/Google credentials.
 *
 * Contract:
 *   - `send(token, payload, opts)` is best-effort and never throws.  Returns
 *     `{ok: true}` on confirmed acceptance by the push provider, or
 *     `{ok: false, error}` on any failure.  Callers MUST NOT depend on
 *     successful delivery — push is fire-and-forget by design.
 *   - Implementations should be safe to call rapidly; throttling is the
 *     caller's responsibility (the relay throttles per recipient).
 */
export class PushSender {
  /**
   * Send a wake-up push notification.
   *
   * @param {string} token         device push token
   * @param {object} payload       data-only push payload (no UI / no sound by default)
   * @param {object} [opts]
   * @param {string} [opts.platform]   'ios'|'android'|'web' — informational
   * @param {string} [opts.priority]   'default'|'high' — providers may honour or ignore
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  // eslint-disable-next-line no-unused-vars
  async send(token, payload, opts) {
    throw new Error('PushSender.send() not implemented');
  }
}

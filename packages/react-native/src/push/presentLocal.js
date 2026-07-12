/**
 * presentLocal — the single shared implementation of "show a LOCAL
 * notification immediately" (no server push).  The mobile counterpart to
 * web's `showLocalNotification`.
 *
 * This lives ONCE here.  Two consumers use it:
 *   - `PushAdapter.presentLocal()` (via ExpoNotificationsAdapter) — the port
 *     surface, so a future iOS/Android adapter satisfies the same contract.
 *   - `presentLocalNotification()` — the imperative helper apps call directly
 *     (canopy-chat-mobile's verify-summary nudge).  Folded here from the app's
 *     old `src/v2/nativePush.js` dup (invariant #3) — behaviour is identical:
 *     schedule with a `null` trigger so it presents now; no-op (`false`) when
 *     permission isn't granted or notifications aren't available.
 *
 * `expo-notifications` is lazy-imported (or injected for tests), so importing
 * this module has no native side effect.
 */

/**
 * Pure logic, given a resolved `expo-notifications`-shaped namespace.
 * @param {object} Notifications  `getPermissionsAsync` + `scheduleNotificationAsync`.
 * @param {object} [args]
 * @param {string} [args.title]
 * @param {string} [args.body]
 * @param {object} [args.data]
 * @returns {Promise<boolean>}
 */
export async function presentLocalWith(Notifications, { title, body, data } = {}) {
  if (!Notifications) return false;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (perm?.granted !== true) return false;
    await Notifications.scheduleNotificationAsync({
      content: { title: title || 'Feedback', body: body || '', data },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Imperative helper — resolves `expo-notifications` (lazy, or injected) and
 * presents the notification.  Returns `false` when the native module is
 * absent, permission isn't granted, or scheduling throws.
 *
 * @param {object} [args]
 * @param {string} [args.title]
 * @param {string} [args.body]
 * @param {object} [args.data]
 * @param {object} [args.notifications]  inject `expo-notifications` for tests.
 * @returns {Promise<boolean>}
 */
export async function presentLocalNotification({ title, body, data, notifications } = {}) {
  let Notifications = notifications;
  if (!Notifications) {
    try { Notifications = await import('expo-notifications'); }
    catch { return false; }
  }
  return presentLocalWith(Notifications, { title, body, data });
}

/**
 * push — Stoop V3 Phase 40.9.
 *
 * Thin wrapper over `@canopy/react-native`'s `MobilePushBridge` +
 * `ExpoNotificationsAdapter`. Owns:
 *
 *   1. Permission gate — `requestPushPermission()` asks the OS once,
 *      caches the answer in-memory for this process.
 *   2. Bring-up — `setupPush({agent, projectId})` instantiates the
 *      bridge, registers for the device push token, and surfaces it
 *      via `onToken`. The token is what the agent ships to a relay /
 *      backend that can wake this device later.
 *   3. Tear-down — `teardown()` unregisters cleanly on sign-out.
 *
 * Notification routing is handled by `MobilePushBridge` itself
 * (`agent.emit('push', {data, foreground})` + skill-id dispatch).
 * Stoop-specific routing of payload kinds (chat-message,
 * skill-claim, ...) lands alongside the UI in Phase 40.10 — wire
 * via `agent.on('push', ...)` from there.
 *
 * Adapters are imported via the substrate's documented subpath
 * — `MobilePushBridge` lives on the barrel, but
 * `ExpoNotificationsAdapter` deliberately does NOT (it pulls
 * `expo-notifications` at module-load time, see
 * `packages/react-native/index.js`).
 */

// Deep imports — avoid the barrel so we don't transitively load
// `react-native-keychain` (a peer dep apps that don't sign-in via
// the OS keychain shouldn't need under tests).
import { MobilePushBridge }
  from '@canopy/react-native/src/transport/MobilePushBridge.js';

// `ExpoNotificationsAdapter` imports `expo-notifications` and
// `react-native` at module-load time — fine on a real device, painful
// under vitest where `react-native` ships untransformed ESM in
// node_modules.  Load lazily so callers injecting `AdapterFactory`
// (i.e. tests) never trigger it.
async function _defaultAdapterFactory() {
  const mod = await import('@canopy/react-native/src/transport/pushAdapters/ExpoNotificationsAdapter.js');
  return new mod.ExpoNotificationsAdapter();
}

/**
 * Bring up push for the local agent.
 *
 * @param {object} args
 * @param {import('@canopy/core').Agent} args.agent
 * @param {string} [args.projectId]   EAS project id; required by Expo Go runtime to mint tokens.
 * @param {(token: string, platform: 'ios'|'android'|'web') => void} [args.onToken]
 *   Called with the device token after registration succeeds.
 * @param {(err: unknown) => void} [args.onError]
 * @param {() => PushAdapter | Promise<PushAdapter>} [args.AdapterFactory]
 *   Returns a freshly-constructed adapter; injected by tests.
 *   Defaults to lazily building `new ExpoNotificationsAdapter()`.
 *
 * @returns {Promise<{
 *   bridge: MobilePushBridge | null,
 *   token:  string | null,
 *   platform: 'ios' | 'android' | 'web' | null,
 *   teardown: () => Promise<void>,
 * }>}
 *
 * On permission denial OR registration failure resolves with
 * `{ bridge: null, token: null, ... }` — callers branch on `token`
 * being null.  The `onError` callback receives the underlying
 * exception when one was thrown.
 */
export async function setupPush({
  agent,
  projectId,
  onToken,
  onError,
  AdapterFactory,
} = {}) {
  if (!agent) throw new Error('setupPush: agent is required');

  const factory = AdapterFactory ?? _defaultAdapterFactory;
  const adapter = await factory();
  const bridge  = new MobilePushBridge({ agent, adapter });

  let token    = null;
  let platform = null;
  try {
    const reg = await bridge.register({ projectId });
    token    = reg.token    ?? null;
    platform = reg.platform ?? null;
    if (token && onToken) onToken(token, platform);
  } catch (err) {
    if (onError) onError(err);
    return {
      bridge: null,
      token: null,
      platform: null,
      teardown: async () => {},
    };
  }

  return {
    bridge,
    token,
    platform,
    teardown: async () => {
      try { await bridge.unregister(); }
      catch (err) { if (onError) onError(err); }
    },
  };
}

/**
 * Ask `expo-notifications` for permission. Idempotent — once
 * granted, subsequent calls return the cached state without
 * re-prompting.
 *
 * @param {object} [args]
 * @param {object} [args.NotificationsModule] injected for tests
 *   (defaults to `import('expo-notifications')`).
 * @returns {Promise<{ granted: boolean, status: string }>}
 */
export async function requestPushPermission({ NotificationsModule } = {}) {
  const Notifications = NotificationsModule ?? await _loadExpoNotifications();
  const r = await Notifications.requestPermissionsAsync();
  return {
    granted: r?.granted === true || r?.status === 'granted',
    status:  r?.status ?? (r?.granted ? 'granted' : 'denied'),
  };
}

async function _loadExpoNotifications() {
  // Loaded lazily — apps that never call requestPushPermission
  // shouldn't pay the import cost.
  const mod = await import('expo-notifications');
  return mod;
}

export const _internal = { _loadExpoNotifications, _defaultAdapterFactory };

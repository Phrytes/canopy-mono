/**
 * @canopy/react-native/ports — the RN ports-and-adapters boundary.
 *
 * Three ports name the native seam so the shared 85%+ RN layer stays
 * branch-free and the future iOS/Android work drops into named slots
 * (see `plans/PLAN-rn-ports-adapters.md`):
 *
 *   - PushAdapter        — push register / notify / local-present.
 *   - BackgroundAdapter  — cold-start task / reconnect / wake / app-state.
 *   - SecureStore        — encrypted key/value device storage.
 *
 * Each ships an abstract port, a v1 Expo concrete that WRAPS today's code
 * with zero behaviour change, and a device-free Mock for testing.  A future
 * platform adapter is "done" when the port contract test passes against it.
 */

// Ports (abstract contracts)
export { PushAdapter }       from './PushAdapter.js';
export { BackgroundAdapter } from './BackgroundAdapter.js';
export { SecureStore }       from './SecureStore.js';

// Concretes (v1 — wrap existing code)
//   ExpoNotificationsAdapter is NOT re-exported here: it imports
//   `expo-notifications` at module load (peer dep).  Import it from
//   `@canopy/react-native/src/transport/pushAdapters/ExpoNotificationsAdapter.js`.
export { ExpoBackgroundAdapter } from './backgroundAdapters/ExpoBackgroundAdapter.js';
export { ExpoSecureStore }       from './secureStores/ExpoSecureStore.js';

// iOS reliable-wake SLOTs (⚠️ SCAFFOLD — native side needs on-device
// verification; the JS surface satisfies the port contracts today).  These are
// dependency-injected (no static `expo-*`/native import), so they're safe to
// export + construct device-free.  See docs/ios-reliable-wake-runbook.md.
export { IosPushAdapter }        from './pushAdapters/IosPushAdapter.js';
export { IosBackgroundAdapter }  from './backgroundAdapters/IosBackgroundAdapter.js';

// Mocks (device-free testing)
export { MockPushAdapter }       from './mocks/MockPushAdapter.js';
export { MockBackgroundAdapter } from './mocks/MockBackgroundAdapter.js';
export { MemorySecureStore }     from './mocks/MemorySecureStore.js';

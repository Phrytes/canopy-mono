/**
 * PushAdapter — re-export shim.
 *
 * The canonical PushAdapter port was re-homed to `src/ports/PushAdapter.js`
 * in the RN ports-and-adapters formalization.  This path is kept as a
 * re-export so existing imports
 * (`transport/pushAdapters/PushAdapter.js` — MobilePushBridge,
 * ExpoNotificationsAdapter, tests) keep working unchanged.
 *
 * New code should import from `@canopy/react-native/ports`.
 */
export { PushAdapter } from '../../ports/PushAdapter.js';

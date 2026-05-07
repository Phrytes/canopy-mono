// service-factory — helper for substrate authors to select between
// Node and React Native implementations of a service when Metro's
// `*.js` / `*.rn.js` auto-resolution doesn't fit (e.g. dynamic decision
// at runtime, or when both impls need to be statically analysable).
//
// Usage:
//
//   import { selectPlatform } from '@canopy/react-native/platform/service-factory';
//
//   const Service = selectPlatform({
//     rn:      () => require('./MyModule.rn.js'),
//     default: () => require('./MyModule.js'),
//   });
//
// For the simpler case where Metro can resolve `*.rn.js`
// automatically, prefer that pattern over service-factory.

let _isReactNative = null;

/**
 * @returns {boolean} true if the current runtime is React Native.
 */
export function isReactNative() {
  if (_isReactNative !== null) return _isReactNative;
  _isReactNative = (
    typeof navigator !== 'undefined' &&
    typeof navigator.product === 'string' &&
    navigator.product === 'ReactNative'
  );
  return _isReactNative;
}

/**
 * Select between two implementations based on runtime.
 *
 * @template T
 * @param {object} args
 * @param {() => T} args.rn         RN-variant factory.
 * @param {() => T} args.default    Node / web variant factory.
 * @returns {T}
 */
export function selectPlatform({ rn, default: defaultImpl }) {
  if (typeof rn !== 'function' || typeof defaultImpl !== 'function') {
    throw new TypeError(
      'selectPlatform requires { rn: fn, default: fn } — both must be functions for lazy resolution.',
    );
  }
  return isReactNative() ? rn() : defaultImpl();
}

/**
 * Reset the cached platform detection.  Test-only.
 *
 * @private
 */
export function _resetPlatformCache() {
  _isReactNative = null;
}

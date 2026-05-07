// Polyfills entry — Node / web variant.
//
// This file is the *default* (non-RN) variant.  Node and web bundlers
// resolve to this; React Native's Metro bundler resolves to the
// `.rn.js` variant, which actually patches RN globals.
//
// On Node / web the runtime already has crypto.getRandomValues,
// Buffer, TextDecoder, etc., so this file is intentionally empty
// beyond a sanity-check log when run in dev mode.
//
// Consumers should import this as a side-effect from their app's
// entry point BEFORE importing any other @canopy substrate:
//
//   import '@canopy/react-native/platform/polyfills';
//
// On Node this is a no-op.  On RN it wires up the polyfills.

if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
  console.warn(
    '[@canopy/react-native/platform/polyfills] crypto.getRandomValues unavailable on this runtime. ' +
    'Substrates that sign or generate keys will fail.',
  );
}

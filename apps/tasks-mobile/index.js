// All the cross-cutting polyfills (crypto.getRandomValues, globalThis.Buffer,
// Blob.arrayBuffer / .text, Blob constructor for ArrayBuffer parts) live in
// the substrate package — same as stoop-mobile + folio-mobile. This MUST be
// the first import here (Hermes resolves crypto at module-load time).
import '@canopy/react-native/platform/polyfills';

import 'expo-dev-client';
import { registerRootComponent } from 'expo';

import App from './App.js';

// Phase 41.1 (2026-05-09) — placeholder boot. The bg-fetch task wiring
// (defineBackgroundTask + bgRunOnce) lands in Phase 41.14 once the
// agent + cadence are live.

registerRootComponent(App);

// CRITICAL: polyfills MUST be the first import (Hermes resolves crypto
// at module-load time; later imports that need crypto.getRandomValues,
// globalThis.Buffer, Blob.arrayBuffer / .text, or Blob constructor for
// ArrayBuffer parts will crash silently if this lands second).  Same
// substrate as stoop-mobile + folio-mobile + tasks-mobile (see
// apps/stoop-mobile/index.js for the canonical comment).
import '@canopy/react-native/platform/polyfills';

// @expo/metro-runtime adds the fast-refresh + web-only runtime hooks
// required by metro-web (#224 Phase A).  Native bundles ignore it.
import '@expo/metro-runtime';

import 'expo-dev-client';
import { registerRootComponent } from 'expo';

import App from './App.js';

registerRootComponent(App);

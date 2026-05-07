// All the cross-cutting polyfills (crypto.getRandomValues, globalThis.Buffer,
// Blob.arrayBuffer / .text, Blob constructor for ArrayBuffer parts) live in
// the substrate package — same as folio-mobile.  This MUST be the first
// import here (Hermes resolves crypto at module-load time).
import '@canopy/react-native/platform/polyfills';

import 'expo-dev-client';
import { registerRootComponent } from 'expo';
import App from './App.js';

registerRootComponent(App);

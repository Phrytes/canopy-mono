// All the cross-cutting polyfills (crypto.getRandomValues, globalThis.Buffer,
// Blob.arrayBuffer / .text, Blob constructor for ArrayBuffer parts) live in
// the substrate package — same as folio-mobile.  This MUST be the first
// import here (Hermes resolves crypto at module-load time).
import '@canopy/react-native/platform/polyfills';

import 'expo-dev-client';
import { registerRootComponent } from 'expo';

import * as TaskManager from 'expo-task-manager';
import { defineBackgroundTask, bgRunOnce, BG_TASK_NAME }
  from './src/lib/bgRunOnce.js';

import App from './App.js';

// Phase 40.21 (2026-05-08).  Define the background-fetch task at
// module-load time per Expo's requirement.  The task body calls
// `bgRunOnce()` which delegates to whatever ServiceContext set via
// `setBgRunOnce` (i.e. the active bundle's tick function). When no
// bundle is active, the call resolves to null and the OS treats it
// as 'noData'.
defineBackgroundTask({
  TaskManager,
  taskName: BG_TASK_NAME,
  runOnce:  bgRunOnce,
});

registerRootComponent(App);

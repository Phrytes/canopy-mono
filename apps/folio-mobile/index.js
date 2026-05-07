// All the cross-cutting polyfills (crypto.getRandomValues, globalThis.Buffer,
// Blob.arrayBuffer / .text, Blob constructor for ArrayBuffer parts) live in
// the substrate package — see packages/react-native/src/platform/polyfills.rn.js
// + packages/react-native/docs/BRING-UP-NOTES.md (traps 11-13).  This MUST
// be the first import in this file (Hermes resolves crypto at module-load
// time).
import '@canopy/react-native/platform/polyfills';

import 'expo-dev-client';

// Background-fetch task definition.  Must run at JS-load time (Expo's
// requirement — the OS may cold-wake the app to fire the task, and
// `TaskManager.defineTask` is what the OS looks for).  Registration is
// in ServiceContext after sign-in; teardown on sign-out.
import * as TaskManager from 'expo-task-manager';
import { defineBackgroundTask } from '@canopy/sync-engine-rn';
import { bgRunOnce, BG_TASK_NAME } from './src/lib/bgRunOnce.js';

defineBackgroundTask({
  TaskManager,
  taskName: BG_TASK_NAME,
  runOnce: async () => {
    const r = await bgRunOnce();
    return r ?? { uploads: 0, downloads: 0, deletes: 0, conflicts: 0 };
  },
});

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);

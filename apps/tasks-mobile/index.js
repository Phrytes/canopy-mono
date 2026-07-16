// All the cross-cutting polyfills (crypto.getRandomValues, globalThis.Buffer,
// Blob.arrayBuffer / .text, Blob constructor for ArrayBuffer parts) live in
// the substrate package — same as stoop-mobile + folio-mobile. This MUST be
// the first import here (Hermes resolves crypto at module-load time).
import '@onderling/react-native/platform/polyfills';

import 'expo-dev-client';
import { registerRootComponent } from 'expo';

import * as TaskManager from 'expo-task-manager';
import {
  defineBackgroundTask, bgRunOnce,
} from '@onderling/sync-engine-rn';

import App from './App.js';

// Phase 41.14 (2026-05-09) — bg-fetch task definition.
// MUST be at JS-bundle load time per Expo's TaskManager API. The
// task body calls `bgRunOnce()` from the substrate's module-level
// singleton; ServiceContext later wires the actual runOnce via
// `setBgRunOnce(...)` once the meshAgent + localStoreBundle are
// ready. When the OS fires this before that point, `bgRunOnce`
// resolves to null and the task returns NoData.
export const TASKS_BG_TASK_NAME = 'tasks-mobile-sync-background';

defineBackgroundTask({
  TaskManager,
  taskName: TASKS_BG_TASK_NAME,
  runOnce:  bgRunOnce,
});

registerRootComponent(App);

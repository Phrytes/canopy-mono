# `@canopy/online-cadence`

> **Layer:** SDK foundation (RN-flavored cadence helpers).
> **Convention:** RN-specific substrates live in their own packages
> (locked 2026-05-08, see
> [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md#mobile-substrates-live-in-their-own-packages-locked-2026-05-08)).

Foreground/background cadence helpers for React Native agents:

- `createActiveCadence({runOnce, getPollIntervalMs, AppState, onError})` —
  pure-JS ticker that drives a `runOnce()` pass at a configurable
  interval while the app is foreground; pauses when backgrounded.
- `attachAppStateBridge({bundle, getPollIntervalMs, AppState})` —
  wires the cadence helper to a live agent bundle: drives
  `bundle.cache.setOnline(true|false)` on AppState transitions and
  ticks `bundle.skillMatch.tick()` on each foreground pass. Returns
  a cleanup callback.
- Re-exports of the bg-fetch helpers from `@canopy/sync-engine-rn`
  (`setBgRunOnce`, `clearBgRunOnce`, `bgRunOnce`,
  `registerBackgroundTask`, `defineBackgroundTask`,
  `registerBackgroundFetch`, `unregisterBackgroundFetch`,
  `statusBackgroundFetch`, `DEFAULT_BACKGROUND_FETCH_INTERVAL_S`) so
  apps can import the whole cadence + bg-task surface from one
  module.

## Origins

Lifted from `apps/stoop-mobile/src/lib/{activeCadence, appStateBridge,
bgRunOnce}.js` on **2026-05-09** as part of Tasks-mobile Phase 41.0
L2 — Tasks-mobile is the second consumer (rule of two). Stoop V3's
copies are now thin re-exports through the substrate. `bgRunOnce` had
already been promoted to `@canopy/sync-engine-rn` in 2026-05-08;
this package re-exports it for ergonomic colocation.

## Example

```js
import {
  attachAppStateBridge,
  setBgRunOnce,
  registerBackgroundTask,
} from '@canopy/online-cadence';
import { AppState } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';

// Attach foreground cadence after the bundle is built:
const detach = attachAppStateBridge({
  bundle,
  getPollIntervalMs: () => settings.get().pollIntervalMs,
  AppState,
});

// And the bg-fetch bridge at JS-bundle load:
registerBackgroundTask({
  taskName:    'my-app-sync-background',
  defineTask:  TaskManager.defineTask,
  results:     BackgroundFetch.BackgroundFetchResult,
});
setBgRunOnce(() => engine.runOnce());
```

## Tests

```sh
npm test
```

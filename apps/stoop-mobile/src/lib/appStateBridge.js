/**
 * Re-export of the lifted AppState bridge.
 *
 * The implementation moved to `@onderling/online-cadence` 2026-05-09
 * (Phase 41.0 L2). Stoop's call sites pass RN's AppState explicitly,
 * which is what the substrate now requires.
 */
import { AppState } from 'react-native';
import { attachAppStateBridge as _attachAppStateBridge } from '@onderling/online-cadence';

/**
 * Convenience wrapper that defaults `AppState` to RN's import. Apps
 * that want to inject a stub (tests) should call the substrate's
 * `attachAppStateBridge` directly.
 */
export function attachAppStateBridge({
  bundle,
  getPollIntervalMs,
  onError,
  AppStateModule = AppState,
} = {}) {
  return _attachAppStateBridge({
    bundle,
    getPollIntervalMs,
    onError,
    AppState: AppStateModule,
  });
}

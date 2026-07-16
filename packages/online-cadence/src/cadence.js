/**
 * cadence — foreground / background ticker controller.
 *
 * Lifted from apps/stoop-mobile/src/lib/activeCadence.js 2026-05-09
 * (Phase 41.0 L2; Tasks-mobile is the second consumer).
 *
 * When the app is foreground we tick at `getPollIntervalMs()` (default
 * 5000 ms — battery-aware); when backgrounded we cancel the ticker and
 * let the OS-driven background-fetch task handle sync (see `./bgTask.js`,
 * which re-exports the helpers from `@onderling/sync-engine-rn`).
 *
 * Designed to be peer-injected — both `runOnce` and the `AppState`
 * namespace are passed in, which makes the ticker easy to unit-test
 * without React Native and easy to repurpose across apps.
 */

const DEFAULT_POLL_INTERVAL_MS = 5000;
const MIN_POLL_INTERVAL_MS     = 1000;

/**
 * @param {object} args
 * @param {() => Promise<unknown>} args.runOnce
 *   Idempotent sync pass; invoked on each foreground tick.
 * @param {() => number} [args.getPollIntervalMs]
 *   Reads the current `pollIntervalMs` from settings. Defaults to 5000 ms.
 * @param {object} args.AppState
 *   `import { AppState } from 'react-native'`. Tests pass a stub.
 * @param {(err: unknown) => void} [args.onError]
 *   Optional error sink for `runOnce` exceptions; defaults to swallow.
 *   The cadence keeps ticking regardless — one bad tick mustn't stop
 *   the next.
 * @returns {{
 *   start:    () => void,
 *   stop:     () => void,
 *   refresh:  () => void,
 *   isActive: () => boolean,
 *   _state:   () => { active: boolean, intervalMs: number, ticking: boolean },
 * }}
 */
export function createActiveCadence({
  runOnce,
  getPollIntervalMs = () => DEFAULT_POLL_INTERVAL_MS,
  AppState,
  onError,
} = {}) {
  if (typeof runOnce !== 'function') {
    throw new Error('createActiveCadence: runOnce(): Promise required');
  }
  if (!AppState) {
    throw new Error('createActiveCadence: AppState namespace required');
  }

  let timer        = null;
  let subscription = null;
  let active       = false;
  let foreground   = true;
  let intervalMs   = _resolveInterval(getPollIntervalMs);

  function _tick() {
    let ret;
    try {
      ret = runOnce();
    } catch (err) {
      if (onError) onError(err);
      return;
    }
    if (ret && typeof ret.catch === 'function') {
      ret.catch((err) => { if (onError) onError(err); });
    }
  }

  function _startTicker() {
    if (timer) return;
    timer = setInterval(_tick, intervalMs);
  }

  function _stopTicker() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function _onAppStateChange(next) {
    const wasForeground = foreground;
    foreground = next === 'active';
    if (foreground && !wasForeground) _startTicker();
    if (!foreground && wasForeground) _stopTicker();
  }

  function start() {
    if (active) return;
    active = true;
    foreground = AppState.currentState === undefined
      ? true
      : AppState.currentState === 'active';
    subscription = AppState.addEventListener('change', _onAppStateChange);
    if (foreground) _startTicker();
  }

  function stop() {
    if (!active) return;
    active = false;
    if (subscription && typeof subscription.remove === 'function') {
      subscription.remove();
    }
    subscription = null;
    _stopTicker();
  }

  function refresh() {
    const next = _resolveInterval(getPollIntervalMs);
    if (next === intervalMs) return;
    intervalMs = next;
    if (timer) {
      _stopTicker();
      _startTicker();
    }
  }

  return {
    start,
    stop,
    refresh,
    isActive: () => active,
    _state: () => ({ active, intervalMs, ticking: timer !== null }),
  };
}

function _resolveInterval(fn) {
  let raw;
  try {
    raw = fn();
  } catch {
    raw = DEFAULT_POLL_INTERVAL_MS;
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_POLL_INTERVAL_MS;
  return Math.max(MIN_POLL_INTERVAL_MS, Math.floor(raw));
}

export const _internal = {
  DEFAULT_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  _resolveInterval,
};

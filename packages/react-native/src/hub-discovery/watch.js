/**
 * `watch(callback)` — observe Hub install / uninstall mid-session.
 *
 * Listens for Android `ACTION_PACKAGE_ADDED` and
 * `ACTION_PACKAGE_REMOVED` broadcast intents via the native bridge.
 * On every event, invalidates the discovery cache so the next
 * `check()` reflects current state, then fires the caller's callback.
 *
 * Standardisation Phase 51.6.3.
 *
 * @typedef {object} HubInstallEvent
 * @property {'added'|'removed'} op
 * @property {string} packageName
 * @property {string} at                  — ISO
 */

/**
 * @param {object} args
 * @param {object}   args.nativeModule    — { subscribePackageEvents(cb) → unsubscribe }
 * @param {object}   args.cache
 * @param {(event: HubInstallEvent) => void} args.callback
 * @param {() => string} [args.now]
 * @returns {() => void}                  unsubscribe
 */
export function watch({
  nativeModule,
  cache,
  callback,
  now = () => new Date().toISOString(),
} = {}) {
  if (!nativeModule || typeof nativeModule.subscribePackageEvents !== 'function') {
    throw Object.assign(
      new Error('hub-discovery.watch: nativeModule.subscribePackageEvents is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (!cache || typeof cache.invalidate !== 'function') {
    throw Object.assign(
      new Error('hub-discovery.watch: cache is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (typeof callback !== 'function') {
    throw Object.assign(
      new Error('hub-discovery.watch: callback must be a function'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  let active = true;
  const nativeUnsub = nativeModule.subscribePackageEvents((raw) => {
    if (!active || !raw || typeof raw !== 'object') return;
    cache.invalidate();
    const event = Object.freeze({
      op:          raw.op === 'added' || raw.op === 'removed' ? raw.op : 'unknown',
      packageName: typeof raw.packageName === 'string' ? raw.packageName : '',
      at:          now(),
    });
    try { callback(event); } catch { /* swallow */ }
  });

  return () => {
    active = false;
    if (typeof nativeUnsub === 'function') {
      try { nativeUnsub(); } catch { /* swallow */ }
    }
  };
}

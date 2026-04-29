/**
 * Folio.B1.tray — Windows driver shim (post-v2.7).
 *
 * The real Windows tray icon is now driven by `systray2` from `./index.js`.
 * This module survives only as a thin compatibility shim for the legacy
 * driver-mode tests.  In production, `./index.js` does NOT load this file;
 * OS dispatch happens inside the `systray2` Go binary.
 *
 * Driver interface matches `linux.js` and `macos.js`.
 */
const STATE_TEXT = {
  'sync-idle':     'Folio: idle — up to date',
  'sync-active':   'Folio: syncing…',
  'sync-conflict': 'Folio: conflicts need attention',
  'sync-error':    'Folio: error — server unreachable',
};

/**
 * @returns {Promise<object>}
 */
export async function createDriver() {
  let clickHandler = () => {};
  let lastState = null;
  let destroyed = false;
  // Keep the historical "starting up" log so legacy callers know they're on
  // the shim path.  Tests stub out console.log to silence this.
  // eslint-disable-next-line no-console
  console.log('folio tray: legacy windows driver shim — real-mode uses systray2.');

  return {
    async setIcon(stateName) {
      if (destroyed) return;
      if (stateName === lastState) return;
      lastState = stateName;
      const text = STATE_TEXT[stateName] ?? `Folio: ${stateName}`;
      // eslint-disable-next-line no-console
      console.log(`folio tray [windows]: ${text}`);
    },
    onClick(handler) {
      clickHandler = typeof handler === 'function' ? handler : (() => {});
    },
    triggerClick() {
      try { return clickHandler(); } catch { /* swallow */ }
    },
    async destroy() {
      destroyed = true;
      lastState = null;
      clickHandler = () => {};
    },
  };
}

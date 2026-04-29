/**
 * Folio.B1.tray — Windows driver (stub for v1).
 *
 * Spec calls macOS + Linux as v1 targets; Windows is stretch.  This stub
 * matches the driver interface so `index.js`'s OS dispatch never throws on
 * Windows — it just logs state changes to stdout.
 *
 * A real implementation could use Windows Toast notifications via
 * `powershell -Command "...BurntToast..."` or wrap the `node-notifier`
 * Snore-Toast helper.  Both are out of scope for v1.
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
  // Print once at startup so a user running `folio tray` on Windows knows
  // they're on the stub.
  // eslint-disable-next-line no-console
  console.log('folio tray: Windows tray driver is a stub in v1 — status changes will print to stdout.');

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

/**
 * Folio.B1.tray — macOS driver shim (post-v2.7).
 *
 * The real macOS menubar icon is now driven by `systray2` from `./index.js`.
 * This module survives only as a thin compatibility shim for the legacy
 * driver-mode tests.  In production, `./index.js` does NOT load this file;
 * OS dispatch happens inside the `systray2` Go binary.
 *
 * Driver interface matches `linux.js` and `windows.js`.
 */
import { exec as defaultExec } from 'node:child_process';

const STATE_TEXT = {
  'sync-idle':     'Folio: idle — up to date',
  'sync-active':   'Folio: syncing…',
  'sync-conflict': 'Folio: conflicts need attention',
  'sync-error':    'Folio: error — server unreachable',
};

/**
 * @param {object}   opts
 * @param {URL}      [opts.iconsDir]
 * @param {Function} [opts.exec]
 */
export async function createDriver({ exec: execImpl } = {}) {
  const run = execImpl ?? defaultExec;
  let clickHandler = () => {};
  let lastState = null;
  let destroyed = false;

  return {
    async setIcon(stateName) {
      if (destroyed) return;
      if (stateName === lastState) return;
      lastState = stateName;
      const text = STATE_TEXT[stateName] ?? `Folio: ${stateName}`;
      const escaped = text.replace(/'/g, `'\\''`);
      const cmd = `osascript -e 'display notification "${escaped}" with title "Folio"'`;
      await new Promise((res) => {
        run(cmd, (err) => {
          if (err) {
            // eslint-disable-next-line no-console
            console.log(`folio tray [macos]: ${stateName} (${text})`);
          }
          res();
        });
      });
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

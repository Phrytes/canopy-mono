/**
 * Folio.B1.tray — macOS driver.
 *
 * Implementation strategy: shell-out to `osascript`.
 *
 *   • Status changes → `osascript -e 'display notification …'` for a native
 *     macOS Notification Center entry.
 *   • Click handling has no native hook from pure Node; users open the URL
 *     via the CLI (`folio tray --open`) or by reacting to the notification.
 *
 * For users who run a third-party menu-bar manager (BitBar / xbar / SwiftBar),
 * `folio tray --xbar` (future flag) will print a SwiftBar-formatted line —
 * those tools poll a script and render the result as a real menu-bar icon.
 * That route is documented in `apps/folio/src/tray/CHOICE.md` but not wired
 * up in v1.
 *
 * Driver interface matches `linux.js` and `windows.js`.
 */
import { exec } from 'node:child_process';

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
 * @returns {Promise<object>}
 */
export async function createDriver({ exec: execImpl } = {}) {
  const run = execImpl ?? exec;
  let clickHandler = () => {};
  let lastState = null;
  let destroyed = false;

  return {
    async setIcon(stateName) {
      if (destroyed) return;
      if (stateName === lastState) return;
      lastState = stateName;
      const text = STATE_TEXT[stateName] ?? `Folio: ${stateName}`;
      // osascript needs the inner string properly escaped.  Use single-quoted
      // shell + escape any single quotes in the message.
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

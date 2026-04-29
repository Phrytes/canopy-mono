/**
 * Folio.B1.tray — Linux driver shim (post-v2.7).
 *
 * The real Linux tray icon is now driven by `systray2` from `./index.js`.
 * This module survives only as a thin compatibility shim for the legacy
 * driver-mode tests (`tray.test.js`'s "linux driver — shells out to
 * notify-send" suite).  In production, `./index.js` does NOT load this
 * file; OS dispatch happens inside the `systray2` Go binary.
 *
 * The shim implements the historical driver interface:
 *
 *   {
 *     setIcon(stateName: string): Promise<void>
 *     onClick(handler: () => void): void
 *     triggerClick(): void
 *     destroy(): Promise<void>
 *   }
 *
 * `setIcon` shells out to `notify-send` only if `exec` is supplied (the
 * tests inject a stub).  Without `exec`, `setIcon` is a no-op so this
 * file never spawns notifications during real-mode runs.
 */
import { exec as defaultExec } from 'node:child_process';

const NOTIFY_TITLE = 'Folio';
const STATE_TEXT = {
  'sync-idle':     'idle — up to date',
  'sync-active':   'syncing…',
  'sync-conflict': 'conflicts need attention',
  'sync-error':    'error — server unreachable',
};

/**
 * @param {object} opts
 * @param {URL}    [opts.iconsDir]
 * @param {Function} [opts.exec]
 */
export async function createDriver({ iconsDir, exec: execImpl } = {}) {
  const run = execImpl ?? defaultExec;
  let clickHandler = () => {};
  let lastState = null;
  let destroyed = false;

  const iconPath = (state) => {
    if (!iconsDir) return null;
    try { return new URL(`${state}.png`, iconsDir).pathname; }
    catch { return null; }
  };

  return {
    async setIcon(stateName) {
      if (destroyed) return;
      if (stateName === lastState) return;
      lastState = stateName;
      const text = STATE_TEXT[stateName] ?? stateName;
      const icon = iconPath(stateName);
      const args = [
        '--app-name=Folio',
        `"${NOTIFY_TITLE}"`,
        `"${text.replace(/"/g, '\\"')}"`,
      ];
      if (icon) args.unshift(`--icon=${JSON.stringify(icon)}`);
      const cmd = `notify-send ${args.join(' ')}`;
      await new Promise((res) => {
        run(cmd, (err) => {
          if (err) {
            // eslint-disable-next-line no-console
            console.log(`folio tray [linux]: ${stateName} (${text})`);
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

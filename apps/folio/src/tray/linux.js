/**
 * Folio.B1.tray — Linux driver.
 *
 * Implementation strategy: shell-out only, no GUI dep.
 *
 *   • Status changes → `notify-send` desktop notification (every common
 *     Linux desktop ships libnotify; if it's missing, we just log).
 *   • Click is provided by a CLI helper (`folio tray --open` or just
 *     printing the URL) — pure-Node has no way to listen for clicks on a
 *     desktop notification or system tray without a GUI binding.
 *
 * If you have `yad` installed, it can render an actual system-tray icon via
 * `yad --notification` — we DON'T spawn it by default (it's not standard on
 * every distro), but the driver exposes a hook so a future PR can wire it
 * up.
 *
 * The driver interface (matched by macos.js + windows.js):
 *
 *   {
 *     setIcon(stateName: string): Promise<void>
 *     onClick(handler: () => void): void
 *     destroy(): Promise<void>
 *   }
 */
import { exec } from 'node:child_process';

const NOTIFY_TITLE = 'Folio';
const STATE_TEXT = {
  'sync-idle':     'idle — up to date',
  'sync-active':   'syncing…',
  'sync-conflict': 'conflicts need attention',
  'sync-error':    'error — server unreachable',
};

/**
 * Factory.  `index.js` calls `createDriver({ iconsDir })`.
 *
 * @param {object} opts
 * @param {URL}    [opts.iconsDir]   — folder containing PNG icons (used for notify-send `--icon`)
 * @param {Function} [opts.exec]     — override for tests
 * @returns {Promise<object>}
 */
export async function createDriver({ iconsDir, exec: execImpl } = {}) {
  const run = execImpl ?? exec;
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
      // Best-effort: never throw if notify-send is missing.
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
      // Public hook: a future yad / xdotool integration can call this.
      try { return clickHandler(); } catch { /* swallow */ }
    },
    async destroy() {
      destroyed = true;
      lastState = null;
      clickHandler = () => {};
    },
  };
}

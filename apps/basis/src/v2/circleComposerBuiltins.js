/**
 * basis v2 — composer slash BUILT-INS (DESIGN-connectivity-phase4 §10 / G17).
 *
 * The v2 kring composer intercepts a handful of slash commands as BUILT-INS — the same
 * path `/settings` uses — and dispatches them to the settings/transport handlers instead of
 * routing them to the circle bot/LLM. `/set-relay` + `/transport-mode` (+ `/settings`,
 * `/transports`) used to fall through to `circleBot.handle` and be answered as chat; this
 * classifier is the ONE shared place that recognises them so BOTH shells (web `circleApp.js`
 * + mobile `CircleLauncherScreen.js`) intercept the SAME set by construction (invariants
 * #1/#2 — the decision lives once; each shell only injects platform execution).
 *
 * Pure JS — no I/O, no DOM. Deterministic for tests.
 */

/**
 * The slash commands the composer dispatches as circle/transport built-ins (NOT to the bot).
 * Names match the `surfaces.slash.command` (sans leading `/`) on the basis manifest ops.
 * @type {ReadonlyArray<string>}
 */
export const CIRCLE_BUILTIN_COMMANDS = Object.freeze(['settings', 'set-relay', 'transport-mode', 'transports']);

/** Parse `--lang=nl` / `--lang nl` / `lang nl` out of a `/settings` body. */
function parseSettingsArgs(body) {
  const m = String(body || '').match(/(?:--)?lang[=\s]+([a-z]{2})/i);
  if (m && (m[1].toLowerCase() === 'en' || m[1].toLowerCase() === 'nl')) return { lang: m[1].toLowerCase() };
  return {};
}

/**
 * Classify a composer line. Returns the built-in `{ command, opId, args }` to dispatch as a
 * built-in, or `null` when the line is not one of these circle/transport commands (the shell
 * then continues its normal routing → the bot). The op id matches the manifest op so the shell
 * can run it through the same handler the app-level chat shell uses.
 *
 * @param {string} line  the raw composer text
 * @returns {{command:string, opId:string, args:object}|null}
 */
export function parseCircleBuiltin(line) {
  const raw = String(line == null ? '' : line).trim();
  if (!raw.startsWith('/')) return null;
  const m = raw.match(/^\/([a-z][a-z-]*)\b\s*(.*)$/i);
  if (!m) return null;
  const command = m[1].toLowerCase();
  const body = (m[2] || '').trim();
  if (!CIRCLE_BUILTIN_COMMANDS.includes(command)) return null;

  switch (command) {
    case 'settings':
      return { command, opId: 'settings', args: parseSettingsArgs(body) };
    case 'set-relay':
      if (/^--clear\b/i.test(body) || body.toLowerCase() === 'clear') return { command, opId: 'set-relay', args: { clear: true } };
      return { command, opId: 'set-relay', args: body ? { url: body.split(/\s+/)[0] } : {} };
    case 'transport-mode':
      return { command, opId: 'transport-mode', args: body ? { mode: body.split(/\s+/)[0].toLowerCase() } : {} };
    case 'transports':
      return { command, opId: 'transports', args: {} };
    default:
      return null;
  }
}

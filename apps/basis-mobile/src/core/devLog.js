/**
 * Dev-mode logger for basis-mobile.
 *
 * Default ON when `__DEV__` is true (Metro/Hermes dev build).  Can be
 * toggled at runtime via `setDevLog(true/false)` or the global
 * `globalThis.ccSetDevLog(...)` shim (Metro's debug console + Chrome
 * DevTools both have access to it).
 *
 * Categories are first-class so the consumer can mute one channel
 * without losing the others:
 *   - dlog.boot     — bundle bring-up, vault wiring, transport status
 *   - dlog.dispatch — parseInput → resolveDispatch → runDispatch chain
 *   - dlog.render   — renderReply outputs (kind, item count, button count)
 *   - dlog.button   — row-button taps + their synthesized dispatch
 *   - dlog.warn     — recoverable surprises (always on when enabled)
 *
 * The "ON" default keeps me + Frits seeing structured logs during dev;
 * release builds (`__DEV__ === false`) suppress them entirely so the
 * production console stays quiet.
 *
 * Portable — runs in vitest too.  Tests use `setDevLog(false)` to
 * silence the channel without spying on console.
 */

const ENV_DEFAULT = (typeof __DEV__ !== 'undefined' && __DEV__);

let enabled  = ENV_DEFAULT;
let channels = {
  boot:     true,
  dispatch: true,
  render:   true,
  button:   true,
  warn:     true,
};

/** Master switch — disables EVERY channel. */
export function setDevLog(on) {
  enabled = !!on;
}

/** Channel switch — disable a single category while leaving the rest. */
export function setDevLogChannel(channel, on) {
  if (channel in channels) channels[channel] = !!on;
}

/** Current state (for tests + debug pages). */
export function getDevLogState() {
  return { enabled, channels: { ...channels } };
}

function emit(channel, level, args) {
  if (!enabled || !channels[channel]) return;
  const fn = level === 'warn' ? console.warn : console.log;
  // eslint-disable-next-line no-console
  fn(`[cc/${channel}]`, ...args);
}

export const dlog = {
  boot:     (...args) => emit('boot',     'log',  args),
  dispatch: (...args) => emit('dispatch', 'log',  args),
  render:   (...args) => emit('render',   'log',  args),
  button:   (...args) => emit('button',   'log',  args),
  warn:     (...args) => emit('warn',     'warn', args),
};

// Expose runtime toggles on globalThis so the Metro JS console can
// flip them without code changes.  Safe — these are dev-only sinks.
if (typeof globalThis === 'object' && globalThis !== null) {
  globalThis.ccSetDevLog        = setDevLog;
  globalThis.ccSetDevLogChannel = setDevLogChannel;
  globalThis.ccGetDevLogState   = getDevLogState;
}

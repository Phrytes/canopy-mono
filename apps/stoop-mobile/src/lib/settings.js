/**
 * settings — pure helpers for SettingsScreen.
 *
 * Stoop V3 mobile splits settings into a "shared" section (lives in
 * `<pod>/stoop/settings/shared.json`, travels between devices) and
 * a "device" section (`<pod>/stoop/settings/devices/<deviceId>.json`,
 * fresh per install). Per the functional design § 4g, mobile
 * defaults override the desktop defaults for `pollIntervalMs` and
 * `onlineWindow.everyMinutes`.
 */

export const MOBILE_DEFAULTS = Object.freeze({
  pollIntervalMs: 5000,
  onlineWindow: Object.freeze({ everyMinutes: null, durationSec: null }),
});

export const POLL_INTERVAL_MIN_MS = 1000;
export const POLL_INTERVAL_MAX_MS = 60_000;

/**
 * Validate a `pollIntervalMs` value.
 *
 * @returns {{ ok: true } | { ok: false, reason: 'not_number'|'too_small'|'too_large' }}
 */
export function validatePollInterval(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return { ok: false, reason: 'not_number' };
  if (ms < POLL_INTERVAL_MIN_MS) return { ok: false, reason: 'too_small' };
  if (ms > POLL_INTERVAL_MAX_MS) return { ok: false, reason: 'too_large' };
  return { ok: true };
}

/**
 * Coerce + clamp a poll-interval input from a string field.
 * Returns the clamped number; non-numbers fall back to the default.
 */
export function coercePollInterval(input) {
  const n = Number.parseInt(String(input ?? ''), 10);
  if (!Number.isFinite(n)) return MOBILE_DEFAULTS.pollIntervalMs;
  if (n < POLL_INTERVAL_MIN_MS) return POLL_INTERVAL_MIN_MS;
  if (n > POLL_INTERVAL_MAX_MS) return POLL_INTERVAL_MAX_MS;
  return n;
}

/**
 * Apply mobile defaults over a settings snapshot from the substrate.
 * Used at first hydration to nudge desktop-shaped defaults toward
 * mobile-friendly values when the device file is fresh.
 *
 * Caller should ONLY apply this when `device` is empty / brand-new
 * — never overwrite an explicit user choice.
 */
export function withMobileDefaults(device = {}) {
  return {
    ...MOBILE_DEFAULTS,
    ...device,
    onlineWindow: {
      ...MOBILE_DEFAULTS.onlineWindow,
      ...(device.onlineWindow ?? {}),
    },
  };
}

/**
 * settings — pure-helper coverage for SettingsScreen.
 */

import { describe, it, expect } from 'vitest';
import {
  validatePollInterval, coercePollInterval, withMobileDefaults,
  MOBILE_DEFAULTS, POLL_INTERVAL_MIN_MS, POLL_INTERVAL_MAX_MS,
} from '../src/lib/settings.js';

describe('validatePollInterval', () => {
  it('accepts the mobile default', () => {
    expect(validatePollInterval(MOBILE_DEFAULTS.pollIntervalMs)).toEqual({ ok: true });
  });
  it('accepts the boundaries', () => {
    expect(validatePollInterval(POLL_INTERVAL_MIN_MS)).toEqual({ ok: true });
    expect(validatePollInterval(POLL_INTERVAL_MAX_MS)).toEqual({ ok: true });
  });
  it('rejects below min', () => {
    expect(validatePollInterval(POLL_INTERVAL_MIN_MS - 1)).toEqual({ ok: false, reason: 'too_small' });
  });
  it('rejects above max', () => {
    expect(validatePollInterval(POLL_INTERVAL_MAX_MS + 1)).toEqual({ ok: false, reason: 'too_large' });
  });
  it('rejects non-numbers', () => {
    expect(validatePollInterval('5000')).toEqual({ ok: false, reason: 'not_number' });
    expect(validatePollInterval(NaN)).toEqual({ ok: false, reason: 'not_number' });
  });
});

describe('coercePollInterval', () => {
  it('parses + clamps a string', () => {
    expect(coercePollInterval('5000')).toBe(5000);
    expect(coercePollInterval('100')).toBe(POLL_INTERVAL_MIN_MS);
    expect(coercePollInterval('999999')).toBe(POLL_INTERVAL_MAX_MS);
  });
  it('falls back on garbage', () => {
    expect(coercePollInterval('abc')).toBe(MOBILE_DEFAULTS.pollIntervalMs);
    expect(coercePollInterval(null)).toBe(MOBILE_DEFAULTS.pollIntervalMs);
  });
});

describe('withMobileDefaults', () => {
  it('fills missing fields with mobile defaults', () => {
    const out = withMobileDefaults({});
    expect(out.pollIntervalMs).toBe(MOBILE_DEFAULTS.pollIntervalMs);
    expect(out.onlineWindow.everyMinutes).toBeNull();
  });
  it('preserves user-set fields', () => {
    const out = withMobileDefaults({ pollIntervalMs: 2000 });
    expect(out.pollIntervalMs).toBe(2000);
  });
  it('shallow-merges onlineWindow', () => {
    const out = withMobileDefaults({ onlineWindow: { everyMinutes: 10 } });
    expect(out.onlineWindow.everyMinutes).toBe(10);
    expect(out.onlineWindow.durationSec).toBeNull();
  });
});

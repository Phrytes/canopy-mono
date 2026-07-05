/**
 * S6.6 (mobile) — native push orchestration. Injects fake expo-notifications /
 * expo-device so the register flow is testable without the native dep. Asserts
 * the RESULT: a granted permission yields an Expo token forwarded to
 * stoop.subscribeExpoPush; denied/simulator paths short-circuit.
 */
import { describe, it, expect, vi } from 'vitest';
import { enableNativePush, disableNativePush, getNativePushState, presentLocalNotification } from '../src/v2/nativePush.js';

const TOKEN = 'ExponentPushToken[xyz]';
const fakeDevice = (isDevice = true) => ({ isDevice });
const fakeNotifications = ({ granted = true } = {}) => ({
  getPermissionsAsync: vi.fn(async () => ({ granted })),
  requestPermissionsAsync: vi.fn(async () => ({ granted })),
  getExpoPushTokenAsync: vi.fn(async () => ({ data: TOKEN })),
});

describe('enableNativePush', () => {
  it('requests permission, gets the Expo token, registers it with stoop', async () => {
    const notifications = fakeNotifications();
    const callSkill = vi.fn(async () => ({ ok: true }));
    const res = await enableNativePush({ callSkill, notifications, device: fakeDevice() });
    expect(res).toEqual({ ok: true, token: TOKEN });
    expect(notifications.requestPermissionsAsync).toHaveBeenCalled();
    expect(callSkill).toHaveBeenCalledWith('stoop', 'subscribeExpoPush', { token: TOKEN });
  });

  it('short-circuits on a simulator (no real device)', async () => {
    const callSkill = vi.fn();
    const res = await enableNativePush({ callSkill, notifications: fakeNotifications(), device: fakeDevice(false) });
    expect(res).toEqual({ ok: false, reason: 'simulator' });
    expect(callSkill).not.toHaveBeenCalled();
  });

  it('stops at the permission gate when denied', async () => {
    const callSkill = vi.fn();
    const res = await enableNativePush({ callSkill, notifications: fakeNotifications({ granted: false }), device: fakeDevice() });
    expect(res).toEqual({ ok: false, reason: 'denied' });
    expect(callSkill).not.toHaveBeenCalled();
  });

  it('reports register-failed when stoop rejects the token', async () => {
    const callSkill = vi.fn(async () => ({ error: 'nope' }));
    const res = await enableNativePush({ callSkill, notifications: fakeNotifications(), device: fakeDevice() });
    expect(res).toMatchObject({ ok: false, reason: 'register-failed' });
  });
});

describe('disableNativePush', () => {
  it('deregisters the token at stoop', async () => {
    const callSkill = vi.fn(async () => ({ ok: true }));
    expect(await disableNativePush({ callSkill, token: TOKEN })).toEqual({ ok: true });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'unsubscribeExpoPush', { token: TOKEN });
  });
});

describe('getNativePushState', () => {
  it('reflects granted permission on a real device', async () => {
    const state = await getNativePushState({ notifications: fakeNotifications({ granted: true }), device: fakeDevice() });
    expect(state).toEqual({ supported: true, granted: true });
  });
  // ⚠️ KNOWN-FAILING — DEFERRED (recorded REMAINING-WORK.md §M test-hygiene, 2026-07-05).
  // Not a product bug and NOT a §1b regression (this path is untouched by that work): in the vitest env the
  // `require('expo-notifications')`-style probe RESOLVES (a stub) instead of throwing, so `getNativePushState()`
  // reports `supported:true` where the test expects `false` for module-absence. This is an RN-vitest harness
  // artifact (native-module resolution in a non-native env — cf. the resolve.alias quirks the mobile suite
  // already needs). DEFERRED as test-harness debt — fix opportunistically when the mobile vitest harness is
  // next touched (mock the native probe to throw); no product-logic change implied.
  it('reports unsupported when the native module is absent', async () => {
    // No injected deps + no installed module → require throws → unsupported.
    const state = await getNativePushState();
    expect(state.supported).toBe(false);
  });
});

describe('presentLocalNotification (verify-summary nudge — mobile parity)', () => {
  it('schedules an immediate local notification when permission is granted', async () => {
    const scheduled = [];
    const notifications = {
      getPermissionsAsync: vi.fn(async () => ({ granted: true })),
      scheduleNotificationAsync: vi.fn(async (n) => { scheduled.push(n); }),
    };
    const ok = await presentLocalNotification({ title: 'Feedback', body: 'verify', data: { round: 1 }, notifications });
    expect(ok).toBe(true);
    expect(scheduled[0].content.title).toBe('Feedback');
    expect(scheduled[0].content.body).toBe('verify');
    expect(scheduled[0].trigger).toBe(null);   // present now
  });

  it('no-ops (false) when permission is not granted', async () => {
    const notifications = {
      getPermissionsAsync: vi.fn(async () => ({ granted: false })),
      scheduleNotificationAsync: vi.fn(async () => { throw new Error('must not schedule'); }),
    };
    expect(await presentLocalNotification({ title: 'x', notifications })).toBe(false);
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

/**
 * S6.6 (mobile) — native push orchestration. Injects fake expo-notifications /
 * expo-device so the register flow is testable without the native dep. Asserts
 * the RESULT: a granted permission yields an Expo token forwarded to
 * stoop.subscribeExpoPush; denied/simulator paths short-circuit.
 */
import { describe, it, expect, vi } from 'vitest';
import { enableNativePush, disableNativePush, getNativePushState } from '../src/v2/nativePush.js';

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
  it('reports unsupported when the native module is absent', async () => {
    // No injected deps + no installed module → require throws → unsupported.
    const state = await getNativePushState();
    expect(state.supported).toBe(false);
  });
});

/**
 * requestMeshPermissions — Group O.
 *
 * react-native (PermissionsAndroid + Platform) is mocked so this runs in Node.
 * See EXTRACTION-PLAN.md §7 Group O and CODING-PLAN.md Group O.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// Mutable state so each test can reconfigure the mock per call.

const permState = {
  platform:      { OS: 'android', Version: 33 },
  requestResult:         'granted',    // result of PermissionsAndroid.request()
  requestMultipleResult: null,          // override for requestMultiple; else built from PERMISSIONS
  requestThrows:         null,          // Error to throw from request()
};

vi.mock('react-native', () => ({
  Platform: {
    get OS()      { return permState.platform.OS; },
    get Version() { return permState.platform.Version; },
  },
  PermissionsAndroid: {
    PERMISSIONS: {
      ACCESS_FINE_LOCATION:   'android.permission.ACCESS_FINE_LOCATION',
      BLUETOOTH_SCAN:         'android.permission.BLUETOOTH_SCAN',
      BLUETOOTH_ADVERTISE:    'android.permission.BLUETOOTH_ADVERTISE',
      BLUETOOTH_CONNECT:      'android.permission.BLUETOOTH_CONNECT',
    },
    RESULTS: { GRANTED: 'granted', DENIED: 'denied', NEVER_ASK_AGAIN: 'never_ask_again' },
    request: vi.fn(async () => {
      if (permState.requestThrows) throw permState.requestThrows;
      return permState.requestResult;
    }),
    requestMultiple: vi.fn(async (perms) => {
      if (permState.requestMultipleResult) return permState.requestMultipleResult;
      const out = {};
      for (const p of perms) out[p] = permState.requestResult;
      return out;
    }),
  },
}));

// Import AFTER the mock so ESM resolves against it.
import { requestMeshPermissions } from '../src/permissions.js';

beforeEach(() => {
  permState.platform = { OS: 'android', Version: 33 };
  permState.requestResult = 'granted';
  permState.requestMultipleResult = null;
  permState.requestThrows = null;
});

describe('requestMeshPermissions — Android', () => {
  it('returns { ble:true, location:true } when everything is granted on API 31+', async () => {
    permState.platform.Version = 33;
    permState.requestResult = 'granted';
    const out = await requestMeshPermissions();
    expect(out).toEqual({ ble: true, location: true });
  });

  it('returns { ble:false, location:false } when all denied', async () => {
    permState.requestResult = 'denied';
    const out = await requestMeshPermissions();
    expect(out).toEqual({ ble: false, location: false });
  });

  it('reports partial grant correctly when BLE is denied but location granted', async () => {
    permState.platform.Version = 33;
    // Location granted (single-request) but BLE multi-request mixed denied.
    permState.requestResult = 'granted'; // location granted via single request()
    permState.requestMultipleResult = {
      'android.permission.BLUETOOTH_SCAN':      'granted',
      'android.permission.BLUETOOTH_ADVERTISE': 'denied',
      'android.permission.BLUETOOTH_CONNECT':   'granted',
    };
    const out = await requestMeshPermissions();
    expect(out).toEqual({ ble: false, location: true });
  });

  it('on Android ≤11, BLE follows location (no separate BLE prompt)', async () => {
    permState.platform.Version = 30; // API 30 — pre-12
    permState.requestResult = 'granted';
    const out = await requestMeshPermissions();
    expect(out).toEqual({ ble: true, location: true });
  });

  it('on Android ≤11 with location denied, ble is also false', async () => {
    permState.platform.Version = 30;
    permState.requestResult = 'denied';
    const out = await requestMeshPermissions();
    expect(out).toEqual({ ble: false, location: false });
  });

  it('does not crash when the permissions API throws — returns all false', async () => {
    permState.requestThrows = new Error('API broke');
    const out = await requestMeshPermissions();
    expect(out).toEqual({ ble: false, location: false });
  });
});

describe('requestMeshPermissions — iOS', () => {
  it('short-circuits to { ble:true, location:true } without calling PermissionsAndroid', async () => {
    permState.platform.OS = 'ios';
    const out = await requestMeshPermissions();
    expect(out).toEqual({ ble: true, location: true });
  });
});

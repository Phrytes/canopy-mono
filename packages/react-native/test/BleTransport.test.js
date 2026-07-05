/**
 * BleTransport tests — react-native-ble-plx is mocked.
 * Focuses on MTU chunking/reassembly and the transport surface.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock react-native itself — without this, importing the transport pulls
// the real RN package and rollup fails on its Flow-typed source.
vi.mock('react-native', () => ({
  NativeModules:      {},
  NativeEventEmitter: class { addListener() { return { remove() {} }; } removeAllListeners() {} },
}));

// ── Mock react-native-ble-plx ─────────────────────────────────────────────────

// BleTransport writes via writeWithoutResponse (primary path — keeps the
// single GATT command slot free for the CCCD descriptor write); it only
// falls back to writeWithResponse if the stack rejects "write without".
const mockChar = {
  uuid:                 'b1c3e5a7-0002-4f8e-9d0b-2c3e4a5f6b7d',
  writeWithoutResponse: vi.fn(async () => {}),
  writeWithResponse:    vi.fn(async () => {}),
  monitor:              vi.fn((cb) => { mockChar._monitorCb = cb; return { remove: () => {} }; }),
  _monitorCb:           null,
};

const mockSvc = {
  uuid:            'a8f0e4d2-0001-4b3f-8c9a-1e2d3f4a5b6c',
  characteristics: vi.fn(async () => [mockChar]),
};

const mockDevice = {
  id:                                  'test-device-id',
  connect:                             vi.fn(async function() { return this; }),
  discoverAllServicesAndCharacteristics: vi.fn(async function() { return this; }),
  services:                            vi.fn(async () => [mockSvc]),
  requestMTU:                          vi.fn(async () => ({ mtu: 512 })),
  onDisconnected:                      vi.fn(() => ({ remove() {} })),
  cancelConnection:                    vi.fn(async () => {}),
};

let scanCallback = null;

vi.mock('react-native-ble-plx', () => ({
  BleManager: class {
    state()         { return Promise.resolve('PoweredOn'); }
    startDeviceScan(_uuids, _opts, cb) { scanCallback = cb; }
    stopDeviceScan() { scanCallback = null; }
    destroy()        {}
  },
  State: { PoweredOn: 'PoweredOn', PoweredOff: 'PoweredOff', Unauthorized: 'Unauthorized' },
}));

import { AgentIdentity } from '@canopy/core';
import { VaultMemory } from '@canopy/vault';
import { BleTransport, SERVICE_UUID, CHARACTERISTIC_UUID } from '../src/transport/BleTransport.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Drive the chunk reassembly by simulating monitor callbacks. */
function simulateReceive(transport, deviceId, b64chunks) {
  for (const b64 of b64chunks) {
    mockChar._monitorCb?.(null, { value: b64 });
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BleTransport', () => {
  let transport, identity;

  beforeEach(async () => {
    vi.clearAllMocks();
    scanCallback = null;
    mockChar._monitorCb = null;
    identity  = await AgentIdentity.generate(new VaultMemory());
    transport = new BleTransport({ identity });
  });

  afterEach(async () => {
    await transport.disconnect().catch(() => {});
  });

  it('throws without identity', () => {
    expect(() => new BleTransport({})).toThrow('identity');
  });

  it('address equals pubKey', () => {
    expect(transport.address).toBe(identity.pubKey);
  });

  it('connect starts BLE scan when scan=true', async () => {
    await transport.connect();
    expect(scanCallback).toBeTypeOf('function');
  });

  it('connect does NOT start scan when scan=false', async () => {
    const t = new BleTransport({ identity, scan: false });
    await t.connect();
    expect(scanCallback).toBeNull();
    await t.disconnect();
  });

  it('discovers a peer and emits peer-discovered', async () => {
    await transport.connect();
    const discovered = await new Promise(resolve => {
      transport.once('peer-discovered', resolve);
      scanCallback(null, mockDevice);
    });
    expect(discovered).toBe(mockDevice.id);
  });

  it('_put buffers (does not throw) when no connection to peer (Group V)', async () => {
    await transport.connect();
    const env = { _v: 1, _p: 'OW', _id: 'x', _from: identity.pubKey,
                  _to: 'no-such-peer', _ts: Date.now(), _sig: null, payload: null };
    const buffered = new Promise(resolve => transport.once('buffered', resolve));
    await expect(transport._put('no-such-peer', env)).resolves.toBeUndefined();
    expect(await buffered).toMatchObject({ to: 'no-such-peer', queueSize: 1 });
  });

  it('_put writes envelope in chunks after discovery', async () => {
    await transport.connect();
    await new Promise(resolve => {
      transport.once('peer-discovered', resolve);
      scanCallback(null, mockDevice);
    });

    const env = { _v: 1, _p: 'OW', _id: 'e1', _from: identity.pubKey,
                  _to: mockDevice.id, _ts: Date.now(), _sig: null, payload: 'hello' };
    await transport._put(mockDevice.id, env);
    expect(mockChar.writeWithoutResponse).toHaveBeenCalled();
  });

  it('exported UUIDs have the right format', () => {
    expect(SERVICE_UUID).toMatch(/^[0-9a-f-]{36}$/);
    expect(CHARACTERISTIC_UUID).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ── MTU chunking unit tests ───────────────────────────────────────────────────

describe('BleTransport MTU chunking', () => {
  it('small payload fits in one chunk', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const transport = new BleTransport({ identity });
    await transport.connect();

    await new Promise(resolve => {
      transport.once('peer-discovered', resolve);
      scanCallback(null, mockDevice);
    });

    vi.clearAllMocks();
    const smallPayload = 'x'.repeat(10);
    const env = { _v: 1, _p: 'OW', _id: 'e2', _from: identity.pubKey,
                  _to: mockDevice.id, _ts: Date.now(), _sig: null, payload: smallPayload };
    await transport._put(mockDevice.id, env);
    expect(mockChar.writeWithoutResponse).toHaveBeenCalledTimes(1);
    await transport.disconnect();
  });

  it('large payload is split into multiple chunks', async () => {
    const identity  = await AgentIdentity.generate(new VaultMemory());
    const transport = new BleTransport({ identity });
    await transport.connect();

    await new Promise(resolve => {
      transport.once('peer-discovered', resolve);
      scanCallback(null, { ...mockDevice, requestMTU: async () => ({ mtu: 20 }) });
    });

    vi.clearAllMocks();
    // Payload large enough to need multiple 20-byte chunks.
    const env = { _v: 1, _p: 'OW', _id: 'e3', _from: identity.pubKey,
                  _to: mockDevice.id, _ts: Date.now(), _sig: null,
                  payload: 'A'.repeat(200) };
    await transport._put(mockDevice.id, env);
    expect(mockChar.writeWithoutResponse.mock.calls.length).toBeGreaterThan(1);
    await transport.disconnect();
  });
});

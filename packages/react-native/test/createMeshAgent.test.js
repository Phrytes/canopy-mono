/**
 * createMeshAgent — Group Q factory tests.
 *
 * All native transports + RN modules are mocked so this runs in Node.
 * See EXTRACTION-PLAN.md §7 Group Q and CODING-PLAN.md Group Q.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock react-native (Permissions + Platform) ────────────────────────────────

vi.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 33 },
  PermissionsAndroid: {
    PERMISSIONS: {
      ACCESS_FINE_LOCATION:   'loc',
      BLUETOOTH_SCAN:         'scan',
      BLUETOOTH_ADVERTISE:    'adv',
      BLUETOOTH_CONNECT:      'conn',
    },
    RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
    request:         vi.fn(async () => 'granted'),
    requestMultiple: vi.fn(async (perms) => Object.fromEntries(perms.map(p => [p, 'granted']))),
  },
  NativeModules:     { MdnsModule: {}, BlePeripheral: {} },
  NativeEventEmitter: class { addListener() { return { remove() {} }; } },
}));

// ── Mock Keychain (backing store shared across runs) ──────────────────────────

const kcStore = new Map();
vi.mock('react-native-keychain', () => ({
  getInternetCredentials: vi.fn(async (k) => {
    const v = kcStore.get(k);
    return v ? { password: v } : false;
  }),
  setInternetCredentials: vi.fn(async (k, _u, v) => { kcStore.set(k, v); }),
  resetInternetCredentials: vi.fn(async (k) => { kcStore.delete(k); }),
}));

// ── Mock AsyncStorage ─────────────────────────────────────────────────────────

const asStore = new Map();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem:    vi.fn(async (k) => asStore.get(k) ?? null),
    setItem:    vi.fn(async (k, v) => { asStore.set(k, v); }),
    removeItem: vi.fn(async (k) => { asStore.delete(k); }),
    getAllKeys: vi.fn(async () => [...asStore.keys()]),
  },
}));

// ── Mock react-native-ble-plx ─────────────────────────────────────────────────

vi.mock('react-native-ble-plx', () => ({
  State: { PoweredOn: 'PoweredOn' },
  BleManager: class {
    state()              { return Promise.resolve('PoweredOn'); }
    onStateChange(cb)    { cb('PoweredOn'); return { remove() {} }; }
    startDeviceScan()    {}
    stopDeviceScan()     {}
    destroy()            {}
  },
}));

// ── Mock MdnsTransport + isAvailable ──────────────────────────────────────────
// Defaults: mdns is available and connects instantly. Override per test.

const mdnsState = { available: true, connectImpl: async () => {} };

vi.mock('../src/transport/MdnsTransport.js', () => {
  class MdnsTransport {
    static isAvailable() { return mdnsState.available; }
    constructor(opts) {
      this.identity = opts.identity;
      this.address  = opts.identity.pubKey;
    }
    connect()            { return mdnsState.connectImpl(); }
    disconnect()         { return Promise.resolve(); }
    on()                 {}
    off()                {}
    _hasPeer(pk)         { return mdnsState.peers?.has?.(pk) ?? false; }
    useSecurityLayer()   {}
    setReceiveHandler()  {}
    emit()               {}
  }
  return { MdnsTransport };
});

// ── Mock BleTransport ─────────────────────────────────────────────────────────

const bleState = { peers: new Set() };
vi.mock('../src/transport/BleTransport.js', () => {
  class BleTransport {
    constructor(opts) {
      this.identity = opts.identity;
      this.address  = opts.identity.pubKey;
    }
    connect()            { return Promise.resolve(); }
    disconnect()         { return Promise.resolve(); }
    on()                 {}
    off()                {}
    _hasPeer(pk)         { return bleState.peers.has(pk); }
    useSecurityLayer()   {}
    setReceiveHandler()  {}
    emit()               {}
  }
  return {
    BleTransport,
    SERVICE_UUID:        'svc',
    CHARACTERISTIC_UUID: 'chr',
  };
});

// ── Mock rendezvousRtcLib loader ─────────────────────────────────────────────
// Default: loader returns null (acts like the native module isn't installed).
// Individual tests that care about rendezvous override per-test.

const rtcLibState = { lib: null };
vi.mock('../src/transport/rendezvousRtcLib.js', () => ({
  loadRendezvousRtcLib: vi.fn(async () => rtcLibState.lib),
}));

// Import AFTER all mocks are in place.
import { createMeshAgent } from '../src/createMeshAgent.js';

beforeEach(() => {
  // Reset per-test mock state so each test starts clean.
  mdnsState.available   = true;
  mdnsState.connectImpl = async () => {};
  mdnsState.peers       = new Set();
  bleState.peers        = new Set();
  rtcLibState.lib       = null;
});

describe('createMeshAgent', () => {

  it('returns a started Agent with the default transport bundle', async () => {
    kcStore.clear();
    asStore.clear();
    const agent = await createMeshAgent({ label: 'test-phone' });
    expect(agent.label).toBe('test-phone');
    expect(agent.transportNames).toEqual(expect.arrayContaining(['default', 'ble']));
    await agent.stop();
  });

  it('adds relay as a secondary when relayUrl is provided', async () => {
    kcStore.clear();
    asStore.clear();
    const agent = await createMeshAgent({ relayUrl: 'ws://127.0.0.1:9999' });
    expect(agent.transportNames).toContain('relay');
    await agent.stop();
  });

  it('omits BLE when transports.ble === false', async () => {
    kcStore.clear();
    asStore.clear();
    const agent = await createMeshAgent({ transports: { ble: false } });
    expect(agent.transportNames).not.toContain('ble');
    await agent.stop();
  });

  it('falls back to OfflineTransport as primary when mDNS pre-connect fails', async () => {
    kcStore.clear();
    asStore.clear();
    mdnsState.connectImpl = async () => { throw new Error('WiFi off'); };
    const agent = await createMeshAgent({ label: 'offline-primary' });
    // Transport.address === the agent's own pubKey for OfflineTransport
    expect(agent.transport.address).toBe(agent.pubKey);
    // And MdnsTransport should not be attached
    expect(agent.transportNames).not.toContain('mdns'); // secondary was never added anyway
    await agent.stop();
  });

  it('selects transports via the routing strategy', async () => {
    kcStore.clear();
    asStore.clear();
    bleState.peers.add('BLE_PEER_PUBKEY');
    mdnsState.peers = new Set(['MDNS_PEER_PUBKEY']);

    const agent = await createMeshAgent({ relayUrl: 'ws://127.0.0.1:9999' });

    const bleForMac = await agent.transportFor('AA:BB:CC:DD:EE:FF');
    expect(bleForMac).toBe(agent.getTransport('ble'));

    const bleForPubKey = await agent.transportFor('BLE_PEER_PUBKEY');
    expect(bleForPubKey).toBe(agent.getTransport('ble'));

    const mdnsForPubKey = await agent.transportFor('MDNS_PEER_PUBKEY');
    // mdns is the primary ("default"), not added as a secondary.
    expect(mdnsForPubKey).toBe(agent.transport);

    const relayForUnknown = await agent.transportFor('UNKNOWN_PEER');
    expect(relayForUnknown).toBe(agent.getTransport('relay'));

    await agent.stop();
  });

  it('restores the identity from vault on a second invocation', async () => {
    kcStore.clear();
    asStore.clear();
    const agent1 = await createMeshAgent({ label: 'first' });
    const firstPubKey = agent1.pubKey;
    await agent1.stop();

    const agent2 = await createMeshAgent({ label: 'second' });
    expect(agent2.pubKey).toBe(firstPubKey);
    await agent2.stop();
  });

  it('applies authenticated relay-forward policy in the config', async () => {
    kcStore.clear();
    asStore.clear();
    const agent = await createMeshAgent({ label: 'policy-check' });
    expect(agent.config.get('policy.allowRelayFor')).toBe('authenticated');
    await agent.stop();
  });

  // ── Rendezvous (Group AA via DD2) ─────────────────────────────────────────

  it('does not enable rendezvous by default', async () => {
    kcStore.clear();
    asStore.clear();
    const agent = await createMeshAgent({ relayUrl: 'ws://127.0.0.1:9999' });
    expect(agent.transportNames).not.toContain('rendezvous');
    await agent.stop();
  });

  it('silently skips rendezvous when the rtc lib is unavailable', async () => {
    kcStore.clear();
    asStore.clear();
    rtcLibState.lib = null;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = await createMeshAgent({
      relayUrl:   'ws://127.0.0.1:9999',
      rendezvous: true,
    });
    expect(agent.transportNames).not.toContain('rendezvous');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    await agent.stop();
  });

  it('silently skips rendezvous when no relay is configured', async () => {
    kcStore.clear();
    asStore.clear();
    rtcLibState.lib = {
      RTCPeerConnection:     class {},
      RTCSessionDescription: class {},
      RTCIceCandidate:       class {},
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = await createMeshAgent({ rendezvous: true });
    expect(agent.transportNames).not.toContain('rendezvous');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    await agent.stop();
  });

  it('attaches the rendezvous transport when rtc lib + relay are both available', async () => {
    kcStore.clear();
    asStore.clear();
    rtcLibState.lib = {
      RTCPeerConnection:     class {},
      RTCSessionDescription: class {},
      RTCIceCandidate:       class {},
    };
    const agent = await createMeshAgent({
      relayUrl:   'ws://127.0.0.1:9999',
      rendezvous: true,
    });
    expect(agent.transportNames).toContain('rendezvous');
    expect(agent._rendezvousEnabled).toBe(true);
    await agent.stop();
  });

  it('upserts inbound hellos into the PeerGraph as hops:0/via:null', async () => {
    kcStore.clear();
    asStore.clear();
    const agent = await createMeshAgent({ label: 'graph-sync' });

    // Simulate an inbound hello event.
    agent.emit('peer', {
      address: 'ADDR_123',
      pubKey:  'PEER_PUBKEY',
      label:   'alice',
      ack:     false,
    });

    // Give the upsert a microtask to land.
    await new Promise(r => setImmediate(r));

    const rec = await agent.peers.get('PEER_PUBKEY');
    expect(rec).toBeTruthy();
    expect(rec.hops).toBe(0);
    expect(rec.via).toBeNull();
    expect(rec.reachable).toBe(true);

    await agent.stop();
  });
});

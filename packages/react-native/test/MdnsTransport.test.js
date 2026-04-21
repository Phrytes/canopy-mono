/**
 * MdnsTransport tests — react-native-zeroconf is mocked.
 * Tests verify that the transport correctly handles mDNS service discovery
 * events and manages peer WebSocket connections.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock react-native-zeroconf ────────────────────────────────────────────────

class MockZeroconf {
  constructor() { this._handlers = {}; }
  on(event, fn)                { this._handlers[event] = fn; return this; }
  scan()                       {}
  stop()                       {}
  publishService()             {}
  unpublishService()           {}
  // Test helper — simulate a service resolution event.
  _emit(event, data)           { this._handlers[event]?.(data); }
}

let zeroconfInstance;
vi.mock('react-native-zeroconf', () => ({
  default: class {
    constructor() {
      zeroconfInstance = new MockZeroconf();
      return zeroconfInstance;
    }
  },
}));

import { AgentIdentity, VaultMemory } from '@canopy/core';
import { MdnsTransport } from '../src/transport/MdnsTransport.js';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MdnsTransport', () => {
  let transport, identity;

  beforeEach(async () => {
    identity  = await AgentIdentity.generate(new VaultMemory());
    transport = new MdnsTransport({ identity });
  });

  afterEach(async () => {
    await transport.disconnect().catch(() => {});
  });

  it('throws without identity', () => {
    expect(() => new MdnsTransport({})).toThrow('identity');
  });

  it('address equals pubKey', () => {
    expect(transport.address).toBe(identity.pubKey);
  });

  it('connect starts scanning and publishing', async () => {
    const scanSpy    = vi.spyOn(zeroconfInstance, 'scan');
    const publishSpy = vi.spyOn(zeroconfInstance, 'publishService');
    await transport.connect();
    expect(scanSpy).toHaveBeenCalled();
    expect(publishSpy).toHaveBeenCalled();
  });

  it('disconnect stops zeroconf and closes connections', async () => {
    await transport.connect();
    const stopSpy     = vi.spyOn(zeroconfInstance, 'stop');
    const unpublishSpy = vi.spyOn(zeroconfInstance, 'unpublishService');
    await transport.disconnect();
    expect(stopSpy).toHaveBeenCalled();
    expect(unpublishSpy).toHaveBeenCalled();
  });

  it('ignores self-discovery', async () => {
    await transport.connect();
    const discovered = [];
    transport.on('peer-discovered', a => discovered.push(a));

    zeroconfInstance._emit('resolved', {
      addresses: ['127.0.0.1'],
      port:      9999,
      txt:       { pubKey: identity.pubKey },  // same as self
    });

    expect(discovered).toHaveLength(0);
  });

  it('emits peer-discovered on new service resolution (WS mock)', async () => {
    // Patch the private WS opener to avoid real network calls.
    const mockWs = {
      readyState: 1,
      close:      () => {},
      send:       () => {},
      onclose:    null,
      onmessage:  null,
    };
    globalThis.WebSocket = class {
      constructor() { Object.assign(this, mockWs); }
      onopen() {}
    };
    // Trigger open immediately on next tick.
    const OrigWS = globalThis.WebSocket;
    globalThis.WebSocket = class extends OrigWS {
      constructor(...args) {
        super(...args);
        Promise.resolve().then(() => { if (this.onopen) this.onopen(); });
      }
    };

    await transport.connect();

    const discovered = await new Promise(resolve => {
      transport.once('peer-discovered', resolve);
      zeroconfInstance._emit('resolved', {
        addresses: ['192.168.1.5'],
        port:      8080,
        txt:       { pubKey: 'remote-pubkey-xyz' },
      });
    });

    expect(discovered).toBe('remote-pubkey-xyz');

    delete globalThis.WebSocket;
  });

  it('_put throws when no connection to peer', async () => {
    await transport.connect();
    const env = { _v: 1, _p: 'OW', _id: 'x', _from: identity.pubKey,
                  _to: 'unknown', _ts: Date.now(), _sig: null, payload: null };
    await expect(transport._put('unknown', env)).rejects.toThrow('no open connection');
  });
});

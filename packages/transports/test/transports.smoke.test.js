/**
 * @canopy/transports — smoke suite.
 *
 * Behaviour-preserving assertions on the four concrete transports after their
 * extraction out of @canopy/core:
 *   - the package barrel exposes all four;
 *   - each extends the SAME `Transport` base re-imported from '@canopy/core'
 *     (proves the cross-package base import resolves cleanly, no duplicate
 *     Transport identity);
 *   - the documented constructor guards still throw.
 *
 * Deeper behaviour (connect/send/reconnect) is covered by the transport tests
 * that live in @canopy/core/test and now import from this package.
 */
import { describe, it, expect } from 'vitest';
import { Transport } from '@canopy/core';
import {
  NknTransport,
  MqttTransport,
  RelayTransport,
  RendezvousTransport,
} from '../src/index.js';

describe('@canopy/transports barrel', () => {
  it('exports the four concrete transports', () => {
    for (const [name, T] of Object.entries({ NknTransport, MqttTransport, RelayTransport, RendezvousTransport })) {
      expect(T, `${name} must be exported`).toBeTypeOf('function');
    }
  });

  it('each concrete extends the SAME Transport base from @canopy/core', () => {
    for (const T of [NknTransport, MqttTransport, RelayTransport, RendezvousTransport]) {
      expect(Object.getPrototypeOf(T.prototype)).toBe(Transport.prototype);
    }
  });
});

describe('@canopy/transports constructor guards (unchanged behaviour)', () => {
  it('NknTransport requires identity', () => {
    expect(() => new NknTransport()).toThrow(/identity/);
  });
  it('MqttTransport requires brokerUrl', () => {
    expect(() => new MqttTransport({})).toThrow(/brokerUrl/);
  });
  it('RelayTransport requires relayUrl', () => {
    expect(() => new RelayTransport({})).toThrow(/relayUrl/);
  });
  it('RendezvousTransport requires signalingTransport', () => {
    expect(() => new RendezvousTransport({})).toThrow(/signalingTransport/);
  });
  it('RendezvousTransport.isSupported() returns a boolean', () => {
    expect(typeof RendezvousTransport.isSupported()).toBe('boolean');
  });
});

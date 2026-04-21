import { describe, it, expect } from 'vitest';
import { RoutingStrategy, TRANSPORT_PRIORITY } from '../src/routing/RoutingStrategy.js';
import { FallbackTable } from '../src/routing/FallbackTable.js';

// Minimal transport stub
const mkTransport = (name) => ({ name });

describe('RoutingStrategy', () => {
  it('selects the only available transport', async () => {
    const rs = new RoutingStrategy({ transports: { relay: mkTransport('relay') } });
    const sel = await rs.selectTransport('peer1');
    expect(sel?.name).toBe('relay');
  });

  it('returns null when no transports available', async () => {
    const rs = new RoutingStrategy({ transports: {} });
    expect(await rs.selectTransport('peer1')).toBeNull();
  });

  it('respects TRANSPORT_PRIORITY order', async () => {
    const rs = new RoutingStrategy({
      transports: {
        nkn:   mkTransport('nkn'),
        relay: mkTransport('relay'),
        mqtt:  mkTransport('mqtt'),
      },
    });
    // relay > nkn > mqtt in priority
    const sel = await rs.selectTransport('peer1');
    expect(sel?.name).toBe('relay');
  });

  it('prefers FallbackTable fastest transport when latency data exists', async () => {
    const ft = new FallbackTable();
    ft.record('peer1', 'nkn',   10);   // nkn is fastest for this peer
    ft.record('peer1', 'relay', 50);

    const rs = new RoutingStrategy({
      transports:    { relay: mkTransport('relay'), nkn: mkTransport('nkn') },
      fallbackTable: ft,
    });
    const sel = await rs.selectTransport('peer1');
    expect(sel?.name).toBe('nkn');
  });

  it('preferredTransports overrides priority order', async () => {
    const rs = new RoutingStrategy({
      transports: {
        relay: mkTransport('relay'),
        nkn:   mkTransport('nkn'),
      },
    });
    const sel = await rs.selectTransport('peer1', { preferredTransports: ['nkn'] });
    expect(sel?.name).toBe('nkn');
  });

  it('transportFilter config excludes filtered-out transports', async () => {
    const rs = new RoutingStrategy({
      transports: { relay: mkTransport('relay'), nkn: mkTransport('nkn') },
      config:     { transportFilter: ['nkn'] },
    });
    const sel = await rs.selectTransport('peer1');
    expect(sel?.name).toBe('nkn');
  });

  it('returns a2a transport for a2a peer type from PeerGraph', async () => {
    const mockGraph = {
      get: async () => ({ type: 'a2a', pubKey: 'peer1' }),
    };
    const rs = new RoutingStrategy({
      transports:  { relay: mkTransport('relay'), a2a: mkTransport('a2a') },
      peerGraph:   mockGraph,
    });
    const sel = await rs.selectTransport('peer1');
    expect(sel?.name).toBe('a2a');
  });

  it('onTransportFailure marks transport degraded', async () => {
    const ft = new FallbackTable();
    ft.record('peer1', 'relay', 10);
    ft.record('peer1', 'nkn',   20);

    const rs = new RoutingStrategy({
      transports:    { relay: mkTransport('relay'), nkn: mkTransport('nkn') },
      fallbackTable: ft,
    });

    // relay is fastest — mark it failed
    rs.onTransportFailure('peer1', 'relay');
    expect(ft.isDegraded('peer1', 'relay')).toBe(true);
  });

  it('falls back past degraded transports to next in priority', async () => {
    const ft = new FallbackTable();
    ft.record('peer1', 'relay', 10);
    ft.record('peer1', 'nkn',   20);
    ft.markDegraded('peer1', 'relay');

    const rs = new RoutingStrategy({
      transports:    { relay: mkTransport('relay'), nkn: mkTransport('nkn') },
      fallbackTable: ft,
    });
    const sel = await rs.selectTransport('peer1');
    expect(sel?.name).toBe('nkn');
  });

  it('TRANSPORT_PRIORITY contains expected order', () => {
    const relay = TRANSPORT_PRIORITY.indexOf('relay');
    const nkn   = TRANSPORT_PRIORITY.indexOf('nkn');
    const mqtt  = TRANSPORT_PRIORITY.indexOf('mqtt');
    const a2a   = TRANSPORT_PRIORITY.indexOf('a2a');
    expect(relay).toBeLessThan(nkn);
    expect(nkn).toBeLessThan(mqtt);
    expect(a2a).toBeGreaterThan(mqtt);
  });
});

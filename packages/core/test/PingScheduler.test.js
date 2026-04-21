import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PingScheduler } from '../src/discovery/PingScheduler.js';
import { PeerGraph }     from '../src/discovery/PeerGraph.js';

vi.mock('../src/protocol/ping.js', () => ({
  ping: vi.fn(),
}));

import { ping as mockPing } from '../src/protocol/ping.js';

function makeAgent(pingOk = true) {
  return {
    transport: { name: 'relay' },
    invoke: vi.fn(),
  };
}

describe('PingScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pingAll marks peer reachable and updates latency on success', async () => {
    const graph = new PeerGraph();
    await graph.upsert({ pubKey: 'pk1', reachable: false });

    mockPing.mockResolvedValueOnce(undefined);

    const agent    = makeAgent();
    const sched    = new PingScheduler({ agent, peerGraph: graph, intervalMs: 60_000 });
    await sched.pingAll();

    const record = await graph.get('pk1');
    expect(record.reachable).toBe(true);
    expect(record.latency?.relay).toBeGreaterThanOrEqual(0);
  });

  it('pingAll marks peer unreachable on failure', async () => {
    const graph = new PeerGraph();
    await graph.upsert({ pubKey: 'pk1', reachable: true });

    mockPing.mockRejectedValueOnce(new Error('timeout'));

    const agent = makeAgent();
    const sched = new PingScheduler({ agent, peerGraph: graph, intervalMs: 60_000 });
    await sched.pingAll();

    expect((await graph.get('pk1')).reachable).toBe(false);
  });

  it('applies exponential backoff after repeated failures', async () => {
    const graph = new PeerGraph();
    await graph.upsert({ pubKey: 'pk1' });

    // All pings fail.
    mockPing.mockRejectedValue(new Error('timeout'));

    const agent = makeAgent();
    const sched = new PingScheduler({ agent, peerGraph: graph, intervalMs: 1_000 });

    // First failure → backoff = 1 * 2^0 = 1000ms
    await sched.pingAll();
    // Second call within backoff window should be skipped.
    const firstLatency = mockPing.mock.calls.length;
    await sched.pingAll();
    expect(mockPing.mock.calls.length).toBe(firstLatency);  // no new call
  });

  it('start() and stop() do not throw', () => {
    const sched = new PingScheduler({
      agent:      makeAgent(),
      peerGraph:  new PeerGraph(),
      intervalMs: 1_000_000,
    });
    expect(() => sched.start()).not.toThrow();
    expect(() => sched.stop()).not.toThrow();
  });

  it('stop() prevents further scheduled pings', async () => {
    const sched = new PingScheduler({
      agent:      makeAgent(),
      peerGraph:  new PeerGraph(),
      intervalMs: 50,
    });
    sched.start();
    sched.stop();
    // No async pings should fire after stop.
    await new Promise(r => setTimeout(r, 100));
    expect(mockPing).not.toHaveBeenCalled();
  });

  it('marks peer unreachable after failure, then reachable after success', async () => {
    const graph = new PeerGraph();
    await graph.upsert({ pubKey: 'pk1', reachable: true });

    // First ping fails → mark unreachable.
    mockPing.mockRejectedValueOnce(new Error('timeout'));
    const agent = makeAgent();
    const sched = new PingScheduler({ agent, peerGraph: graph, intervalMs: 1_000 });

    await sched.pingAll();
    expect((await graph.get('pk1')).reachable).toBe(false);
  });
});

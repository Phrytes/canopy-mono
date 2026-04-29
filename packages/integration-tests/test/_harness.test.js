/**
 * Lab smoke test — proves the harness boots, agents can talk to each
 * other, partitions isolate, and teardown is clean.
 *
 * This is the only test in T.1.  Real scenarios land in T.2–T.5.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TextPart, Parts } from '@canopy/core';
import { Lab } from '../src/_harness/index.js';

describe('Lab smoke', () => {
  let lab;

  afterEach(async () => {
    if (lab) {
      await lab.teardown();
      lab = null;
    }
  });

  it('boots fast — 3 agents in <500ms', async () => {
    const t0 = Date.now();
    lab = await Lab.boot({ agents: ['alice', 'bob', 'carol'] });
    const dt = Date.now() - t0;
    expect(dt).toBeLessThan(500);
    expect(lab.agentNames()).toEqual(['alice', 'bob', 'carol']);
  });

  it('booted agents can ping each other (echo skill round-trip)', async () => {
    lab = await Lab.boot({ agents: ['alice', 'bob', 'carol'] });

    // Bob and Carol both register an `echo` skill.  Alice invokes it.
    lab.agent('bob').register('echo', async ({ parts }) => parts);
    lab.agent('carol').register('echo', async ({ parts }) => parts);

    // First do a hello so SecurityLayer learns each peer's pubKey
    // properly (full mesh topology pre-wires addPeer; hello adds the
    // round-trip handshake state).
    await lab.agent('alice').hello(lab.agent('bob').address);
    await lab.agent('alice').hello(lab.agent('carol').address);

    const responseFromBob   = await lab.invoke('alice', 'bob',   'echo', 'hello-bob');
    const responseFromCarol = await lab.invoke('alice', 'carol', 'echo', 'hello-carol');

    expect(Parts.text(responseFromBob)).toBe('hello-bob');
    expect(Parts.text(responseFromCarol)).toBe('hello-carol');
  });

  it('peers() reports the configured mesh', async () => {
    lab = await Lab.boot({ agents: ['alice', 'bob', 'carol'] });
    expect(lab.peers('alice').sort()).toEqual(['bob', 'carol']);
    expect(lab.peers('bob').sort()).toEqual(['alice', 'carol']);
  });

  it('partitionMesh isolates groups (alice cannot reach carol)', async () => {
    lab = await Lab.boot({ agents: ['alice', 'bob', 'carol'] });
    lab.agent('bob').register('echo', async ({ parts }) => parts);
    lab.agent('carol').register('echo', async ({ parts }) => parts);

    await lab.agent('alice').hello(lab.agent('bob').address);
    await lab.agent('alice').hello(lab.agent('carol').address);

    // Sanity: pre-partition, alice can reach carol.
    const pre = await lab.invoke('alice', 'carol', 'echo', 'pre');
    expect(Parts.text(pre)).toBe('pre');

    // Partition: alice + bob in one group, carol alone.
    lab.partitionMesh([['alice', 'bob'], ['carol']]);

    // alice → bob still works
    const stillBob = await lab.invoke('alice', 'bob', 'echo', 'still-bob');
    expect(Parts.text(stillBob)).toBe('still-bob');

    // alice → carol now hangs (no delivery).  We confirm by giving the
    // call a short timeout and expecting it to throw.
    await expect(
      lab.invoke('alice', 'carol', 'echo', 'should-fail', { timeout: 200 }),
    ).rejects.toThrow();

    // Heal — carol is reachable again.
    lab.healPartition();
    const healed = await lab.invoke('alice', 'carol', 'echo', 'healed');
    expect(Parts.text(healed)).toBe('healed');
  });

  it('dropTransport disables a single edge; addTransport restores it', async () => {
    lab = await Lab.boot({ agents: ['alice', 'bob'] });
    lab.agent('bob').register('echo', async ({ parts }) => parts);
    await lab.agent('alice').hello(lab.agent('bob').address);

    lab.dropTransport('alice', 'internal');
    await expect(
      lab.invoke('alice', 'bob', 'echo', 'x', { timeout: 200 }),
    ).rejects.toThrow();

    lab.addTransport('alice', 'internal');
    const ok = await lab.invoke('alice', 'bob', 'echo', 'x');
    expect(Parts.text(ok)).toBe('x');
  });

  it('teardown is idempotent and leaves no leaked agents', async () => {
    lab = await Lab.boot({ agents: ['alice'] });
    await lab.teardown();
    // Second call — must not throw.
    await lab.teardown();
    // After teardown, agent lookups fail.
    expect(() => lab.agent('alice')).toThrow();

    // Re-boot a fresh Lab on the same describe — must work.
    lab = await Lab.boot({ agents: ['alice', 'bob'] });
    expect(lab.agentNames()).toEqual(['alice', 'bob']);
  });

  it('routeFor returns sensible defaults without a RoutingStrategy', async () => {
    lab = await Lab.boot({ agents: ['alice', 'bob'] });
    const route = await lab.routeFor('alice', 'bob');
    expect(route.tier).toBe('direct');
    expect(route.transport).toBe('internal');
  });

  it('MockClock injection sets per-agent offset (without SDK-side honour)', async () => {
    lab = await Lab.boot({ agents: ['alice', 'bob'] });
    lab.injectClockSkew('alice', 5_000);
    const aliceNow = lab.clock('alice').now();
    const bobNow   = lab.clock('bob').now();
    // bob has zero offset; alice has +5s.  Allow 50ms for timing slop.
    expect(aliceNow - bobNow).toBeGreaterThanOrEqual(4_950);
    expect(aliceNow - bobNow).toBeLessThanOrEqual(5_050);
  });

  it('podWrite/podRead round-trip via MockPod', async () => {
    lab = await Lab.boot({ agents: ['alice'], pod: 'mock' });
    await lab.podWrite('alice', '/notes/x.md', 'hello-pod');
    const r = await lab.podRead('alice', '/notes/x.md');
    expect(r.content).toBe('hello-pod');
  });

  it('assertSyncConverged passes when all named agents have matching content', async () => {
    lab = await Lab.boot({ agents: ['alice', 'bob'], pod: 'mock' });
    await lab.podWrite('alice', '/c/x', 'same');
    await lab.podWrite('bob',   '/c/x', 'same');
    await lab.assertSyncConverged(['alice', 'bob'], '/c/x');
  });

  it('star topology: hub knows all spokes, spokes know only the hub', async () => {
    lab = await Lab.boot({
      agents:   ['hub', 's1', 's2'],
      topology: 'star',
    });
    expect(lab.peers('hub').sort()).toEqual(['s1', 's2']);
    expect(lab.peers('s1')).toEqual(['hub']);
    expect(lab.peers('s2')).toEqual(['hub']);
  });
});

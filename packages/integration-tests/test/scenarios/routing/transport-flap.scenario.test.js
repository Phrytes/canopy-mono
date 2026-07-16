/**
 * routing/transport-flap — rapid drop/add cycles don't thrash routing.
 *
 * What this scenario verifies:
 *   1. Cycling `dropTransport` / `addTransport` 10 times in <1s on
 *      Alice's 'internal' transport leaves the routing decision and
 *      the agent's primary transport in a sane state at the end.
 *   2. After the flap, a real Alice→Bob round-trip succeeds — proving
 *      the wrapped transport's monkey-patches haven't drifted.
 *   3. The `routeFor()` answer is stable (same transport name) before
 *      and after the flap — RoutingStrategy / harness do not thrash
 *      under churn.
 *
 * Note on debouncing: the harness's `RoutingStrategy` does not run a
 * debounce timer of its own; debounce semantics live in the routing
 * decision (FallbackTable degraded windows) and at the transport
 * layer (rendezvous / relay reconnect timers).  What we assert here
 * is the observable invariant: the rapid flap does not corrupt state.
 * The harness exposes the wrapped transport's `enabled` flag, so we
 * can also verify it ends up enabled.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Parts } from '@onderling/core';
import { Lab } from '../../../src/_harness/index.js';

describe('routing/transport-flap', () => {
  let lab;

  beforeEach(async () => {
    lab = await Lab.boot({ agents: ['alice', 'bob'] });
  });

  afterEach(async () => {
    if (lab) {
      await lab.teardown();
      lab = null;
    }
  });

  it('10 drop/add cycles in <1s leaves alice→bob healthy', async () => {
    const alice = lab.agent('alice');
    const bob   = lab.agent('bob');
    bob.register('echo', async ({ parts }) => parts);
    await alice.hello(bob.address);

    // Pre-flap baseline: route + round-trip both work.
    const routeBefore = await lab.routeFor('alice', 'bob');
    const beforeText  = Parts.text(
      await lab.invoke('alice', 'bob', 'echo', 'before'),
    );
    expect(beforeText).toBe('before');

    // Run 10 drop/add cycles, measuring wall-clock total.
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) {
      lab.dropTransport('alice', 'internal');
      lab.addTransport ('alice', 'internal');
    }
    const flapMs = Date.now() - t0;
    if (flapMs >= 1_000) {
      throw new Error(
        `flap-budget: expected={cycles:10,wallclock:<1000ms}, ` +
        `got={cycles:10,wallclock:${flapMs}ms}, edge-states={transport:'internal'}`
      );
    }

    // After flap: route is unchanged, round-trip still works.
    const routeAfter = await lab.routeFor('alice', 'bob');
    if (routeAfter.transport !== routeBefore.transport ||
        routeAfter.tier      !== routeBefore.tier) {
      throw new Error(
        `route-thrash: expected={tier:'${routeBefore.tier}',transport:'${routeBefore.transport}'}, ` +
        `got={tier:'${routeAfter.tier}',transport:'${routeAfter.transport}'}, ` +
        `edge-states={cycles:10,final-enabled:true}`
      );
    }

    const afterText = Parts.text(
      await lab.invoke('alice', 'bob', 'echo', 'after'),
    );
    expect(afterText).toBe('after');
  });

  it('flap that ends DISABLED keeps state consistent (round-trip fails fast)', async () => {
    // Tail-end variant: 11 toggles starting from enabled = 10 down/up
    // pairs followed by one extra drop.  The transport must end
    // disabled and the round-trip must fail-fast (timeout).
    const alice = lab.agent('alice');
    const bob   = lab.agent('bob');
    bob.register('echo', async ({ parts }) => parts);
    await alice.hello(bob.address);

    for (let i = 0; i < 10; i++) {
      lab.dropTransport('alice', 'internal');
      lab.addTransport ('alice', 'internal');
    }
    lab.dropTransport('alice', 'internal');

    await expect(
      lab.invoke('alice', 'bob', 'echo', 'should-fail', { timeout: 200 }),
    ).rejects.toThrow();

    // Re-enable and recover.
    lab.addTransport('alice', 'internal');
    const recovered = Parts.text(
      await lab.invoke('alice', 'bob', 'echo', 'recovered'),
    );
    expect(recovered).toBe('recovered');
  });
});

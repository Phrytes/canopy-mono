/**
 * invokeWithHop — oracle-aware bridge selection.
 * See CODING-PLAN.md Group T5 and Design-v3/oracle-bridge-selection.md §6.
 */
import { describe, it, expect, vi } from 'vitest';
import { invokeWithHop } from '../src/routing/invokeWithHop.js';
import { PeerGraph }     from '../src/discovery/PeerGraph.js';
import { DataPart, Parts } from '../src/Parts.js';

const TARGET   = 'T_pubkey_0000000000000000';
const ORACLE_B = 'B_pubkey_0000000000000000';
const ORACLE_C = 'C_pubkey_0000000000000000';
const PLAIN_Z  = 'Z_pubkey_0000000000000000';

function forwardOk(fromBridge) {
  return [DataPart({ forwarded: true, parts: [DataPart({ bridge: fromBridge })] })];
}

async function makeAgent(peersArr, invokeImpl) {
  const graph = new PeerGraph();
  for (const p of peersArr) await graph.upsert(p);
  return {
    peers: {
      get: (k) => graph.get(k),
      all: () => graph.all(),
    },
    invoke: vi.fn(invokeImpl ?? (async () => [])),
    hello:  vi.fn(async () => {}),
  };
}

describe('invokeWithHop — oracle bridge selection', () => {

  it('prefers a bridge whose fresh knownPeers contains the target', async () => {
    const now = Date.now();
    const agent = await makeAgent(
      [
        { pubKey: TARGET,  hops: 1, via: PLAIN_Z, reachable: true },
        { pubKey: ORACLE_B, hops: 0, reachable: true,
          knownPeers: [TARGET], knownPeersTs: now + 60_000 },
        { pubKey: PLAIN_Z,  hops: 0, reachable: true },
      ],
      async (peerId) => {
        if (peerId === ORACLE_B) return forwardOk(ORACLE_B);
        throw new Error('should not have been called');
      },
    );

    const result = await invokeWithHop(agent, TARGET, 'echo', []);
    expect(Parts.data(result)).toEqual({ bridge: ORACLE_B });

    // Exactly one invoke — the oracle pick was correct on the first try.
    expect(agent.invoke).toHaveBeenCalledTimes(1);
    expect(agent.invoke.mock.calls[0][0]).toBe(ORACLE_B);
  });

  it('ignores an expired oracle entry (falls back to probe-retry order)', async () => {
    const now = Date.now();
    // ORACLE_B's claim is past expiry. PLAIN_Z (record.via) should be tried first.
    const agent = await makeAgent(
      [
        { pubKey: TARGET,  hops: 1, via: PLAIN_Z, reachable: true },
        { pubKey: ORACLE_B, hops: 0, reachable: true,
          knownPeers: [TARGET], knownPeersTs: now - 1 },
        { pubKey: PLAIN_Z,  hops: 0, reachable: true },
      ],
      async (peerId) => {
        if (peerId === PLAIN_Z) return forwardOk(PLAIN_Z);
        return [DataPart({ error: 'target-unreachable' })];
      },
    );

    await invokeWithHop(agent, TARGET, 'echo', []);

    // First try must be record.via (PLAIN_Z), NOT the stale oracle bridge.
    expect(agent.invoke.mock.calls[0][0]).toBe(PLAIN_Z);
  });

  it('orders multiple oracle hits lexicographically', async () => {
    const now = Date.now();
    const calls = [];
    const agent = await makeAgent(
      [
        { pubKey: TARGET,   hops: 1, via: PLAIN_Z, reachable: true },
        { pubKey: ORACLE_C, hops: 0, reachable: true,
          knownPeers: [TARGET], knownPeersTs: now + 60_000 },
        { pubKey: ORACLE_B, hops: 0, reachable: true,
          knownPeers: [TARGET], knownPeersTs: now + 60_000 },
        { pubKey: PLAIN_Z,  hops: 0, reachable: true },
      ],
      async (peerId) => {
        calls.push(peerId);
        // Both oracle candidates refuse; we want to see that ORACLE_B is
        // tried before ORACLE_C (lex order).
        return [DataPart({ error: 'target-unreachable' })];
      },
    );

    await expect(invokeWithHop(agent, TARGET, 'echo', []))
      .rejects.toThrow(/target-unreachable/);

    // ORACLE_B before ORACLE_C, both before PLAIN_Z (probe-retry tail).
    const bOrder = calls.indexOf(ORACLE_B);
    const cOrder = calls.indexOf(ORACLE_C);
    const zOrder = calls.indexOf(PLAIN_Z);
    expect(bOrder).toBeGreaterThanOrEqual(0);
    expect(cOrder).toBeGreaterThanOrEqual(0);
    expect(bOrder).toBeLessThan(cOrder);
    expect(cOrder).toBeLessThan(zOrder);
  });

  it('falls back to probe-retry candidates when the oracle-picked bridge refuses', async () => {
    const now = Date.now();
    const calls = [];
    const agent = await makeAgent(
      [
        { pubKey: TARGET,   hops: 1, via: PLAIN_Z, reachable: true },
        { pubKey: ORACLE_B, hops: 0, reachable: true,
          knownPeers: [TARGET], knownPeersTs: now + 60_000 },
        { pubKey: PLAIN_Z,  hops: 0, reachable: true },
      ],
      async (peerId) => {
        calls.push(peerId);
        if (peerId === ORACLE_B) return [DataPart({ error: 'target-unreachable' })];
        if (peerId === PLAIN_Z)  return forwardOk(PLAIN_Z);
        throw new Error('unexpected');
      },
    );

    const result = await invokeWithHop(agent, TARGET, 'echo', []);
    expect(Parts.data(result)).toEqual({ bridge: PLAIN_Z });
    expect(calls).toEqual([ORACLE_B, PLAIN_Z]);  // oracle first, then probe-retry
  });

  it('zero oracle data → behaves exactly like Group-M probe-retry', async () => {
    const calls = [];
    const agent = await makeAgent(
      [
        { pubKey: TARGET,  hops: 1, via: PLAIN_Z, reachable: true },
        { pubKey: PLAIN_Z, hops: 0, reachable: true },
      ],
      async (peerId) => {
        calls.push(peerId);
        if (peerId === PLAIN_Z) return forwardOk(PLAIN_Z);
        throw new Error('unexpected');
      },
    );

    const result = await invokeWithHop(agent, TARGET, 'echo', []);
    expect(Parts.data(result)).toEqual({ bridge: PLAIN_Z });
    expect(calls).toEqual([PLAIN_Z]);
  });

  it('ignores a knownPeers entry that does not contain the target', async () => {
    const now = Date.now();
    const calls = [];
    const agent = await makeAgent(
      [
        { pubKey: TARGET,   hops: 1, via: PLAIN_Z, reachable: true },
        { pubKey: ORACLE_B, hops: 0, reachable: true,
          knownPeers: ['someone-else'], knownPeersTs: now + 60_000 },
        { pubKey: PLAIN_Z,  hops: 0, reachable: true },
      ],
      async (peerId) => {
        calls.push(peerId);
        if (peerId === PLAIN_Z) return forwardOk(PLAIN_Z);
        return [DataPart({ error: 'target-unreachable' })];
      },
    );

    await invokeWithHop(agent, TARGET, 'echo', []);
    // ORACLE_B is not prioritised because it doesn't claim TARGET;
    // record.via (PLAIN_Z) is the first bridge.
    expect(calls[0]).toBe(PLAIN_Z);
  });
});

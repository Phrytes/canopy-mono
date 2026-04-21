/**
 * invokeWithHop — hop-aware invoke with bridge fallback.
 * See EXTRACTION-PLAN.md Group M for the Tests checklist.
 */
import { describe, it, expect, vi } from 'vitest';
import { invokeWithHop } from '../src/routing/invokeWithHop.js';
import { DataPart, Parts } from '../src/Parts.js';

// ── Tiny fake Agent ───────────────────────────────────────────────────────────

function makeAgent({ peers = [], invoke, hello } = {}) {
  const record = {};
  for (const p of peers) record[p.pubKey] = p;
  return {
    peers: {
      get: vi.fn(async (k) => record[k] ?? null),
      all: vi.fn(async () => peers),
    },
    invoke: vi.fn(invoke ?? (async () => [])),
    hello:  vi.fn(hello  ?? (async () => {})),
  };
}

describe('invokeWithHop', () => {
  const TARGET = 'T_pubkey_0000000000000000';
  const BRIDGE = 'B_pubkey_0000000000000000';
  const STRANGER = 'X_pubkey_0000000000000000';

  it('succeeds on direct invoke when peer is hops:0', async () => {
    const agent = makeAgent({
      peers: [{ pubKey: TARGET, hops: 0, reachable: true }],
      invoke: async () => [DataPart({ ok: true })],
    });

    const out = await invokeWithHop(agent, TARGET, 'echo', []);
    expect(Parts.data(out)).toEqual({ ok: true });
    expect(agent.invoke).toHaveBeenCalledTimes(1);
    expect(agent.invoke.mock.calls[0][0]).toBe(TARGET);
  });

  it('skips direct when record.hops > 0 and uses record.via as bridge', async () => {
    const agent = makeAgent({
      peers: [
        { pubKey: TARGET, hops: 1, via: BRIDGE, reachable: true },
        { pubKey: BRIDGE, hops: 0,             reachable: true },
      ],
      invoke: vi.fn(async (peerId, skill) => {
        if (peerId === BRIDGE && skill === 'relay-forward') {
          return [DataPart({ forwarded: true, parts: [DataPart({ ok: 'via-bridge' })] })];
        }
        throw new Error('should not call direct when skipDirect is true');
      }),
    });

    const out = await invokeWithHop(agent, TARGET, 'echo', []);
    expect(Parts.data(out)).toEqual({ ok: 'via-bridge' });

    // agent.invoke called exactly once, to the bridge.
    expect(agent.invoke).toHaveBeenCalledTimes(1);
    expect(agent.invoke.mock.calls[0][0]).toBe(BRIDGE);
    expect(agent.invoke.mock.calls[0][1]).toBe('relay-forward');
  });

  it('falls back to a bridge when direct fails with a transport error', async () => {
    let directFailed = false;
    const agent = makeAgent({
      peers: [
        { pubKey: TARGET, hops: 0, reachable: true },          // stale-direct
        { pubKey: BRIDGE, hops: 0, reachable: true },
      ],
      invoke: vi.fn(async (peerId, skill) => {
        if (peerId === TARGET) {
          directFailed = true;
          throw new Error('MdnsTransport: no connection to ' + TARGET);
        }
        if (peerId === BRIDGE && skill === 'relay-forward') {
          return [DataPart({ forwarded: true, parts: [DataPart({ ok: 'bridge-rescue' })] })];
        }
        throw new Error('unexpected call');
      }),
    });

    const out = await invokeWithHop(agent, TARGET, 'echo', []);
    expect(directFailed).toBe(true);
    expect(Parts.data(out)).toEqual({ ok: 'bridge-rescue' });
  });

  it('auto-attempts hello when direct fails with a "pubKey" security error, then retries', async () => {
    let helloed = false;
    const agent = makeAgent({
      peers: [{ pubKey: TARGET, hops: 0, reachable: true }],
      hello: vi.fn(async () => { helloed = true; }),
    });
    agent.invoke = vi.fn(async () => {
      if (!helloed) throw new Error('No pubKey registered for recipient ' + TARGET);
      return [DataPart({ ok: 'after-hello' })];
    });

    const out = await invokeWithHop(agent, TARGET, 'echo', []);
    expect(agent.hello).toHaveBeenCalledTimes(1);
    expect(agent.invoke).toHaveBeenCalledTimes(2);
    expect(Parts.data(out)).toEqual({ ok: 'after-hello' });
  });

  it('re-throws genuine skill errors (not transport, not security)', async () => {
    const agent = makeAgent({
      peers: [{ pubKey: TARGET, hops: 0, reachable: true }],
      invoke: async () => { throw new Error('division by zero'); },
    });
    await expect(invokeWithHop(agent, TARGET, 'echo', [])).rejects.toThrow(/division by zero/);
  });

  it('tries every reachable direct peer as a bridge and surfaces the last error', async () => {
    const agent = makeAgent({
      peers: [
        { pubKey: TARGET,   hops: 1, via: BRIDGE, reachable: true },
        { pubKey: BRIDGE,   hops: 0,              reachable: true },
        { pubKey: STRANGER, hops: 0,              reachable: true },
      ],
      invoke: vi.fn(async (peerId) => {
        if (peerId === BRIDGE)   return [DataPart({ error: 'target-unreachable' })];
        if (peerId === STRANGER) return [DataPart({ error: 'target-unreachable' })];
        throw new Error('unexpected');
      }),
    });

    await expect(invokeWithHop(agent, TARGET, 'echo', []))
      .rejects.toThrow(/target-unreachable/);

    // Both candidates should be tried.
    const calls = agent.invoke.mock.calls.map(c => c[0]);
    expect(calls).toContain(BRIDGE);
    expect(calls).toContain(STRANGER);
  });

  it('throws with a helpful message when no bridges exist', async () => {
    const agent = makeAgent({
      peers: [{ pubKey: TARGET, hops: 1, reachable: true }], // no via; no other direct peers
      invoke: async () => { throw new Error('unexpected'); },
    });

    await expect(invokeWithHop(agent, TARGET, 'echo', []))
      .rejects.toThrow(/no bridge peer available/);
  });

  it('returns the first successful bridge result and stops after that', async () => {
    const agent = makeAgent({
      peers: [
        { pubKey: TARGET,   hops: 1, via: BRIDGE, reachable: true },
        { pubKey: BRIDGE,   hops: 0,              reachable: true },
        { pubKey: STRANGER, hops: 0,              reachable: true },
      ],
      invoke: vi.fn(async (peerId) => {
        if (peerId === BRIDGE) {
          return [DataPart({ forwarded: true, parts: [DataPart({ ok: true })] })];
        }
        throw new Error('should not be reached');
      }),
    });

    const out = await invokeWithHop(agent, TARGET, 'echo', []);
    expect(Parts.data(out)).toEqual({ ok: true });
    // Only the first bridge should have been tried.
    expect(agent.invoke).toHaveBeenCalledTimes(1);
  });
});

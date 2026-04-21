/**
 * NknTransport tests.
 *
 * Full integration tests require live NKN network access and are skipped in CI.
 * The construction / configuration tests run everywhere.
 *
 * To run the integration tests locally:
 *   RUN_NKN_TESTS=1 npm test -- test/NknTransport.test.js
 */
import { describe, it, expect } from 'vitest';
import { NknTransport }  from '../src/transport/NknTransport.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory }   from '../src/identity/VaultMemory.js';

const RUN_INTEGRATION = !!process.env.RUN_NKN_TESTS;

// ── Construction / configuration ──────────────────────────────────────────────

describe('NknTransport construction', () => {
  it('throws without identity', () => {
    expect(() => new NknTransport({})).toThrow(/identity/);
  });

  it('constructs without throwing when identity provided', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    expect(() => new NknTransport({ identity: id })).not.toThrow();
  });

  it('address is set after construction (NKN addr derived on connect, not yet here)', async () => {
    // The NKN address is derived from the identity seed during connect().
    // Before connect(), address may be undefined — that is expected.
    const id = await AgentIdentity.generate(new VaultMemory());
    const t  = new NknTransport({ identity: id });
    // Just verify it doesn't crash; address may be undefined before connect.
    expect(t).toBeDefined();
  });

  it('accepts an optional identifier prefix', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const t  = new NknTransport({ identity: id, identifier: 'my-agent' });
    expect(t).toBeDefined();
  });

  it('accepts a custom nknLib (no network call)', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const fakeLib = { Client: class { connect() {} } };
    const t = new NknTransport({ identity: id, nknLib: fakeLib });
    expect(t).toBeDefined();
  });
});

// ── Integration (live network — skip in CI) ───────────────────────────────────

describe.skipIf(!RUN_INTEGRATION)('NknTransport integration (requires network)', () => {
  it('connects to NKN mainnet and sends a round-trip message', async () => {
    // Two transports on the same seed → same address, different identifier.
    const id = await AgentIdentity.generate(new VaultMemory());
    const t1 = new NknTransport({ identity: id, identifier: 'nkn-test-a' });
    const t2 = new NknTransport({ identity: id, identifier: 'nkn-test-b' });

    await Promise.all([t1.connect(), t2.connect()]);

    const received = new Promise(resolve => t2.setReceiveHandler(resolve));

    await t1._put(t2.address, {
      _v: 1, _p: 'OW', _id: 'test', _re: null,
      _from: t1.address, _to: t2.address,
      _topic: null, _ts: Date.now(), _sig: null,
      payload: { type: 'ping' },
    });

    const env = await received;
    expect(env.payload.type).toBe('ping');

    await t1.disconnect(); await t2.disconnect();
  }, 60_000);
});

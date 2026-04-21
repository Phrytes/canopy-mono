/**
 * OfflineTransport — no-op transport for agents with no network interface.
 * See EXTRACTION-PLAN.md Group M.
 */
import { describe, it, expect } from 'vitest';
import { OfflineTransport } from '../src/transport/OfflineTransport.js';

describe('OfflineTransport', () => {
  const identity = { pubKey: 'self-pubkey-xyz' };

  it('constructs with an identity and exposes its pubKey as address', () => {
    const t = new OfflineTransport({ identity });
    expect(t.address).toBe('self-pubkey-xyz');
  });

  it('accepts a bare identity argument for convenience', () => {
    const t = new OfflineTransport(identity);
    expect(t.address).toBe('self-pubkey-xyz');
  });

  it('connect() resolves without doing any network work', async () => {
    const t = new OfflineTransport({ identity });
    await expect(t.connect()).resolves.toBeUndefined();
  });

  it('_put() rejects with a message that includes a peer-address slice', async () => {
    const t  = new OfflineTransport({ identity });
    const to = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    await expect(t._put(to, { type: 'task' })).rejects.toThrow(/offline/i);
    await expect(t._put(to, { type: 'task' })).rejects.toThrow(/ABCDEFGHIJKLMNOP/);
  });

  it('_put() with null peer address still throws without crashing', async () => {
    const t = new OfflineTransport({ identity });
    await expect(t._put(null, {})).rejects.toThrow(/offline/i);
  });

  it('disconnect() is a no-op', async () => {
    const t = new OfflineTransport({ identity });
    await expect(t.disconnect()).resolves.toBeUndefined();
  });
});

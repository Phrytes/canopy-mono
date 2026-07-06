/**
 * createCustomerRegister — in-memory coverage (Map store + StorageBackend
 * store), injected clock for deterministic timestamps.
 */

import { describe, it, expect } from 'vitest';
import { createMemoryBackend }   from '@canopy/pseudo-pod';
import {
  createCustomerRegister,
  CUSTOMER_STATUS,
} from '../src/customerRegister.js';

const T0 = '2026-07-06T09:00:00.000Z';
const T1 = '2026-07-06T10:00:00.000Z';

function fixedClock(seq = [T0]) {
  let i = 0;
  return () => seq[Math.min(i++, seq.length - 1)];
}

describe('createCustomerRegister — register / get / list (Map store)', () => {
  it('registers a fresh instance with provisioning status + injected timestamp', async () => {
    const reg = createCustomerRegister({ now: () => T0 });
    const entry = await reg.register({
      customerId: 'acme', podUri: 'https://acme.pod', agentWebid: 'https://acme.pod/profile/card#me',
    });
    expect(entry).toEqual({
      customerId:    'acme',
      podUri:        'https://acme.pod',
      agentWebid:    'https://acme.pod/profile/card#me',
      status:        CUSTOMER_STATUS.provisioning,
      provisionedAt: T0,
    });
  });

  it('get returns the entry; unknown customer → null', async () => {
    const reg = createCustomerRegister({ now: () => T0 });
    await reg.register({ customerId: 'acme', podUri: 'https://acme.pod', agentWebid: 'w' });
    expect(await reg.get('acme')).toMatchObject({ customerId: 'acme', status: 'provisioning' });
    expect(await reg.get('nobody')).toBeNull();
    expect(await reg.get('')).toBeNull();
  });

  it('list returns all instances sorted by customerId', async () => {
    const reg = createCustomerRegister({ now: () => T0 });
    await reg.register({ customerId: 'zeta', podUri: 'p', agentWebid: 'w' });
    await reg.register({ customerId: 'acme', podUri: 'p', agentWebid: 'w' });
    const ids = (await reg.list()).map(e => e.customerId);
    expect(ids).toEqual(['acme', 'zeta']);
  });

  it('re-register upserts fields but preserves original provisionedAt + status', async () => {
    const reg = createCustomerRegister({ now: fixedClock([T0, T1]) });
    await reg.register({ customerId: 'acme', podUri: 'https://old.pod', agentWebid: 'w-old' });
    await reg.setStatus('acme', CUSTOMER_STATUS.active);
    const updated = await reg.register({ customerId: 'acme', podUri: 'https://new.pod', agentWebid: 'w-new' });
    expect(updated.podUri).toBe('https://new.pod');
    expect(updated.agentWebid).toBe('w-new');
    expect(updated.provisionedAt).toBe(T0);      // preserved
    expect(updated.status).toBe(CUSTOMER_STATUS.active); // preserved
  });

  it('validates required fields', async () => {
    const reg = createCustomerRegister();
    await expect(reg.register({ podUri: 'p', agentWebid: 'w' }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(reg.register({ customerId: 'c', agentWebid: 'w' }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(reg.register({ customerId: 'c', podUri: 'p' }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('createCustomerRegister — status transitions', () => {
  it('transitions through the lifecycle states', async () => {
    const reg = createCustomerRegister({ now: () => T0 });
    await reg.register({ customerId: 'acme', podUri: 'p', agentWebid: 'w' });
    for (const s of ['active', 'suspended', 'active', 'retired']) {
      const r = await reg.setStatus('acme', s);
      expect(r.status).toBe(s);
      expect((await reg.get('acme')).status).toBe(s);
    }
  });

  it('rejects an unknown status', async () => {
    const reg = createCustomerRegister({ now: () => T0 });
    await reg.register({ customerId: 'acme', podUri: 'p', agentWebid: 'w' });
    await expect(reg.setStatus('acme', 'deleted'))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('setStatus on unknown customer → coded UNKNOWN_CUSTOMER', async () => {
    const reg = createCustomerRegister({ now: () => T0 });
    await expect(reg.setStatus('ghost', 'active'))
      .rejects.toMatchObject({ code: 'UNKNOWN_CUSTOMER', customerId: 'ghost' });
  });
});

describe('createCustomerRegister — StorageBackend-shaped store', () => {
  it('works against a MemoryBackend (put/get/list)', async () => {
    const reg = createCustomerRegister({ store: createMemoryBackend(), now: () => T0 });
    await reg.register({ customerId: 'acme', podUri: 'https://acme.pod', agentWebid: 'w' });
    await reg.register({ customerId: 'beta', podUri: 'https://beta.pod', agentWebid: 'w' });
    expect(await reg.get('acme')).toMatchObject({ customerId: 'acme', podUri: 'https://acme.pod' });
    expect((await reg.list()).map(e => e.customerId)).toEqual(['acme', 'beta']);
    await reg.setStatus('acme', 'active');
    expect((await reg.get('acme')).status).toBe('active');
    expect(await reg.get('missing')).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { PushTokenRegistry } from '../../src/push/PushTokenRegistry.js';

describe('PushTokenRegistry', () => {
  it('register / get round-trip', () => {
    const reg = new PushTokenRegistry();
    reg.register('alice', { token: 'tok-1', platform: 'ios' });
    const rec = reg.get('alice');
    expect(rec).toMatchObject({ token: 'tok-1', platform: 'ios', lastPushedAt: 0 });
    expect(rec.registeredAt).toBeGreaterThan(0);
  });

  it('returns null for unknown addresses', () => {
    const reg = new PushTokenRegistry();
    expect(reg.get('nobody')).toBeNull();
  });

  it('re-register replaces the prior record', () => {
    const reg = new PushTokenRegistry();
    reg.register('alice', { token: 'tok-1', platform: 'ios' });
    reg.register('alice', { token: 'tok-2', platform: 'android' });
    expect(reg.get('alice')).toMatchObject({ token: 'tok-2', platform: 'android' });
  });

  it('unregister is idempotent', () => {
    const reg = new PushTokenRegistry();
    reg.register('alice', { token: 'tok-1', platform: 'ios' });
    reg.unregister('alice');
    reg.unregister('alice');                  // must not throw
    expect(reg.get('alice')).toBeNull();
  });

  it('markPushed updates lastPushedAt', () => {
    const reg = new PushTokenRegistry();
    reg.register('alice', { token: 'tok-1', platform: 'ios' });
    reg.markPushed('alice', 12345);
    expect(reg.get('alice').lastPushedAt).toBe(12345);
  });

  it('markPushed on unknown address is a no-op', () => {
    const reg = new PushTokenRegistry();
    reg.markPushed('nobody');                 // must not throw
    expect(reg.get('nobody')).toBeNull();
  });

  it('rejects missing address / token', () => {
    const reg = new PushTokenRegistry();
    expect(() => reg.register(null, { token: 't' })).toThrow(/address required/);
    expect(() => reg.register('a',  {})).toThrow(/token required/);
  });

  it('size + clear', () => {
    const reg = new PushTokenRegistry();
    reg.register('a', { token: 't1' });
    reg.register('b', { token: 't2' });
    expect(reg.size()).toBe(2);
    reg.clear();
    expect(reg.size()).toBe(0);
  });
});

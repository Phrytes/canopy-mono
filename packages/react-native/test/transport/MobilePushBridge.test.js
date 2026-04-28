/**
 * MobilePushBridge tests — adapter + agent are mocked.
 * No real Expo runtime, no real device.
 */
import { describe, it, expect, vi } from 'vitest';

import { MobilePushBridge } from '../../src/transport/MobilePushBridge.js';
import { PushAdapter }      from '../../src/transport/pushAdapters/PushAdapter.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockAdapter({ token = 'tok-1', platform = 'ios', failPermission = false } = {}) {
  let handler = null;
  const subscription = vi.fn();           // unsubscribe fn
  const adapter = {
    register: vi.fn(async () => {
      if (failPermission) {
        throw Object.assign(new Error('Push permission denied'),
                            { code: 'PUSH_PERMISSION_DENIED' });
      }
      return { token, platform };
    }),
    onNotification: vi.fn((h) => {
      handler = h;
      return subscription;
    }),
    unregister: vi.fn(async () => {}),
    // test helpers
    _fire: (data, foreground = true) => handler?.({ data, foreground }),
    _subscription: subscription,
    _hasHandler: () => handler !== null,
  };
  return adapter;
}

function mockAgent({ skillIds = ['wake'] } = {}) {
  const events = new Map();
  return {
    address:  'agent-self',
    identity: { pubKey: 'agent-pk' },
    emit:    vi.fn((event, payload) => {
      const arr = events.get(event) ?? [];
      arr.push(payload);
      events.set(event, arr);
    }),
    on: vi.fn(),
    invoke: vi.fn(() => undefined),     // sync stub
    skills: {
      get: vi.fn((id) => (skillIds.includes(id) ? { id } : null)),
    },
    _events: events,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MobilePushBridge', () => {
  describe('constructor', () => {
    it('throws when agent is missing', () => {
      expect(() => new MobilePushBridge({ adapter: mockAdapter() }))
        .toThrow(/agent is required/);
    });

    it('throws when adapter is missing', () => {
      expect(() => new MobilePushBridge({ agent: mockAgent() }))
        .toThrow(/adapter is required/);
    });
  });

  describe('register', () => {
    it('returns { token, platform } and exposes them via getters', async () => {
      const adapter = mockAdapter({ token: 'tok-abc', platform: 'android' });
      const agent   = mockAgent();
      const bridge  = new MobilePushBridge({ agent, adapter });

      const result = await bridge.register({ projectId: 'eas-123' });

      expect(result).toEqual({ token: 'tok-abc', platform: 'android' });
      expect(bridge.token).toBe('tok-abc');
      expect(bridge.platform).toBe('android');
      expect(adapter.register).toHaveBeenCalledWith({ projectId: 'eas-123' });
      expect(adapter.onNotification).toHaveBeenCalledTimes(1);
      expect(adapter._hasHandler()).toBe(true);
    });

    it('propagates PUSH_PERMISSION_DENIED from adapter', async () => {
      const adapter = mockAdapter({ failPermission: true });
      const agent   = mockAgent();
      const bridge  = new MobilePushBridge({ agent, adapter });

      await expect(bridge.register()).rejects.toMatchObject({
        code: 'PUSH_PERMISSION_DENIED',
      });
      expect(bridge.token).toBeNull();
      expect(bridge.platform).toBeNull();
    });
  });

  describe('notification dispatch', () => {
    it('invokes a matching skill with (selfAddress, skillId, parts)', async () => {
      const adapter = mockAdapter();
      const agent   = mockAgent({ skillIds: ['wake'] });
      const bridge  = new MobilePushBridge({ agent, adapter });
      await bridge.register();

      const parts = [{ kind: 'text', text: 'go' }];
      adapter._fire({ skillId: 'wake', parts });

      expect(agent.invoke).toHaveBeenCalledTimes(1);
      expect(agent.invoke).toHaveBeenCalledWith('agent-self', 'wake', parts);
    });

    it('always emits a generic "push" event with { data, foreground }', async () => {
      const adapter = mockAdapter();
      const agent   = mockAgent();
      const bridge  = new MobilePushBridge({ agent, adapter });
      await bridge.register();

      adapter._fire({ skillId: 'wake', parts: [] }, true);
      adapter._fire({ note: 'no skill here' }, false);

      // Two 'push' emits, one per notification.
      const pushEvents = agent._events.get('push') ?? [];
      expect(pushEvents).toHaveLength(2);
      expect(pushEvents[0]).toEqual({
        data:       { skillId: 'wake', parts: [] },
        foreground: true,
      });
      expect(pushEvents[1]).toEqual({
        data:       { note: 'no skill here' },
        foreground: false,
      });
    });

    it('emits "push" but does NOT invoke when skillId is unknown', async () => {
      const adapter = mockAdapter();
      const agent   = mockAgent({ skillIds: ['wake'] });
      const bridge  = new MobilePushBridge({ agent, adapter });
      await bridge.register();

      adapter._fire({ skillId: 'unknown-skill', parts: [] });

      expect(agent.invoke).not.toHaveBeenCalled();
      const pushEvents = agent._events.get('push') ?? [];
      expect(pushEvents).toHaveLength(1);
    });

    it('emits "push" without invoking when skillId is absent', async () => {
      const adapter = mockAdapter();
      const agent   = mockAgent();
      const bridge  = new MobilePushBridge({ agent, adapter });
      await bridge.register();

      adapter._fire({ payload: 'opaque' });

      expect(agent.invoke).not.toHaveBeenCalled();
      expect(agent._events.get('push') ?? []).toHaveLength(1);
    });

    it('falls back to identity.pubKey when address is missing', async () => {
      const adapter = mockAdapter();
      const agent   = mockAgent();
      agent.address = undefined;            // simulate not-yet-started agent
      const bridge  = new MobilePushBridge({ agent, adapter });
      await bridge.register();

      adapter._fire({ skillId: 'wake', parts: [] });

      expect(agent.invoke).toHaveBeenCalledWith('agent-pk', 'wake', []);
    });

    it('forwards invoke rejection to agent "error" event', async () => {
      const adapter = mockAdapter();
      const agent   = mockAgent();
      const boom    = new Error('boom');
      agent.invoke  = vi.fn(() => Promise.reject(boom));
      const bridge  = new MobilePushBridge({ agent, adapter });
      await bridge.register();

      adapter._fire({ skillId: 'wake', parts: [] });

      // Wait one microtask for the rejected promise to land.
      await Promise.resolve();
      await Promise.resolve();

      const errorEvents = agent._events.get('error') ?? [];
      expect(errorEvents).toContain(boom);
    });

    it('forwards synchronous invoke throw to agent "error" event', async () => {
      const adapter = mockAdapter();
      const agent   = mockAgent();
      const boom    = new Error('sync-boom');
      agent.invoke  = vi.fn(() => { throw boom; });
      const bridge  = new MobilePushBridge({ agent, adapter });
      await bridge.register();

      adapter._fire({ skillId: 'wake', parts: [] });

      const errorEvents = agent._events.get('error') ?? [];
      expect(errorEvents).toContain(boom);
    });

    it('treats non-array parts as empty parts', async () => {
      const adapter = mockAdapter();
      const agent   = mockAgent();
      const bridge  = new MobilePushBridge({ agent, adapter });
      await bridge.register();

      adapter._fire({ skillId: 'wake', parts: 'not-an-array' });

      expect(agent.invoke).toHaveBeenCalledWith('agent-self', 'wake', []);
    });
  });

  describe('unregister', () => {
    it('is idempotent and tears down listener + adapter', async () => {
      const adapter = mockAdapter();
      const agent   = mockAgent();
      const bridge  = new MobilePushBridge({ agent, adapter });
      await bridge.register();

      await bridge.unregister();
      expect(adapter._subscription).toHaveBeenCalledTimes(1); // unsub fn called
      expect(adapter.unregister).toHaveBeenCalledTimes(1);
      expect(bridge.token).toBeNull();
      expect(bridge.platform).toBeNull();

      // Second call must not throw and should still try the adapter.
      await bridge.unregister();
      expect(adapter._subscription).toHaveBeenCalledTimes(1); // not called again
      expect(adapter.unregister).toHaveBeenCalledTimes(2);
    });

    it('survives an unsubscribe fn that throws', async () => {
      const adapter = mockAdapter();
      adapter.onNotification = vi.fn(() => { return () => { throw new Error('no'); }; });
      const agent   = mockAgent();
      const bridge  = new MobilePushBridge({ agent, adapter });
      await bridge.register();

      await expect(bridge.unregister()).resolves.toBeUndefined();
      expect(adapter.unregister).toHaveBeenCalled();
    });
  });

  describe('PushAdapter base class', () => {
    it('throws on every method (must be subclassed)', async () => {
      const base = new PushAdapter();
      await expect(base.register()).rejects.toThrow(/not implemented/);
      expect(() => base.onNotification(() => {})).toThrow(/not implemented/);
      await expect(base.unregister()).rejects.toThrow(/not implemented/);
    });
  });
});

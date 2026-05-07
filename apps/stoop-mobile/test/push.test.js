/**
 * push tests — `setupPush` + `requestPushPermission` wiring.
 *
 * The ExpoNotificationsAdapter pulls real `expo-notifications` and
 * `react-native` imports at module-load time; tests rely on the
 * setup.js mocks for both.  We additionally inject a fake adapter
 * to test the orchestration logic without depending on the real
 * adapter's behaviour.
 */

import { describe, it, expect, vi } from 'vitest';
import { setupPush, requestPushPermission } from '../src/lib/push.js';

class FakeAdapter {
  constructor({ shouldFail = false, token = 'fake-token', platform = 'android' } = {}) {
    this.shouldFail = shouldFail;
    this.token      = token;
    this.platform   = platform;
    this.subscribers = new Set();
    this.unregistered = false;
  }
  async register() {
    if (this.shouldFail) throw Object.assign(new Error('denied'), { code: 'PUSH_PERMISSION_DENIED' });
    return { token: this.token, platform: this.platform };
  }
  onNotification(handler) {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }
  async unregister() { this.unregistered = true; }
  fire(notif) { for (const h of this.subscribers) h(notif); }
}

function makeAgentStub() {
  const events = new Map();
  const skills = new Map();
  return {
    address: 'agent://stub',
    skills:  { get: (id) => skills.get(id) ?? null, _set: (id, s) => skills.set(id, s) },
    on:   (evt, cb) => { (events.get(evt) ?? events.set(evt, new Set()).get(evt)).add(cb); },
    emit: (evt, payload) => { for (const cb of events.get(evt) ?? []) cb(payload); },
    _events: events,
  };
}

describe('setupPush — happy path', () => {
  it('returns the bridge + token from the adapter', async () => {
    const agent = makeAgentStub();
    const onToken = vi.fn();
    const r = await setupPush({
      agent,
      projectId: 'project-stoop',
      onToken,
      AdapterFactory: () => new FakeAdapter({ token: 'tok-1', platform: 'android' }),
    });
    expect(r.bridge).not.toBeNull();
    expect(r.token).toBe('tok-1');
    expect(r.platform).toBe('android');
    expect(onToken).toHaveBeenCalledWith('tok-1', 'android');
  });

  it('routes incoming notifications via the bridge → agent.emit("push")', async () => {
    const agent = makeAgentStub();
    let pushed;
    agent.on('push', (p) => { pushed = p; });

    const fake = new FakeAdapter();
    const r = await setupPush({
      agent,
      AdapterFactory: () => fake,
    });
    expect(r.bridge).not.toBeNull();

    fake.fire({ data: { kind: 'chat-msg' }, foreground: true });
    expect(pushed).toEqual({ data: { kind: 'chat-msg' }, foreground: true });
  });

  it('teardown() unregisters the adapter', async () => {
    const agent = makeAgentStub();
    const fake = new FakeAdapter();
    const r = await setupPush({ agent, AdapterFactory: () => fake });
    await r.teardown();
    expect(fake.unregistered).toBe(true);
  });
});

describe('setupPush — failure paths', () => {
  it('returns null bridge + null token on permission denial', async () => {
    const agent = makeAgentStub();
    const onError = vi.fn();
    const r = await setupPush({
      agent,
      AdapterFactory: () => new FakeAdapter({ shouldFail: true }),
      onError,
    });
    expect(r.bridge).toBeNull();
    expect(r.token).toBeNull();
    expect(r.platform).toBeNull();
    expect(onError).toHaveBeenCalled();
    const err = onError.mock.calls[0][0];
    expect(err.code).toBe('PUSH_PERMISSION_DENIED');
  });

  it('teardown is a no-op after a failed register', async () => {
    const agent = makeAgentStub();
    const r = await setupPush({
      agent,
      AdapterFactory: () => new FakeAdapter({ shouldFail: true }),
      onError: () => {},
    });
    await expect(r.teardown()).resolves.toBeUndefined();
  });
});

describe('setupPush — input validation', () => {
  it('throws when agent is missing', async () => {
    await expect(setupPush({})).rejects.toThrow(/agent/);
  });
});

describe('requestPushPermission', () => {
  it('returns granted when expo says so', async () => {
    const r = await requestPushPermission({
      NotificationsModule: {
        requestPermissionsAsync: async () => ({ granted: true, status: 'granted' }),
      },
    });
    expect(r.granted).toBe(true);
    expect(r.status).toBe('granted');
  });

  it('returns denied when expo says so', async () => {
    const r = await requestPushPermission({
      NotificationsModule: {
        requestPermissionsAsync: async () => ({ granted: false, status: 'denied' }),
      },
    });
    expect(r.granted).toBe(false);
    expect(r.status).toBe('denied');
  });

  it('falls back to default expo-notifications module when no module is injected', async () => {
    const r = await requestPushPermission();
    expect(r.granted).toBe(true);
    expect(r.status).toBe('granted');
  });
});

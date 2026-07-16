/**
 * basis — event router tests.  v0.2 sub-slice 2.5.
 */
import { describe, it, expect, vi } from 'vitest';

import { ThreadStore }    from '../src/threadStore.js';
import {
  EventRouter, createEventRouter, defaultFormatNotification,
  __resetEventIdSeq,
} from '../src/events.js';

function makeStore() {
  const s = new ThreadStore();
  s.createThread({ id: 'main',    name: 'Main',    filter: {} });
  s.createThread({ id: 'inbox',   name: 'Inbox',
                   filter: { eventTypes: ['notification', 'reminder'] } });
  s.createThread({ id: 'house',   name: 'House',
                   filter: { apps: ['household'], eventTypes: ['notification'] } });
  s.createThread({ id: 'silent',  name: 'Silent',
                   filter: { apps: ['__never__'] } });   // matches nothing
  return s;
}

describe('EventRouter — construction', () => {
  it('throws when threadStore missing', () => {
    expect(() => new EventRouter({})).toThrow(/threadStore required/);
    expect(() => new EventRouter()).toThrow(/threadStore required/);
  });

  it('createEventRouter is a thin convenience wrapper', () => {
    const r = createEventRouter({ threadStore: new ThreadStore() });
    expect(r).toBeInstanceOf(EventRouter);
  });
});

describe('EventRouter — deliver: filter match + notification append', () => {
  it('routes a household notification to wildcard main + inbox + house, NOT silent', () => {
    const store = makeStore();
    const router = new EventRouter({ threadStore: store });
    const event = {
      id: 'e-1', ts: 100,
      app: 'household', type: 'notification',
      actor: 'webid:karl',
      payload: { message: 'Karl completed dishwasher' },
    };
    const matched = router.deliver(event);
    expect(matched.sort()).toEqual(['house', 'inbox', 'main']);

    // Verify each matched thread got a shell message.
    for (const id of ['main', 'inbox', 'house']) {
      const last = store.getThread(id).tail(1)[0];
      expect(last.origin).toBe('shell');
      expect(last.rendered.kind).toBe('text');
      expect(last.rendered.text).toBe('Karl completed dishwasher');
    }
    expect(store.getThread('silent').messages.length).toBe(0);
  });

  it('routes a reminder to inbox but NOT to house (eventType narrows)', () => {
    const store = makeStore();
    const router = new EventRouter({ threadStore: store });
    const matched = router.deliver({
      id: 'e-2', ts: 1, app: 'household', type: 'reminder',
      payload: { message: 'Bin out tonight' },
    });
    expect(matched.sort()).toEqual(['inbox', 'main']);
    expect(store.getThread('house').messages.length).toBe(0);
  });

  it('routes events with no actor only to actor-wildcard threads', () => {
    const store = new ThreadStore();
    store.createThread({ id: 'any', name: 'Any',
                         filter: { actors: ['*'] } });
    store.createThread({ id: 'karl', name: 'Karl',
                         filter: { actors: ['webid:karl'] } });
    const router = new EventRouter({ threadStore: store });
    const matched = router.deliver({
      id: 'e', ts: 0, app: 'sys', type: 'system-tick',  // no actor
      payload: { message: 'tick' },
    });
    expect(matched).toEqual(['any']);
  });

  it('appended message has unique messageId per (event, thread)', () => {
    const store = makeStore();
    const router = new EventRouter({ threadStore: store });
    router.deliver({
      id: 'e-X', ts: 0, app: 'household', type: 'notification',
      payload: { message: 'hi' },
    });
    const mainMsg = store.getThread('main').tail(1)[0];
    const inboxMsg = store.getThread('inbox').tail(1)[0];
    expect(mainMsg.messageId).toBe('notif-e-X-main');
    expect(inboxMsg.messageId).toBe('notif-e-X-inbox');
    expect(mainMsg.messageId).not.toBe(inboxMsg.messageId);
  });

  it("returns [] when no thread matches (still emits subscribe event)", () => {
    const store = new ThreadStore();
    store.createThread({ id: 't1', name: 'T1', filter: { apps: ['x'] } });
    const router = new EventRouter({ threadStore: store });
    const events = [];
    router.onRouted((e, ids) => events.push({ id: e.id, ids }));
    const matched = router.deliver({
      id: 'e-no', ts: 0, app: 'y', type: 'notification',
      payload: { message: 'nope' },
    });
    expect(matched).toEqual([]);
    expect(events).toEqual([{ id: 'e-no', ids: [] }]);
  });
});

describe('EventRouter — defaultFormatNotification', () => {
  it("uses payload.message when present", () => {
    expect(defaultFormatNotification({
      app: 'h', type: 'n', payload: { message: 'hi' },
    })).toEqual({ message: 'hi' });
  });

  it("falls back to payload.text", () => {
    expect(defaultFormatNotification({
      app: 'h', type: 'n', payload: { text: 'yo' },
    })).toEqual({ message: 'yo' });
  });

  it("falls back to '[app/type] from actor' synthesis", () => {
    expect(defaultFormatNotification({
      app: 'household', type: 'item-changed', actor: 'webid:karl',
      payload: { ok: true },
    })).toEqual({ message: '[household/item-changed] from webid:karl' });
  });

  it("falls back to '[app/type]' when no actor", () => {
    expect(defaultFormatNotification({
      app: 'sys', type: 'tick',
    })).toEqual({ message: '[sys/tick]' });
  });
});

describe('EventRouter — formatNotification override', () => {
  it("custom formatter receives the enriched event", () => {
    const store = makeStore();
    const formatNotification = vi.fn((e) => ({
      message: `CUSTOM[${e.app}]: ${e.payload?.message ?? '?'}`,
    }));
    const router = new EventRouter({ threadStore: store, formatNotification });
    router.deliver({
      id: 'e-c', ts: 0, app: 'household', type: 'notification',
      payload: { message: 'X' },
    });
    expect(formatNotification).toHaveBeenCalled();
    const last = store.getThread('main').tail(1)[0];
    expect(last.rendered.text).toBe('CUSTOM[household]: X');
  });
});

describe('EventRouter — subscriptions', () => {
  it('onRouted gets (event, threadIds) tuples', () => {
    const store = makeStore();
    const router = new EventRouter({ threadStore: store });
    const calls = [];
    const off = router.onRouted((e, ids) => calls.push({ id: e.id, ids: ids.sort() }));
    router.deliver({
      id: 'e-1', ts: 0, app: 'household', type: 'notification',
      payload: { message: 'one' },
    });
    router.deliver({
      id: 'e-2', ts: 0, app: 'tasks', type: 'reminder',
      payload: { message: 'two' },
    });
    expect(calls).toEqual([
      { id: 'e-1', ids: ['house', 'inbox', 'main'] },
      { id: 'e-2', ids: ['inbox', 'main'] },
    ]);
    off();
    router.deliver({ id: 'e-3', ts: 0, app: 'x', type: 'y', payload: {} });
    expect(calls.length).toBe(2);   // unsubscribed
  });

  it('subscriber errors are swallowed (one bad listener does not break others)', () => {
    const store = makeStore();
    const router = new EventRouter({ threadStore: store });
    const good = [];
    router.onRouted(() => { throw new Error('boom'); });
    router.onRouted(() => good.push('ok'));
    expect(() => router.deliver({
      id: 'e', ts: 0, app: 'h', type: 'n', payload: { message: '_' },
    })).not.toThrow();
    expect(good).toEqual(['ok']);
  });

  it('throws on non-function subscriber', () => {
    const r = new EventRouter({ threadStore: new ThreadStore() });
    expect(() => r.onRouted('not a fn')).toThrow();
  });
});

describe('EventRouter — in-flight wake', () => {
  it('registerInFlight fires the callback when a matching event arrives', () => {
    const store = makeStore();
    const router = new EventRouter({ threadStore: store });
    const captured = [];
    router.registerInFlight('sess-123', (event) => captured.push(event));
    expect(router.hasInFlight('sess-123')).toBe(true);
    expect(router.inFlightSize).toBe(1);

    router.deliver({
      id: 'cb', ts: 0, app: 'auth', type: 'oidc-callback',
      correlationId: 'sess-123',
      payload: { webid: 'webid:anne' },
    });

    expect(captured.length).toBe(1);
    expect(captured[0].correlationId).toBe('sess-123');
    expect(captured[0].payload).toEqual({ webid: 'webid:anne' });

    // After fire, the registration is removed.
    expect(router.hasInFlight('sess-123')).toBe(false);
    expect(router.inFlightSize).toBe(0);
  });

  it('events with NO correlationId do not fire registered handlers', () => {
    const store = makeStore();
    const router = new EventRouter({ threadStore: store });
    const captured = [];
    router.registerInFlight('sess-X', (e) => captured.push(e));
    router.deliver({ id: 'e', ts: 0, app: 'h', type: 'n', payload: { message: 'x' } });
    expect(captured).toEqual([]);
    expect(router.hasInFlight('sess-X')).toBe(true);   // still pending
  });

  it("events with non-matching correlationId leave the registration intact", () => {
    const store = new ThreadStore();
    const router = new EventRouter({ threadStore: store });
    router.registerInFlight('sess-A', () => {});
    router.deliver({
      id: 'e', ts: 0, app: 'h', type: 'n',
      correlationId: 'sess-B', payload: { message: 'x' },
    });
    expect(router.hasInFlight('sess-A')).toBe(true);
    expect(router.hasInFlight('sess-B')).toBe(false);
  });

  it("returned cancel function removes the registration", () => {
    const router = new EventRouter({ threadStore: new ThreadStore() });
    const cancel = router.registerInFlight('s', () => {});
    expect(router.hasInFlight('s')).toBe(true);
    cancel();
    expect(router.hasInFlight('s')).toBe(false);
  });

  it("callback errors don't break the subscribe path", () => {
    const store = makeStore();
    const router = new EventRouter({ threadStore: store });
    const subs = [];
    router.onRouted((e, ids) => subs.push(ids));
    router.registerInFlight('s', () => { throw new Error('cb boom'); });
    // Event shaped to match house + inbox + main filters in makeStore().
    router.deliver({
      id: 'e', ts: 0, app: 'household', type: 'notification',
      correlationId: 's', payload: { message: 'x' },
    });
    // Despite the cb error, subscribers fired with the right thread list.
    expect(subs.length).toBe(1);
    expect(subs[0].sort()).toEqual(['house', 'inbox', 'main']);
  });

  it('validates inputs', () => {
    const r = new EventRouter({ threadStore: new ThreadStore() });
    expect(() => r.registerInFlight('', () => {})).toThrow();
    expect(() => r.registerInFlight('s', null)).toThrow();
  });
});

describe('EventRouter — normalisation', () => {
  it("fills missing id + ts when caller omits them", () => {
    __resetEventIdSeq();
    const store = makeStore();
    const router = new EventRouter({ threadStore: store, now: () => 999 });
    router.deliver({ app: 'household', type: 'notification', payload: { message: 'x' } });
    const last = store.getThread('main').tail(1)[0];
    // messageId should embed the auto-generated event id
    expect(last.messageId).toMatch(/^notif-e-/);
  });

  it("rejects null event", () => {
    const r = new EventRouter({ threadStore: new ThreadStore() });
    expect(() => r.deliver(null)).toThrow();
    expect(() => r.deliver('not-an-event')).toThrow();
  });
});

describe('EventRouter — excludeThreadIds (deduplication)', () => {
  it("skips threads listed in opts.excludeThreadIds even when filter matches", () => {
    const store = makeStore();
    const router = new EventRouter({ threadStore: store });
    const matched = router.deliver({
      app: 'household', type: 'notification',
      payload: { message: 'x' },
    }, { excludeThreadIds: ['house'] });
    expect(matched.sort()).toEqual(['inbox', 'main']);   // 'house' excluded
    expect(store.getThread('house').messages.length).toBe(0);
  });

  it("excluding a non-matching thread is a no-op", () => {
    const store = makeStore();
    const router = new EventRouter({ threadStore: store });
    const matched = router.deliver({
      app: 'household', type: 'notification',
      payload: { message: 'x' },
    }, { excludeThreadIds: ['silent'] });
    expect(matched.sort()).toEqual(['house', 'inbox', 'main']);
  });

  it("excluding ALL matching threads returns empty + still notifies subscribers", () => {
    const store = makeStore();
    const router = new EventRouter({ threadStore: store });
    const subs = [];
    router.onRouted((e, ids) => subs.push(ids));
    const matched = router.deliver({
      app: 'household', type: 'notification', payload: { message: 'x' },
    }, { excludeThreadIds: ['main', 'inbox', 'house'] });
    expect(matched).toEqual([]);
    expect(subs).toEqual([[]]);
  });
});

describe('EventRouter — integration with A2 hybrid lifecycle', () => {
  it("notification arrival does NOT trigger A2 flip (only user messages do)", () => {
    const store = new ThreadStore();
    store.createThread({ id: 'main', name: 'Main', filter: {} });
    const thread = store.getThread('main');
    thread.addShellMessage({
      kind: 'list', messageId: 'm-1', lifecycleState: 'live', items: [],
    }, { opId: 'listMine' });
    const router = new EventRouter({ threadStore: store });
    router.deliver({
      id: 'e', ts: 0, app: 'h', type: 'notification',
      payload: { message: 'something happened' },
    });
    // The live list message is still 'live' — only an addUserMessage
    // would flip it (A2 hybrid behaviour from v0.1.2 thread.js).
    expect(thread.messages.find((m) => m.messageId === 'm-1').lifecycleState)
      .toBe('live');
  });
});

describe('EventRouter — E3 onPanelStale auto-refresh seam', () => {
  function storeWithPanel() {
    const s = new ThreadStore();
    s.createThread({ id: 'main', name: 'Main', filter: {} });
    s.getThread('main').addShellMessage(
      { kind: 'record', messageId: 'p-1', lifecycleState: 'live',
        payload: { id: 'task-9', type: 'task', title: 'old' } },
      { opId: 'getTask', appOrigin: 'tasks', args: { id: 'task-9' } },
    );
    return s;
  }
  const changed = (id) => ({
    app: 'tasks', type: 'item-changed', actor: 'webid:me',
    itemRef: { app: 'tasks', type: 'task', id },
  });

  it('fires onPanelStale(thread, panel, itemRef) for a matching panel + marks it stale', () => {
    const store = storeWithPanel();
    const onPanelStale = vi.fn();
    new EventRouter({ threadStore: store, onPanelStale }).deliver(changed('task-9'));
    expect(onPanelStale).toHaveBeenCalledTimes(1);
    const [thread, panel, itemRef] = onPanelStale.mock.calls[0];
    expect(thread.id).toBe('main');
    expect(panel.messageId).toBe('p-1');
    expect(panel.sourceOp).toEqual({ opId: 'getTask', appOrigin: 'tasks', args: { id: 'task-9' } });
    expect(itemRef.id).toBe('task-9');
    expect(store.getThread('main').messages.find((m) => m.messageId === 'p-1').rendered.stale).toBe(true);
  });

  it('does not fire for a non-matching itemRef', () => {
    const store = storeWithPanel();
    const onPanelStale = vi.fn();
    new EventRouter({ threadStore: store, onPanelStale }).deliver(changed('OTHER'));
    expect(onPanelStale).not.toHaveBeenCalled();
  });

  it('a throwing onPanelStale does not break delivery to matching threads', () => {
    const store = storeWithPanel();
    store.createThread({ id: 'inbox', name: 'Inbox', filter: { eventTypes: ['item-changed'] } });
    const router = new EventRouter({ threadStore: store, onPanelStale: () => { throw new Error('boom'); } });
    expect(() => router.deliver(changed('task-9'))).not.toThrow();
    expect(store.getThread('inbox').messages.length).toBe(1);   // notification still delivered
  });

  it('omitting onPanelStale keeps legacy behaviour (only the stale badge)', () => {
    const store = storeWithPanel();
    new EventRouter({ threadStore: store }).deliver(changed('task-9'));
    expect(store.getThread('main').messages.find((m) => m.messageId === 'p-1').rendered.stale).toBe(true);
  });
});

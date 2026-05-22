/**
 * canopy-chat — reactive panel-stale refresh tests.  v0.6 sub-slice 6.3.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { Thread }       from '../src/thread.js';
import { EventRouter }  from '../src/events.js';
import { ThreadStore }  from '../src/threadStore.js';

let store, thread, router;
beforeEach(() => {
  store  = new ThreadStore();
  store.createThread({ id: 'main', name: 'Main', filter: {} });
  thread = store.getThread('main');
  router = new EventRouter({ threadStore: store });
});

describe('Thread.openPanelsForItemRef', () => {
  it("matches record panels by payload.id + payload.type", () => {
    thread.addShellMessage({
      kind: 'record', messageId: 'm-1', lifecycleState: 'live',
      payload: { id: 'c-1', type: 'chore', name: 'Dishwasher' },
    });
    expect(thread.openPanelsForItemRef({
      app: 'household', type: 'chore', id: 'c-1',
    })).toEqual([{
      messageId: 'm-1',
      rendered:  expect.objectContaining({ kind: 'record' }),
    }]);
  });

  it("matches mini-page panels", () => {
    thread.addShellMessage({
      kind: 'mini-page', messageId: 'm-mp', lifecycleState: 'live',
      payload: { id: 't-1', type: 'task' },
    });
    const panels = thread.openPanelsForItemRef({
      app: 'tasks', type: 'task', id: 't-1',
    });
    expect(panels.length).toBe(1);
    expect(panels[0].messageId).toBe('m-mp');
  });

  it("matches embed-card panels by embed.itemRef", () => {
    thread.addShellMessage({
      kind: 'embed-card', messageId: 'm-e', lifecycleState: 'live',
      embed: {
        kind: 'item-card',
        appOrigin: 'household',
        itemRef: { app: 'household', type: 'chore', id: 'c-2' },
        snapshot: { id: 'c-2', type: 'chore' },
      },
    });
    const panels = thread.openPanelsForItemRef({
      app: 'household', type: 'chore', id: 'c-2',
    });
    expect(panels.length).toBe(1);
  });

  it("does NOT match disabled / closed panels", () => {
    thread.addShellMessage({
      kind: 'record', messageId: 'm-d', lifecycleState: 'live',
      payload: { id: 'c-1', type: 'chore' },
    });
    thread.closeMessage('m-d');
    expect(thread.openPanelsForItemRef({
      app: 'household', type: 'chore', id: 'c-1',
    })).toEqual([]);
  });

  it("does NOT match items with different id / type", () => {
    thread.addShellMessage({
      kind: 'record', messageId: 'm-x', lifecycleState: 'live',
      payload: { id: 'c-1', type: 'chore' },
    });
    expect(thread.openPanelsForItemRef({ app: 'h', type: 'chore', id: 'c-2' })).toEqual([]);
    expect(thread.openPanelsForItemRef({ app: 'h', type: 'task',  id: 'c-1' })).toEqual([]);
  });

  it("returns [] for invalid itemRef", () => {
    expect(thread.openPanelsForItemRef(null)).toEqual([]);
    expect(thread.openPanelsForItemRef(undefined)).toEqual([]);
    expect(thread.openPanelsForItemRef('not-an-object')).toEqual([]);
  });

  it("does NOT match text or list messages", () => {
    thread.addShellMessage({
      kind: 'text', messageId: 'm-t', lifecycleState: 'live',
      text: 'just text',
    });
    thread.addShellMessage({
      kind: 'list', messageId: 'm-l', lifecycleState: 'live',
      items: [{ id: 'c-1', label: 'X', buttons: [] }],
    });
    expect(thread.openPanelsForItemRef({ app: 'h', type: 'chore', id: 'c-1' }))
      .toEqual([]);
  });
});

describe('Thread.markPanelStale', () => {
  it("sets rendered.stale = true", () => {
    thread.addShellMessage({
      kind: 'record', messageId: 'm-1', lifecycleState: 'live',
      payload: { id: 'c-1', type: 'chore' },
    });
    thread.markPanelStale('m-1');
    const msg = thread.messages.find((m) => m.messageId === 'm-1');
    expect(msg.rendered.stale).toBe(true);
  });

  it("is idempotent + silent on unknown messageId", () => {
    expect(() => thread.markPanelStale('nope')).not.toThrow();
  });
});

describe('EventRouter.deliver — reactive panel-staleness scan', () => {
  it("marks matching open panels stale when event has itemRef", () => {
    thread.addShellMessage({
      kind: 'record', messageId: 'm-1', lifecycleState: 'live',
      payload: { id: 'c-1', type: 'chore', name: 'Dishwasher' },
    });
    router.deliver({
      app: 'household', type: 'item-changed',
      itemRef: { app: 'household', type: 'chore', id: 'c-1' },
    });
    const msg = thread.messages.find((m) => m.messageId === 'm-1');
    expect(msg.rendered.stale).toBe(true);
  });

  it("does NOT mark non-matching panels stale", () => {
    thread.addShellMessage({
      kind: 'record', messageId: 'm-x', lifecycleState: 'live',
      payload: { id: 'c-1', type: 'chore' },
    });
    router.deliver({
      app: 'household', type: 'item-changed',
      itemRef: { app: 'household', type: 'chore', id: 'c-2' },
    });
    const msg = thread.messages.find((m) => m.messageId === 'm-x');
    expect(msg.rendered.stale).toBeUndefined();
  });

  it("respects excludeThreadIds for staleness scan", () => {
    thread.addShellMessage({
      kind: 'record', messageId: 'm-1', lifecycleState: 'live',
      payload: { id: 'c-1', type: 'chore' },
    });
    router.deliver({
      app: 'household', type: 'item-changed',
      itemRef: { app: 'household', type: 'chore', id: 'c-1' },
    }, { excludeThreadIds: ['main'] });
    const msg = thread.messages.find((m) => m.messageId === 'm-1');
    expect(msg.rendered.stale).toBeUndefined();
  });

  it("events without itemRef do NOT trigger the scan", () => {
    thread.addShellMessage({
      kind: 'record', messageId: 'm-1', lifecycleState: 'live',
      payload: { id: 'c-1', type: 'chore' },
    });
    router.deliver({
      app: 'household', type: 'notification',
      payload: { message: 'hi' },
    });
    const msg = thread.messages.find((m) => m.messageId === 'm-1');
    expect(msg.rendered.stale).toBeUndefined();
  });
});

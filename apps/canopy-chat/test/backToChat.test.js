/**
 * canopy-chat — E4 "← back to chat" (chat-nav) consumer tests.
 *
 * Both the logs side-panel and the generic page panel render a floating
 * chat-nav button when a `backTo` descriptor is supplied.  The button
 * closes the panel AND refocuses the originating thread (its value over
 * the bare [×], which only closes).  When `backTo` is omitted, no button
 * renders.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';

import { renderLogsPanel } from '../src/web/logsPanel.js';
import { openPagePanel }   from '../src/web/pagePanel.js';

const NAV_BTN = '.canopy-chat-nav-back-button';

/** Minimal EventLog stub the logs panel needs. */
function fakeEventLog() {
  return {
    size: 0,
    query: () => [],
    isMuted: () => false,
    mute: () => {},
    unmute: () => {},
  };
}

describe('logsPanel — back-to-chat (E4)', () => {
  it('renders the chat-nav button when backTo is supplied', () => {
    const container = document.createElement('aside');
    renderLogsPanel(container, {
      doc: document,
      eventLog: fakeEventLog(),
      onClose: vi.fn(),
      backTo: { returnTo: 'thread-7', label: '← back', onNavigate: vi.fn() },
    });
    const btn = container.querySelector(NAV_BTN);
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('← back');
  });

  it('omits the button when backTo is missing or has no returnTo', () => {
    const c1 = document.createElement('aside');
    renderLogsPanel(c1, { doc: document, eventLog: fakeEventLog(), onClose: vi.fn() });
    expect(c1.querySelector(NAV_BTN)).toBeNull();

    const c2 = document.createElement('aside');
    renderLogsPanel(c2, {
      doc: document, eventLog: fakeEventLog(), onClose: vi.fn(),
      backTo: { returnTo: '' },
    });
    expect(c2.querySelector(NAV_BTN)).toBeNull();
  });

  it('clicking the button closes the panel then refocuses the origin', () => {
    const calls = [];
    const container = document.createElement('aside');
    renderLogsPanel(container, {
      doc: document,
      eventLog: fakeEventLog(),
      onClose:    () => calls.push('close'),
      backTo: {
        returnTo:   'thread-7',
        label:      '← back',
        onNavigate: () => calls.push('navigate'),
      },
    });
    container.querySelector(NAV_BTN).click();
    // close fires before refocus so the panel is already gone when we land.
    expect(calls).toEqual(['close', 'navigate']);
  });
});

describe('pagePanel — back-to-chat (E4)', () => {
  const op = {
    id: 'demoOp',
    params: [],
    surfaces: { page: { kind: 'form', title: 'Demo' } },
  };

  it('renders the chat-nav button when backTo is supplied', () => {
    const container = document.createElement('aside');
    openPagePanel({
      container, doc: document, op, appOrigin: 'demo',
      callSkill: vi.fn(), onClose: vi.fn(),
      backTo: { returnTo: 'thread-3', label: '← back', onNavigate: vi.fn() },
    });
    expect(container.querySelector(NAV_BTN)).not.toBeNull();
  });

  it('omits the button when backTo is missing', () => {
    const container = document.createElement('aside');
    openPagePanel({
      container, doc: document, op, appOrigin: 'demo',
      callSkill: vi.fn(), onClose: vi.fn(),
    });
    expect(container.querySelector(NAV_BTN)).toBeNull();
  });

  it('clicking the button tears down the panel and refocuses the origin', () => {
    const onNavigate = vi.fn();
    const container = document.createElement('aside');
    openPagePanel({
      container, doc: document, op, appOrigin: 'demo',
      callSkill: vi.fn(), onClose: vi.fn(),
      backTo: { returnTo: 'thread-3', label: '← back', onNavigate },
    });
    container.querySelector(NAV_BTN).click();
    // teardown clears the container + hides it; refocus hook fired.
    expect(container.hidden).toBe(true);
    expect(container.innerHTML).toBe('');
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});

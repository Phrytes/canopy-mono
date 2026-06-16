/**
 * S6.A — manifest-driven inline buttons render on a bot reply in the v2 kring
 * chat (the resurrected "inline menu") + a tap fires onEmbedButton with the
 * op + item. @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleKring } from '../web/v2/circleKring.js';

const t = (k) => k;

// A bot chat-row carrying inline manifest buttons on its event payload (the
// shape kringChatMessageEvent produces: payload.buttons).
const botRowWithButtons = (buttons) => ({
  id: 'kring-c1-bot-1', ts: Date.now(), type: 'chat-message', actor: 'bot',
  circleId: 'c1',
  event: { id: 'kring-c1-bot-1', ts: Date.now(), type: 'chat-message', actor: 'bot', payload: { circleId: 'c1', text: '✓ Added: boodschappen', kind: 'chat-message', buttons } },
});

describe('renderCircleKring — S6.A inline embed buttons', () => {
  it('renders payload.buttons on a bot row + a tap dispatches {opId,itemId}', () => {
    const onEmbedButton = vi.fn();
    const el = renderCircleKring(document.createElement('div'), {
      circle: { id: 'c1', name: 'Buren' }, t,
      activeTab: 'gesprek',
      rows: [botRowWithButtons([
        { id: 'claimTask:t1', label: 'Claim · boodschappen', opId: 'claimTask', itemId: 't1' },
      ])],
      onEmbedButton,
    });
    const btn = el.querySelector('.circle-kring__embed-button');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toMatch(/Claim/);
    expect(btn.dataset.opId).toBe('claimTask');
    expect(btn.dataset.itemId).toBe('t1');
    btn.click();
    expect(onEmbedButton).toHaveBeenCalledWith({ opId: 'claimTask', itemId: 't1' });
  });

  it('S6.B — renders a screen button (opens a panel) + a tap fires onEmbedButton with {screen}', () => {
    const onEmbedButton = vi.fn();
    const el = renderCircleKring(document.createElement('div'), {
      circle: { id: 'c1' }, t, activeTab: 'gesprek',
      rows: [botRowWithButtons([{ id: 'screen:tasks', label: 'All tasks →', screen: 'tasks' }])],
      onEmbedButton,
    });
    const btn = el.querySelector('.circle-kring__screen-button');
    expect(btn).toBeTruthy();
    expect(btn.dataset.screen).toBe('tasks');
    expect(btn.dataset.opId).toBeUndefined();
    btn.click();
    expect(onEmbedButton).toHaveBeenCalledWith({ opId: undefined, itemId: undefined, screen: 'tasks' });
  });

  it('scope badge — a kring-scoped bot reply shows "whole kring"; default/self shows "only you"', () => {
    const kringRow = { id: 'k1', ts: Date.now(), type: 'chat-message', actor: 'bot', circleId: 'c1',
      event: { type: 'chat-message', actor: 'bot', payload: { circleId: 'c1', text: '✓ Posted', kind: 'chat-message', scope: 'kring' } } };
    const selfRow = { id: 'k2', ts: Date.now(), type: 'chat-message', actor: 'bot', circleId: 'c1',
      event: { type: 'chat-message', actor: 'bot', payload: { circleId: 'c1', text: 'private answer', kind: 'chat-message' } } };
    const el = renderCircleKring(document.createElement('div'), {
      circle: { id: 'c1' }, t, activeTab: 'gesprek', rows: [kringRow, selfRow],
    });
    const badges = [...el.querySelectorAll('.circle-kring__scope')];
    expect(badges).toHaveLength(2);
    expect(el.querySelector('.circle-kring__scope--kring').textContent).toContain('circle.scope.kring');
    expect(el.querySelector('.circle-kring__scope--self').textContent).toContain('circle.scope.self');
  });

  it('renders no embed buttons when the row carries none', () => {
    const el = renderCircleKring(document.createElement('div'), {
      circle: { id: 'c1' }, t, activeTab: 'gesprek',
      rows: [botRowWithButtons(undefined)],
      onEmbedButton: () => {},
    });
    expect(el.querySelector('.circle-kring__embed-button')).toBeNull();
  });

  it('skips embed buttons when no onEmbedButton handler is wired', () => {
    const el = renderCircleKring(document.createElement('div'), {
      circle: { id: 'c1' }, t, activeTab: 'gesprek',
      rows: [botRowWithButtons([{ id: 'x:1', label: 'X', opId: 'x', itemId: '1' }])],
    });
    expect(el.querySelector('.circle-kring__embed-button')).toBeNull();
  });
});

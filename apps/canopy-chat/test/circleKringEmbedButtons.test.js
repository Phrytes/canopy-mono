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
    expect(onEmbedButton).toHaveBeenCalledWith(expect.objectContaining({ opId: 'claimTask', itemId: 't1' }));  // whole button passed (47c630c1)
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
    expect(onEmbedButton).toHaveBeenCalledWith(expect.objectContaining({ screen: 'tasks' }));
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

describe('renderCircleKring — embeds[] "See also" chips on a bot row', () => {
  const botRowWithEmbeds = (embeds) => ({
    id: 'kring-c1-bot-2', ts: Date.now(), type: 'chat-message', actor: 'bot', circleId: 'c1',
    event: { id: 'kring-c1-bot-2', ts: Date.now(), type: 'chat-message', actor: 'bot',
      payload: { circleId: 'c1', text: '✓ Added: Fix the gate', kind: 'chat-message', embeds } },
  });

  it('renders a chip per embed the message carries (icon + type + title)', () => {
    const el = renderCircleKring(document.createElement('div'), {
      circle: { id: 'c1' }, t, activeTab: 'gesprek',
      rows: [botRowWithEmbeds([{ type: 'task', ref: 't2', title: 'Fix the gate' }])],
    });
    const chips = el.querySelectorAll('.circle-kring__embed');
    expect(chips).toHaveLength(1);
    expect(chips[0].dataset.ref).toBe('t2');
    expect(chips[0].textContent).toBe('✅ task: Fix the gate');   // identity t() → raw type fallback
  });

  it('renders no embeds block when the message carries none', () => {
    const el = renderCircleKring(document.createElement('div'), {
      circle: { id: 'c1' }, t, activeTab: 'gesprek', rows: [botRowWithEmbeds(undefined)],
    });
    expect(el.querySelector('.circle-kring__embeds')).toBeNull();
  });

  it('a task chip is TAPPABLE (a button) + a tap opens the tasks screen', () => {
    const onEmbedOpen = vi.fn();
    const el = renderCircleKring(document.createElement('div'), {
      circle: { id: 'c1' }, t, activeTab: 'gesprek',
      rows: [botRowWithEmbeds([{ type: 'task', ref: 't2', title: 'Fix the gate' }])],
      onEmbedOpen,
    });
    const chip = el.querySelector('.circle-kring__embed--tappable');
    expect(chip).toBeTruthy();
    expect(chip.tagName).toBe('BUTTON');
    chip.click();
    expect(onEmbedOpen).toHaveBeenCalledWith({ type: 'task', ref: 't2', screen: 'tasks' });
  });

  it('a chip with no screen (note) stays a non-tappable span even with onEmbedOpen', () => {
    const el = renderCircleKring(document.createElement('div'), {
      circle: { id: 'c1' }, t, activeTab: 'gesprek',
      rows: [botRowWithEmbeds([{ type: 'note', ref: 'n1', title: 'A note' }])],
      onEmbedOpen: vi.fn(),
    });
    expect(el.querySelector('.circle-kring__embed--tappable')).toBeNull();
    expect(el.querySelector('.circle-kring__embed').tagName).toBe('SPAN');
  });
});

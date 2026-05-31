// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderCircleKring } from '../../web/v2/circleKring.js';

const t = (key, params) =>
  params && params.count != null ? `${key}:${params.count}` : key;

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

const circle = { id: 'g1', name: 'Selwerd', memberCount: 87 };

const yest = Date.now() - 24 * 60 * 60 * 1000;
const now  = Date.now();

const rows = [
  // newest-first (matches buildKringStream output)
  {
    id: 'r3', ts: now,        app: 'household', type: 'chat-message',
    actor: 'Pieter', circleId: 'g1',
    event: { id: 'r3', type: 'chat-message', payload: { text: 'Bedankt!', senderDisplay: 'Pieter' } },
  },
  {
    id: 'r2', ts: now - 60_000, app: 'stoop', type: 'buurt-post',
    actor: 'Pieter', circleId: 'g1',
    event: { id: 'r2', type: 'buurt-post', payload: { kind: 'aanbod', text: 'Boekje te geef.', authorName: 'Pieter' } },
  },
  {
    id: 'r1', ts: yest, app: 'stoop', type: 'buurt-post',
    actor: 'Anne', circleId: 'g1',
    event: { id: 'r1', type: 'buurt-post', payload: { kind: 'vraag', text: 'Heeft iemand een ladder t/m vrijdag?', authorName: 'Anne' } },
  },
];

describe('renderCircleKring · SP-13.2 chat-style kring view', () => {
  it('renders header (back + title + members meta)', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t });
    expect(el.querySelector('.circle-kring__back').textContent).toBe('circle.back');
    expect(el.querySelector('.circle-kring__title').textContent).toBe('Selwerd');
    expect(el.querySelector('.circle-kring__meta').textContent).toBe('circle.members:87');
  });

  it('renders message bubbles chronologically (oldest at top)', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t });
    const bubbles = el.querySelectorAll('.circle-kring__bubble');
    expect([...bubbles].map((b) => b.dataset.rowId)).toEqual(['r1', 'r2', 'r3']);
  });

  it('groups bubbles under dated day-dividers', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t });
    const days = el.querySelectorAll('.circle-kring__day');
    expect(days.length).toBe(2);
    // First divider = yesterday's date (precedes r1).
    expect(days[0].textContent).toBe('circle.kring.day_yesterday');
    // Second divider = today's date (precedes r2 + r3).
    expect(days[1].textContent).toBe('circle.kring.day_today');
  });

  it('shows a KIND pill on bubbles whose payload carries a kind ≠ message', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t });
    const bubbles = el.querySelectorAll('.circle-kring__bubble');
    // r1 vraag, r2 aanbod, r3 chat-message (no pill).
    expect(bubbles[0].querySelector('.circle-kring__bubble-kind').textContent).toBe('VRAAG');
    expect(bubbles[1].querySelector('.circle-kring__bubble-kind').textContent).toBe('AANBOD');
    expect(bubbles[2].querySelector('.circle-kring__bubble-kind')).toBeNull();
  });

  it('renders sender label + body text + substrate action chips', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t });
    const bubbles = el.querySelectorAll('.circle-kring__bubble');
    // r1 = vraag → [help, ignore] via streamActions.
    expect(bubbles[0].querySelector('.circle-kring__bubble-sender').textContent).toBe('Anne');
    expect(bubbles[0].querySelector('.circle-kring__bubble-text').textContent)
      .toBe('Heeft iemand een ladder t/m vrijdag?');
    const acts = bubbles[0].querySelectorAll('.circle-kring__bubble-action');
    expect([...acts].map((b) => b.dataset.action)).toEqual(['help', 'ignore']);
  });

  it('renders the inline composer when onSend is wired', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t });
    expect(el.querySelector('.circle-kring__composer')).toBeNull();

    const el2 = mount();
    const onSend = vi.fn();
    renderCircleKring(el2, { circle, rows, t, onSend });
    const form  = el2.querySelector('.circle-kring__composer');
    const input = el2.querySelector('.circle-kring__composer-input');
    expect(form).not.toBeNull();
    expect(input.placeholder).toBe('circle.kring.composer_placeholder');
  });

  it('composer submit fires onSend(text) and clears the input', () => {
    const el = mount();
    const onSend = vi.fn();
    renderCircleKring(el, { circle, rows, t, onSend });
    const input = el.querySelector('.circle-kring__composer-input');
    const form  = el.querySelector('.circle-kring__composer');
    input.value = '  Hoi buurt!  ';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toBe('Hoi buurt!');
    expect(input.value).toBe('');
  });

  it('composer ignores empty / whitespace-only submits', () => {
    const el = mount();
    const onSend = vi.fn();
    renderCircleKring(el, { circle, rows, t, onSend });
    const input = el.querySelector('.circle-kring__composer-input');
    const form  = el.querySelector('.circle-kring__composer');
    input.value = '   ';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('composer honors a kring-specific placeholder when the host passes one', () => {
    const el = mount();
    renderCircleKring(el, {
      circle, rows, t, onSend: () => {},
      composerPlaceholder: 'Schrijf naar de buurt…',
    });
    expect(el.querySelector('.circle-kring__composer-input').placeholder)
      .toBe('Schrijf naar de buurt…');
  });

  it('empty state shows when rows = []', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows: [], t });
    expect(el.querySelector('.circle-kring__empty').textContent).toBe('circle.kring.empty');
    expect(el.querySelectorAll('.circle-kring__bubble')).toHaveLength(0);
  });

  it('overflow menu hides until a `more` action is provided + toggles on click', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t });
    expect(el.querySelector('.circle-kring__more')).toBeNull();

    const el2 = mount();
    const onSettings = vi.fn();
    renderCircleKring(el2, { circle, rows, t, more: { settings: onSettings } });
    const trigger = el2.querySelector('.circle-kring__more');
    expect(trigger).not.toBeNull();
    const menu = el2.querySelector('.circle-kring__more-menu');
    expect(menu.classList.contains('is-open')).toBe(false);
    trigger.click();
    expect(menu.classList.contains('is-open')).toBe(true);
    menu.querySelector('[data-action=settings]').click();
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(menu.classList.contains('is-open')).toBe(false);
  });

  it('fires onAction with action + row on a bubble action button click', () => {
    const el = mount();
    const onAction = vi.fn();
    renderCircleKring(el, { circle, rows, t, onAction });
    el.querySelector('.circle-kring__bubble .circle-kring__bubble-action[data-action=help]').click();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0].action).toBe('help');
    expect(onAction.mock.calls[0][1].id).toBe('r1');
  });
});

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

const rows = [
  {
    id: 'r1', ts: 300, app: 'stoop', type: 'buurt-post',
    actor: 'Anne', circleId: 'g1', circleName: 'Selwerd',
    event: { id: 'r1', type: 'buurt-post', payload: { kind: 'vraag', text: 'Heeft iemand een ladder?' } },
  },
  {
    id: 'r2', ts: 200, app: 'stoop', type: 'buurt-post',
    actor: 'Pieter', circleId: 'g1', circleName: 'Selwerd',
    event: { id: 'r2', type: 'buurt-post', payload: { kind: 'aanbod', text: 'Boekje te geef.' } },
  },
];

describe('renderCircleKring', () => {
  it('renders header (back + title + members meta)', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, filter: 'all', t });
    expect(el.querySelector('.circle-kring__back').textContent).toBe('circle.back');
    expect(el.querySelector('.circle-kring__title').textContent).toBe('Selwerd');
    expect(el.querySelector('.circle-kring__meta').textContent).toBe('circle.members:87');
  });

  it('renders the 4-chip filter row with the active one marked', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, filter: 'vraag', t });
    const chips = el.querySelectorAll('.circle-kring__chip');
    expect([...chips].map((c) => c.dataset.filter))
      .toEqual(['all', 'vraag', 'aanbod', 'leen']);
    const active = el.querySelector('.circle-kring__chip.is-active');
    expect(active.dataset.filter).toBe('vraag');
  });

  it('fires onFilter when a chip is clicked', () => {
    const el = mount();
    const onFilter = vi.fn();
    renderCircleKring(el, { circle, rows, filter: 'all', t, onFilter });
    el.querySelector('.circle-kring__chip[data-filter=aanbod]').click();
    expect(onFilter).toHaveBeenCalledWith('aanbod');
  });

  it('renders one row per item with kind tag + text + action buttons', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, filter: 'all', t });
    const renderedRows = el.querySelectorAll('.circle-kring__row');
    expect(renderedRows).toHaveLength(2);
    expect(renderedRows[0].querySelector('.circle-kring__row-kind').textContent).toBe('VRAAG');
    expect(renderedRows[0].querySelector('.circle-kring__row-text').textContent)
      .toBe('Heeft iemand een ladder?');
    // vraag → [help, ignore] via streamActions substrate
    const actions = renderedRows[0].querySelectorAll('.circle-kring__row-action');
    expect([...actions].map((b) => b.dataset.action)).toEqual(['help', 'ignore']);
  });

  it('shows the kind-specific empty state when filter is active and rows are []', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows: [], filter: 'vraag', t });
    expect(el.querySelector('.circle-kring__empty').textContent)
      .toBe('circle.kring.empty_filtered');
  });

  it('shows the unfiltered empty state when filter is all', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows: [], filter: 'all', t });
    expect(el.querySelector('.circle-kring__empty').textContent).toBe('circle.kring.empty');
  });

  it('renders the + plaats FAB only when onPost is wired', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, filter: 'all', t });
    expect(el.querySelector('.circle-kring__fab')).toBeNull();

    const el2 = mount();
    const onPost = vi.fn();
    renderCircleKring(el2, { circle, rows, filter: 'all', t, onPost });
    const fab = el2.querySelector('.circle-kring__fab');
    expect(fab.textContent).toBe('circle.kring.post_fab');
    fab.click();
    expect(onPost).toHaveBeenCalledTimes(1);
  });

  it('overflow menu hides until a `more` action is provided + toggles on click', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, filter: 'all', t });
    expect(el.querySelector('.circle-kring__more')).toBeNull();

    const el2 = mount();
    const onSettings = vi.fn();
    const onSkills = vi.fn();
    renderCircleKring(el2, {
      circle, rows, filter: 'all', t,
      more: { settings: onSettings, skills: onSkills },
    });
    const trigger = el2.querySelector('.circle-kring__more');
    expect(trigger).not.toBeNull();
    const menu = el2.querySelector('.circle-kring__more-menu');
    expect(menu.classList.contains('is-open')).toBe(false);
    trigger.click();
    expect(menu.classList.contains('is-open')).toBe(true);
    // First menu item runs its handler + closes the menu.
    menu.querySelector('[data-action=settings]').click();
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(menu.classList.contains('is-open')).toBe(false);
  });

  it('overflow menu omits items whose handler is missing (host gating)', () => {
    const el = mount();
    renderCircleKring(el, {
      circle, rows, filter: 'all', t,
      more: { settings: () => {} },     // viewAs, files, rules etc. all absent
    });
    const items = el.querySelectorAll('.circle-kring__more-item');
    expect([...items].map((i) => i.dataset.action)).toEqual(['settings']);
  });

  it('fires onAction with action + row on a row action button click', () => {
    const el = mount();
    const onAction = vi.fn();
    renderCircleKring(el, { circle, rows, filter: 'all', t, onAction });
    el.querySelector('.circle-kring__row .circle-kring__row-action[data-action=help]').click();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0].action).toBe('help');
    expect(onAction.mock.calls[0][1].id).toBe('r1');
  });
});

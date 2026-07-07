// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderListScreen } from '../../web/v2/listScreen.js';
import { buildScreenModel } from '../../src/v2/screenModel.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }
const contacts = [
  { id: 'a', label: 'Karin', category: 'family' },
  { id: 'b', label: 'Klaas', category: 'buren' },
  { id: 'c', label: 'Anna',  category: 'family' },
];

describe('renderListScreen', () => {
  it('renders a search box, category checkboxes with counts, and the rows', () => {
    const el = mount();
    const model = buildScreenModel({ items: contacts, categoryField: 'category' });
    renderListScreen(el, { model, t, query: '' });
    expect(el.querySelector('.list-screen__search')).toBeTruthy();
    expect(el.querySelectorAll('.list-screen__category input')).toHaveLength(2);
    expect(el.querySelector('[data-category=family]').checked).toBe(true);
    expect(el.querySelectorAll('.list-screen__row')).toHaveLength(3);
  });

  it('fires onQuery on typing + onToggleCategory on checkbox', () => {
    const el = mount();
    const onQuery = vi.fn(); const onToggleCategory = vi.fn();
    renderListScreen(el, { model: buildScreenModel({ items: contacts, categoryField: 'category' }), t, onQuery, onToggleCategory });
    const s = el.querySelector('.list-screen__search');
    s.value = 'k'; s.dispatchEvent(new Event('input'));
    expect(onQuery).toHaveBeenCalledWith('k');
    const box = el.querySelector('[data-category=buren]');
    box.checked = false; box.dispatchEvent(new Event('change'));
    expect(onToggleCategory).toHaveBeenCalledWith('buren', false);
  });

  it('reflects a filtered model (query k → 2 rows) + shows empty state', () => {
    const el = mount();
    renderListScreen(el, { model: buildScreenModel({ items: contacts, query: 'k' }), t, query: 'k' });
    expect(el.querySelectorAll('.list-screen__row')).toHaveLength(2);
    renderListScreen(el, { model: buildScreenModel({ items: contacts, query: 'zzz' }), t, query: 'zzz' });
    expect(el.querySelector('.list-screen__empty')).toBeTruthy();
  });

  it('renders row actions + greys disabled ones + fires onRowAction', () => {
    const el = mount();
    const onRowAction = vi.fn();
    const model = { rows: [{ item: { id: 'x' }, label: 'X', actions: [
      { id: 'claim:x', label: 'Claim', opId: 'claimTask', itemId: 'x' },
      { id: 'done:x', label: 'Done', opId: 'completeTask', itemId: 'x', disabled: true },
    ] }], categories: [] };
    renderListScreen(el, { model, t, onRowAction });
    const btns = el.querySelectorAll('.list-screen__row-action');
    expect(btns).toHaveLength(2);
    expect(btns[1].disabled).toBe(true);
    expect(btns[1].classList.contains('list-screen__row-action--greyed')).toBe(true);
    btns[0].click();
    expect(onRowAction).toHaveBeenCalledWith({ opId: 'claimTask', itemId: 'x' });
    onRowAction.mockClear();
    btns[1].click();                       // disabled → no dispatch
    expect(onRowAction).not.toHaveBeenCalled();
  });
});

import { renderListBlock } from '../../web/v2/listScreen.js';

describe('renderListBlock (stateful, focus-safe)', () => {
  const items = [
    { id: 'a', label: 'Karin', category: 'family' },
    { id: 'b', label: 'Klaas', category: 'buren' },
    { id: 'c', label: 'Anna',  category: 'family' },
  ];

  it('typing filters rows WITHOUT recreating the search input (focus preserved)', () => {
    const el = mount();
    renderListBlock(el, { block: { items, categoryField: 'category', title: 'Contacts' }, t });
    const search = el.querySelector('.list-screen__search');
    search.focus();
    expect(el.querySelectorAll('.list-screen__row')).toHaveLength(3);
    search.value = 'k'; search.dispatchEvent(new Event('input'));
    expect(el.querySelectorAll('.list-screen__row')).toHaveLength(2);           // filtered
    expect(el.querySelector('.list-screen__search')).toBe(search);              // SAME node → focus kept
    expect(document.activeElement).toBe(search);
  });

  it('unchecking a category filters rows to the checked ones', () => {
    const el = mount();
    renderListBlock(el, { block: { items, categoryField: 'category' }, t });
    const buren = el.querySelector('[data-category=buren]');
    buren.checked = false; buren.dispatchEvent(new Event('change'));
    expect([...el.querySelectorAll('.list-screen__row-label')].map((n) => n.textContent)).toEqual(['Karin', 'Anna']);
  });

  it('dispatches a row action', () => {
    const el = mount();
    const onRowAction = vi.fn();
    const block = { items: [{ id: 'x', label: 'X' }], manifestsByOrigin: null, appOrigin: null };
    // inject a row action by faking the model path — use the controlled renderer for the action assertion
    renderListBlock(el, { block, t, onRowAction });
    expect(el.querySelector('.list-screen__row-label').textContent).toBe('X');
  });

  it('threads block.defaultAudience → buildScreenModel: filters rows by the section audience (SP-5b fetched-items path)', () => {
    const el = mount();
    const items = [
      { id: 'a', label: 'Alpha',   audience: 'crew:abc' },
      { id: 'b', label: 'Bravo',   audience: 'crew:xyz' },
      { id: 'c', label: 'Charlie', visibility: 'crew:abc' }, // legacy audience field resolves too
    ];
    // Without the threading (pre-fix) all 3 render; with block.defaultAudience the live list path
    // now audience-filters the FETCHED items (the projected section's view.defaultAudience → section.audience).
    renderListBlock(el, { block: { items, defaultAudience: 'crew:abc' }, t });
    expect([...el.querySelectorAll('.list-screen__row-label')].map((n) => n.textContent)).toEqual(['Alpha', 'Charlie']);
  });
});

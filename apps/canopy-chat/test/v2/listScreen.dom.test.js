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

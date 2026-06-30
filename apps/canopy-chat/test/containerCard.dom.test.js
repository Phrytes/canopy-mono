/**
 * @vitest-environment happy-dom
 * renderContainerCard (cluster K · K2 container UI) — the nested container card from a projectContainer tree.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderContainerCard } from '../web/v2/containerCard.js';

const tree = {
  id: 'L1', type: 'list', label: 'groceries', canAdd: true,
  children: [
    { id: 'T1', type: 'list-item', label: 'milk',  rowActions: ['markComplete', 'removeItem'], children: [] },
    { id: 'T2', type: 'list-item', label: 'bread', rowActions: ['markComplete', 'removeItem'], children: [] },
  ],
};

describe('renderContainerCard', () => {
  it('renders the container + nested children as rows, with labels + depth', () => {
    const card = renderContainerCard(tree);
    expect(card.dataset.itemId).toBe('L1');
    const rows = card.querySelectorAll('.circle-container-card__row');
    expect(rows.length).toBe(3);                               // list + 2 items
    expect(card.textContent).toContain('groceries');
    expect(card.textContent).toContain('milk');
    expect(card.textContent).toContain('bread');
    // children are indented one level
    const childRows = [...rows].filter((r) => r.dataset.type === 'list-item');
    expect(childRows.every((r) => r.dataset.depth === '1')).toBe(true);
  });

  it('"+ add" appears only on can-add nodes; tapping fires onAdd with that node', () => {
    const onAdd = vi.fn();
    const card = renderContainerCard(tree, { onAdd });
    const adds = card.querySelectorAll('.circle-container-card__add');
    expect(adds.length).toBe(1);                               // only the list (canAdd); leaves have no canAdd
    expect(adds[0].dataset.addTo).toBe('L1');
    adds[0].click();
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'L1' }));
  });

  it('row-action buttons fire onRowAction(op, node)', () => {
    const onRowAction = vi.fn();
    const card = renderContainerCard(tree, { onRowAction });
    const milkComplete = card.querySelector('.circle-container-card__row[data-item-id="T1"] [data-op="markComplete"]');
    expect(milkComplete).toBeTruthy();
    milkComplete.click();
    expect(onRowAction).toHaveBeenCalledWith('markComplete', expect.objectContaining({ id: 'T1' }));
  });

  it('uses the injected translator for the add + action labels', () => {
    const t = (key, _p, fallback) => ({ 'circle.container.add': '+ Toevoegen' }[key] ?? fallback);
    const card = renderContainerCard(tree, { t });
    expect(card.querySelector('.circle-container-card__add').textContent).toBe('+ Toevoegen');
  });

  it('renders a deep nest (offer→list→task) recursively', () => {
    const deep = { id: 'O', type: 'offer', label: 'help', canAdd: true, children: [
      { id: 'L', type: 'list', label: 'tasks', canAdd: true, children: [
        { id: 'T', type: 'task', label: 'pack', rowActions: ['claim'], children: [] },
      ] },
    ] };
    const card = renderContainerCard(deep);
    expect(card.querySelectorAll('.circle-container-card__row').length).toBe(3);
    expect(card.querySelector('[data-item-id="T"]').dataset.depth).toBe('2');
  });
});

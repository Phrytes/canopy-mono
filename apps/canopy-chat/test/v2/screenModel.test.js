/**
 * screenModel — B · Slice 3 pure projection (filter + categorise + capability-gated row actions).
 */
import { describe, it, expect } from 'vitest';
import { buildScreenModel } from '../../src/v2/screenModel.js';
import { mockTasksManifest } from '../../src/core/manifests/mockManifests.js';
import { buildCapabilityMatrix, capabilityKey } from '@canopy/app-manifest';

const contacts = [
  { id: 'a', label: 'Karin',  category: 'family' },
  { id: 'b', label: 'Klaas',  category: 'buren' },
  { id: 'c', label: 'Anna',   category: 'family' },
  { id: 'd', label: 'Bob',    category: 'buren' },
];

describe('buildScreenModel — text filter', () => {
  it('the "contacten met k" test: filters the label case-insensitively', () => {
    const { rows } = buildScreenModel({ items: contacts, query: 'k' });
    expect(rows.map((r) => r.label)).toEqual(['Karin', 'Klaas']);
  });
  it('empty query returns everything', () => {
    expect(buildScreenModel({ items: contacts }).rows).toHaveLength(4);
  });
});

describe('buildScreenModel — category checkboxes', () => {
  it('lists categories with counts + all-checked by default', () => {
    const { categories } = buildScreenModel({ items: contacts, categoryField: 'category' });
    expect(categories).toEqual([
      { id: 'family', count: 2, checked: true },
      { id: 'buren',  count: 2, checked: true },
    ]);
  });
  it('unchecking a category hides its rows (counts stay full)', () => {
    const m = buildScreenModel({ items: contacts, categoryField: 'category', activeCategories: ['family'] });
    expect(m.rows.map((r) => r.label)).toEqual(['Karin', 'Anna']);
    expect(m.categories.find((c) => c.id === 'buren')).toMatchObject({ count: 2, checked: false });
  });
  it('category + text filter compose', () => {
    const m = buildScreenModel({ items: contacts, query: 'k', categoryField: 'category', activeCategories: ['buren'] });
    expect(m.rows.map((r) => r.label)).toEqual(['Klaas']);   // Karin is family (unchecked)
  });
});

describe('buildScreenModel — capability-gated row actions (reuse Slice 4)', () => {
  const APP = mockTasksManifest.app;
  const tasks = [{ id: 't1', label: 'x', state: 'open', type: 'task' }];
  const manifestsByOrigin = { [APP]: mockTasksManifest };

  it('attaches the item’s capability-gated actions per row', () => {
    const { rows } = buildScreenModel({ items: tasks, manifestsByOrigin, appOrigin: APP });
    expect(rows[0].actions.some((a) => a.opId === 'claimTask')).toBe(true);
  });
  it('a hidden-consequence capability drops the row action (Slice 4 treatment)', () => {
    const matrix = buildCapabilityMatrix([{ manifest: mockTasksManifest }], {
      template: { [capabilityKey(APP, 'claim', 'task')]: { enabled: false, consequence: 'hidden' } },
    });
    const { rows } = buildScreenModel({ items: tasks, manifestsByOrigin, appOrigin: APP, capabilityMatrix: matrix });
    expect(rows[0].actions.some((a) => a.opId === 'claimTask')).toBe(false);
  });
});

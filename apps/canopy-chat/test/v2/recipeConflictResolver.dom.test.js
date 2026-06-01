// @vitest-environment happy-dom
/**
 * γ.3 — recipeConflictResolver DOM tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderRecipeConflictResolver } from '../../web/v2/recipeConflictResolver.js';

const t = (key, params) => {
  if (params && params.name != null) return `${key}:${params.name}`;
  if (params && params.path != null) return `${key}:${params.path}`;
  return key;
};

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function buildFixture() {
  const local = {
    id: 'r1', name: 'Mine',
    blocks: [
      { id: 'A', type: 'text',         config: { text: 'mine-A' } },
      { id: 'B', type: 'announcement', config: { text: 'mine-B' } },
    ],
  };
  const incoming = {
    id: 'r1', name: 'Theirs',
    blocks: [
      { id: 'A', type: 'text',         config: { text: 'theirs-A' } },
      { id: 'B', type: 'announcement', config: { text: 'theirs-B' } },
    ],
  };
  const conflicts = {
    blockConflicts: [
      { blockId: 'A', conflicts: [{ path: ['blocks','A','config','text'], yours: 'mine-A', theirs: 'theirs-A', base: 'base-A' }] },
      { blockId: 'B', conflicts: [{ path: ['blocks','B','config','text'], yours: 'mine-B', theirs: 'theirs-B', base: 'base-B' }] },
    ],
    metaConflicts: [
      { path: ['name'], yours: 'Mine', theirs: 'Theirs', base: 'Base' },
    ],
    identical: false,
    toMerge: [],
  };
  return { local, incoming, conflicts };
}

describe('renderRecipeConflictResolver · γ.3', () => {
  it('renders one block-row per blockConflict + one meta-row per metaConflict', () => {
    const { local, incoming, conflicts } = buildFixture();
    const el = mount();
    renderRecipeConflictResolver(el, { conflicts, local, incoming, t, onResolve: () => {}, onCancel: () => {} });
    expect(el.classList.contains('circle-recipe-conflict')).toBe(true);
    const blockRows = el.querySelectorAll('.circle-recipe-conflict__block-row');
    expect(blockRows).toHaveLength(2);
    expect(blockRows[0].dataset.blockId).toBe('A');
    expect(blockRows[1].dataset.blockId).toBe('B');
    const metaRows = el.querySelectorAll('.circle-recipe-conflict__meta-row');
    expect(metaRows).toHaveLength(1);
    expect(metaRows[0].dataset.pathKey).toBe('name');
  });

  it('shows the modal title + instructions text', () => {
    const { local, incoming, conflicts } = buildFixture();
    const el = mount();
    renderRecipeConflictResolver(el, { conflicts, local, incoming, t, onResolve: () => {}, onCancel: () => {} });
    expect(el.querySelector('.circle-recipe-conflict__title').textContent).toBe('circle.recipe.conflict.title');
    expect(el.querySelector('.circle-recipe-conflict__instructions').textContent).toBe('circle.recipe.conflict.instructions');
  });

  it('Apply is disabled until EVERY block + meta conflict has a decision', () => {
    const { local, incoming, conflicts } = buildFixture();
    const el = mount();
    renderRecipeConflictResolver(el, { conflicts, local, incoming, t, onResolve: () => {}, onCancel: () => {} });
    const apply = el.querySelector('.circle-recipe-conflict__apply');
    expect(apply.disabled).toBe(true);

    // Pick choices on each block, then the meta.
    const blockRows = el.querySelectorAll('.circle-recipe-conflict__block-row');
    blockRows[0].querySelector('.circle-recipe-conflict__choice--yours').click();
    expect(apply.disabled).toBe(true);
    blockRows[1].querySelector('.circle-recipe-conflict__choice--both').click();
    expect(apply.disabled).toBe(true);
    const metaRow = el.querySelector('.circle-recipe-conflict__meta-row');
    metaRow.querySelector('.circle-recipe-conflict__choice--theirs').click();
    expect(apply.disabled).toBe(false);
  });

  it('Apply forwards the picked decisions through onResolve', () => {
    const { local, incoming, conflicts } = buildFixture();
    const onResolve = vi.fn();
    const onCancel = vi.fn();
    const el = mount();
    renderRecipeConflictResolver(el, { conflicts, local, incoming, t, onResolve, onCancel });

    const blockRows = el.querySelectorAll('.circle-recipe-conflict__block-row');
    blockRows[0].querySelector('.circle-recipe-conflict__choice--theirs').click();
    blockRows[1].querySelector('.circle-recipe-conflict__choice--yours').click();
    el.querySelector('.circle-recipe-conflict__meta-row .circle-recipe-conflict__choice--theirs').click();

    el.querySelector('.circle-recipe-conflict__apply').click();
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve.mock.calls[0][0]).toEqual({ A: 'theirs', B: 'yours', name: 'theirs' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Cancel button calls onCancel + does NOT call onResolve', () => {
    const { local, incoming, conflicts } = buildFixture();
    const onResolve = vi.fn();
    const onCancel = vi.fn();
    const el = mount();
    renderRecipeConflictResolver(el, { conflicts, local, incoming, t, onResolve, onCancel });
    el.querySelector('.circle-recipe-conflict__cancel').click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('picking a choice marks the picked button is-picked / aria-pressed=true (and unmarks siblings)', () => {
    const { local, incoming, conflicts } = buildFixture();
    const el = mount();
    renderRecipeConflictResolver(el, { conflicts, local, incoming, t, onResolve: () => {}, onCancel: () => {} });
    const row = el.querySelector('.circle-recipe-conflict__block-row');
    const yours = row.querySelector('.circle-recipe-conflict__choice--yours');
    const theirs = row.querySelector('.circle-recipe-conflict__choice--theirs');
    yours.click();
    expect(yours.classList.contains('is-picked')).toBe(true);
    expect(yours.getAttribute('aria-pressed')).toBe('true');
    expect(theirs.classList.contains('is-picked')).toBe(false);
    theirs.click();
    expect(yours.classList.contains('is-picked')).toBe(false);
    expect(theirs.classList.contains('is-picked')).toBe(true);
  });

  it('empty conflicts: still renders title + footer; Cancel still works', () => {
    // Defensive: host should short-circuit the modal entirely when
    // there's nothing to resolve, so this exercise is just a smoke
    // check that the substrate doesn't blow up on empty input.
    const onCancel = vi.fn();
    const el = mount();
    renderRecipeConflictResolver(el, {
      conflicts: { blockConflicts: [], metaConflicts: [], identical: true, toMerge: [] },
      local: { id: 'r', name: '', blocks: [] },
      incoming: { id: 'r', name: '', blocks: [] },
      t, onResolve: () => {}, onCancel,
    });
    expect(el.querySelector('.circle-recipe-conflict__title')).not.toBeNull();
    expect(el.querySelector('.circle-recipe-conflict__block-row')).toBeNull();
    expect(el.querySelector('.circle-recipe-conflict__meta-row')).toBeNull();
    el.querySelector('.circle-recipe-conflict__cancel').click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('block label includes the block type label + emoji prefix', () => {
    const { local, incoming, conflicts } = buildFixture();
    const el = mount();
    renderRecipeConflictResolver(el, { conflicts, local, incoming, t, onResolve: () => {}, onCancel: () => {} });
    const firstLabel = el.querySelector('.circle-recipe-conflict__block-row .circle-recipe-conflict__block-label').textContent;
    // t mock with {name} returns `${key}:${name}`; the name includes the emoji prefix + block type key.
    expect(firstLabel).toContain('circle.recipe.conflict.block_label:');
    expect(firstLabel).toContain('circle.recipe.block.text');
  });
});

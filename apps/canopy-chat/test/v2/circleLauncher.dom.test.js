// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderCircleLauncher } from '../../web/v2/circleLauncher.js';

// Stub t(): echo the key, and fold {{count}} so the members label is checkable.
const t = (key, params) =>
  params && params.count != null ? `${key}:${params.count}` : key;

const circles = [
  { id: 'g1', name: 'Selwerd', kind: 'neighbourhood', memberCount: 87 },
  { id: 'h1', name: 'Huisgenoten', kind: 'home', memberCount: 4 },
  { id: 'p1', name: 'My things', memberCount: null },
];

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('renderCircleLauncher', () => {
  it('renders one tile per circle with name + member meta', () => {
    const el = mount();
    renderCircleLauncher(el, { circles, t });
    const tiles = el.querySelectorAll('.circle-tile');
    expect(tiles).toHaveLength(3);
    expect(tiles[0].dataset.circleId).toBe('g1');
    expect(tiles[0].dataset.kind).toBe('neighbourhood');
    expect(el.querySelector('.circle-tile__name').textContent).toBe('Selwerd');
    expect(tiles[0].querySelector('.circle-tile__meta').textContent).toBe('circle.members:87');
    // null memberCount → no meta row
    expect(tiles[2].querySelector('.circle-tile__meta')).toBeNull();
  });

  it('renders the title + new-circle button via t()', () => {
    const el = mount();
    renderCircleLauncher(el, { circles, t });
    expect(el.querySelector('.circle-launcher__title').textContent).toBe('circle.title');
    expect(el.querySelector('.circle-launcher__new').textContent).toBe('circle.new');
  });

  it('fires onOpenCircle(id) on tile click and onNewCircle on new click', () => {
    const el = mount();
    const onOpenCircle = vi.fn();
    const onNewCircle = vi.fn();
    renderCircleLauncher(el, { circles, t, onOpenCircle, onNewCircle });
    el.querySelector('.circle-tile').click();
    el.querySelector('.circle-launcher__new').click();
    expect(onOpenCircle).toHaveBeenCalledWith('g1', circles[0]);
    expect(onNewCircle).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state with no circles', () => {
    const el = mount();
    renderCircleLauncher(el, { circles: [], t });
    expect(el.querySelector('.circle-launcher__empty').textContent).toBe('circle.empty');
    expect(el.querySelectorAll('.circle-tile')).toHaveLength(0);
  });

  it('shows the loading state and no tiles while loading', () => {
    const el = mount();
    renderCircleLauncher(el, { circles, t, loading: true });
    expect(el.querySelector('.circle-launcher__loading').textContent).toBe('circle.loading');
    expect(el.querySelectorAll('.circle-tile')).toHaveLength(0);
  });

  it('re-render clears previous content (idempotent mount)', () => {
    const el = mount();
    renderCircleLauncher(el, { circles, t });
    renderCircleLauncher(el, { circles: circles.slice(0, 1), t });
    expect(el.querySelectorAll('.circle-tile')).toHaveLength(1);
  });
});

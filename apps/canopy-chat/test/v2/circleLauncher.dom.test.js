// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderCircleLauncher } from '../../web/v2/circleLauncher.js';

// Stub t(): echo the key, and fold {{count}} so the members label is checkable.
const t = (key, params) =>
  params && params.count != null ? `${key}:${params.count}` : key;

// Default fixture: mixed kinds → β.3 grouping is exercised.
const circles = [
  { id: 'g1', name: 'Selwerd',     kind: 'buurt',         memberCount: 87 },
  { id: 'h1', name: 'Huisgenoten', kind: 'household',     memberCount: 4 },
  { id: 'p1', name: 'My things',                          memberCount: null },
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
    // Tiles carry the kind data-attr (unchanged from pre-β).
    const byId = Object.fromEntries(
      Array.from(tiles).map((tl) => [tl.dataset.circleId, tl]),
    );
    expect(byId.g1.dataset.kind).toBe('buurt');
    expect(byId.h1.dataset.kind).toBe('household');
    expect(byId.g1.querySelector('.circle-tile__name').textContent).toBe('Selwerd');
    expect(byId.g1.querySelector('.circle-tile__meta').textContent).toBe('circle.members:87');
    // null memberCount → no meta row
    expect(byId.p1.querySelector('.circle-tile__meta')).toBeNull();
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
    // Click the tile for g1 specifically (sort order isn't lexical).
    el.querySelector('.circle-tile[data-circle-id="g1"]').click();
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

  // β.1 — top-row Stream/Availability/Hop/Nearby/My-things buttons removed.
  it('β.1 — no Stream/Availability/Hop/Nearby/My-things buttons on the launcher', () => {
    const el = mount();
    renderCircleLauncher(el, {
      circles,
      t,
      // Even if a host passes these legacy handlers, no buttons must render.
      onStream:       vi.fn(),
      onAvailability: vi.fn(),
      onHop:          vi.fn(),
      onNearby:       vi.fn(),
      onMyThings:     vi.fn(),
    });
    expect(el.querySelector('.circle-launcher__stream')).toBeNull();
    expect(el.querySelector('.circle-launcher__availability')).toBeNull();
    expect(el.querySelector('.circle-launcher__hop')).toBeNull();
    expect(el.querySelector('.circle-launcher__nearby')).toBeNull();
    expect(el.querySelector('.circle-launcher__my-things')).toBeNull();
  });

  it('renders the voorstellen badge when proposals[id] > 0', () => {
    const el = mount();
    renderCircleLauncher(el, { circles, t, proposals: { h1: 2 } });
    const tiles = el.querySelectorAll('.circle-tile');
    const byId = Object.fromEntries(
      Array.from(tiles).map((tl) => [tl.dataset.circleId, tl]),
    );
    // g1 + p1 have no pending proposals → no badge
    expect(byId.g1.querySelector('.circle-tile__proposals')).toBeNull();
    expect(byId.p1.querySelector('.circle-tile__proposals')).toBeNull();
    // h1 has 2 pending → badge shows the count
    const badge = byId.h1.querySelector('.circle-tile__proposals');
    expect(badge.textContent).toBe('2');
    expect(badge.getAttribute('aria-label')).toBe('circle.tile_proposals:2');
  });

  it('ignores non-positive / non-numeric proposal counts', () => {
    const el = mount();
    renderCircleLauncher(el, { circles, t, proposals: { g1: 0, h1: 'nope', p1: null } });
    for (const tile of el.querySelectorAll('.circle-tile')) {
      expect(tile.querySelector('.circle-tile__proposals')).toBeNull();
    }
  });

  // β.2 — sort tiles by preview.ts desc; stable name tiebreak on equal ts.
  describe('β.2 — sort by recent activity', () => {
    it('sorts tiles by previews[c.id].ts descending', () => {
      const el = mount();
      // All same kind (household) so β.3 grouping degenerates to a flat
      // list and the order assertion is purely about β.2.
      const same = [
        { id: 'a', name: 'A', kind: 'household' },
        { id: 'b', name: 'B', kind: 'household' },
        { id: 'c', name: 'C', kind: 'household' },
      ];
      const previews = {
        a: { ts: 100 },
        b: { ts: 300 },
        c: { ts: 200 },
      };
      renderCircleLauncher(el, { circles: same, previews, t });
      const ids = Array.from(el.querySelectorAll('.circle-tile'))
        .map((tl) => tl.dataset.circleId);
      expect(ids).toEqual(['b', 'c', 'a']);
    });

    it('breaks ties on equal ts by name (stable, locale-aware)', () => {
      const el = mount();
      const same = [
        { id: 'x', name: 'Zeta',  kind: 'household' },
        { id: 'y', name: 'Alpha', kind: 'household' },
        { id: 'z', name: 'Mango', kind: 'household' },
      ];
      // Equal ts → name order: Alpha, Mango, Zeta.
      const previews = { x: { ts: 0 }, y: { ts: 0 }, z: { ts: 0 } };
      renderCircleLauncher(el, { circles: same, previews, t });
      const ids = Array.from(el.querySelectorAll('.circle-tile'))
        .map((tl) => tl.dataset.circleId);
      expect(ids).toEqual(['y', 'z', 'x']);
    });

    it('tiles without a preview.ts sort to the end (treated as 0)', () => {
      const el = mount();
      const same = [
        { id: 'old',  name: 'Old',  kind: 'household' },
        { id: 'new',  name: 'New',  kind: 'household' },
        { id: 'none', name: 'None', kind: 'household' },
      ];
      const previews = { old: { ts: 50 }, new: { ts: 500 } };
      renderCircleLauncher(el, { circles: same, previews, t });
      const ids = Array.from(el.querySelectorAll('.circle-tile'))
        .map((tl) => tl.dataset.circleId);
      // 'new' (500) → 'old' (50) → 'none' (0).
      expect(ids).toEqual(['new', 'old', 'none']);
    });
  });

  // β.3 — group tiles by kind under fixed-order section headers.
  describe('β.3 — group by kind', () => {
    it('renders section headers when ≥2 kinds are present', () => {
      const el = mount();
      renderCircleLauncher(el, { circles, t });
      const sections = el.querySelectorAll('.circle-launcher__section');
      // Three distinct kinds: 'household', 'buurt', 'other' (p1 has no kind).
      expect(sections).toHaveLength(3);
      const headers = Array.from(el.querySelectorAll('.circle-launcher__section-title'))
        .map((h) => h.textContent);
      // Fixed order: household → buurt → vriendenkring → other.
      // vriendenkring isn't present, so: household, buurt, other.
      expect(headers).toEqual([
        'circle.kind.household',
        'circle.kind.buurt',
        'circle.kind.other',
      ]);
    });

    it('skips section headers entirely when all kringen share one kind', () => {
      const el = mount();
      const all = [
        { id: 'a', name: 'A', kind: 'household' },
        { id: 'b', name: 'B', kind: 'household' },
      ];
      renderCircleLauncher(el, { circles: all, t });
      expect(el.querySelectorAll('.circle-launcher__section')).toHaveLength(0);
      expect(el.querySelectorAll('.circle-launcher__section-title')).toHaveLength(0);
      // Flat list still renders the tiles.
      expect(el.querySelectorAll('.circle-tile')).toHaveLength(2);
    });

    it('buckets unknown kinds under the "other" header', () => {
      const el = mount();
      const mixed = [
        { id: 'h',  name: 'Home',  kind: 'household' },
        { id: 'w',  name: 'Work',  kind: 'team' },        // unknown
        { id: 'g',  name: 'Group', kind: 'gardening' },   // unknown
      ];
      renderCircleLauncher(el, { circles: mixed, t });
      const sections = el.querySelectorAll('.circle-launcher__section');
      expect(sections).toHaveLength(2); // household + other
      // The 'other' section should contain BOTH unknown-kind tiles.
      const otherSection = el.querySelector('.circle-launcher__section[data-kind="other"]');
      const otherIds = Array.from(otherSection.querySelectorAll('.circle-tile'))
        .map((tl) => tl.dataset.circleId)
        .sort();
      expect(otherIds).toEqual(['g', 'w']);
    });

    it('respects KIND_ORDER (household → buurt → vriendenkring → other) even if input is reordered', () => {
      const el = mount();
      const reordered = [
        { id: 'a', name: 'A', kind: 'vriendenkring' },
        { id: 'b', name: 'B', kind: 'other-thing' },
        { id: 'c', name: 'C', kind: 'buurt' },
        { id: 'd', name: 'D', kind: 'household' },
      ];
      renderCircleLauncher(el, { circles: reordered, t });
      const headers = Array.from(el.querySelectorAll('.circle-launcher__section-title'))
        .map((h) => h.textContent);
      expect(headers).toEqual([
        'circle.kind.household',
        'circle.kind.buurt',
        'circle.kind.vriendenkring',
        'circle.kind.other',
      ]);
    });

    it('sort-by-activity applies WITHIN each kind section', () => {
      const el = mount();
      const mixed = [
        { id: 'h-old', name: 'H-old', kind: 'household' },
        { id: 'h-new', name: 'H-new', kind: 'household' },
        { id: 'b-old', name: 'B-old', kind: 'buurt' },
        { id: 'b-new', name: 'B-new', kind: 'buurt' },
      ];
      const previews = {
        'h-old': { ts: 1 }, 'h-new': { ts: 99 },
        'b-old': { ts: 2 }, 'b-new': { ts: 98 },
      };
      renderCircleLauncher(el, { circles: mixed, previews, t });
      // Household section comes first; inside, h-new (99) before h-old (1).
      const hSection = el.querySelector('.circle-launcher__section[data-kind="household"]');
      const bSection = el.querySelector('.circle-launcher__section[data-kind="buurt"]');
      const hIds = Array.from(hSection.querySelectorAll('.circle-tile')).map((tl) => tl.dataset.circleId);
      const bIds = Array.from(bSection.querySelectorAll('.circle-tile')).map((tl) => tl.dataset.circleId);
      expect(hIds).toEqual(['h-new', 'h-old']);
      expect(bIds).toEqual(['b-new', 'b-old']);
    });
  });
});

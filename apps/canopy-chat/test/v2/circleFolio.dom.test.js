// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderCircleFolioBrowser } from '../../web/v2/circleFolio.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

const files = [
  { id: 'f1', name: 'plan.md',  kind: 'doc',  updatedAt: 300 },
  { id: 'f2', name: 'notes.txt', kind: 'file', updatedAt: 200 },
];

describe('renderCircleFolioBrowser', () => {
  it('renders a row per file with its name', () => {
    const el = mount();
    renderCircleFolioBrowser(el, { files, t });
    const rowEls = el.querySelectorAll('.circle-folio__row');
    expect(rowEls).toHaveLength(2);
    expect(el.querySelector('.circle-folio__row[data-file-id=f1] .circle-folio__name').textContent).toBe('plan.md');
  });

  it('shows the empty state when there are no files', () => {
    const el = mount();
    renderCircleFolioBrowser(el, { files: [], t });
    expect(el.querySelector('.circle-folio__empty').textContent).toBe('circle.folio.empty');
  });

  it('shows the loading state', () => {
    const el = mount();
    renderCircleFolioBrowser(el, { loading: true, t });
    expect(el.querySelector('.circle-folio__loading')).not.toBeNull();
  });

  it('renders the three filter buttons and fires onFilter on click', () => {
    const el = mount();
    const onFilter = vi.fn();
    renderCircleFolioBrowser(el, { files, t, onFilter });
    const filters = el.querySelectorAll('.circle-folio__filter');
    expect([...filters].map((f) => f.dataset.filter)).toEqual(['all', 'favourites', 'recent']);
    el.querySelector('.circle-folio__filter[data-filter=recent]').click();
    expect(onFilter).toHaveBeenCalledWith('recent');
  });

  it('marks the active filter', () => {
    const el = mount();
    renderCircleFolioBrowser(el, { files, t, filter: 'favourites' });
    expect(el.querySelector('.circle-folio__filter[data-filter=favourites]').classList.contains('is-active')).toBe(true);
  });

  it('tapping a row fires onOpen with the file', () => {
    const el = mount();
    const onOpen = vi.fn();
    renderCircleFolioBrowser(el, { files, t, onOpen });
    el.querySelector('.circle-folio__row[data-file-id=f1]').click();
    expect(onOpen).toHaveBeenCalledWith(files[0]);
  });

  it('onBack fires from the back button', () => {
    const el = mount();
    const onBack = vi.fn();
    renderCircleFolioBrowser(el, { files, t, onBack });
    el.querySelector('.circle-folio__back').click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

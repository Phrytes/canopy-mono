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

  it('renders rich rows — a glyph and a human size', () => {
    const el = mount();
    renderCircleFolioBrowser(el, { files: [{ id: 'd', name: 'lease.pdf', bytes: 102400 }], t });
    const row = el.querySelector('.circle-folio__row');
    expect(row.querySelector('.circle-folio__glyph').textContent).toBe('📕');
    expect(row.querySelector('.circle-folio__size').textContent).toBe('100 KB');
  });
});

// N5 — folder navigation (Drive-style) lights up when onNavigate is wired.
const treeFiles = [
  { id: '/notes/recipes.md', name: 'recipes.md', bytes: 5678 },
  { id: '/notes/shared/anne.md', name: 'anne.md', bytes: 1234 },
  { id: '/docs/lease.pdf', name: 'lease.pdf', bytes: 102400 },
  { id: '/readme.txt', name: 'readme.txt', bytes: 12 },
];

describe('renderCircleFolioBrowser — folder navigation', () => {
  it('renders root folders (with counts) and root files', () => {
    const el = mount();
    renderCircleFolioBrowser(el, { files: treeFiles, t, currentPath: '', onNavigate: vi.fn() });
    const folders = [...el.querySelectorAll('.circle-folio__row--folder')];
    expect(folders.map((f) => f.dataset.folderPath)).toEqual(['docs', 'notes']);
    expect(folders[1].querySelector('.circle-folio__count').textContent).toBe('circle.folio.folder_count');
    // readme.txt is the only root-level file.
    const fileRows = [...el.querySelectorAll('.circle-folio__row:not(.circle-folio__row--folder)')];
    expect(fileRows.map((r) => r.dataset.fileId)).toEqual(['/readme.txt']);
  });

  it('tapping a folder navigates into it', () => {
    const el = mount();
    const onNavigate = vi.fn();
    renderCircleFolioBrowser(el, { files: treeFiles, t, onNavigate });
    el.querySelector('.circle-folio__row--folder[data-folder-path=notes]').click();
    expect(onNavigate).toHaveBeenCalledWith('notes');
  });

  it('shows breadcrumbs inside a subfolder and the current crumb is static', () => {
    const el = mount();
    const onNavigate = vi.fn();
    renderCircleFolioBrowser(el, { files: treeFiles, t, currentPath: 'notes/shared', onNavigate });
    const crumbs = [...el.querySelectorAll('.circle-folio__crumbs > *')].filter((n) => n.classList.contains('circle-folio__crumb'));
    expect(crumbs.map((c) => c.textContent)).toEqual(['circle.folio.root', 'notes', 'shared']);
    // The last crumb ('shared') is the current one — static, not a button.
    expect(crumbs.at(-1).classList.contains('is-current')).toBe(true);
    expect(crumbs.at(-1).tagName).toBe('SPAN');
    // anne.md sits directly in notes/shared.
    expect([...el.querySelectorAll('.circle-folio__row:not(.circle-folio__row--folder) .circle-folio__name')].map((n) => n.textContent)).toEqual(['anne.md']);
  });

  it('clicking a parent breadcrumb climbs out', () => {
    const el = mount();
    const onNavigate = vi.fn();
    renderCircleFolioBrowser(el, { files: treeFiles, t, currentPath: 'notes/shared', onNavigate });
    el.querySelector('.circle-folio__crumb[data-crumb-path=notes]').click();
    expect(onNavigate).toHaveBeenCalledWith('notes');
  });

  it('shows the empty-folder state for a path with no rows', () => {
    const el = mount();
    renderCircleFolioBrowser(el, { files: treeFiles, t, currentPath: 'nope', onNavigate: vi.fn() });
    expect(el.querySelector('.circle-folio__empty').textContent).toBe('circle.folio.empty_folder');
  });
});

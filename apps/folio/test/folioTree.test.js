/**
 * folio — drive tree (N5).  Source-agnostic folder navigation derived
 * from flat file rows (scanLocal `relPath`, scanPod `relPath`, or the
 * browser listFiles `id`/`path`).
 */
import { describe, it, expect } from 'vitest';

import {
  folioLevel, breadcrumbs, parentPath, rowPath, rowName,
  formatFileSize, fileKind, glyphForFile,
} from '../src/folioTree.js';

// Mixed sources: scanLocal/scanPod use `relPath`, listFiles uses `id`.
const ROWS = [
  { relPath: 'readme.txt', size: 12 },
  { relPath: '2024/notulen/jan.pdf', size: 2048 },
  { relPath: '2024/notulen/feb.pdf', size: 4096 },
  { relPath: '2024/begroting.xlsx', size: 8192 },
  { id: 'foto/plattegrond.png', size: 1_500_000 },   // listFiles shape
];

describe('rowPath / rowName', () => {
  it('reads relPath, then path/id/name', () => {
    expect(rowPath({ relPath: 'a/b.txt' })).toBe('a/b.txt');
    expect(rowPath({ id: 'x/y.pdf' })).toBe('x/y.pdf');
    expect(rowName({ relPath: '2024/notulen/jan.pdf' })).toBe('jan.pdf');
    expect(rowName({ name: 'Custom', relPath: 'a/b.txt' })).toBe('Custom');
  });
});

describe('folioLevel', () => {
  it('lists root folders + root files', () => {
    const lvl = folioLevel(ROWS, '');
    expect(lvl.folders.map((f) => f.name)).toEqual(['2024', 'foto']);
    expect(lvl.folders.find((f) => f.name === '2024').count).toBe(3);
    expect(lvl.files.map(rowName)).toEqual(['readme.txt']);
    expect(lvl.crumbs).toEqual([{ name: '', path: '' }]);
  });

  it('navigates into a subfolder', () => {
    const lvl = folioLevel(ROWS, '2024');
    expect(lvl.folders.map((f) => f.name)).toEqual(['notulen']);
    expect(lvl.files.map(rowName)).toEqual(['begroting.xlsx']);
  });

  it('lists a leaf folder with only files + breadcrumbs', () => {
    const lvl = folioLevel(ROWS, '2024/notulen');
    expect(lvl.folders).toEqual([]);
    expect(lvl.files.map(rowName).sort()).toEqual(['feb.pdf', 'jan.pdf']);
    expect(lvl.crumbs).toEqual([
      { name: '', path: '' },
      { name: '2024', path: '2024' },
      { name: 'notulen', path: '2024/notulen' },
    ]);
  });

  it('tolerates junk + empty input', () => {
    expect(folioLevel(null)).toEqual({ path: '', crumbs: [{ name: '', path: '' }], folders: [], files: [] });
    expect(folioLevel([null, {}, 5])).toMatchObject({ folders: [], files: [] });
  });
});

describe('breadcrumbs / parentPath', () => {
  it('parentPath climbs one level', () => {
    expect(parentPath('2024/notulen')).toBe('2024');
    expect(parentPath('2024')).toBe('');
    expect(parentPath('')).toBe('');
  });
});

describe('rich-row helpers', () => {
  it('formatFileSize is human-readable', () => {
    expect(formatFileSize(12)).toBe('12 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(1_500_000)).toBe('1.4 MB');
    expect(formatFileSize(NaN)).toBe('');
    expect(formatFileSize(-1)).toBe('');
  });
  it('fileKind + glyph derive from extension', () => {
    expect(fileKind('jan.pdf')).toBe('pdf');
    expect(fileKind('plattegrond.png')).toBe('image');
    expect(fileKind('begroting.xlsx')).toBe('sheet');
    expect(fileKind('noext')).toBe('file');
    expect(glyphForFile('a.pdf')).toBe('📕');
    expect(glyphForFile('a.png')).toBe('🖼');
  });
});

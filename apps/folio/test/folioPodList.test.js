/**
 * folio — pod folder listing for the Drive browser (N5 real-pod source).
 * Walks a fake PodClient (canned `.list` per container) — no real auth —
 * verifying files-only recursion, relPath derivation, size mapping, depth
 * guard, and the empty-pod (404 root) path.
 */
import { describe, it, expect } from 'vitest';

import { listPodFolio } from '../src/folioPodList.js';
import { folioLevel, rowName } from '../src/folioTree.js';

const ROOT = 'https://bob.solidpod.nl/huishouden/';

// A fake PodClient: a map of container URI -> entries, à la SolidPodSource.
function fakePod(tree) {
  return {
    async list(uri) {
      if (!(uri in tree)) { const e = new Error('not found'); e.code = 'NOT_FOUND'; throw e; }
      return { container: uri, entries: tree[uri] };
    },
  };
}

const POD = fakePod({
  [ROOT]: [
    { uri: `${ROOT}readme.txt`, type: 'resource', size: 12 },
    { uri: `${ROOT}2024/`, type: 'container' },
    { uri: `${ROOT}foto/`, type: 'container' },
  ],
  [`${ROOT}2024/`]: [
    { uri: `${ROOT}2024/begroting.xlsx`, type: 'resource', size: 8192 },
    { uri: `${ROOT}2024/notulen/`, type: 'container' },
  ],
  [`${ROOT}2024/notulen/`]: [
    { uri: `${ROOT}2024/notulen/jan.pdf`, type: 'resource', size: 2048 },
  ],
  [`${ROOT}foto/`]: [
    { uri: `${ROOT}foto/plattegrond.png`, type: 'resource', size: 1_500_000 },
  ],
});

describe('listPodFolio', () => {
  it('returns files only (no containers), recursively, with pod-relative paths', async () => {
    const rows = await listPodFolio(POD, ROOT);
    expect(rows.map((r) => r.relPath).sort()).toEqual([
      '2024/begroting.xlsx',
      '2024/notulen/jan.pdf',
      'foto/plattegrond.png',
      'readme.txt',
    ]);
    // No container rows leaked in.
    expect(rows.every((r) => r.type === 'file')).toBe(true);
  });

  it('maps size→bytes and keeps the absolute podUri', async () => {
    const rows = await listPodFolio(POD, ROOT);
    const jan = rows.find((r) => r.relPath === '2024/notulen/jan.pdf');
    expect(jan.bytes).toBe(2048);
    expect(jan.name).toBe('jan.pdf');
    expect(jan.podUri).toBe(`${ROOT}2024/notulen/jan.pdf`);
  });

  it('feeds straight into folioLevel (the Drive tree)', async () => {
    const rows = await listPodFolio(POD, ROOT);
    const root = folioLevel(rows, '');
    expect(root.folders.map((f) => f.name)).toEqual(['2024', 'foto']);
    expect(root.folders.find((f) => f.name === '2024').count).toBe(2);
    expect(root.files.map(rowName)).toEqual(['readme.txt']);

    const sub = folioLevel(rows, '2024/notulen');
    expect(sub.files.map(rowName)).toEqual(['jan.pdf']);
  });

  it('treats a 404 on the root container as an empty pod', async () => {
    const rows = await listPodFolio(fakePod({}), ROOT);
    expect(rows).toEqual([]);
  });

  it('honours the depth guard', async () => {
    const rows = await listPodFolio(POD, ROOT, { maxDepth: 0 });
    // depth 0 = only the root container's direct files.
    expect(rows.map((r) => r.relPath)).toEqual(['readme.txt']);
  });

  it('rejects a client without .list()', async () => {
    await expect(listPodFolio({}, ROOT)).rejects.toThrow(/podClient with \.list/);
  });
});

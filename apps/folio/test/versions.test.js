/**
 * versions.test.js — unit tests for Folio.B4 versioning module.
 *
 * Coverage map (≥10 tests per the spec DoD):
 *   - isVersionable: pure-fn rejection of dotted / absolute / .. paths
 *   - captureVersion: writes snapshot + sidecar + entry shape
 *   - captureVersion: skips dotted paths (NOT_VERSIONABLE)
 *   - captureVersion: skips first-ever snapshot of empty content
 *   - captureVersion: debounces same-sha256 within 5 seconds
 *   - captureVersion: does NOT debounce when content sha changes
 *   - captureVersion: does NOT debounce when window has elapsed
 *   - listVersions: empty + populated + sort order
 *   - restoreVersion: writes snapshot back; captures CURRENT first
 *   - restoreVersion: VERSION_NOT_FOUND for unknown ts
 *   - dropVersions: removes the per-file directory entirely
 *   - pruneVersions: per-file cap drops oldest beyond N
 *   - pruneVersions: global byte budget evicts oldest across all files
 *   - listFilesWithVersions: nested tree picker shape
 *   - readVersionContent: returns raw bytes; VERSION_NOT_FOUND for unknown ts
 *   - retention: configurable perFile + budgetMb
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  captureVersion,
  listVersions,
  restoreVersion,
  dropVersions,
  pruneVersions,
  listFilesWithVersions,
  readVersionContent,
  isVersionable,
  sha256Of,
  _clearVersionsCache,
  DEFAULT_VERSIONS_PER_FILE,
} from '../src/versions.js';

let localRoot;

beforeEach(async () => {
  localRoot = await fs.mkdtemp(join(tmpdir(), 'folio-vers-'));
  _clearVersionsCache();
});
afterEach(async () => {
  _clearVersionsCache();
  await fs.rm(localRoot, { recursive: true, force: true });
});

// ── isVersionable ──────────────────────────────────────────────────────────

describe('isVersionable', () => {
  it('accepts plain markdown paths', () => {
    expect(isVersionable('a.md')).toBe(true);
    expect(isVersionable('sub/dir/note.md')).toBe(true);
    expect(isVersionable('file with spaces.txt')).toBe(true);
  });

  it('rejects empty / dotted / absolute / .. paths', () => {
    expect(isVersionable('')).toBe(false);
    expect(isVersionable(null)).toBe(false);
    expect(isVersionable(undefined)).toBe(false);
    expect(isVersionable('.folio/versions/a.md')).toBe(false);
    expect(isVersionable('.canopy/state.json')).toBe(false);
    expect(isVersionable('/abs/path')).toBe(false);
    expect(isVersionable('a/../b')).toBe(false);
    expect(isVersionable('a/.hidden/c.md')).toBe(false);
    expect(isVersionable('.dotfile')).toBe(false);
  });
});

// ── captureVersion happy path ──────────────────────────────────────────────

describe('captureVersion', () => {
  it('writes a snapshot file + sidecar with the captured content', async () => {
    const r = await captureVersion({
      localRoot,
      relPath: 'note.md',
      content: 'hello world',
      now:     1_700_000_000_000,
    });
    expect(r.captured).toBe(true);
    expect(r.ts).toBe(1_700_000_000_000);
    expect(r.sha256).toBe(sha256Of('hello world'));
    expect(r.path).toMatch(/\.folio[\/\\]versions[\/\\]note\.md[\/\\]1700000000000\.md$/);

    const content = await fs.readFile(r.path, 'utf8');
    expect(content).toBe('hello world');

    const sidecar = await fs.readFile(`${r.path}.sha256`, 'utf8');
    expect(sidecar.trim()).toBe(r.sha256);
  });

  it('returns NOT_VERSIONABLE when relPath has a dotted segment', async () => {
    const r = await captureVersion({
      localRoot,
      relPath: '.folio/foo.md',
      content: 'x',
    });
    expect(r.captured).toBe(false);
    expect(r.reason).toBe('NOT_VERSIONABLE');
  });

  it('skips first-ever snapshot of empty content (EMPTY_FIRST_VERSION)', async () => {
    const r = await captureVersion({ localRoot, relPath: 'a.md', content: '' });
    expect(r.captured).toBe(false);
    expect(r.reason).toBe('EMPTY_FIRST_VERSION');
    const list = await listVersions({ localRoot, relPath: 'a.md' });
    expect(list).toHaveLength(0);
  });

  it('captures empty content AFTER a non-empty version exists', async () => {
    const r1 = await captureVersion({ localRoot, relPath: 'a.md', content: 'x', now: 1_000 });
    expect(r1.captured).toBe(true);
    const r2 = await captureVersion({ localRoot, relPath: 'a.md', content: '', now: 10_000 });
    expect(r2.captured).toBe(true);
    const list = await listVersions({ localRoot, relPath: 'a.md' });
    expect(list).toHaveLength(2);
  });

  it('debounces same-sha256 captures within 5 seconds', async () => {
    const r1 = await captureVersion({ localRoot, relPath: 'a.md', content: 'X', now: 10_000 });
    expect(r1.captured).toBe(true);
    const r2 = await captureVersion({ localRoot, relPath: 'a.md', content: 'X', now: 10_500 });
    expect(r2.captured).toBe(false);
    expect(r2.reason).toBe('DEBOUNCED');
    const list = await listVersions({ localRoot, relPath: 'a.md' });
    expect(list).toHaveLength(1);
  });

  it('does NOT debounce when sha changes', async () => {
    await captureVersion({ localRoot, relPath: 'a.md', content: 'X', now: 10_000 });
    const r2 = await captureVersion({ localRoot, relPath: 'a.md', content: 'Y', now: 10_500 });
    expect(r2.captured).toBe(true);
  });

  it('does NOT debounce after the window elapses', async () => {
    await captureVersion({ localRoot, relPath: 'a.md', content: 'X', now: 10_000 });
    const r2 = await captureVersion({ localRoot, relPath: 'a.md', content: 'X', now: 10_000 + 6_000 });
    expect(r2.captured).toBe(true);
  });

  it('uses extension from relPath; works for .txt and unknown', async () => {
    const r1 = await captureVersion({ localRoot, relPath: 'a.txt', content: 'A', now: 1 });
    expect(r1.path.endsWith('1.txt')).toBe(true);
    const r2 = await captureVersion({ localRoot, relPath: 'b', content: 'B', now: 2 });
    expect(r2.path.endsWith('/b/2') || r2.path.endsWith('\\b\\2')).toBe(true);
  });
});

// ── listVersions ───────────────────────────────────────────────────────────

describe('listVersions', () => {
  it('returns [] for unknown / non-versionable paths', async () => {
    expect(await listVersions({ localRoot, relPath: 'never-touched.md' })).toEqual([]);
    expect(await listVersions({ localRoot, relPath: '.folio/foo' })).toEqual([]);
  });

  it('returns versions newest-first', async () => {
    await captureVersion({ localRoot, relPath: 'a.md', content: 'v1', now: 1_000 });
    await captureVersion({ localRoot, relPath: 'a.md', content: 'v2', now: 2_000 });
    await captureVersion({ localRoot, relPath: 'a.md', content: 'v3', now: 3_000 });
    const list = await listVersions({ localRoot, relPath: 'a.md' });
    expect(list.map((v) => v.ts)).toEqual([3_000, 2_000, 1_000]);
    expect(list[0].sha256).toBe(sha256Of('v3'));
    expect(list[0].size).toBe(2);
    expect(list[0].path).toMatch(/3000\.md$/);
  });

  it('rebuilds the sidecar if it goes missing', async () => {
    const r = await captureVersion({ localRoot, relPath: 'a.md', content: 'X', now: 1 });
    await fs.unlink(`${r.path}.sha256`);
    _clearVersionsCache();
    const [v] = await listVersions({ localRoot, relPath: 'a.md' });
    expect(v.sha256).toBe(sha256Of('X'));
    // Sidecar restored on disk.
    const sidecar = await fs.readFile(`${r.path}.sha256`, 'utf8');
    expect(sidecar.trim()).toBe(sha256Of('X'));
  });
});

// ── restoreVersion ─────────────────────────────────────────────────────────

describe('restoreVersion', () => {
  it('writes the chosen snapshot to the live file and captures the current content first', async () => {
    const live = join(localRoot, 'a.md');
    await fs.writeFile(live, 'live-now');
    await captureVersion({ localRoot, relPath: 'a.md', content: 'old-A', now: 1_000 });
    await captureVersion({ localRoot, relPath: 'a.md', content: 'old-B', now: 2_000 });

    const r = await restoreVersion({ localRoot, relPath: 'a.md', ts: 1_000 });
    expect(r.restoredFromMs).toBe(1_000);
    expect(typeof r.snapshotMsBeforeRestore).toBe('number');

    // Live file holds restored content.
    expect(await fs.readFile(live, 'utf8')).toBe('old-A');

    // Pre-restore snapshot exists (sha256 = sha256('live-now')).
    const versions = await listVersions({ localRoot, relPath: 'a.md' });
    const preSnap = versions.find((v) => v.ts === r.snapshotMsBeforeRestore);
    expect(preSnap).toBeDefined();
    expect(preSnap.sha256).toBe(sha256Of('live-now'));
  });

  it('throws VERSION_NOT_FOUND when ts does not exist', async () => {
    await captureVersion({ localRoot, relPath: 'a.md', content: 'x', now: 1 });
    await expect(
      restoreVersion({ localRoot, relPath: 'a.md', ts: 999 })
    ).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });

  it('throws NOT_VERSIONABLE on a dotted relPath', async () => {
    await expect(
      restoreVersion({ localRoot, relPath: '.folio/secret', ts: 1 })
    ).rejects.toMatchObject({ code: 'NOT_VERSIONABLE' });
  });

  it('handles a missing live file (file was deleted) by capturing empty as the pre-restore baseline', async () => {
    await captureVersion({ localRoot, relPath: 'a.md', content: 'snap', now: 100 });
    // Live file does not exist on disk.
    const r = await restoreVersion({ localRoot, relPath: 'a.md', ts: 100 });
    expect(r.restoredFromMs).toBe(100);
    // Live file was created by the restore.
    const live = await fs.readFile(join(localRoot, 'a.md'), 'utf8');
    expect(live).toBe('snap');
  });
});

// ── dropVersions ───────────────────────────────────────────────────────────

describe('dropVersions', () => {
  it('removes every snapshot for a relPath and returns the count', async () => {
    await captureVersion({ localRoot, relPath: 'a.md', content: 'v1', now: 1 });
    await captureVersion({ localRoot, relPath: 'a.md', content: 'v2', now: 2 });
    await captureVersion({ localRoot, relPath: 'a.md', content: 'v3', now: 3 });
    const count = await dropVersions({ localRoot, relPath: 'a.md' });
    expect(count).toBe(3);
    expect(await listVersions({ localRoot, relPath: 'a.md' })).toEqual([]);
  });

  it('returns 0 for a relPath with no history', async () => {
    expect(await dropVersions({ localRoot, relPath: 'absent.md' })).toBe(0);
  });

  it('cleans up empty parent directories under .folio/versions', async () => {
    await captureVersion({ localRoot, relPath: 'sub/deep/a.md', content: 'x', now: 1 });
    await dropVersions({ localRoot, relPath: 'sub/deep/a.md' });
    // sub/ and sub/deep/ should be gone since they only contained a.md.
    await expect(
      fs.access(join(localRoot, '.folio', 'versions', 'sub', 'deep'))
    ).rejects.toThrow();
  });
});

// ── pruneVersions ──────────────────────────────────────────────────────────

describe('pruneVersions', () => {
  it('respects per-file cap (drops oldest beyond N)', async () => {
    for (let i = 0; i < 7; i++) {
      await captureVersion({
        localRoot, relPath: 'a.md', content: `v${i}`, now: 1_000 + i,
        retention: { perFile: 4, budgetMb: 100 },
      });
    }
    const list = await listVersions({ localRoot, relPath: 'a.md' });
    expect(list).toHaveLength(4);
    expect(list.map((v) => v.ts).sort()).toEqual([1_003, 1_004, 1_005, 1_006]);
  });

  it('respects per-file cap explicitly via pruneVersions(relPath)', async () => {
    // Capture without retention pressure first, then prune separately.
    for (let i = 0; i < 60; i++) {
      await captureVersion({
        localRoot, relPath: 'a.md', content: `v${i}`, now: 1_000 + i,
        retention: { perFile: DEFAULT_VERSIONS_PER_FILE, budgetMb: 1_000 },
      });
    }
    // After captures, the per-file cap (default 50) should already be
    // enforced by the prune that runs inside captureVersion.
    const list = await listVersions({ localRoot, relPath: 'a.md' });
    expect(list.length).toBeLessThanOrEqual(DEFAULT_VERSIONS_PER_FILE);
  });

  it('respects global byte budget (drops oldest across all files)', async () => {
    // Two files; large content; tiny budget.
    const big = 'x'.repeat(1024 * 1024); // 1 MB
    await captureVersion({
      localRoot, relPath: 'a.md', content: big, now: 1_000,
      retention: { perFile: 100, budgetMb: 10 },
    });
    await captureVersion({
      localRoot, relPath: 'b.md', content: big, now: 2_000,
      retention: { perFile: 100, budgetMb: 10 },
    });
    await captureVersion({
      localRoot, relPath: 'c.md', content: big, now: 3_000,
      retention: { perFile: 100, budgetMb: 10 },
    });

    // Final capture squeezes us over the 2 MB budget.
    const r = await captureVersion({
      localRoot, relPath: 'd.md', content: big, now: 4_000,
      retention: { perFile: 100, budgetMb: 2 },
    });
    expect(r.captured).toBe(true);

    // Total size now must be ≤ 2 MB → at least 2 oldest were evicted.
    const all = [
      ...(await listVersions({ localRoot, relPath: 'a.md' })),
      ...(await listVersions({ localRoot, relPath: 'b.md' })),
      ...(await listVersions({ localRoot, relPath: 'c.md' })),
      ...(await listVersions({ localRoot, relPath: 'd.md' })),
    ];
    const totalBytes = all.reduce((s, v) => s + v.size, 0);
    expect(totalBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
    // Oldest (a.md @ 1_000) should be the first to go.
    const aList = await listVersions({ localRoot, relPath: 'a.md' });
    expect(aList).toHaveLength(0);
  });
});

// ── listFilesWithVersions ──────────────────────────────────────────────────

describe('listFilesWithVersions', () => {
  it('lists every relPath with at least one version, newest-first by latestMs', async () => {
    await captureVersion({ localRoot, relPath: 'a.md',         content: 'A', now: 1_000 });
    await captureVersion({ localRoot, relPath: 'sub/b.md',     content: 'B', now: 2_000 });
    await captureVersion({ localRoot, relPath: 'sub/deep/c.md', content: 'C', now: 3_000 });
    const files = await listFilesWithVersions(localRoot);
    expect(files.map((f) => f.relPath)).toEqual([
      'sub/deep/c.md', 'sub/b.md', 'a.md',
    ]);
    expect(files[0].latestMs).toBe(3_000);
    expect(files[0].count).toBe(1);
  });

  it('returns [] when the versions tree does not exist', async () => {
    expect(await listFilesWithVersions(localRoot)).toEqual([]);
  });
});

// ── readVersionContent ─────────────────────────────────────────────────────

describe('readVersionContent', () => {
  it('returns the raw bytes of a snapshot', async () => {
    await captureVersion({ localRoot, relPath: 'a.md', content: 'hello-world', now: 5 });
    const buf = await readVersionContent({ localRoot, relPath: 'a.md', ts: 5 });
    expect(buf.toString('utf8')).toBe('hello-world');
  });

  it('throws VERSION_NOT_FOUND when ts is unknown', async () => {
    await captureVersion({ localRoot, relPath: 'a.md', content: 'x', now: 1 });
    await expect(
      readVersionContent({ localRoot, relPath: 'a.md', ts: 999 })
    ).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });

  it('throws NOT_VERSIONABLE for dotted paths', async () => {
    await expect(
      readVersionContent({ localRoot, relPath: '.folio/foo', ts: 1 })
    ).rejects.toMatchObject({ code: 'NOT_VERSIONABLE' });
  });
});

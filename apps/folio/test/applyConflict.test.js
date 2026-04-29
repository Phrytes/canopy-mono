import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyConflict, hasConflictMarkers } from '../src/applyConflict.js';

let dir;
beforeEach(async () => { dir = await fs.mkdtemp(join(tmpdir(), 'folio-conflict-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('applyConflict', () => {
  it('writes git-style markers in place', async () => {
    const file = join(dir, 'a.md');
    await fs.writeFile(file, 'mine');
    await applyConflict(file, 'mine', 'theirs', {
      localTimestamp:  Date.UTC(2026, 3, 29, 14, 32),
      remoteTimestamp: Date.UTC(2026, 3, 29, 14, 35),
    });
    const out = await fs.readFile(file, 'utf8');
    expect(out).toMatch(/^<<<<<<< YOURS \(local 2026-04-29 14:32 UTC\)/m);
    expect(out).toMatch(/^=======/m);
    expect(out).toMatch(/^>>>>>>> THEIRS \(pod 2026-04-29 14:35 UTC\)/m);
    expect(out).toContain('mine');
    expect(out).toContain('theirs');
    expect(hasConflictMarkers(out)).toBe(true);
  });

  it('creates parent dirs if missing', async () => {
    const file = join(dir, 'sub', 'nested', 'a.md');
    await applyConflict(file, 'L', 'R');
    const out = await fs.readFile(file, 'utf8');
    expect(out).toContain('L');
    expect(out).toContain('R');
  });

  it('is idempotent on already-conflicted files', async () => {
    const file = join(dir, 'a.md');
    await applyConflict(file, 'first', 'second', { localTimestamp: 0, remoteTimestamp: 0 });
    const after1 = await fs.readFile(file, 'utf8');
    // Re-run with different content; existing markers should keep us hands-off.
    await applyConflict(file, 'NEW', 'NEW2', { localTimestamp: 0, remoteTimestamp: 0 });
    const after2 = await fs.readFile(file, 'utf8');
    expect(after2).toBe(after1);
    expect(after2).not.toContain('NEW');
  });

  it('handles missing trailing newlines gracefully', async () => {
    const file = join(dir, 'a.md');
    await applyConflict(file, 'mine', 'theirs');
    const out = await fs.readFile(file, 'utf8');
    // The mid + tail markers must be on their own lines.
    const lines = out.split('\n');
    expect(lines).toContain('=======');
    expect(lines.some((l) => l.startsWith('>>>>>>>'))).toBe(true);
  });

  it('shows "unknown" when timestamps are absent', async () => {
    const file = join(dir, 'a.md');
    await applyConflict(file, 'mine', 'theirs');
    const out = await fs.readFile(file, 'utf8');
    expect(out).toMatch(/local unknown/);
    expect(out).toMatch(/pod unknown/);
  });

  describe('hasConflictMarkers', () => {
    it('returns false for plain user content that mentions <<<<<<<', () => {
      const debugLog = [
        'shell session:',
        '$ git pull',
        'CONFLICT (content): Merge conflict in foo.txt',
        '<<<<<<< HEAD',
        'my line',
        '=======',
        'their line',
        '>>>>>>> origin/main',
        '',
        'tutorial note: a Git conflict marker starts with `<<<<<<<`.',
      ].join('\n');
      expect(hasConflictMarkers(debugLog)).toBe(false);
    });

    it('returns true only for Folio-written conflict signatures', () => {
      const folioConflict =
        '<<<<<<< YOURS (local 2026-04-29 14:32 UTC)\n' +
        'mine\n' +
        '=======\n' +
        'theirs\n' +
        '>>>>>>> THEIRS (pod 2026-04-29 14:35 UTC)\n';
      expect(hasConflictMarkers(folioConflict)).toBe(true);
    });

    it('does not flag a file whose only `<<<<<<<` is git-conflict-shaped', () => {
      // Critically: a file that contains a *git*-style conflict marker
      // (`<<<<<<< HEAD`) but NOT a Folio one must not be flagged.
      const gitConflict =
        '<<<<<<< HEAD\n' +
        'mine\n' +
        '=======\n' +
        'theirs\n' +
        '>>>>>>> origin/main\n';
      expect(hasConflictMarkers(gitConflict)).toBe(false);
    });
  });
});

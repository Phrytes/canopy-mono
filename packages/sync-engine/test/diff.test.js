import { describe, it, expect } from 'vitest';

import { diff } from '../src/diff.js';

function L(relPath, sha = `LSHA(${relPath})`, mtimeMs = 1, size = 1) {
  return { relPath, absPath: `/local/${relPath}`, sha256: sha, mtimeMs, size };
}
function P(relPath, sha = `PSHA(${relPath})`, mtimeMs = 1, size = 1, etag = 'e') {
  return { relPath, podUri: `https://pod/${relPath}`, sha256: sha, mtimeMs, size, etag };
}

describe('diff', () => {
  it('flags pure-local files for upload', () => {
    const out = diff([L('a.md', 's1')], [], {});
    expect(out.toUpload.map((f) => f.relPath)).toEqual(['a.md']);
    expect(out.toDownload).toEqual([]);
    expect(out.conflicts).toEqual([]);
  });

  it('flags pure-pod files for download', () => {
    const out = diff([], [P('a.md', 'r1')], {});
    expect(out.toDownload.map((f) => f.relPath)).toEqual(['a.md']);
    expect(out.toUpload).toEqual([]);
    expect(out.conflicts).toEqual([]);
  });

  it('treats matching content as no-op', () => {
    const out = diff([L('a.md', 'same')], [P('a.md', 'same')], {});
    expect(out.toUpload).toEqual([]);
    expect(out.toDownload).toEqual([]);
    expect(out.conflicts).toEqual([]);
  });

  it('upload when local changed, pod unchanged from common state', () => {
    const out = diff(
      [L('a.md', 'newLocal')],
      [P('a.md', 'commonR')],
      { 'a.md': { sha256: 'commonR', syncedAt: 0 } },
    );
    expect(out.toUpload.map((f) => f.relPath)).toEqual(['a.md']);
    expect(out.conflicts).toEqual([]);
  });

  it('download when pod changed, local unchanged from common state', () => {
    const out = diff(
      [L('a.md', 'commonL')],
      [P('a.md', 'newRemote')],
      { 'a.md': { sha256: 'commonL', syncedAt: 0 } },
    );
    expect(out.toDownload.map((f) => f.relPath)).toEqual(['a.md']);
    expect(out.conflicts).toEqual([]);
  });

  it('conflict when both sides diverge from common state', () => {
    const out = diff(
      [L('a.md', 'localEdit')],
      [P('a.md', 'remoteEdit')],
      { 'a.md': { sha256: 'common', syncedAt: 0 } },
    );
    expect(out.conflicts).toHaveLength(1);
    const c = out.conflicts[0];
    expect(c.relPath).toBe('a.md');
    expect(c.localSha256).toBe('localEdit');
    expect(c.remoteSha256).toBe('remoteEdit');
    expect(c.absPath).toBe('/local/a.md');
    expect(c.podUri).toBe('https://pod/a.md');
  });

  it('conflict when both sides differ and there is no common state', () => {
    const out = diff([L('a.md', 'l')], [P('a.md', 'r')], {});
    expect(out.conflicts).toHaveLength(1);
  });

  it('reports state-only entries as toDelete', () => {
    const out = diff([], [], { 'gone.md': { sha256: 'x', syncedAt: 0 } });
    expect(out.toDelete.map((f) => f.relPath)).toEqual(['gone.md']);
  });

  it('mixed scenario: 1 upload, 1 download, 1 conflict, 1 noop', () => {
    const local = [
      L('add.md',     'addL'),                  // pure-local → upload
      L('keep.md',    'sameSha'),               // matching → noop
      L('conflict.md','localNew'),              // both changed → conflict
      L('remoteEdited.md', 'commonRE'),         // local unchanged from common
    ];
    const pod = [
      P('keep.md',         'sameSha'),
      P('conflict.md',     'remoteNew'),
      P('remoteEdited.md', 'remoteNew'),
      P('newRemote.md',    'rOnly'),            // pure-pod → download
    ];
    const known = {
      'conflict.md':     { sha256: 'common',   syncedAt: 0 },
      'remoteEdited.md': { sha256: 'commonRE', syncedAt: 0 },
      'keep.md':         { sha256: 'sameSha',  syncedAt: 0 },
    };
    const out = diff(local, pod, known);
    expect(out.toUpload.map((f) => f.relPath).sort()).toEqual(['add.md']);
    expect(out.toDownload.map((f) => f.relPath).sort()).toEqual(['newRemote.md', 'remoteEdited.md']);
    expect(out.conflicts.map((f) => f.relPath)).toEqual(['conflict.md']);
  });

  // ── Phase D — tombstone-aware diff (additive opts.isTombstoned) ──────────────

  it('local-only file IS re-uploaded when no isTombstoned predicate is given (unchanged default)', () => {
    const out = diff([L('note.md', 's')], [], { 'note.md': { sha256: 'old', syncedAt: 0 } });
    expect(out.toUpload.map((f) => f.relPath)).toEqual(['note.md']);
    expect(out.toDelete).toEqual([]);
  });

  it('local-only file is dropped (toDelete, not toUpload) when isTombstoned(rel) is true', () => {
    const out = diff(
      [L('note.md', 's')],
      [],
      { 'note.md': { sha256: 'old', syncedAt: 0 } },
      { isTombstoned: (rel) => rel === 'note.md' },
    );
    expect(out.toUpload).toEqual([]);
    expect(out.toDelete.map((f) => f.relPath)).toEqual(['note.md']);
    expect(out.toDelete[0].tombstoned).toBe(true);
  });

  it('isTombstoned only affects local-only files (a tombstoned pod-side file still downloads)', () => {
    const out = diff(
      [],
      [P('note.md', 's')],
      {},
      { isTombstoned: () => true },
    );
    expect(out.toDownload.map((f) => f.relPath)).toEqual(['note.md']);
    expect(out.toDelete).toEqual([]);
  });

  it('isTombstoned is idempotent across runs (no knownState → still dropped, not uploaded)', () => {
    const out = diff(
      [L('note.md', 's')],
      [],
      {},                                            // state already evicted by a prior run
      { isTombstoned: () => true },
    );
    expect(out.toUpload).toEqual([]);
    expect(out.toDelete.map((f) => f.relPath)).toEqual(['note.md']);
  });
});

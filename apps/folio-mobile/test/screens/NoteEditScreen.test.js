/**
 * NoteEditScreen.test.js — `splitConflictText` (ConflictsScreen helper)
 * + SignInScreen normalisation helpers + share-flow guard.
 *
 * The actual editor + screens are React-rendered; we test the pure
 * helpers each screen exports for unit-level coverage.
 */

import { describe, it, expect } from 'vitest';

import {
  splitConflictText,
  hasConflictMarkers,
  CONFLICT_MARKER_OURS as CONFLICT_MARKER,
} from '../../src/lib/conflictText.js';
import { suggestPodRoot, normalizePodRoot } from '../../src/lib/podRootHelpers.js';

describe('splitConflictText', () => {
  it('returns the input verbatim in both halves when no markers', () => {
    const text = 'Hello\nWorld\nNo conflict here.\n';
    const r = splitConflictText(text);
    expect(r.mine).toBe('Hello\nWorld\nNo conflict here.\n');
    expect(r.theirs).toBe('Hello\nWorld\nNo conflict here.\n');
  });

  it('splits a single conflict hunk', () => {
    const text = [
      'shared above',
      '<<<<<<< local',
      'mine line 1',
      'mine line 2',
      '=======',
      'theirs line 1',
      '>>>>>>> remote',
      'shared below',
    ].join('\n');
    const r = splitConflictText(text);
    expect(r.mine).toBe('shared above\nmine line 1\nmine line 2\nshared below');
    expect(r.theirs).toBe('shared above\ntheirs line 1\nshared below');
  });

  it('handles multiple conflict hunks', () => {
    const text = [
      'A',
      '<<<<<<< local',
      'mine-1',
      '=======',
      'theirs-1',
      '>>>>>>> remote',
      'B',
      '<<<<<<< local',
      'mine-2',
      '=======',
      'theirs-2',
      '>>>>>>> remote',
      'C',
    ].join('\n');
    const r = splitConflictText(text);
    expect(r.mine).toBe('A\nmine-1\nB\nmine-2\nC');
    expect(r.theirs).toBe('A\ntheirs-1\nB\ntheirs-2\nC');
  });

  it('handles empty input', () => {
    const r = splitConflictText('');
    expect(r.mine).toBe('');
    expect(r.theirs).toBe('');
  });

  it('exports the CONFLICT_MARKER constant', () => {
    expect(CONFLICT_MARKER).toBe('<<<<<<<');
  });
});

describe('hasConflictMarkers', () => {
  it('false for non-string', () => {
    expect(hasConflictMarkers(null)).toBe(false);
    expect(hasConflictMarkers(undefined)).toBe(false);
  });
  it('false for clean text', () => {
    expect(hasConflictMarkers('hello world')).toBe(false);
  });
  it('true when the marker is present', () => {
    expect(hasConflictMarkers('a\n<<<<<<< local\nb\n')).toBe(true);
  });
});

describe('SignInScreen helpers', () => {
  describe('suggestPodRoot', () => {
    it('returns "" for falsy / non-string input', () => {
      expect(suggestPodRoot(null)).toBe('');
      expect(suggestPodRoot(undefined)).toBe('');
      expect(suggestPodRoot('')).toBe('');
    });

    it('strips path + appends /folio/ for a valid WebID URL', () => {
      expect(suggestPodRoot('https://alice.solidcommunity.net/profile/card#me'))
        .toBe('https://alice.solidcommunity.net/folio/');
    });

    it('returns "" for un-parseable input', () => {
      expect(suggestPodRoot('not-a-url')).toBe('');
    });

    it('handles bare-host WebID', () => {
      expect(suggestPodRoot('https://alice.example/'))
        .toBe('https://alice.example/folio/');
    });
  });

  describe('normalizePodRoot', () => {
    it('returns empty for empty', () => {
      expect(normalizePodRoot('')).toBe('');
      expect(normalizePodRoot(null)).toBe('');
    });
    it('trims surrounding whitespace', () => {
      expect(normalizePodRoot('  https://x.example/folio/  '))
        .toBe('https://x.example/folio/');
    });
    it('adds the https scheme when missing', () => {
      expect(normalizePodRoot('alice.example/folio/'))
        .toBe('https://alice.example/folio/');
    });
    it('preserves the http scheme for local servers', () => {
      expect(normalizePodRoot('http://127.0.0.1:8080/folio'))
        .toBe('http://127.0.0.1:8080/folio/');
    });
    it('adds a trailing slash', () => {
      expect(normalizePodRoot('https://x.example/folio'))
        .toBe('https://x.example/folio/');
    });
  });
});

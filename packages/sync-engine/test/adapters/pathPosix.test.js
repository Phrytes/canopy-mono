/**
 * pathPosix.test.js — pure-string POSIX path helper tests.
 */

import { describe, it, expect } from 'vitest';

import {
  joinPosix,
  dirnamePosix,
  basenamePosix,
  extnamePosix,
} from '../../src/adapters/pathPosix.js';

describe('joinPosix', () => {
  it('joins simple segments with /', () => {
    expect(joinPosix('a', 'b', 'c')).toBe('a/b/c');
  });
  it('preserves a leading slash on the first segment', () => {
    expect(joinPosix('/a', 'b', 'c')).toBe('/a/b/c');
  });
  it('skips empty segments', () => {
    expect(joinPosix('a', '', 'b', null, 'c', undefined)).toBe('a/b/c');
  });
  it('dedupes inner slashes', () => {
    expect(joinPosix('a/', '/b/', '/c')).toBe('a/b/c');
  });
  it('returns the lone slash for "/"', () => {
    expect(joinPosix('/')).toBe('/');
  });
  it('returns "" when called with nothing or only empty/falsy parts', () => {
    expect(joinPosix()).toBe('');
    expect(joinPosix('', null, undefined)).toBe('');
  });
  it('handles a single-segment absolute path', () => {
    expect(joinPosix('/foo')).toBe('/foo');
  });
  it('joins file:// style URIs as opaque strings — internal slashes preserved', () => {
    // First segment is treated opaquely (no leading `/` so no special
    // leading-slash handling); subsequent segments only have their
    // leading/trailing slashes stripped before re-glue.  The triple slash
    // inside `file:///` survives because no part of joinPosix scans it.
    expect(joinPosix('file:///doc/folio', '.folio', 'state.json'))
      .toBe('file:///doc/folio/.folio/state.json');
  });
});

describe('dirnamePosix', () => {
  it('returns the directory of a file path', () => {
    expect(dirnamePosix('a/b/c.md')).toBe('a/b');
  });
  it('preserves a root /', () => {
    expect(dirnamePosix('/a.md')).toBe('/');
    expect(dirnamePosix('/a/b/c.md')).toBe('/a/b');
  });
  it('returns "" for a single segment with no slashes', () => {
    expect(dirnamePosix('a.md')).toBe('');
  });
  it('returns "" for an empty input', () => {
    expect(dirnamePosix('')).toBe('');
  });
  it('strips trailing slashes before computing dirname', () => {
    expect(dirnamePosix('a/b/c/')).toBe('a/b');
  });
});

describe('basenamePosix', () => {
  it('returns the final segment', () => {
    expect(basenamePosix('a/b/c.md')).toBe('c.md');
  });
  it('strips a trailing extension when given', () => {
    expect(basenamePosix('a/b/c.md', '.md')).toBe('c');
  });
  it('returns "" for an empty input', () => {
    expect(basenamePosix('')).toBe('');
  });
  it('handles trailing slashes', () => {
    expect(basenamePosix('a/b/')).toBe('b');
  });
  it('does NOT strip an extension that doesn\'t match', () => {
    expect(basenamePosix('c.md', '.txt')).toBe('c.md');
  });
});

describe('extnamePosix', () => {
  it('returns the extension including the leading dot', () => {
    expect(extnamePosix('a/b/c.md')).toBe('.md');
  });
  it('returns "" when there is no dot', () => {
    expect(extnamePosix('a/b/c')).toBe('');
  });
  it('returns "" for a leading-dot file with no further dot', () => {
    expect(extnamePosix('a/.hidden')).toBe('');
  });
  it('returns the LAST extension on multi-dot names', () => {
    expect(extnamePosix('a/b/c.tar.gz')).toBe('.gz');
  });
  it('returns "" for an empty input', () => {
    expect(extnamePosix('')).toBe('');
  });
});

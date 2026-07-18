/**
 * slashFilter — unit tests for the pure slash-suggest filter
 * (2026-05-24).
 *
 * Mirrors the suggest semantics from
 * apps/basis/web/main.js's `refreshSuggest`.
 */
import { describe, it, expect } from 'vitest';
import { filterSlashSuggestions, DEFAULT_SUGGEST_LIMIT } from '../src/core/slashFilter.js';

/** A tiny fake catalog with enough variety for the matchers below. */
function makeCatalog(commands) {
  return { commandMenu: commands.map((c) => ({ command: c, appOrigin: 'x', opId: c.slice(1) })) };
}

describe('filterSlashSuggestions', () => {
  it('returns [] when input is empty', () => {
    const catalog = makeCatalog(['/post', '/help-with', '/dm']);
    expect(filterSlashSuggestions({ input: '', catalog })).toEqual([]);
  });

  it('returns [] when input has no leading /', () => {
    const catalog = makeCatalog(['/post', '/help-with', '/dm']);
    expect(filterSlashSuggestions({ input: 'post', catalog })).toEqual([]);
    expect(filterSlashSuggestions({ input: 'hello', catalog })).toEqual([]);
  });

  it('returns [] in args mode (after a space)', () => {
    const catalog = makeCatalog(['/post', '/help-with', '/dm']);
    expect(filterSlashSuggestions({ input: '/post ', catalog })).toEqual([]);
    expect(filterSlashSuggestions({ input: '/post hello', catalog })).toEqual([]);
  });

  it('prefix-matches a typed slash', () => {
    const catalog = makeCatalog(['/post', '/help-with', '/dm', '/done']);
    const r = filterSlashSuggestions({ input: '/p', catalog });
    expect(r.map((m) => m.command)).toEqual(['/post']);
  });

  it('lists all matches when input is just /', () => {
    const catalog = makeCatalog(['/post', '/help-with', '/dm']);
    const r = filterSlashSuggestions({ input: '/', catalog });
    expect(r.map((m) => m.command)).toEqual(['/post', '/help-with', '/dm']);
  });

  it('is case-insensitive', () => {
    const catalog = makeCatalog(['/Post', '/PaSt']);
    const r = filterSlashSuggestions({ input: '/p', catalog });
    expect(r).toHaveLength(2);
  });

  it('caps at the default limit', () => {
    const cmds = Array.from({ length: 30 }, (_, i) => `/cmd-${i}`);
    const catalog = makeCatalog(cmds);
    const r = filterSlashSuggestions({ input: '/', catalog });
    expect(r).toHaveLength(DEFAULT_SUGGEST_LIMIT);
  });

  it('honours an explicit limit', () => {
    const cmds = Array.from({ length: 30 }, (_, i) => `/cmd-${i}`);
    const catalog = makeCatalog(cmds);
    expect(filterSlashSuggestions({ input: '/', catalog, limit: 5 })).toHaveLength(5);
    expect(filterSlashSuggestions({ input: '/', catalog, limit: 100 })).toHaveLength(30);
  });

  it('skips malformed commandMenu entries', () => {
    const catalog = { commandMenu: [
      { command: '/ok' },
      { command: 42 },
      null,
      { command: null },
    ] };
    const r = filterSlashSuggestions({ input: '/', catalog });
    expect(r).toHaveLength(1);
    expect(r[0].command).toBe('/ok');
  });

  it('handles missing catalog/commandMenu gracefully', () => {
    expect(filterSlashSuggestions({ input: '/', catalog: {} })).toEqual([]);
    expect(filterSlashSuggestions({ input: '/', catalog: null })).toEqual([]);
  });
});

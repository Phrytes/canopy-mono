/**
 * embedResolve — resolve a cross-object embed ref to a live title (best-effort).
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveEmbedTitle, enrichEmbedsWithTitles } from '../../src/v2/embedResolve.js';

describe('resolveEmbedTitle', () => {
  it('resolves a task via tasks-v0 getTaskSnapshot (with crewId)', async () => {
    const callSkill = vi.fn(async () => ({ id: 'T2', title: 'Fix the gate' }));
    const title = await resolveEmbedTitle({ callSkill, embed: { type: 'task', ref: 'urn:dec:item:T2' }, crewId: 'c-1' });
    expect(title).toBe('Fix the gate');
    // tries the verbatim ref first; passes crewId through
    expect(callSkill).toHaveBeenCalledWith('tasks-v0', 'getTaskSnapshot', { id: 'urn:dec:item:T2', crewId: 'c-1' });
  });

  it('falls back to the local-id tail when the verbatim ref misses', async () => {
    const callSkill = vi.fn(async (_app, _op, args) =>
      args.id === 'T2' ? { title: 'Tail hit' } : { error: 'not found' });
    const title = await resolveEmbedTitle({ callSkill, embed: { type: 'task', ref: 'urn:dec:item:T2' }, crewId: 'c-1' });
    expect(title).toBe('Tail hit');
    expect(callSkill).toHaveBeenCalledTimes(2);
  });

  it('resolves a calendar-event via getEventSnapshot (no crewId needed)', async () => {
    const callSkill = vi.fn(async () => ({ title: 'Lunch' }));
    const title = await resolveEmbedTitle({ callSkill, embed: { type: 'calendar-event', ref: 'evt-1' } });
    expect(title).toBe('Lunch');
    expect(callSkill).toHaveBeenCalledWith('calendar', 'getEventSnapshot', { id: 'evt-1' });
  });

  it('returns null for unknown types and on error/throw', async () => {
    const ok = vi.fn(async () => ({ title: 'x' }));
    expect(await resolveEmbedTitle({ callSkill: ok, embed: { type: 'note', ref: 'n' } })).toBeNull();         // unknown type
    const err = vi.fn(async () => ({ error: 'nope' }));
    expect(await resolveEmbedTitle({ callSkill: err, embed: { type: 'task', ref: 'T2' }, crewId: 'c' })).toBeNull();
    const thrower = vi.fn(async () => { throw new Error('boom'); });
    expect(await resolveEmbedTitle({ callSkill: thrower, embed: { type: 'task', ref: 'T2' }, crewId: 'c' })).toBeNull();
  });
});

describe('resolveEmbedTitle — cross-pod HTTP refs', () => {
  const POD_REF = 'https://alice.pod/items/X.json';

  it('fetches a public cross-pod task ref and extracts .text', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ text: 'Fix the gate' }) }));
    const title = await resolveEmbedTitle({
      embed: { type: 'task', ref: POD_REF }, fetchImpl,
    });
    expect(title).toBe('Fix the gate');
    expect(fetchImpl).toHaveBeenCalledWith(POD_REF, { headers: { Accept: 'application/json' } });
  });

  it('extracts a folio-note frontmatter.title', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ frontmatter: { title: 'Welcome' } }) }));
    const title = await resolveEmbedTitle({ embed: { type: 'note', ref: POD_REF }, fetchImpl });
    expect(title).toBe('Welcome');
  });

  it('honours the title-extraction priority (.text wins over .title)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ text: 'a', title: 'b', name: 'c' }) }));
    expect(await resolveEmbedTitle({ embed: { type: 'task', ref: POD_REF }, fetchImpl })).toBe('a');
  });

  it('reads a nested source.title when top-level fields are absent', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ source: { title: 'Nested' } }) }));
    expect(await resolveEmbedTitle({ embed: { type: 'task', ref: POD_REF }, fetchImpl })).toBe('Nested');
  });

  it('returns null on a 403 (ACP-protected) — chip keeps its ref', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403 }));
    expect(await resolveEmbedTitle({ embed: { type: 'task', ref: POD_REF }, fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('returns null on a network throw', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    expect(await resolveEmbedTitle({ embed: { type: 'task', ref: POD_REF }, fetchImpl })).toBeNull();
  });

  it('returns null on bad JSON without throwing', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => { throw new Error('not json'); } }));
    expect(await resolveEmbedTitle({ embed: { type: 'task', ref: POD_REF }, fetchImpl })).toBeNull();
  });

  it('returns null (no throw) when no fetch is available', async () => {
    // fetchImpl explicitly undefined AND globalThis.fetch removed so nothing real is hit.
    const orig = globalThis.fetch;
    // eslint-disable-next-line no-global-assign
    globalThis.fetch = undefined;
    try {
      const title = await resolveEmbedTitle({ embed: { type: 'task', ref: POD_REF }, fetchImpl: undefined });
      expect(title).toBeNull();
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('enrichEmbedsWithTitles threads fetchImpl to cross-pod embeds', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ title: 'Remote' }) }));
    const out = await enrichEmbedsWithTitles({
      embeds: [{ type: 'task', ref: POD_REF }], fetchImpl,
    });
    expect(out[0]).toEqual({ type: 'task', ref: POD_REF, title: 'Remote' });
  });
});

describe('enrichEmbedsWithTitles', () => {
  it('attaches title to resolvable embeds, leaves others unchanged', async () => {
    const callSkill = vi.fn(async (app) => app === 'calendar' ? { title: 'Lunch' } : { error: 'no' });
    const out = await enrichEmbedsWithTitles({
      callSkill,
      embeds: [{ type: 'calendar-event', ref: 'evt-1' }, { type: 'note', ref: 'n' }],
    });
    expect(out[0]).toEqual({ type: 'calendar-event', ref: 'evt-1', title: 'Lunch' });
    expect(out[1]).toEqual({ type: 'note', ref: 'n' });   // untouched
  });

  it('passes an empty/blank list straight through', async () => {
    expect(await enrichEmbedsWithTitles({ callSkill: vi.fn(), embeds: [] })).toEqual([]);
    expect(await enrichEmbedsWithTitles({ callSkill: vi.fn(), embeds: null })).toEqual([]);
  });
});

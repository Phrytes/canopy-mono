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

  it('returns null for unknown types, cross-pod refs, and on error/throw', async () => {
    const ok = vi.fn(async () => ({ title: 'x' }));
    expect(await resolveEmbedTitle({ callSkill: ok, embed: { type: 'note', ref: 'n' } })).toBeNull();         // unknown type
    expect(await resolveEmbedTitle({ callSkill: ok, embed: { type: 'task', ref: 'https://p/x.json' } })).toBeNull();  // cross-pod
    const err = vi.fn(async () => ({ error: 'nope' }));
    expect(await resolveEmbedTitle({ callSkill: err, embed: { type: 'task', ref: 'T2' }, crewId: 'c' })).toBeNull();
    const thrower = vi.fn(async () => { throw new Error('boom'); });
    expect(await resolveEmbedTitle({ callSkill: thrower, embed: { type: 'task', ref: 'T2' }, crewId: 'c' })).toBeNull();
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

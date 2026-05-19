/**
 * Audience model — unit tests.
 *
 * Coverage:
 *   - normalizeAudience: every string short-hand + every structured
 *     form, + rejected invalid inputs.
 *   - resolveAudience: every kind, with ctx supplying me /
 *     householdMembers / roleMembers / getCircle.  union flattening +
 *     public-absorbs-union.  Missing circle = empty set (not throw).
 *   - inAudience: positive + negative + public-everyone.
 *   - The crew:ID ↔ circle:ID alias resolves to identical normalized
 *     forms (the documented circle.id ≡ task.crewId aliasing).
 */

import { describe, it, expect } from 'vitest';

import {
  PUBLIC,
  normalizeAudience,
  resolveAudience,
  inAudience,
} from '../src/audience.js';

describe('normalizeAudience', () => {
  it("'public' → {kind:'public'}", () => {
    expect(normalizeAudience('public')).toEqual({ kind: 'public' });
  });

  it("'private' and 'me' both → {kind:'me'}", () => {
    expect(normalizeAudience('private')).toEqual({ kind: 'me' });
    expect(normalizeAudience('me')).toEqual({ kind: 'me' });
  });

  it("'household' → {kind:'household'}", () => {
    expect(normalizeAudience('household')).toEqual({ kind: 'household' });
  });

  it("'role:NAME' → {kind:'role', name}", () => {
    expect(normalizeAudience('role:admin')).toEqual({ kind: 'role', name: 'admin' });
  });

  it("'crew:ID' and 'circle:ID' both → {kind:'circle-ref', id}  (the documented alias)", () => {
    expect(normalizeAudience('crew:abc-123')).toEqual({ kind: 'circle-ref', id: 'abc-123' });
    expect(normalizeAudience('circle:abc-123')).toEqual({ kind: 'circle-ref', id: 'abc-123' });
    // The whole point of the alias: identical normalized form.
    expect(normalizeAudience('crew:abc-123')).toEqual(normalizeAudience('circle:abc-123'));
  });

  it('structured {kind:set, members} → defensive copy', () => {
    const src = { kind: 'set', members: ['alice', 'bob'] };
    const got = normalizeAudience(src);
    expect(got).toEqual(src);
    expect(got.members).not.toBe(src.members);
  });

  it("structured {kind:'union', of:[…]} normalises every branch recursively", () => {
    const got = normalizeAudience({
      kind: 'union',
      of: ['household', 'circle:c1', { kind: 'set', members: ['x'] }],
    });
    expect(got).toEqual({
      kind: 'union',
      of: [
        { kind: 'household' },
        { kind: 'circle-ref', id: 'c1' },
        { kind: 'set',        members: ['x'] },
      ],
    });
  });

  it.each([
    ['',         /unknown audience short-hand/],
    ['nope',     /unknown audience short-hand/],
    ['role:',    /empty role name/],
    ['crew:',    /empty id/],
    ['circle:',  /empty id/],
  ])('rejects %j', (input, re) => {
    expect(() => normalizeAudience(input)).toThrow(re);
  });

  it("rejects {kind:'set'} without members[]", () => {
    expect(() => normalizeAudience({ kind: 'set' })).toThrow(/members/);
  });

  it("rejects {kind:'circle-ref'} without id", () => {
    expect(() => normalizeAudience({ kind: 'circle-ref' })).toThrow(/non-empty id/);
  });

  it('rejects unknown kind', () => {
    expect(() => normalizeAudience({ kind: 'whatever' })).toThrow(/unknown kind/);
  });

  it('rejects non-string/non-object input', () => {
    expect(() => normalizeAudience(42)).toThrow(/string or object/);
    expect(() => normalizeAudience(null)).toThrow(/string or object/);
  });
});

describe('resolveAudience', () => {
  it("'public' → PUBLIC sentinel", async () => {
    expect(await resolveAudience('public', {})).toBe(PUBLIC);
  });

  it("'me' / 'private' → {ctx.me}", async () => {
    const r1 = await resolveAudience('me',      { me: 'alice' });
    const r2 = await resolveAudience('private', { me: 'alice' });
    expect([...r1]).toEqual(['alice']);
    expect([...r2]).toEqual(['alice']);
  });

  it("'me' with no ctx.me → empty set (not throw)", async () => {
    const r = await resolveAudience('me', {});
    expect(r.size).toBe(0);
  });

  it("'household' → ctx.householdMembers", async () => {
    const r = await resolveAudience('household', { householdMembers: ['a', 'b'] });
    expect([...r].sort()).toEqual(['a', 'b']);
  });

  it("'role:NAME' → ctx.roleMembers[NAME]", async () => {
    const r = await resolveAudience('role:admin', {
      roleMembers: { admin: ['root', 'op'], coordinator: ['c'] },
    });
    expect([...r].sort()).toEqual(['op', 'root']);
  });

  it("'role:NAME' with no roleMembers → empty set", async () => {
    const r = await resolveAudience('role:admin', {});
    expect(r.size).toBe(0);
  });

  it("'set' → its members", async () => {
    const r = await resolveAudience({ kind: 'set', members: ['x', 'y'] }, {});
    expect([...r].sort()).toEqual(['x', 'y']);
  });

  it("'circle-ref' → members from ctx.getCircle(id)", async () => {
    const ctx = {
      getCircle: async (id) =>
        id === 'gardening' ? { id, members: ['a', 'b'] } : null,
    };
    const r = await resolveAudience('circle:gardening', ctx);
    expect([...r].sort()).toEqual(['a', 'b']);
  });

  it("'circle-ref' with missing circle → empty set (not throw)", async () => {
    const ctx = { getCircle: async () => null };
    const r = await resolveAudience('circle:gone', ctx);
    expect(r.size).toBe(0);
  });

  it("'circle-ref' without ctx.getCircle → throws", async () => {
    await expect(resolveAudience('circle:any', {})).rejects.toThrow(/requires ctx.getCircle/);
  });

  it("'union' flattens distinct members", async () => {
    const r = await resolveAudience(
      { kind: 'union', of: [{ kind: 'set', members: ['a', 'b'] }, { kind: 'set', members: ['b', 'c'] }] },
      {},
    );
    expect([...r].sort()).toEqual(['a', 'b', 'c']);
  });

  it("'union' with a 'public' branch absorbs → PUBLIC", async () => {
    const r = await resolveAudience(
      { kind: 'union', of: ['household', 'public'] },
      { householdMembers: ['a'] },
    );
    expect(r).toBe(PUBLIC);
  });

  it('crew:ID and circle:ID resolve identically (alias)', async () => {
    const ctx = {
      getCircle: async (id) => (id === 'g' ? { id, members: ['x', 'y'] } : null),
    };
    const r1 = await resolveAudience('crew:g',   ctx);
    const r2 = await resolveAudience('circle:g', ctx);
    expect([...r1].sort()).toEqual([...r2].sort());
  });
});

describe('inAudience', () => {
  it('public → everyone is in', async () => {
    expect(await inAudience('anyone', 'public', {})).toBe(true);
  });

  it('positive set match', async () => {
    expect(await inAudience('alice', { kind: 'set', members: ['alice', 'bob'] }, {})).toBe(true);
  });

  it('negative set match', async () => {
    expect(await inAudience('eve', { kind: 'set', members: ['alice', 'bob'] }, {})).toBe(false);
  });

  it('circle-ref via ctx.getCircle', async () => {
    const ctx = { getCircle: async () => ({ members: ['alice'] }) };
    expect(await inAudience('alice', 'circle:g', ctx)).toBe(true);
    expect(await inAudience('bob',   'circle:g', ctx)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { VIEWER_KINDS, viewAsDirectory } from '../../src/v2/circleViewAs.js';

const members = [
  { id: 'me',    handle: 'Owl',   realName: 'Frits',  reveals: ['bob'] },
  { id: 'bob',   handle: 'Fox',   realName: 'Bob',    reveals: ['me'] },
  { id: 'carol', handle: 'Heron', realName: 'Carol',  reveals: [] },
];

describe('viewAsDirectory', () => {
  it('open policy: a member viewer sees every real name', () => {
    const rows = viewAsDirectory({ members, viewer: { id: 'me', kind: 'member' }, policy: 'open' });
    expect(rows.map((r) => r.displayName)).toEqual(['Frits', 'Bob', 'Carol']);
    expect(rows.every((r) => r.revealed)).toBe(true);
  });

  it('pairwise: a member sees only self + members who revealed to them', () => {
    const rows = viewAsDirectory({ members, viewer: { id: 'me', kind: 'member' }, policy: 'pairwise' });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.me.displayName).toBe('Frits');   // self
    expect(byId.me.self).toBe(true);
    expect(byId.bob.displayName).toBe('Bob');    // bob revealed to me
    expect(byId.bob.revealed).toBe(true);
    expect(byId.carol.displayName).toBe('Heron'); // carol didn't → handle
    expect(byId.carol.revealed).toBe(false);
  });

  it('stranger sees only handles, even under open policy', () => {
    const rows = viewAsDirectory({ members, viewer: { kind: 'stranger' }, policy: 'open' });
    expect(rows.map((r) => r.displayName)).toEqual(['Owl', 'Fox', 'Heron']);
    expect(rows.every((r) => !r.revealed)).toBe(true);
  });

  it('agent sees only handles (openness is member-to-member)', () => {
    const rows = viewAsDirectory({ members, viewer: { id: 'some-agent', kind: 'agent' }, policy: 'open' });
    expect(rows.map((r) => r.displayName)).toEqual(['Owl', 'Fox', 'Heron']);
  });

  it('falls back to handle then id when a name is missing', () => {
    const rows = viewAsDirectory({
      members: [{ id: 'x' }, { id: 'y', handle: 'Jay' }],
      viewer: { kind: 'stranger' },
      policy: 'pairwise',
    });
    expect(rows[0].displayName).toBe('x');   // no handle, no realName → id
    expect(rows[1].displayName).toBe('Jay');
  });

  it('unknown viewer kind defaults to member; tolerates empty/missing input', () => {
    expect(VIEWER_KINDS).toEqual(['member', 'stranger', 'agent']);
    expect(viewAsDirectory()).toEqual([]);
    const rows = viewAsDirectory({ members, viewer: { id: 'me', kind: 'bogus' }, policy: 'open' });
    expect(rows.every((r) => r.revealed)).toBe(true); // treated as member viewer
  });
});

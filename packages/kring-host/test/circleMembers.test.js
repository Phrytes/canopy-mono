import { describe, it, expect } from 'vitest';
import { normalizeCircleMembers, circleMemberCount } from '../src/circleMembers.js';

describe('normalizeCircleMembers', () => {
  it('maps the raw stoop skill shape { members: [{ webid, handle, displayName }] }', () => {
    const out = normalizeCircleMembers({
      groupId: 'g1',
      members: [
        { webid: 'did:anne', handle: '@anne', displayName: 'Anne de Vries', role: 'admin' },
        { webid: 'did:bob', handle: '@bob', displayName: null },
      ],
    });
    expect(out).toEqual([
      { id: 'did:anne', handle: '@anne', realName: 'Anne de Vries', reveals: [] },
      { id: 'did:bob', handle: '@bob', realName: null, reveals: [] },
    ]);
  });

  it('maps the chat-reshaped shape { items: [{ id, webid, label, handle }] }', () => {
    const out = normalizeCircleMembers({
      items: [
        { id: 'did:anne', webid: 'did:anne', label: 'Anne de Vries', handle: '@anne', role: 'member' },
        { id: 'did:carol', webid: 'did:carol', label: '@carol', handle: '@carol' }, // label == handle → no real name
      ],
    });
    expect(out[0]).toEqual({ id: 'did:anne', handle: '@anne', realName: 'Anne de Vries', reveals: [] });
    expect(out[1]).toEqual({ id: 'did:carol', handle: '@carol', realName: null, reveals: [] });
  });

  it('carries through a pairwise reveals array when present', () => {
    const out = normalizeCircleMembers({ members: [{ webid: 'did:anne', reveals: ['did:bob'] }] });
    expect(out[0].reveals).toEqual(['did:bob']);
  });

  it('tolerates an empty / nullish / malformed result', () => {
    expect(normalizeCircleMembers(null)).toEqual([]);
    expect(normalizeCircleMembers({})).toEqual([]);
    expect(normalizeCircleMembers({ members: [null, 42, { webid: null }] })).toEqual([]);
  });

  it('accepts a bare array of members too', () => {
    expect(normalizeCircleMembers([{ webid: 'x', handle: '@x' }])).toHaveLength(1);
  });

  it('circleMemberCount counts normalised members', () => {
    expect(circleMemberCount({ members: [{ webid: 'a' }, { webid: 'b' }, { webid: null }] })).toBe(2);
    expect(circleMemberCount(null)).toBe(0);
  });
});

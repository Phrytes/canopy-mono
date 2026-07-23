// LEDEN-tab card projections (§2) — thin projectors over the built reveal machinery.
// These assert the member-persona + self-view splits re-run the SAME openness rules
// `isVisibleTo`/`splitViewAsAttributes` already own, so no visibility logic drifts here.
import { describe, it, expect } from 'vitest';
import { personaAttributes, memberPersonaView, selfViewSplit } from '../../src/v2/memberCards.js';

// A small roster (same shape `normalizeCircleMembers` emits): id + handle + realName + reveals.
const me    = { id: 'me',    handle: 'Owl',   realName: 'Frits', reveals: ['bob'] };   // I revealed to bob
const bob   = { id: 'bob',   handle: 'Fox',   realName: 'Bob',   reveals: ['me'] };    // bob revealed to me
const carol = { id: 'carol', handle: 'Heron', realName: 'Carol', reveals: [] };        // carol revealed to no one

describe('personaAttributes', () => {
  it('projects the roster pair the reveal ladder covers: handle (public) + realName (pairwise)', () => {
    const attrs = personaAttributes(bob);
    expect(attrs.map((a) => [a.key, a.openness])).toEqual([['handle', 'public'], ['realName', 'pairwise']]);
    expect(attrs[0].value).toBe('@Fox');
    expect(attrs[1].value).toBe('Bob');
    // labels ride as locale keys (invariant 8), never baked strings.
    expect(attrs.every((a) => a.labelKey.startsWith('circle.memberCard.attr.'))).toBe(true);
  });

  it('omits the handle attribute when the member has none (realName still projected)', () => {
    const attrs = personaAttributes({ id: 'x', handle: null, realName: 'Nomen' });
    expect(attrs.map((a) => a.key)).toEqual(['realName']);
  });
});

describe('memberPersonaView — what I see of a member', () => {
  it('pairwise: I see the real name of a member who revealed to me, only the handle of one who did not', () => {
    const seenBob = memberPersonaView({ member: bob, viewerWebid: 'me', policy: 'pairwise' });
    // bob revealed to me → realName visible.
    expect(seenBob.sees.map((a) => a.key).sort()).toEqual(['handle', 'realName']);
    expect(seenBob.hides).toHaveLength(0);
    expect(seenBob.counts.visible).toBe(2);

    const seenCarol = memberPersonaView({ member: carol, viewerWebid: 'me', policy: 'pairwise' });
    // carol did NOT reveal to me → only the handle is visible.
    expect(seenCarol.sees.map((a) => a.key)).toEqual(['handle']);
    expect(seenCarol.hides.map((a) => a.key)).toEqual(['realName']);
    expect(seenCarol.counts).toMatchObject({ visible: 1, hidden: 1, total: 2 });
  });

  it("open policy: I see every member's real name without a pairwise reveal", () => {
    const seen = memberPersonaView({ member: carol, viewerWebid: 'me', policy: 'open' });
    expect(seen.hides).toHaveLength(0);
    expect(seen.sees.map((a) => a.key).sort()).toEqual(['handle', 'realName']);
  });
});

describe('selfViewSplit — how a chosen viewer sees me', () => {
  it('a stranger sees only my handle (real name never clears pairwise for a non-member)', () => {
    const split = selfViewSplit({ me, viewer: { kind: 'stranger' }, policy: 'open' });
    expect(split.sees.map((a) => a.key)).toEqual(['handle']);
    expect(split.hides.map((a) => a.key)).toEqual(['realName']);
  });

  it('an agent sees only my handle', () => {
    const split = selfViewSplit({ me, viewer: { kind: 'agent', id: 'a1' }, policy: 'open' });
    expect(split.sees.map((a) => a.key)).toEqual(['handle']);
    expect(split.hides.map((a) => a.key)).toEqual(['realName']);
  });

  it('pairwise: a member I revealed to sees my real name; one I did not sees only the handle', () => {
    const toBob = selfViewSplit({ me, viewer: { kind: 'member', id: 'bob' }, policy: 'pairwise' });
    expect(toBob.sees.map((a) => a.key).sort()).toEqual(['handle', 'realName']);

    const toCarol = selfViewSplit({ me, viewer: { kind: 'member', id: 'carol' }, policy: 'pairwise' });
    expect(toCarol.sees.map((a) => a.key)).toEqual(['handle']);
    expect(toCarol.hides.map((a) => a.key)).toEqual(['realName']);
  });

  it('open policy: any member viewer sees my real name', () => {
    const toCarol = selfViewSplit({ me, viewer: { kind: 'member', id: 'carol' }, policy: 'open' });
    expect(toCarol.sees.map((a) => a.key).sort()).toEqual(['handle', 'realName']);
  });
});

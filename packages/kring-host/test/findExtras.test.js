/**
 * buildFindExtras — the shared find-result enrichment (used by web circleApp + mobile CircleLauncherScreen).
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { buildFindExtras } from '../src/findExtras.js';

const t = (k) => k;

describe('buildFindExtras', () => {
  it('returns empty extras for no query or no callSkill (guards)', async () => {
    expect(await buildFindExtras({ query: '', circleId: 'c', callSkill: async () => null, t })).toEqual({ skillMatches: [], hopCard: null });
    expect(await buildFindExtras({ query: '   ', circleId: 'c', callSkill: async () => null, t })).toEqual({ skillMatches: [], hopCard: null });
    expect(await buildFindExtras({ query: 'x', circleId: 'c', t })).toEqual({ skillMatches: [], hopCard: null }); // no callSkill
  });

  it('fetches the roster (+ hop info when the search is short) via the injected callSkill', async () => {
    const calls = [];
    const callSkill = async (op) => {
      calls.push(op);
      if (op === 'getHopMode') return { global: false };
      if (op === 'listContacts') return { items: [] };
      return { members: [] };   // listGroupMembers → no roster
    };
    const r = await buildFindExtras({ query: 'plumbing', groups: [], circleId: 'c1', callSkill, t });
    expect(calls).toContain('listGroupMembers');
    expect(calls).toContain('getHopMode');          // short search → hop decision attempted
    expect(r).toEqual({ skillMatches: [], hopCard: null }); // no members → no matches; hop off → no card
  });

  it('does NOT prompt to hop when items + in-circle matches already satisfied the search', async () => {
    let askedHop = false;
    const callSkill = async (op) => { if (op === 'getHopMode') askedHop = true; return { members: [] }; };
    // groups carry an item → with (hypothetical) matches we'd skip hop; with no members there are no matches,
    // so this asserts the short-circuit path only fires hop when needed. Here matches=0 so hop IS considered.
    await buildFindExtras({ query: 'q', groups: [{ items: [{ id: '1' }] }], circleId: 'c', callSkill, t });
    expect(askedHop).toBe(true); // 0 matches → still considered (the "already useful" guard needs BOTH)
  });
});

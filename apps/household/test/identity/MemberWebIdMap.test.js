/**
 * MemberWebIdMap.test.js — Phase 2 Stream 2d.
 *
 * Locks the bridgeUid → webid lookup the agent uses on every incoming
 * message + the reverse + member-by-webid convenience.
 */
import { describe, it, expect } from 'vitest';

import { MemberWebIdMap } from '../../src/identity/MemberWebIdMap.js';

/**
 * @returns {import('../../src/types.js').HouseholdConfig}
 */
function mkConfig() {
  return {
    name:       'De Roos Family',
    groupKeyId: 'gk-1',
    botWebid:   'https://bot.example.com/profile/card#me',
    members: [
      {
        webid:       'https://id.inrupt.com/frits',
        displayName: 'the author',
        role:        'admin',
        podRoot:     'https://pod.example.com/frits/',
        bridges: {
          telegram: { bridgeUid: '1234567', handle: '@frits' },
          signal:   { bridgeUid: '+31600000001' },
        },
      },
      {
        webid:       'https://id.inrupt.com/anne',
        displayName: 'Anne',
        role:        'member',
        podRoot:     'https://pod.example.com/anne/',
        bridges: {
          telegram: { bridgeUid: '7654321', handle: '@anne' },
        },
      },
      {
        webid:       'https://id.inrupt.com/guest',
        displayName: 'Guest',
        role:        'guest',
        podRoot:     null,
        // no bridges yet — lookups against this member should miss
      },
    ],
  };
}

describe('MemberWebIdMap', () => {
  it('throws when constructed without a config', () => {
    // @ts-expect-error testing the runtime guard
    expect(() => new MemberWebIdMap(undefined)).toThrow();
    // @ts-expect-error testing the runtime guard
    expect(() => new MemberWebIdMap(null)).toThrow();
  });

  // ── resolve ────────────────────────────────────────────────────────────

  it("resolve('telegram', '1234567') returns the author's webid", () => {
    const map = new MemberWebIdMap(mkConfig());
    expect(map.resolve('telegram', '1234567')).toBe('https://id.inrupt.com/frits');
  });

  it('resolve works across bridges (signal looks up by phone-style bridgeUid)', () => {
    const map = new MemberWebIdMap(mkConfig());
    expect(map.resolve('signal', '+31600000001')).toBe('https://id.inrupt.com/frits');
  });

  it('resolve returns null for an unknown bridgeUid', () => {
    const map = new MemberWebIdMap(mkConfig());
    expect(map.resolve('telegram', '0000000')).toBeNull();
  });

  it('resolve returns null for an unknown bridgeId', () => {
    const map = new MemberWebIdMap(mkConfig());
    expect(map.resolve('matrix', '1234567')).toBeNull();
  });

  it('resolve returns null when bridgeUid types differ but stringify equal', () => {
    // Defensive: bridgeUid is a string per types.js; numbers should
    // still match (we compare via String()).
    const map = new MemberWebIdMap(mkConfig());
    // @ts-expect-error testing string-coercion against a numeric input
    expect(map.resolve('telegram', 1234567)).toBe('https://id.inrupt.com/frits');
  });

  it('resolve tolerates members with no bridges map (guest member)', () => {
    const map = new MemberWebIdMap(mkConfig());
    // The guest has no bridges; no lookup should ever surface them
    expect(map.resolve('telegram', 'whatever')).toBeNull();
  });

  // ── bindingFor ─────────────────────────────────────────────────────────

  it('bindingFor round-trips with resolve', () => {
    const map = new MemberWebIdMap(mkConfig());
    const webid = map.resolve('telegram', '1234567');
    expect(webid).not.toBeNull();
    const binding = map.bindingFor(/** @type {string} */ (webid), 'telegram');
    expect(binding).toEqual({ bridgeUid: '1234567', handle: '@frits' });
  });

  it('bindingFor returns null for an unknown webid', () => {
    const map = new MemberWebIdMap(mkConfig());
    expect(map.bindingFor('https://id.inrupt.com/nobody', 'telegram')).toBeNull();
  });

  it("bindingFor returns null when the member isn't bound on that bridge", () => {
    const map = new MemberWebIdMap(mkConfig());
    // Anne has no signal binding.
    expect(map.bindingFor('https://id.inrupt.com/anne', 'signal')).toBeNull();
    // Guest has no bridges at all.
    expect(map.bindingFor('https://id.inrupt.com/guest', 'telegram')).toBeNull();
  });

  // ── member ─────────────────────────────────────────────────────────────

  it('member(webid) returns the full MemberConfig including role + podRoot', () => {
    const map = new MemberWebIdMap(mkConfig());
    const m = map.member('https://id.inrupt.com/frits');
    expect(m).toMatchObject({
      webid:       'https://id.inrupt.com/frits',
      displayName: 'the author',
      role:        'admin',
      podRoot:     'https://pod.example.com/frits/',
    });
  });

  it('member(webid) returns null for an unknown webid', () => {
    const map = new MemberWebIdMap(mkConfig());
    expect(map.member('https://id.inrupt.com/nobody')).toBeNull();
  });

  it('member(webid) handles guests with podRoot === null', () => {
    const map = new MemberWebIdMap(mkConfig());
    const guest = map.member('https://id.inrupt.com/guest');
    expect(guest?.role).toBe('guest');
    expect(guest?.podRoot).toBeNull();
  });

  // ── empty / degenerate configs ─────────────────────────────────────────

  it('handles a config with no members array', () => {
    // @ts-expect-error testing degenerate input shape
    const map = new MemberWebIdMap({ name: 'empty' });
    expect(map.resolve('telegram', '123')).toBeNull();
    expect(map.member('any')).toBeNull();
    expect(map.bindingFor('any', 'telegram')).toBeNull();
  });
});

/**
 * effectiveActor — pubKey ↔ webid resolution against the crew's
 * roles map + alias map.
 *
 * Phase 41.18 follow-up (2026-05-10).
 *
 * Pinned cases:
 *   - direct webid match (desktop's HTTP path, LocalUiAuth-injected)
 *   - pubKey match via alias map (mobile's React path)
 *   - relay-forwarded call resolves via `envelope._origin`
 *   - unknown actor → null
 *   - alias whose webid isn't in roles → null (defensive)
 */

import { describe, it, expect } from 'vitest';
import {
  resolveActorWebid,
  resolveActorRole,
  buildActorAliases,
} from '../../src/ui/effectiveActor.js';

const ANNE_WEBID  = 'webid://anne';
const ANNE_PUBKEY = 'pk-anne-aabbcc';
const BOB_WEBID   = 'webid://bob';
const BOB_PUBKEY  = 'pk-bob-deadbeef';

const CREW = {
  roles: { [ANNE_WEBID]: 'admin', [BOB_WEBID]: 'member' },
  actorAliases: { [ANNE_PUBKEY]: ANNE_WEBID, [BOB_PUBKEY]: BOB_WEBID },
};

describe('resolveActorWebid', () => {
  it('returns the from value when it directly matches a roles key', () => {
    expect(resolveActorWebid({ from: ANNE_WEBID, crewState: CREW })).toBe(ANNE_WEBID);
  });

  it('resolves a pubKey through the alias map', () => {
    expect(resolveActorWebid({ from: ANNE_PUBKEY, crewState: CREW })).toBe(ANNE_WEBID);
    expect(resolveActorWebid({ from: BOB_PUBKEY,  crewState: CREW })).toBe(BOB_WEBID);
  });

  it('falls through to envelope._origin on relay-forwarded calls', () => {
    expect(resolveActorWebid({
      from: 'pk-relay',
      envelope: { _origin: ANNE_WEBID },
      crewState: CREW,
    })).toBe(ANNE_WEBID);

    // Origin is a pubKey → resolve via aliases too.
    expect(resolveActorWebid({
      from: 'pk-relay',
      envelope: { _origin: BOB_PUBKEY },
      crewState: CREW,
    })).toBe(BOB_WEBID);
  });

  it('unknown actor returns null', () => {
    expect(resolveActorWebid({ from: 'unknown', crewState: CREW })).toBeNull();
    expect(resolveActorWebid({ from: null,      crewState: CREW })).toBeNull();
  });

  it('alias entry whose webid isn\'t in roles returns null (defensive)', () => {
    const stale = {
      roles: {},
      actorAliases: { [ANNE_PUBKEY]: ANNE_WEBID }, // webid removed from roles
    };
    expect(resolveActorWebid({ from: ANNE_PUBKEY, crewState: stale })).toBeNull();
  });

  it('no crewState → returns from unchanged', () => {
    expect(resolveActorWebid({ from: ANNE_WEBID })).toBe(ANNE_WEBID);
  });
});

describe('resolveActorRole', () => {
  it('looks up role through the alias map', () => {
    expect(resolveActorRole({ from: ANNE_WEBID,  crewState: CREW })).toBe('admin');
    expect(resolveActorRole({ from: ANNE_PUBKEY, crewState: CREW })).toBe('admin');
    expect(resolveActorRole({ from: BOB_PUBKEY,  crewState: CREW })).toBe('member');
  });

  it('returns null for unknown actors', () => {
    expect(resolveActorRole({ from: 'unknown', crewState: CREW })).toBeNull();
    expect(resolveActorRole({ from: ANNE_WEBID, crewState: null })).toBeNull();
  });
});

describe('buildActorAliases', () => {
  it('builds pubKey → webid pairs, dropping members without both', () => {
    const aliases = buildActorAliases([
      { webid: ANNE_WEBID, pubKey: ANNE_PUBKEY, role: 'admin' },
      { webid: BOB_WEBID,  pubKey: BOB_PUBKEY,  role: 'member' },
      { webid: 'webid://chris',  /* no pubKey */ role: 'observer' },
      { /* no webid */    pubKey: 'pk-orphan' },
      { webid: 'same',    pubKey: 'same' }, // identical; skip (no aliasing needed)
    ]);
    expect(aliases).toEqual({
      [ANNE_PUBKEY]: ANNE_WEBID,
      [BOB_PUBKEY]:  BOB_WEBID,
    });
  });

  it('empty input → empty map', () => {
    expect(buildActorAliases([])).toEqual({});
    expect(buildActorAliases()).toEqual({});
  });
});

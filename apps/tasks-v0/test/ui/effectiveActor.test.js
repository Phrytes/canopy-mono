/**
 * effectiveActor — pubKey ↔ webid resolution against the circle's
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
  buildActorResolverFromMembers,
} from '../../src/ui/effectiveActor.js';

const ANNE_WEBID  = 'webid://anne';
const ANNE_PUBKEY = 'pk-anne-aabbcc';
const BOB_WEBID   = 'webid://bob';
const BOB_PUBKEY  = 'pk-bob-deadbeef';

const CIRCLE = {
  roles: { [ANNE_WEBID]: 'admin', [BOB_WEBID]: 'member' },
  actorAliases: { [ANNE_PUBKEY]: ANNE_WEBID, [BOB_PUBKEY]: BOB_WEBID },
};

describe('resolveActorWebid', () => {
  it('returns the from value when it directly matches a roles key', () => {
    expect(resolveActorWebid({ from: ANNE_WEBID, circleState: CIRCLE })).toBe(ANNE_WEBID);
  });

  it('resolves a pubKey through the alias map', () => {
    expect(resolveActorWebid({ from: ANNE_PUBKEY, circleState: CIRCLE })).toBe(ANNE_WEBID);
    expect(resolveActorWebid({ from: BOB_PUBKEY,  circleState: CIRCLE })).toBe(BOB_WEBID);
  });

  it('falls through to envelope._origin on relay-forwarded calls', () => {
    expect(resolveActorWebid({
      from: 'pk-relay',
      envelope: { _origin: ANNE_WEBID },
      circleState: CIRCLE,
    })).toBe(ANNE_WEBID);

    // Origin is a pubKey → resolve via aliases too.
    expect(resolveActorWebid({
      from: 'pk-relay',
      envelope: { _origin: BOB_PUBKEY },
      circleState: CIRCLE,
    })).toBe(BOB_WEBID);
  });

  it('unknown actor returns null', () => {
    expect(resolveActorWebid({ from: 'unknown', circleState: CIRCLE })).toBeNull();
    expect(resolveActorWebid({ from: null,      circleState: CIRCLE })).toBeNull();
  });

  it('alias entry whose webid isn\'t in roles returns null (defensive)', () => {
    const stale = {
      roles: {},
      actorAliases: { [ANNE_PUBKEY]: ANNE_WEBID }, // webid removed from roles
    };
    expect(resolveActorWebid({ from: ANNE_PUBKEY, circleState: stale })).toBeNull();
  });

  it('no circleState → returns from unchanged', () => {
    expect(resolveActorWebid({ from: ANNE_WEBID })).toBe(ANNE_WEBID);
  });
});

describe('resolveActorRole', () => {
  it('looks up role through the alias map', () => {
    expect(resolveActorRole({ from: ANNE_WEBID,  circleState: CIRCLE })).toBe('admin');
    expect(resolveActorRole({ from: ANNE_PUBKEY, circleState: CIRCLE })).toBe('admin');
    expect(resolveActorRole({ from: BOB_PUBKEY,  circleState: CIRCLE })).toBe('member');
  });

  it('returns null for unknown actors', () => {
    expect(resolveActorRole({ from: 'unknown', circleState: CIRCLE })).toBeNull();
    expect(resolveActorRole({ from: ANNE_WEBID, circleState: null })).toBeNull();
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

describe('buildActorResolverFromMembers (Phase 52.11)', () => {
  it('resolves by webid (identity lookup)', () => {
    const r = buildActorResolverFromMembers([
      { webid: ANNE_WEBID, pubKey: ANNE_PUBKEY, role: 'admin' },
    ]);
    expect(r.resolveSync(ANNE_WEBID)).toEqual({ webid: ANNE_WEBID });
  });

  it('resolves by pubKey', () => {
    const r = buildActorResolverFromMembers([
      { webid: ANNE_WEBID, pubKey: ANNE_PUBKEY, role: 'admin' },
      { webid: BOB_WEBID,  pubKey: BOB_PUBKEY,  role: 'member' },
    ]);
    expect(r.resolveSync(ANNE_PUBKEY)).toEqual({ webid: ANNE_WEBID });
    expect(r.resolveSync(BOB_PUBKEY)).toEqual({ webid: BOB_WEBID });
  });

  it('resolves by agentUri when present', () => {
    const r = buildActorResolverFromMembers([
      {
        webid:    ANNE_WEBID,
        pubKey:   ANNE_PUBKEY,
        agentUri: 'agent://anne/laptop',
      },
    ]);
    expect(r.resolveSync('agent://anne/laptop')).toEqual({ webid: ANNE_WEBID });
  });

  it('returns null for unknown identifiers + bad input', () => {
    const r = buildActorResolverFromMembers([
      { webid: ANNE_WEBID, pubKey: ANNE_PUBKEY },
    ]);
    expect(r.resolveSync('webid://unknown')).toBe(null);
    expect(r.resolveSync('')).toBe(null);
    expect(r.resolveSync(null)).toBe(null);
    expect(r.resolveSync(undefined)).toBe(null);
  });

  it('skips members without a webid (no useful resolution)', () => {
    const r = buildActorResolverFromMembers([
      { pubKey: 'pk-orphan' },              // no webid
      { webid: ANNE_WEBID, pubKey: ANNE_PUBKEY },
    ]);
    expect(r.resolveSync('pk-orphan')).toBe(null);
    expect(r.resolveSync(ANNE_PUBKEY)).toEqual({ webid: ANNE_WEBID });
  });

  it('empty input → resolver that always misses', () => {
    const r = buildActorResolverFromMembers([]);
    expect(r.resolveSync('anything')).toBe(null);
  });

  it('integrates with buildStandardRolePolicy: pubKey actor → role gates pass', async () => {
    // End-to-end: simulate mobile's dispatch where `from = agent.pubKey`.
    const { buildStandardRolePolicy } = await import('../../src/rolePolicy.js');
    const resolver = buildActorResolverFromMembers([
      { webid: ANNE_WEBID, pubKey: ANNE_PUBKEY },
      { webid: BOB_WEBID,  pubKey: BOB_PUBKEY },
    ]);
    const policy = buildStandardRolePolicy(
      { [ANNE_WEBID]: 'admin', [BOB_WEBID]: 'observer' },
      { actorResolver: resolver },
    );
    expect(policy.canClaim(ANNE_PUBKEY, {})).toBe(true);
    expect(policy.canClaim(BOB_PUBKEY, {})).toBe(false);    // observer
    expect(policy.canRemove(ANNE_PUBKEY, {})).toBe(true);   // admin
  });
});

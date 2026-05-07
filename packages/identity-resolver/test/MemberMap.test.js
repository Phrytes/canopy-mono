/**
 * MemberMap unit tests.
 *
 * NOTE — 2026-05-07: this file was accidentally truncated to 0 bytes
 * during a sed-driven Dutch→English status enum migration.  The
 * stubs below are placeholders covering the headline behaviours the
 * file used to test; rebuild the rest from `MemberMap`'s public API
 * (`addMember`, `resolveByWebid`, `resolveByStableId`,
 * `resolveByExternalId`, `removeMember`, `list`, `fromPodConfig`)
 * + the per-field defaults in `#normalise`.
 */

import { describe, it, expect } from 'vitest';
import { MemberMap } from '../src/MemberMap.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';

describe('MemberMap — basic CRUD', () => {
  it('addMember + resolveByWebid round-trip', async () => {
    const m = new MemberMap();
    await m.addMember({ webid: ANNE, handle: 'anne-23' });
    const found = await m.resolveByWebid(ANNE);
    expect(found.webid).toBe(ANNE);
    expect(found.handle).toBe('anne-23');
  });

  it('resolveByWebid returns null for unknown webid', async () => {
    const m = new MemberMap();
    expect(await m.resolveByWebid('https://nope.example/x')).toBeNull();
  });

  it('addMember is upsert-shaped (second call merges)', async () => {
    const m = new MemberMap();
    await m.addMember({ webid: ANNE, handle: 'anne' });
    await m.addMember({ webid: ANNE, displayName: 'Anne van Dijk' });
    const found = await m.resolveByWebid(ANNE);
    expect(found.handle).toBe('anne');
    expect(found.displayName).toBe('Anne van Dijk');
  });

  it('removeMember drops the entry', async () => {
    const m = new MemberMap();
    await m.addMember({ webid: ANNE });
    await m.removeMember(ANNE);
    expect(await m.resolveByWebid(ANNE)).toBeNull();
  });

  it('list returns all members', async () => {
    const m = new MemberMap();
    await m.addMember({ webid: ANNE });
    await m.addMember({ webid: BOB });
    const all = await m.list();
    expect(all).toHaveLength(2);
  });
});

describe('MemberMap — skill status enum (V2.5 migration)', () => {
  it('default status is the V2.5 English value "active"', async () => {
    const m = new MemberMap();
    await m.addMember({ webid: ANNE, skills: [{ categoryId: 'klusjes' }] });
    const found = await m.resolveByWebid(ANNE);
    expect(found.skills[0].status).toBe('active');
  });

  it('legacy Dutch values are translated on read (back-compat)', async () => {
    const m = new MemberMap();
    await m.addMember({
      webid: ANNE,
      skills: [
        { categoryId: 'a', status: 'actief' },
        { categoryId: 'b', status: 'gepauzeerd' },
        { categoryId: 'c', status: 'gearchiveerd' },
      ],
    });
    const found = await m.resolveByWebid(ANNE);
    expect(found.skills.map(s => s.status))
      .toEqual(['active', 'paused', 'archived']);
  });
});

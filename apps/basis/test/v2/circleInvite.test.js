/**
 * v2 circle invite/join glue — reuses the classic membership core. Verifies the issue side
 * (build a stoop-invite:// URI from the current code) round-trips into the join side (decode +
 * run the shared finalSubmit chain), with callSkill mocked at the stoop-skill boundary.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildCircleInviteUri, joinCircleFromInvite } from '../../src/v2/circleInvite.js';

describe('buildCircleInviteUri', () => {
  it('reads the current code and encodes a stoop-invite:// URI with the admin address', async () => {
    const callSkill = vi.fn(async (app, op) =>
      (op === 'getCurrentMembershipCode' ? { code: 'OPEN-SESAME', expiresAt: 123 } : {}));
    const r = await buildCircleInviteUri({ callSkill, circleId: 'circle-1', adminPeerAddr: 'addr-admin' });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'getCurrentMembershipCode', { groupId: 'circle-1' });
    expect(r.uri).toMatch(/^stoop-invite:\/\//);
  });

  it('B2 — carries BOTH addresses (pubKey adminPeerAddr + NKN adminNknAddr) when known; omits nkn otherwise', async () => {
    const callSkill = vi.fn(async (app, op) =>
      (op === 'getCurrentMembershipCode' ? { code: 'C', expiresAt: 1 } : {}));
    const decode = (uri) => JSON.parse(Buffer.from(
      uri.replace(/^stoop-invite:\/\//, '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    const both = await buildCircleInviteUri({ callSkill, circleId: 'c', adminPeerAddr: 'PUBKEY', adminNknAddr: 'nkn-addr' });
    const d = decode(both.uri);
    expect(d.adminPeerAddr).toBe('PUBKEY');
    expect(d.adminNknAddr).toBe('nkn-addr');
    // relay-only admin (no NKN up) → the nkn field is simply absent (older-invite shape).
    const relayOnly = await buildCircleInviteUri({ callSkill, circleId: 'c', adminPeerAddr: 'PUBKEY' });
    expect('adminNknAddr' in decode(relayOnly.uri)).toBe(false);
  });

  it('admin-only is terminal (does not try to mint); missing args rejected', async () => {
    const callSkill = vi.fn(async () => ({ error: 'admin-only' }));
    expect(await buildCircleInviteUri({ callSkill, circleId: 'c' })).toEqual({ error: 'admin-only' });
    expect(callSkill).toHaveBeenCalledTimes(1);   // no rotate attempt
    expect(await buildCircleInviteUri({})).toEqual({ error: 'missing-args' });
  });

  it('B/S4 — embeds the freedom template (capabilities + apps) when passed, so the joiner can opt out', async () => {
    const callSkill = vi.fn(async (app, op) =>
      (op === 'getCurrentMembershipCode' ? { code: 'C', expiresAt: 1 } : {}));
    const capabilities = { 'tasks complete task': { freedom: 'optional' } };
    const r = await buildCircleInviteUri({ callSkill, circleId: 'c', capabilities, apps: ['tasks'] });
    // decode the payload back out of the stoop-invite:// URI
    const b64 = r.uri.replace(/^stoop-invite:\/\//, '');
    const decoded = JSON.parse(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    expect(decoded.capabilities).toEqual(capabilities);
    expect(decoded.apps).toEqual(['tasks']);
  });

  it('B/S4 — omits the template when there is none (invite unchanged for un-configured circles)', async () => {
    const callSkill = vi.fn(async (app, op) =>
      (op === 'getCurrentMembershipCode' ? { code: 'C', expiresAt: 1 } : {}));
    const r = await buildCircleInviteUri({ callSkill, circleId: 'c', capabilities: {}, apps: [] });
    const b64 = r.uri.replace(/^stoop-invite:\/\//, '');
    const decoded = JSON.parse(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    expect('capabilities' in decoded).toBe(false);
    expect('apps' in decoded).toBe(false);
  });

  it('fold-in C/Q3 — embeds offeringsMatching: true when passed; omits it otherwise (older-invite shape)', async () => {
    const callSkill = vi.fn(async (app, op) =>
      (op === 'getCurrentMembershipCode' ? { code: 'C', expiresAt: 1 } : {}));
    const decode = (uri) => JSON.parse(Buffer.from(
      uri.replace(/^stoop-invite:\/\//, '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    const on = await buildCircleInviteUri({ callSkill, circleId: 'c', offeringsMatching: true });
    expect(decode(on.uri).offeringsMatching).toBe(true);
    const off = await buildCircleInviteUri({ callSkill, circleId: 'c', offeringsMatching: false });
    expect('offeringsMatching' in decode(off.uri)).toBe(false);
    const absent = await buildCircleInviteUri({ callSkill, circleId: 'c' });
    expect('offeringsMatching' in decode(absent.uri)).toBe(false);
  });

  it('mints a fresh code (rotateMyGroupCode) when there is no active one', async () => {
    const callSkill = vi.fn(async (app, op) => {
      if (op === 'getCurrentMembershipCode') return { error: 'no-code' };
      if (op === 'rotateMyGroupCode') return { codeId: 'x', code: 'FRESH-CODE', expiresAt: 42 };
      return {};
    });
    const r = await buildCircleInviteUri({ callSkill, circleId: 'c', adminPeerAddr: 'a' });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'rotateMyGroupCode', { groupId: 'c' });
    expect(r.uri).toMatch(/^stoop-invite:\/\//);
  });
});

describe('joinCircleFromInvite', () => {
  it('round-trips a built invite → local redeem → joined', async () => {
    const issuer = vi.fn(async (app, op) =>
      (op === 'getCurrentMembershipCode' ? { code: 'CODE-9', expiresAt: 9 } : {}));
    const { uri } = await buildCircleInviteUri({ callSkill: issuer, circleId: 'kaas', adminPeerAddr: 'a' });

    // joiner side — local redeemMembershipCode succeeds (has the code), no peer fallback needed.
    const joinSkill = vi.fn(async (app, op) => {
      if (op === 'setMyHandle') return { ok: true };
      if (op === 'redeemMembershipCode') return { ok: true };
      return {};
    });
    const r = await joinCircleFromInvite({ inviteUri: uri, callSkill: joinSkill, handle: 'frits' });
    expect(r.ok).toBe(true);
    expect(r.circleId).toBe('kaas');
    expect(joinSkill).toHaveBeenCalledWith('stoop', 'redeemMembershipCode', expect.objectContaining({ groupId: 'kaas', code: 'CODE-9' }));
  });

  it('requires a handle and rejects a bad invite', async () => {
    const callSkill = vi.fn();
    expect(await joinCircleFromInvite({ inviteUri: 'stoop-invite://x', callSkill, handle: '' })).toEqual({ error: 'handle-required' });
    const bad = await joinCircleFromInvite({ inviteUri: 'not-an-invite', callSkill, handle: 'me' });
    expect(bad.error).toBeTruthy();
    expect(callSkill).not.toHaveBeenCalled();
  });
});

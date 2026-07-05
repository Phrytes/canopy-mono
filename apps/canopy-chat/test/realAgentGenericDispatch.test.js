/**
 * canopy-chat — real-Agent generic-capability dispatch (§1b sub-slice 1d).
 *
 * Proves the callSkill waist decodes a SYNTHETIC generic op-id
 * (`__generic__:app:atom:noun`) and routes it to the household capability
 * entry (`householdService.callCapability`) — "declare a noun → get CRUD
 * free". The household manifest declares an op-LESS `note` noun; a generic
 * add/list op-id therefore operates it with zero handler code.
 *
 * Mirrors the setup of realAgent.test.js (the real @canopy/core Agent over
 * the InternalTransport bus), constructed with `householdViaCircleStore:true`
 * so the per-circle CircleItemStore capability service exists.
 */
import { describe, it, expect } from 'vitest';
import { encodeGenericOpId } from '@canopy/app-manifest';

import { createRealHouseholdAgent } from '../src/web/realAgent.js';

describe('createRealHouseholdAgent — §1b 1d generic op-id dispatch at callSkill', () => {
  it('flag ON: a generic add:note op-id stores a note; a subsequent list:note returns it', async () => {
    const a = await createRealHouseholdAgent({ householdViaCircleStore: true });

    const addOp = encodeGenericOpId('household', 'add', 'note');
    const added = await a.callSkill('household', addOp, { circleId: 'c1', body: 'buy stamps' });
    // dispatchCapability wraps the generic path: {ok, via:'generic', atom, result}.
    expect(added.ok).toBe(true);
    expect(added.via).toBe('generic');
    expect(added.atom).toBe('add');
    expect(added.result.ok).toBe(true);
    expect(added.result.item.type).toBe('note');
    expect(added.result.item.body).toBe('buy stamps');
    expect(added.result.item.id).toBeTruthy();

    const listed = await a.callSkill('household', '__generic__:household:list:note', { circleId: 'c1' });
    expect(listed.ok).toBe(true);
    expect(listed.via).toBe('generic');
    expect(listed.result.items.map((i) => i.body)).toContain('buy stamps');
    expect(listed.result.items.every((i) => i.type === 'note')).toBe(true);
  });

  it('regression: a non-generic (bespoke) household op still routes normally via callSkill', async () => {
    const a = await createRealHouseholdAgent({ householdViaCircleStore: true });
    await a.callSkill('household', 'addItem', { circleId: 'c1', type: 'shopping', text: 'milk' });
    const open = await a.callSkill('household', 'listOpen', { circleId: 'c1', type: 'shopping' });
    expect(open.items.map((i) => i.label)).toContain('milk');
  });

  it('flag OFF (no householdService): a generic op-id returns a structured error, not a throw', async () => {
    const a = await createRealHouseholdAgent();   // default: householdViaCircleStore off
    const addOp = encodeGenericOpId('household', 'add', 'note');
    const r = await a.callSkill('household', addOp, { circleId: 'c1', body: 'buy stamps' });
    expect(r).toEqual({ ok: false, error: 'generic-capability-unavailable' });
  });
});

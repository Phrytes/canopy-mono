/**
 * Household app over the circle store (cluster L · L3) — the FAITHFUL dissolve: household's real ops + model
 * (typed lists shopping/errand/repair/schedule + tasks, completedAt, match-by-text), only the store changed.
 * Exercised through createHouseholdService's callSkill, per circle.
 */
import { describe, it, expect } from 'vitest';
import { createHouseholdService, householdRegistry } from '../src/v2/householdApp.js';

const ctx = (circleId, by = 'webid:alice') => ({ circleId, by });

describe('household app over the circle store (L3 faithful dissolve)', () => {
  it('typed lists: addItem → listOpen → markComplete (by match) → removed from open', async () => {
    const svc = createHouseholdService();
    const c = ctx('c1');
    await svc.callSkill('addItem', { type: 'shopping', text: 'milk' }, c);
    await svc.callSkill('addItem', { type: 'shopping', text: 'bread' }, c);
    await svc.callSkill('addItem', { type: 'errand', text: 'post office' }, c);

    expect((await svc.callSkill('listOpen', { type: 'shopping' }, c)).map((i) => i.text).sort()).toEqual(['bread', 'milk']);
    expect((await svc.callSkill('listOpen', { type: 'errand' }, c)).map((i) => i.text)).toEqual(['post office']);

    const done = await svc.callSkill('markComplete', { match: 'milk' }, c);
    expect(done.ok).toBe(true);
    expect(done.item.completedAt).toBeGreaterThan(0);
    expect((await svc.callSkill('listOpen', { type: 'shopping' }, c)).map((i) => i.text)).toEqual(['bread']);  // milk gone from open
  });

  it('tasks: addTask validates against the CANONICAL task type, listTasks, claim assigns the caller', async () => {
    const svc = createHouseholdService();
    const c = ctx('c1', 'webid:bob');
    const t = await svc.callSkill('addTask', { text: 'fix the fence' }, c);
    expect(t.type).toBe('task');
    expect(t.createdBy).toBe('webid:bob');               // store-stamped base metadata (canonical-required)
    expect(t.createdAt).toMatch(/\d{4}-\d{2}-\d{2}T/);   // ISO timestamp

    expect((await svc.callSkill('listTasks', {}, c)).map((i) => i.text)).toEqual(['fix the fence']);
    const claimed = await svc.callSkill('claim', { match: 'fence' }, c);
    expect(claimed.item.assignee).toBe('webid:bob');
  });

  it('removeItem by match; reassign a task', async () => {
    const svc = createHouseholdService();
    const c = ctx('c1');
    await svc.callSkill('addItem', { type: 'repair', text: 'leaky tap' }, c);
    expect((await svc.callSkill('removeItem', { match: 'leaky' }, c)).ok).toBe(true);
    expect(await svc.callSkill('listOpen', { type: 'repair' }, c)).toEqual([]);

    await svc.callSkill('addTask', { text: 'mow lawn' }, c);
    const r = await svc.callSkill('reassign', { match: 'mow', assignee: 'webid:carol' }, c);
    expect(r.item.assignee).toBe('webid:carol');
  });

  it('per-circle isolation + not-found + the registry rejects an unregistered list type', async () => {
    const svc = createHouseholdService();
    await svc.callSkill('addItem', { type: 'shopping', text: 'in A' }, ctx('A'));
    expect(await svc.callSkill('listOpen', { type: 'shopping' }, ctx('B'))).toEqual([]);   // isolated
    expect((await svc.callSkill('markComplete', { match: 'nope' }, ctx('A'))).ok).toBe(false);
    // 'bogus' isn't a registered type → store validation rejects
    await expect(svc.callSkill('addItem', { type: 'bogus', text: 'x' }, ctx('A'))).rejects.toThrow(/invalid "bogus"/);
  });

  it('householdRegistry registers the 4 list types (+ canonical task available)', async () => {
    const reg = householdRegistry();
    expect(reg.validate({ type: 'shopping', text: 'x', id: '1', createdAt: '2026-01-01T00:00:00Z', createdBy: 'a' }).ok).toBe(true);
    expect(reg.validate({ type: 'errand',   text: 'x', id: '1', createdAt: '2026-01-01T00:00:00Z', createdBy: 'a' }).ok).toBe(true);
  });
});

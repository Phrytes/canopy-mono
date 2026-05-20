/**
 * V0.2 — `fetchSectionItems` helper.
 *
 * Honours Q7 (`section.dataSource`) when declared; falls back to Q6
 * rule-b default (`listOpen({type, ...filter})`) otherwise.
 */

import { describe, it, expect, vi } from 'vitest';

import { fetchSectionItems } from '../src/fetchSectionItems.js';

describe('fetchSectionItems — contract', () => {
  it('rejects missing section', async () => {
    await expect(fetchSectionItems(null, { callSkill: vi.fn() }))
      .rejects.toThrow(/section.*required/);
  });

  it('rejects missing callSkill', async () => {
    await expect(fetchSectionItems({ itemType: 'task' }, {}))
      .rejects.toThrow(/callSkill.*required/);
  });
});

describe('fetchSectionItems — Q7 view.dataSource (explicit)', () => {
  it('calls section.dataSource.skillId with section.dataSource.args', async () => {
    const callSkill = vi.fn().mockResolvedValue({ items: ['x'] });
    const section = {
      id: 'mine', itemType: 'task',
      dataSource: { skillId: 'listMine', args: { open: true } },
    };
    const reply = await fetchSectionItems(section, { callSkill });
    expect(callSkill).toHaveBeenCalledWith('listMine', { open: true });
    expect(reply).toEqual({ items: ['x'] });
  });

  it('args defaults to {} when dataSource has no args', async () => {
    const callSkill = vi.fn().mockResolvedValue([]);
    const section = {
      id: 'lend', itemType: 'lend',
      dataSource: { skillId: 'listLends' },
    };
    await fetchSectionItems(section, { callSkill });
    expect(callSkill).toHaveBeenCalledWith('listLends', {});
  });

  it("dataSource without a skillId field falls back to default (defensive)", async () => {
    const callSkill = vi.fn().mockResolvedValue([]);
    const section = {
      id: 'x', itemType: 'task',
      dataSource: { args: { unused: true } },   // malformed — no skillId
    };
    await fetchSectionItems(section, { callSkill });
    // Falls back to default listOpen with {type: 'task'}.
    expect(callSkill).toHaveBeenCalledWith('listOpen', { type: 'task' });
  });
});

describe('fetchSectionItems — fallback Q6 rule-b (no dataSource)', () => {
  it('calls listOpen with {type: section.itemType}', async () => {
    const callSkill = vi.fn().mockResolvedValue([]);
    const section = { id: 'shopping', itemType: 'shopping' };
    await fetchSectionItems(section, { callSkill });
    expect(callSkill).toHaveBeenCalledWith('listOpen', { type: 'shopping' });
  });

  it("merges section.filter into the listOpen args", async () => {
    const callSkill = vi.fn().mockResolvedValue([]);
    const section = {
      id: 'tasks',
      itemType: 'task',
      filter: { open: true, assignee: null },
    };
    await fetchSectionItems(section, { callSkill });
    expect(callSkill).toHaveBeenCalledWith('listOpen', {
      type: 'task', open: true, assignee: null,
    });
  });

  it('omits type when itemType is undefined (defensive)', async () => {
    const callSkill = vi.fn().mockResolvedValue([]);
    const section = { id: 'all' };
    await fetchSectionItems(section, { callSkill });
    expect(callSkill).toHaveBeenCalledWith('listOpen', {});
  });

  it('honours defaultListSkill override', async () => {
    const callSkill = vi.fn().mockResolvedValue([]);
    const section = { id: 'tasks', itemType: 'task' };
    await fetchSectionItems(section, { callSkill, defaultListSkill: 'listAllOpen' });
    expect(callSkill).toHaveBeenCalledWith('listAllOpen', { type: 'task' });
  });
});

describe('fetchSectionItems — return shape', () => {
  it('returns the skill reply verbatim (no normalisation)', async () => {
    const replies = [
      ['a', 'b'],                          // bare array
      { items: ['x'] },                    // {items}
      { tasks: ['t1'] },                   // {tasks}
      { replies: [], stateUpdates: [] },   // chat-shape
    ];
    for (const r of replies) {
      const callSkill = vi.fn().mockResolvedValue(r);
      const got = await fetchSectionItems(
        { id: 'x', itemType: 'task', dataSource: { skillId: 'list' } },
        { callSkill },
      );
      expect(got).toBe(r);
    }
  });
});

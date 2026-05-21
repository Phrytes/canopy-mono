/**
 * canopy-chat — manifestMerge tests.  v0.1 sub-slice 1.5.
 *
 * Verifies the merged catalog has the right commandMenu entries,
 * opsById map, replyShapeFor lookup, and collision warnings.
 */
import { describe, it, expect } from 'vitest';

import { mergeManifests } from '../src/manifestMerge.js';

const householdLite = {
  app:       'household',
  itemTypes: ['chore'],
  operations: [
    {
      id:       'markComplete', verb: 'complete', params: [],
      surfaces: { slash: { command: '/done' }, chat: { hint: 'mark a chore complete', reply: 'text' } },
    },
    {
      id:       'listOpen', verb: 'list', params: [],
      surfaces: { slash: { command: '/mine' }, chat: { hint: 'list open chores', reply: 'list' } },
    },
  ],
  views: [{ id: 'tasks', title: 'Chores', type: 'chore' }],
};

const tasksLite = {
  app:       'tasks',
  itemTypes: ['task'],
  operations: [
    {
      id:       'addTask', verb: 'add', params: [],
      surfaces: { slash: { command: '/addtask' }, chat: { hint: 'add a task' } },
    },
  ],
  views: [{ id: 'open', title: 'Open', type: 'task' }],
};

describe('mergeManifests — basic shape', () => {
  it('returns a catalog with commandMenu + opsById + replyShapeFor + appOrigins', () => {
    const cat = mergeManifests([
      { manifest: householdLite },
      { manifest: tasksLite },
    ]);
    expect(cat.appOrigins).toEqual(['household', 'tasks']);
    expect(cat.warnings).toEqual([]);

    // commandMenu carries 3 entries (household × 2 + tasks × 1).
    expect(cat.commandMenu.length).toBe(3);
    const byCmd = Object.fromEntries(cat.commandMenu.map((e) => [e.command, e]));
    expect(byCmd['/done']).toEqual({
      command: '/done', opId: 'markComplete', appOrigin: 'household',
    });
    expect(byCmd['/mine']).toEqual({
      command: '/mine', opId: 'listOpen', appOrigin: 'household',
    });
    expect(byCmd['/addtask']).toEqual({
      command: '/addtask', opId: 'addTask', appOrigin: 'tasks',
    });

    // opsById carries every operation.
    expect(cat.opsById.get('markComplete').appOrigin).toBe('household');
    expect(cat.opsById.get('listOpen').appOrigin).toBe('household');
    expect(cat.opsById.get('addTask').appOrigin).toBe('tasks');
  });

  it('replyShapeFor returns declared Q28 shapes; undefined when absent', () => {
    const cat = mergeManifests([
      { manifest: householdLite },
      { manifest: tasksLite },
    ]);
    expect(cat.replyShapeFor('markComplete')).toBe('text');
    expect(cat.replyShapeFor('listOpen')).toBe('list');
    expect(cat.replyShapeFor('addTask')).toBeUndefined();   // not declared
    expect(cat.replyShapeFor('nonexistent')).toBeUndefined();
  });
});

describe('mergeManifests — empty / minimal cases', () => {
  it('empty source array → empty catalog', () => {
    const cat = mergeManifests([]);
    expect(cat.commandMenu).toEqual([]);
    expect(cat.opsById.size).toBe(0);
    expect(cat.appOrigins).toEqual([]);
    expect(cat.warnings).toEqual([]);
  });

  it('single-app source → single-app catalog', () => {
    const cat = mergeManifests([{ manifest: tasksLite }]);
    expect(cat.appOrigins).toEqual(['tasks']);
    expect(cat.commandMenu).toEqual([
      { command: '/addtask', opId: 'addTask', appOrigin: 'tasks' },
    ]);
  });
});

describe('mergeManifests — error handling', () => {
  it('throws on invalid manifests (forward-fail)', () => {
    expect(() => mergeManifests([{ manifest: { /* no app id */ } }]))
      .toThrow(/invalid manifest/);
  });

  it('throws on non-array sources', () => {
    expect(() => mergeManifests('not-an-array')).toThrow(/must be an array/);
  });

  it('warns + skips entries missing the manifest field', () => {
    const cat = mergeManifests([
      { manifest: tasksLite },
      { callSkill: () => null },     // no manifest
    ]);
    expect(cat.appOrigins).toEqual(['tasks']);
    expect(cat.warnings.length).toBe(1);
    expect(cat.warnings[0]).toMatch(/skipping/);
  });
});

describe('mergeManifests — collision handling (v0.1 flat-only)', () => {
  it('warns on slash collision but keeps the first declarer', () => {
    const competing = {
      app:       'compet',
      itemTypes: ['task'],
      operations: [{
        id:       'doSomething', verb: 'do', params: [],
        surfaces: { slash: { command: '/done' } },   // collides with household
      }],
    };
    const cat = mergeManifests([
      { manifest: householdLite },
      { manifest: competing },
    ]);
    expect(cat.commandMenu.find((e) => e.command === '/done').appOrigin)
      .toBe('household');
    expect(cat.warnings.some((w) => /slash collision.*\/done/.test(w))).toBe(true);
  });

  it('warns on op-id collision but keeps the first declarer', () => {
    const competingOpId = {
      app:       'compet',
      itemTypes: ['task'],
      operations: [{
        id:       'markComplete',   // collides
        verb:     'complete',
        params:   [],
        surfaces: { slash: { command: '/competcomplete' } },
      }],
    };
    const cat = mergeManifests([
      { manifest: householdLite },
      { manifest: competingOpId },
    ]);
    expect(cat.opsById.get('markComplete').appOrigin).toBe('household');
    expect(cat.warnings.some((w) => /op-id collision.*markComplete/.test(w))).toBe(true);
  });
});

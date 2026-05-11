/**
 * dagFlatten — depth-first flattening for `getDagTree` consumers.
 *
 * Phase 41.6.7 (2026-05-09); lifted 2026-05-10 alongside the helper
 * into `apps/tasks-v0/src/ui/` per the shared-UI-glue rule.
 */

import { describe, it, expect } from 'vitest';
import { flattenDagTree } from '../../src/ui/dagFlatten.js';

describe('flattenDagTree', () => {
  it('returns [] for empty input', () => {
    expect(flattenDagTree(null)).toEqual([]);
    expect(flattenDagTree({})).toEqual([]);
  });

  it('walks one level', () => {
    const tree = {
      task: { id: 'A', text: 'root' },
      children: [
        { task: { id: 'B', text: 'child-1' }, children: [] },
        { task: { id: 'C', text: 'child-2' }, children: [] },
      ],
    };
    const rows = flattenDagTree(tree);
    expect(rows.map((r) => r.task.id)).toEqual(['A', 'B', 'C']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1]);
  });

  it('walks deeper, preserving DFS order', () => {
    const tree = {
      task: { id: 'A' },
      children: [
        { task: { id: 'B' }, children: [
          { task: { id: 'B1' }, children: [] },
          { task: { id: 'B2' }, children: [] },
        ] },
        { task: { id: 'C' }, children: [] },
      ],
    };
    const rows = flattenDagTree(tree);
    expect(rows.map((r) => r.task.id)).toEqual(['A', 'B', 'B1', 'B2', 'C']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 2, 1]);
  });

  it('honours the {tree: ...} envelope', () => {
    const env = { tree: { task: { id: 'A' }, children: [] } };
    const rows = flattenDagTree(env);
    expect(rows).toHaveLength(1);
    expect(rows[0].task.id).toBe('A');
  });

  it('honours the {trees: [...]} envelope (no-rootId branch)', () => {
    // 41.18 follow-up — DagScreen calls getDagTree({}) when mounted
    // from MainMenu without an id; the skill returns this shape and
    // the helper should walk every tree at depth 0.
    const env = {
      trees: [
        { task: { id: 'root-A' }, children: [
          { task: { id: 'A1' }, children: [] },
        ] },
        { task: { id: 'root-B' }, children: [] },
      ],
    };
    const rows = flattenDagTree(env);
    expect(rows.map((r) => r.task.id)).toEqual(['root-A', 'A1', 'root-B']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 0]);
  });

  it('handles an empty {trees: []} envelope', () => {
    expect(flattenDagTree({ trees: [] })).toEqual([]);
  });

  it('reads node.item (the substrate `treeOf` shape)', () => {
    // 41.18 follow-up — the substrate's treeOf
    // (`apps/tasks-v0/src/dag-tree.js`) emits `{id, item, children}`.
    // Earlier helper fixtures used `{task, children}` which never
    // matched reality, so the DAG screen was empty.
    const tree = {
      id: 'A', item: { id: 'A', text: 'root' },
      children: [
        { id: 'B', item: { id: 'B', text: 'child-1' }, children: [] },
      ],
    };
    const rows = flattenDagTree(tree);
    expect(rows).toHaveLength(2);
    expect(rows[0].task.id).toBe('A');
    expect(rows[0].task.text).toBe('root');
    expect(rows[1].task.id).toBe('B');
    expect(rows[1].depth).toBe(1);
  });

  it('reads {trees: [{id, item, children}]} (skill no-rootId branch)', () => {
    const env = {
      trees: [
        { id: 'A', item: { id: 'A', text: 'A' }, children: [
          { id: 'A1', item: { id: 'A1', text: 'A1' }, children: [] },
        ] },
        { id: 'B', item: { id: 'B', text: 'B' }, children: [] },
      ],
    };
    const rows = flattenDagTree(env);
    expect(rows.map((r) => r.task.text)).toEqual(['A', 'A1', 'B']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 0]);
  });
});

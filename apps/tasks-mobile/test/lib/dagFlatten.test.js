/**
 * dagFlatten — depth-first flattening for the FlatList renderer.
 *
 * Phase 41.6.7 (2026-05-09).
 */

import { describe, it, expect } from 'vitest';
import { flattenDagTree } from '../../src/lib/dagFlatten.js';

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
});

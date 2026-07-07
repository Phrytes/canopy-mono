/**
 * Characterization corpus — dag.html (read-only DAG tree).
 *
 * Picked next after review.html because dag.html is a stable, read-
 * only page (no mutations from the UI itself; it just visualises the
 * task graph) with zero existing test coverage. Small surface, easy
 * to snapshot.
 *
 * Captures:
 *   - Page-serves test: 200 + non-empty HTML + `<html` substring.
 *   - Structural snapshot via `normaliseSnapshot` + `toMatchSnapshot`.
 *   - `getDagTree` skill returns without error on an empty circle + on
 *     a small graph seeded via the fixture's substrate.
 *
 * Discipline: minimal assertions, no domain-state introspection
 * (no checks for `status`, `openDeps`, …). When in doubt the skill
 * assertion just probes "returns without error".
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  ANNE,
  buildCharacterizationFixture,
  normaliseSnapshot,
} from './setup.js';

let fixture;

beforeAll(async () => {
  fixture = await buildCharacterizationFixture({ actor: ANNE });
});

afterAll(async () => {
  await fixture?.teardown();
});

describe('characterization: dag.html', () => {
  it('serves the page (200 + non-empty HTML)', async () => {
    const html = await fixture.fetchPage('dag.html');
    expect(html.length).toBeGreaterThan(100);
    expect(html).toContain('<html');
  });

  it('initial HTML snapshot (empty DAG)', async () => {
    const html = await fixture.fetchPage('dag.html');
    const snap = normaliseSnapshot(html);
    expect(snap, 'dag.html structural baseline').toMatchSnapshot();
  });

  it('getDagTree returns an empty top-level forest on a fresh circle', async () => {
    const r = await fixture.callSkill('getDagTree');
    // Skill returns either {trees: []} (no rootId) or {tree} (with rootId).
    // On an empty circle the trees forest is empty.
    expect(r).toBeTruthy();
    expect(r.error).toBeUndefined();
    expect(Array.isArray(r.trees)).toBe(true);
    expect(r.trees.length).toBe(0);
  });

  it('getDagTree returns a tree after a task is added', async () => {
    // Seed one task via addTask. We don't probe the returned tree's
    // internal shape (status, children, etc.) — just that the skill
    // produces a non-empty forest reflecting the new item via
    // fetchPage's eventual rendering surface.
    // TODO (corpus-next): assert tree-shape (node/children fields)
    // once owner confirms which fields to lock as gold-standard.
    const TASK_TEXT = 'dag-corpus seed task';
    await fixture.callSkill('addTask', {
      circleId: 'characterization-circle',
      text:   TASK_TEXT,
    });

    const r = await fixture.callSkill('getDagTree');
    expect(r.error).toBeUndefined();
    expect(Array.isArray(r.trees)).toBe(true);
    expect(r.trees.length).toBeGreaterThan(0);

    // Substrate-side cross-check: the new task is in itemStore.
    const items = await fixture.circleState.itemStore.listOpen({ type: 'task' });
    expect(items.some((it) => it.text === TASK_TEXT)).toBe(true);
  });
});

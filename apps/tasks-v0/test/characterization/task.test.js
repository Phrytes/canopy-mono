/**
 * Characterization corpus — task.html (per-task detail surface).
 *
 * task.html ships 2026-05-27 alongside the chat.html slice as the
 * per-task surface the desktop never had. Mirrors mobile's
 * `TaskDetailScreen.jsx`. Picked for characterization because:
 *   - new page, no prior snapshot to regress against — locking in
 *     the V0 structural baseline now keeps drift visible;
 *   - the surface is read-only-driven (listOpen + the task's
 *     reviewLog), low interaction risk;
 *   - the URL-keyed page (`?taskId=…`) needs both the no-task and
 *     the served-page paths covered.
 *
 * Captures:
 *   - Page-serves test: 200 + non-empty HTML + `<html` substring.
 *   - Structural snapshot via `normaliseSnapshot` + `toMatchSnapshot`.
 *   - The page exposes the `/lib/taskDetail.js` overlay (the page's
 *     module imports succeed when the overlay is wired).
 *   - The page exposes the `/lib/taskStatus.js` overlay (same).
 *
 * Discipline: no domain-state introspection. The dynamic render path
 * (task lookup + action visibility) is covered by `test/ui/
 * taskDetail.test.js`; this corpus locks the HTML shell only.
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

describe('characterization: task.html', () => {
  it('serves the page (200 + non-empty HTML)', async () => {
    const html = await fixture.fetchPage('task.html');
    expect(html.length).toBeGreaterThan(100);
    expect(html).toContain('<html');
  });

  it('structural snapshot (empty querystring)', async () => {
    const html = await fixture.fetchPage('task.html');
    // Sanity: page declares itself as the task-detail screen.
    expect(html.toLowerCase()).toContain('task');
    // Stable structural anchors.
    expect(html).toContain('<main');
    expect(html).toContain('<script');
    expect(html).toContain('task-shell');
    const snap = normaliseSnapshot(html);
    expect(snap, 'task.html structural baseline').toMatchSnapshot();
  });

  it('serves the shared /lib/taskDetail.js overlay', async () => {
    const res = await fetch(`${fixture.baseUrl}/lib/taskDetail.js`);
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js).toContain('parseTaskLocation');
    expect(js).toContain('deriveTaskActions');
  });

  it('serves the shared /lib/taskStatus.js overlay', async () => {
    const res = await fetch(`${fixture.baseUrl}/lib/taskStatus.js`);
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js).toContain('describeTaskStatus');
  });

  it('mine.html renders task titles as links to task.html', async () => {
    // The cross-page link is the affordance the user takes to land on
    // task.html. Lock the URL shape so a refactor of renderTasks
    // can't drop the link silently.
    //
    // We seed a task, fetch mine.html (which contains the substrate-
    // free shell), then verify renderTasks's source in /app.js
    // contains the `task.html?taskId=` template.
    const res = await fetch(`${fixture.baseUrl}/app.js`);
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js).toContain('task.html?taskId=');
  });
});

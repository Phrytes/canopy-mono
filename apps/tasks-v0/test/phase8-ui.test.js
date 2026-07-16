/**
 * Phase 8 — workspace UI shell + 7 screens (smoke tests).
 *
 * The existing `web.test.js` covers the V0 baseline (index.html + mine.html
 * + a few skill calls + path traversal). This file extends with:
 *   1. The 5 new pages serve.
 *   2. New skills the UI calls are reachable from createCircleAgent.
 *   3. End-to-end through the UI's `addTask → claimTask → submitTask
 *      → approveTask` pipeline (with `approval: 'creator'`).
 *   4. Inbox skills (listMyInbox, inboxBadgeCount, clearInboxItem).
 *   5. Circle + workspace helper skills (getCircleConfig, listAwaitingApproval,
 *      getDagTree, listMyMasteredTasks).
 *   6. /tasks-config.json overlay carries circle context.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AgentIdentity, InternalBus, InternalTransport } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { mountLocalUi, LocalUiAuth } from '@onderling/agent-ui';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';

const CIRCLE = {
  circleId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
    { webid: FRITS, displayName: 'the author', role: 'coordinator' },
    { webid: KID,   displayName: 'Kid',   role: 'member' },
  ],
};
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

let lsBundle, circle, ui, baseUrl;

beforeAll(async () => {
  const id  = await AgentIdentity.generate(new VaultMemory());
  const bus = new InternalBus();
  lsBundle = buildBundle();
  circle = await createCircleAgent({
    circleConfig:           CIRCLE,
    localStoreBundle:     lsBundle,
    wireOnboardingSkills: false,
    identity:             id,
    transport:            new InternalTransport(bus, id.pubKey),
    label:                'Circle(oss-tools)-anne',
  });

  ui = await mountLocalUi(circle.agent, {
    port:        0,
    staticDir:   WEB_DIR,
    a2aTLSLayer: new LocalUiAuth({ localActor: ANNE }),
    extraStaticFiles: {
      '/tasks-config.json': JSON.stringify({
        actor: ANNE,
        roles: Object.fromEntries(CIRCLE.members.map((m) => [m.webid, m.role])),
        circle:  { circleId: CIRCLE.circleId, name: CIRCLE.name, kind: CIRCLE.kind },
      }),
    },
  });
  baseUrl = ui.url;
});

afterAll(async () => {
  await ui?.stop?.();
  await circle?.close?.();
});

async function fetchText(path) {
  const res = await fetch(new URL(path, baseUrl));
  expect(res.ok).toBe(true);
  return res.text();
}

async function callSkill(skillId, args = {}) {
  const res = await fetch(new URL('/tasks/send', baseUrl), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skillId, message: { parts: [{ type: 'DataPart', data: args }] } }),
  });
  expect(res.ok).toBe(true);
  const json = await res.json();
  const parts = json.artifacts?.[0]?.parts ?? json.parts ?? [];
  const dp = parts.find((p) => p?.type === 'DataPart');
  return dp?.data ?? {};
}

describe('Phase 8 — UI pages serve', () => {
  it('serves all 6 pages (index, mine, review, dag, circle, inbox)', async () => {
    for (const path of ['/', '/mine.html', '/review.html', '/dag.html', '/circle.html', '/inbox.html']) {
      const html = await fetchText(path);
      expect(html).toMatch(/<html/);
      // Every page links to the shared style and app.js
      expect(html).toMatch(/style\.css/);
      expect(html).toMatch(/app\.js/);
    }
  });

  it('every page carries the same nav skeleton (Workspace / My work / Review / DAG / Circle / Inbox)', async () => {
    for (const path of ['/', '/mine.html', '/review.html', '/dag.html', '/circle.html', '/inbox.html']) {
      const html = await fetchText(path);
      expect(html).toContain('Workspace');
      expect(html).toContain('My work');
      expect(html).toContain('Review');
      expect(html).toContain('DAG');
      expect(html).toContain('Circle');
      expect(html).toContain('Inbox');
    }
  });

  it('/tasks-config.json carries the actor + role + circle context', async () => {
    const res = await fetch(new URL('/tasks-config.json', baseUrl));
    const cfg = await res.json();
    expect(cfg.actor).toBe(ANNE);
    expect(cfg.roles[ANNE]).toBe('admin');
    expect(cfg.circle?.circleId).toBe('oss-tools');
  });
});

describe('Phase 8 — workspace + inbox skills are wired', () => {
  it('getCircleConfig returns the live circle', async () => {
    const r = await callSkill('getCircleConfig');
    expect(r.circle?.circleId).toBe('oss-tools');
    expect(r.circle?.kind).toBe('project');
    expect(r.circle?.members).toHaveLength(3);
  });

  it('listAwaitingApproval returns submitted items', async () => {
    // Set up: Anne creates a task with approval='creator'; Kid claims + submits.
    const add = await callSkill('addTask', {
      text:     'Paint the fence',
      approval: 'creator',
      definitionOfDone: 'fence painted, photos uploaded',
    });
    const taskId = add.task.id;

    // Kid claims via raw skill call (envelope says ANNE; we override
    // by going through the skill handler directly using callSkill —
    // BUT LocalUiAuth pins the actor to ANNE for HTTP. So instead
    // we just use admin (ANNE) to claim, since admin role has the
    // canClaim gate satisfied.
    await callSkill('claimTask', { id: taskId });
    await callSkill('submitTask', { id: taskId });

    const r = await callSkill('listAwaitingApproval');
    const ours = r.items.find((i) => i.id === taskId);
    expect(ours).toBeTruthy();
  });

  it('getDagTree returns trees for top-level tasks (one tree per top)', async () => {
    const r = await callSkill('getDagTree', {});
    expect(Array.isArray(r.trees)).toBe(true);
    // Each top-level item shows up in trees + its sub-tasks nested.
    for (const t of r.trees) {
      expect(t.id).toBeDefined();
      expect(t.item).toBeDefined();
      expect(Array.isArray(t.children)).toBe(true);
    }
  });

  it('listMyMasteredTasks returns tasks where the caller is master', async () => {
    const r = await callSkill('listMyMasteredTasks');
    expect(Array.isArray(r.items)).toBe(true);
    // Anne is master of every task she created in this test run.
    for (const i of r.items) {
      // Either she's the addedBy (default master) OR explicitly the master.
      expect(i.master ?? i.addedBy).toBe(ANNE);
    }
  });

  it('listMyInbox returns the recipient\'s notifications', async () => {
    const r = await callSkill('listMyInbox', { limit: 50 });
    expect(Array.isArray(r.items)).toBe(true);
    // Should contain at least the task-completed entries from earlier tests.
    expect(r.items.length).toBeGreaterThan(0);
  });

  it('inboxBadgeCount reports a non-negative count', async () => {
    const r = await callSkill('inboxBadgeCount');
    expect(r.count).toBeGreaterThanOrEqual(0);
    expect(r.totalCount).toBeGreaterThanOrEqual(r.count);
  });

  it('clearInboxItem removes one entry by id', async () => {
    const before = await callSkill('listMyInbox', { limit: 1 });
    if ((before.items ?? []).length === 0) return;     // no-op when empty
    const target = before.items[0];
    const r = await callSkill('clearInboxItem', { id: target.id });
    expect(r.ok).toBe(true);
    const after = await callSkill('listMyInbox', { limit: 50 });
    expect(after.items.find((i) => i.id === target.id)).toBeUndefined();
  });
});

describe('Phase 8 — /add full-cycle creator-approval flow', () => {
  it('addTask with approval=creator → submit → approve → complete', async () => {
    const add = await callSkill('addTask', {
      text:     'Build the new shed',
      approval: 'creator',
      definitionOfDone: 'shed built, painted, photos taken',
    });
    expect(add.task.approval).toBe('creator');

    await callSkill('claimTask', { id: add.task.id });
    const subm = await callSkill('submitTask', { id: add.task.id });
    expect(subm.task.reviewLog?.[0]?.decision).toBe('submit');

    const appr = await callSkill('approveTask', { id: add.task.id });
    expect(appr.task.completedAt).toBeGreaterThan(0);
    expect(appr.task.reviewLog.map((r) => r.decision)).toEqual(['submit', 'approve']);
  });
});

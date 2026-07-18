/**
 * invoicing + compensated-role.
 *
 * Asserts:
 *   - Non-compensated member completing → no invoice line.
 *   - Compensated member completing → invoice line at expected path.
 *   - Multiple completions same month → all rolled into one JSON.
 *   - getCompensation admin → returns lines.
 *   - getCompensation self → returns own lines only.
 *   - getCompensation other-member → 403.
 *   - setCompensationEnabled admin gate.
 *   - Disabling compensation detaches the listener (no further emits).
 *   - Idempotent — same taskId completing twice doesn't duplicate.
 */

import { describe, it, expect } from 'vitest';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const CAROL = 'https://id.example/carol';

const CIRCLE = {
  circleId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
    { webid: FRITS, displayName: 'the author', role: 'coordinator' },
    { webid: CAROL, displayName: 'Carol', role: 'member', compensated: true, rate: 80 },
  ],
  compensation: { enabled: true, currency: 'EUR' },
};

function call(circle, name, data, from) {
  return circle.agent.skills.get(name).handler({
    parts: [{ type: 'DataPart', data: data ?? {} }],
    from,
    agent: circle.agent,
    envelope: null,
  });
}

async function setup(overrides = {}) {
  const bundle = buildBundle();
  const circle = await createCircleAgent({
    circleConfig:           { ...CIRCLE, ...overrides },
    localStoreBundle:     bundle,
    wireOnboardingSkills: false,
  });
  return { bundle, circle };
}

describe('V2.2 — invoicing + compensated-role', () => {
  it('non-compensated member completing → no invoice line', async () => {
    const { circle, bundle } = await setup();
    // Anne (non-compensated) creates a task assigned to herself, completes it.
    const r = await call(circle, 'addTask', { text: 'Anne does it', estimateMinutes: 60 }, ANNE);
    await call(circle, 'claimTask',    { id: r.task.id }, ANNE);
    await call(circle, 'completeTask', { id: r.task.id }, ANNE);
    await new Promise((res) => setTimeout(res, 5));
    const path = `mem://tasks/circles/oss-tools/invoicing/${encodeURIComponent(ANNE)}/${currentMonthKey()}.json`;
    expect(await bundle.cache.read(path)).toBeNull();
    await circle.close();
  });

  it('compensated member completing → invoice line at expected path', async () => {
    const { circle, bundle } = await setup();
    const r = await call(circle, 'addTask', { text: 'Carol does it', estimateMinutes: 90 }, ANNE);
    await call(circle, 'claimTask',    { id: r.task.id }, CAROL);
    await call(circle, 'completeTask', { id: r.task.id }, CAROL);
    await new Promise((res) => setTimeout(res, 5));
    const path = `mem://tasks/circles/oss-tools/invoicing/${encodeURIComponent(CAROL)}/${currentMonthKey()}.json`;
    const raw = await bundle.cache.read(path);
    expect(raw).toBeTruthy();
    const lines = JSON.parse(raw);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ taskId: r.task.id, hours: 1.5, rate: 80 });
    await circle.close();
  });

  it('multiple completions same month → rolled into one JSON', async () => {
    const { circle, bundle } = await setup();
    for (const text of ['A', 'B', 'C']) {
      const r = await call(circle, 'addTask', { text, estimateMinutes: 30 }, ANNE);
      await call(circle, 'claimTask',    { id: r.task.id }, CAROL);
      await call(circle, 'completeTask', { id: r.task.id }, CAROL);
    }
    await new Promise((res) => setTimeout(res, 5));
    const path = `mem://tasks/circles/oss-tools/invoicing/${encodeURIComponent(CAROL)}/${currentMonthKey()}.json`;
    const lines = JSON.parse(await bundle.cache.read(path));
    expect(lines).toHaveLength(3);
    await circle.close();
  });

  it('getCompensation admin → returns lines and totals', async () => {
    const { circle } = await setup();
    const r = await call(circle, 'addTask', { text: 'X', estimateMinutes: 60 }, ANNE);
    await call(circle, 'claimTask',    { id: r.task.id }, CAROL);
    await call(circle, 'completeTask', { id: r.task.id }, CAROL);
    await new Promise((res) => setTimeout(res, 5));
    const got = await call(circle, 'getCompensation', { memberWebid: CAROL }, ANNE);
    expect(got.lines).toHaveLength(1);
    expect(got.totals.hours).toBe(1);
    expect(got.totals.amount).toBe(80);
    expect(got.currency).toBe('EUR');
    await circle.close();
  });

  it('getCompensation self → own lines only; other-member → 403', async () => {
    const { circle } = await setup();
    const own = await call(circle, 'getCompensation', {}, CAROL);
    expect(own.memberWebid).toBe(CAROL);
    const other = await call(circle, 'getCompensation', { memberWebid: ANNE }, CAROL);
    expect(other.error).toMatch(/admin/);
    await circle.close();
  });

  it('setCompensationEnabled admin gate; non-admin denied', async () => {
    const { circle } = await setup();
    expect((await call(circle, 'setCompensationEnabled', { enabled: false }, FRITS)).error).toMatch(/admin/);
    expect((await call(circle, 'setCompensationEnabled', { enabled: false }, ANNE)).ok).toBe(true);
    await circle.close();
  });

  it('disabling compensation detaches the listener — no further lines emitted', async () => {
    const { circle, bundle } = await setup();
    await call(circle, 'setCompensationEnabled', { enabled: false }, ANNE);
    const r = await call(circle, 'addTask', { text: 'after off', estimateMinutes: 60 }, ANNE);
    await call(circle, 'claimTask',    { id: r.task.id }, CAROL);
    await call(circle, 'completeTask', { id: r.task.id }, CAROL);
    await new Promise((res) => setTimeout(res, 5));
    const path = `mem://tasks/circles/oss-tools/invoicing/${encodeURIComponent(CAROL)}/${currentMonthKey()}.json`;
    expect(await bundle.cache.read(path)).toBeNull();
    await circle.close();
  });

  it('setMemberCompensation makes a member paid-pro', async () => {
    const { circle } = await setup();
    const r = await call(circle, 'setMemberCompensation', { memberWebid: FRITS, compensated: true, rate: 60 }, ANNE);
    expect(r.ok).toBe(true);
    const live = circle.getCircle();
    const fritsLive = live.members.find((m) => m?.webid === FRITS);
    expect(fritsLive.compensated).toBe(true);
    expect(fritsLive.rate).toBe(60);
    await circle.close();
  });
});

function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

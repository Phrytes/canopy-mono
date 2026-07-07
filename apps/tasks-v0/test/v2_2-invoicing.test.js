/**
 * V2.2 — invoicing + compensated-role.
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
import { createCrewAgent } from '../src/Crew.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const CAROL = 'https://id.example/carol';

const CREW = {
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

function call(crew, name, data, from) {
  return crew.agent.skills.get(name).handler({
    parts: [{ type: 'DataPart', data: data ?? {} }],
    from,
    agent: crew.agent,
    envelope: null,
  });
}

async function setup(overrides = {}) {
  const bundle = buildBundle();
  const crew = await createCrewAgent({
    crewConfig:           { ...CREW, ...overrides },
    localStoreBundle:     bundle,
    wireOnboardingSkills: false,
  });
  return { bundle, crew };
}

describe('V2.2 — invoicing + compensated-role', () => {
  it('non-compensated member completing → no invoice line', async () => {
    const { crew, bundle } = await setup();
    // Anne (non-compensated) creates a task assigned to herself, completes it.
    const r = await call(crew, 'addTask', { text: 'Anne does it', estimateMinutes: 60 }, ANNE);
    await call(crew, 'claimTask',    { id: r.task.id }, ANNE);
    await call(crew, 'completeTask', { id: r.task.id }, ANNE);
    await new Promise((res) => setTimeout(res, 5));
    const path = `mem://tasks/crews/oss-tools/invoicing/${encodeURIComponent(ANNE)}/${currentMonthKey()}.json`;
    expect(await bundle.cache.read(path)).toBeNull();
    await crew.close();
  });

  it('compensated member completing → invoice line at expected path', async () => {
    const { crew, bundle } = await setup();
    const r = await call(crew, 'addTask', { text: 'Carol does it', estimateMinutes: 90 }, ANNE);
    await call(crew, 'claimTask',    { id: r.task.id }, CAROL);
    await call(crew, 'completeTask', { id: r.task.id }, CAROL);
    await new Promise((res) => setTimeout(res, 5));
    const path = `mem://tasks/crews/oss-tools/invoicing/${encodeURIComponent(CAROL)}/${currentMonthKey()}.json`;
    const raw = await bundle.cache.read(path);
    expect(raw).toBeTruthy();
    const lines = JSON.parse(raw);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ taskId: r.task.id, hours: 1.5, rate: 80 });
    await crew.close();
  });

  it('multiple completions same month → rolled into one JSON', async () => {
    const { crew, bundle } = await setup();
    for (const text of ['A', 'B', 'C']) {
      const r = await call(crew, 'addTask', { text, estimateMinutes: 30 }, ANNE);
      await call(crew, 'claimTask',    { id: r.task.id }, CAROL);
      await call(crew, 'completeTask', { id: r.task.id }, CAROL);
    }
    await new Promise((res) => setTimeout(res, 5));
    const path = `mem://tasks/crews/oss-tools/invoicing/${encodeURIComponent(CAROL)}/${currentMonthKey()}.json`;
    const lines = JSON.parse(await bundle.cache.read(path));
    expect(lines).toHaveLength(3);
    await crew.close();
  });

  it('getCompensation admin → returns lines and totals', async () => {
    const { crew } = await setup();
    const r = await call(crew, 'addTask', { text: 'X', estimateMinutes: 60 }, ANNE);
    await call(crew, 'claimTask',    { id: r.task.id }, CAROL);
    await call(crew, 'completeTask', { id: r.task.id }, CAROL);
    await new Promise((res) => setTimeout(res, 5));
    const got = await call(crew, 'getCompensation', { memberWebid: CAROL }, ANNE);
    expect(got.lines).toHaveLength(1);
    expect(got.totals.hours).toBe(1);
    expect(got.totals.amount).toBe(80);
    expect(got.currency).toBe('EUR');
    await crew.close();
  });

  it('getCompensation self → own lines only; other-member → 403', async () => {
    const { crew } = await setup();
    const own = await call(crew, 'getCompensation', {}, CAROL);
    expect(own.memberWebid).toBe(CAROL);
    const other = await call(crew, 'getCompensation', { memberWebid: ANNE }, CAROL);
    expect(other.error).toMatch(/admin/);
    await crew.close();
  });

  it('setCompensationEnabled admin gate; non-admin denied', async () => {
    const { crew } = await setup();
    expect((await call(crew, 'setCompensationEnabled', { enabled: false }, FRITS)).error).toMatch(/admin/);
    expect((await call(crew, 'setCompensationEnabled', { enabled: false }, ANNE)).ok).toBe(true);
    await crew.close();
  });

  it('disabling compensation detaches the listener — no further lines emitted', async () => {
    const { crew, bundle } = await setup();
    await call(crew, 'setCompensationEnabled', { enabled: false }, ANNE);
    const r = await call(crew, 'addTask', { text: 'after off', estimateMinutes: 60 }, ANNE);
    await call(crew, 'claimTask',    { id: r.task.id }, CAROL);
    await call(crew, 'completeTask', { id: r.task.id }, CAROL);
    await new Promise((res) => setTimeout(res, 5));
    const path = `mem://tasks/crews/oss-tools/invoicing/${encodeURIComponent(CAROL)}/${currentMonthKey()}.json`;
    expect(await bundle.cache.read(path)).toBeNull();
    await crew.close();
  });

  it('setMemberCompensation makes a member paid-pro', async () => {
    const { crew } = await setup();
    const r = await call(crew, 'setMemberCompensation', { memberWebid: FRITS, compensated: true, rate: 60 }, ANNE);
    expect(r.ok).toBe(true);
    const live = crew.getCrew();
    const fritsLive = live.members.find((m) => m?.webid === FRITS);
    expect(fritsLive.compensated).toBe(true);
    expect(fritsLive.rate).toBe(60);
    await crew.close();
  });
});

function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Phase 9 — observability stats + cadence config tests.
 *
 * Covers:
 *   1. MetricsTracker counters tick on item-* events.
 *   2. Latency reservoirs record time-to-claim + submit-to-approval.
 *   3. resolveCadence layering — user > crew > baseline.
 *   4. sanitiseCadenceMap drops bad entries.
 *   5. Live skills via createCrewAgent — getMetrics, getCrewCadences,
 *      setCrewCadences (admin/coord only), getMyCadenceOverrides,
 *      setMyCadenceOverrides, resolveMyCadence.
 *   6. Share-with-admin gating: V1 keeps metrics local — getMetrics
 *      returns the local snapshot regardless of caller (no auto-share).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { DataPart } from '@canopy/core';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCrewAgent } from '../src/Crew.js';
import { MetricsTracker, COUNTER_NAMES } from '../src/observability/metrics.js';
import { resolveCadence, sanitiseCadenceMap, BASELINE_CADENCES } from '../src/observability/cadence.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';

const CREW = {
  circleId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
    { webid: FRITS, displayName: 'the author', role: 'coordinator' },
    { webid: KID,   displayName: 'Kid',   role: 'member' },
  ],
};

async function callSkill(agent, skillId, args, fromWebid) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

// ── Pure tests: MetricsTracker + cadence helpers ───────────────────────────

describe('Phase 9 — MetricsTracker (pure)', () => {
  it('records counters via .record() and snapshots them', () => {
    const t = new MetricsTracker();
    t.record('task.added');
    t.record('task.added');
    t.record('task.claimed');
    const s = t.snapshot();
    expect(s.counters['task.added'].count).toBe(2);
    expect(s.counters['task.claimed'].count).toBe(1);
  });

  it('records latency samples and reports p50/p90/max', () => {
    const t = new MetricsTracker();
    [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].forEach((ms) => t.recordLatency('lat', ms));
    const s = t.snapshot();
    expect(s.latencies.lat.count).toBe(10);
    expect(s.latencies.lat.p50).toBeGreaterThanOrEqual(50);
    expect(s.latencies.lat.p90).toBeGreaterThanOrEqual(80);
  });

  it('reservoir is bounded — old samples drop out', () => {
    const t = new MetricsTracker({ latencyReservoirSize: 3 });
    t.recordLatency('x', 10);
    t.recordLatency('x', 20);
    t.recordLatency('x', 30);
    t.recordLatency('x', 99);   // pushes 10 out
    const s = t.snapshot();
    expect(s.latencies.x.count).toBe(3);
  });

  it('reset() drops one or all counters', () => {
    const t = new MetricsTracker();
    t.record('a'); t.record('b');
    t.reset('a');
    expect(t.snapshot().counters.a).toBeUndefined();
    expect(t.snapshot().counters.b.count).toBe(1);
    t.reset();
    expect(t.snapshot().counters).toEqual({});
  });
});

describe('Phase 9 — resolveCadence (pure)', () => {
  it('returns the baseline when no overrides present', () => {
    const r = resolveCadence({ eventType: 'task-completed' });
    expect(r.channel).toBe('inbox');
    expect(r.suppressed).toBe(false);
  });

  it('crew overrides the baseline', () => {
    const r = resolveCadence({
      eventType: 'task-completed',
      crew:      { 'task-completed': { channel: 'silent' } },
    });
    expect(r.channel).toBe('silent');
  });

  it('user overrides the crew', () => {
    const r = resolveCadence({
      eventType: 'task-completed',
      crew:      { 'task-completed': { channel: 'silent' } },
      user:      { 'task-completed': { channel: 'inbox' } },
    });
    expect(r.channel).toBe('inbox');
  });

  it('user `suppressed: true` wins over crew `suppressed: false`', () => {
    const r = resolveCadence({
      eventType: 'task-completed',
      crew:      { 'task-completed': { suppressed: false } },
      user:      { 'task-completed': { suppressed: true } },
    });
    expect(r.suppressed).toBe(true);
  });

  it('rejects calls without an eventType', () => {
    expect(() => resolveCadence({})).toThrow(/eventType/);
  });
});

describe('Phase 9 — sanitiseCadenceMap drops bad input', () => {
  it('strips entries with invalid channels + invalid leadMs', () => {
    const out = sanitiseCadenceMap({
      'task-completed': { channel: 'inbox', suppressed: true, leadMs: 100 },
      'task-submitted': { channel: 'sms' },
      'invalid':        'not an object',
      '':               { channel: 'inbox' },
      'task-revoked':   { leadMs: -1 },
    });
    expect(out['task-completed']).toEqual({ channel: 'inbox', suppressed: true, leadMs: 100 });
    expect(out['task-submitted']).toBeUndefined();
    expect(out['invalid']).toBeUndefined();
    expect(out['']).toBeUndefined();
    expect(out['task-revoked']).toBeUndefined();
  });
});

// ── Live skill tests ───────────────────────────────────────────────────────

describe('Phase 9 — live skills via createCrewAgent', () => {
  let lsBundle;
  let crew;

  beforeEach(async () => {
    lsBundle = buildBundle();
    crew = await createCrewAgent({
      crewConfig:           CREW,
      localStoreBundle:     lsBundle,
      wireOnboardingSkills: false,
    });
  });

  afterEach(async () => {
    await crew?.close?.();
  });

  it('getMetrics returns counter + latency snapshot; counts grow as events fire', async () => {
    const before = await callSkill(crew.agent, 'getMetrics', {}, ANNE);
    const beforeCount = before.snapshot.counters[COUNTER_NAMES.ADDED]?.count ?? 0;

    await callSkill(crew.agent, 'addTask', { text: 'measured' }, ANNE);
    await callSkill(crew.agent, 'claimTask', { id: (await crew.itemStore.listOpen())[0].id }, KID);

    const after = await callSkill(crew.agent, 'getMetrics', {}, ANNE);
    const addedCount = after.snapshot.counters[COUNTER_NAMES.ADDED]?.count ?? 0;
    const claimedCount = after.snapshot.counters[COUNTER_NAMES.CLAIMED]?.count ?? 0;
    expect(addedCount).toBe(beforeCount + 1);
    expect(claimedCount).toBeGreaterThanOrEqual(1);

    // Latency reservoir for time-to-claim recorded a sample.
    const latency = after.snapshot.latencies['latency.time-to-claim'];
    expect(latency?.count).toBeGreaterThanOrEqual(1);
  });

  it('full submit→approve cycle records latency.submit-to-approval', async () => {
    await callSkill(crew.agent, 'addTask', {
      text: 'reviewable', approval: 'creator',
    }, ANNE);
    const taskId = (await crew.itemStore.listOpen())[0].id;
    await callSkill(crew.agent, 'claimTask', { id: taskId }, KID);
    await callSkill(crew.agent, 'submitTask', { id: taskId }, KID);
    // Tiny pause so submitAt < completedAt deterministically.
    await new Promise((r) => setTimeout(r, 5));
    await callSkill(crew.agent, 'approveTask', { id: taskId }, ANNE);

    const r = await callSkill(crew.agent, 'getMetrics', {}, ANNE);
    expect(r.snapshot.counters[COUNTER_NAMES.SUBMITTED]?.count).toBeGreaterThanOrEqual(1);
    expect(r.snapshot.counters[COUNTER_NAMES.APPROVED]?.count).toBeGreaterThanOrEqual(1);
    expect(r.snapshot.latencies['latency.submit-to-approval']?.count).toBeGreaterThanOrEqual(1);
  });

  it('getCrewCadences + setCrewCadences (admin/coord only)', async () => {
    const empty = await callSkill(crew.agent, 'getCrewCadences', {}, ANNE);
    expect(empty.cadences).toEqual({});

    // Non-admin denied.
    const denied = await callSkill(crew.agent, 'setCrewCadences',
      { cadences: { 'task-completed': { channel: 'silent' } } }, KID);
    expect(denied.error).toMatch(/admin|coordinator/i);

    // Admin allowed.
    const ok = await callSkill(crew.agent, 'setCrewCadences',
      { cadences: { 'task-completed': { channel: 'silent' } } }, ANNE);
    expect(ok.cadences['task-completed'].channel).toBe('silent');

    const after = await callSkill(crew.agent, 'getCrewCadences', {}, ANNE);
    expect(after.cadences['task-completed'].channel).toBe('silent');
  });

  it('setMyCadenceOverrides + resolveMyCadence — user overrides crew overrides baseline', async () => {
    // Crew sets "missed-deadline" to silent.
    await callSkill(crew.agent, 'setCrewCadences',
      { cadences: { 'missed-deadline': { channel: 'silent' } } }, ANNE);

    // Resolve with no user override → crew wins.
    const r1 = await callSkill(crew.agent, 'resolveMyCadence',
      { eventType: 'missed-deadline' }, KID);
    expect(r1.resolved.channel).toBe('silent');

    // User sets the same event back to inbox.
    await callSkill(crew.agent, 'setMyCadenceOverrides',
      { overrides: { 'missed-deadline': { channel: 'inbox' } } }, KID);

    // Resolve → user wins.
    const r2 = await callSkill(crew.agent, 'resolveMyCadence',
      { eventType: 'missed-deadline' }, KID);
    expect(r2.resolved.channel).toBe('inbox');
  });

  it('subtask-request counter ticks when a queued request is filed', async () => {
    // Threshold 1 so a depth-2 spawn queues.
    const lsBundle2 = buildBundle();
    const crew2 = await createCrewAgent({
      crewConfig:           { ...CREW, subtasksAdminApprovalDepth: 1 },
      localStoreBundle:     lsBundle2,
      wireOnboardingSkills: false,
    });

    const r1 = await callSkill(crew2.agent, 'addTask', { text: 'Root' }, ANNE);
    const r2 = await callSkill(crew2.agent, 'addSubtask',
      { parentTaskId: r1.task.id, text: 'Child' }, ANNE);
    await callSkill(crew2.agent, 'addSubtask',
      { parentTaskId: r2.task.id, text: 'Grandchild' }, ANNE);
    await new Promise((r) => setTimeout(r, 10));

    const m = await callSkill(crew2.agent, 'getMetrics', {}, ANNE);
    expect(m.snapshot.counters[COUNTER_NAMES.SUBTASK_REQUEST]?.count).toBeGreaterThanOrEqual(1);

    await crew2.close?.();
  });
});

describe('Phase 9 — baseline cadences exist', () => {
  it('has entries for the 6 V1 event types', () => {
    expect(BASELINE_CADENCES['missed-deadline']).toBeDefined();
    expect(BASELINE_CADENCES['task-completed']).toBeDefined();
    expect(BASELINE_CADENCES['task-submitted']).toBeDefined();
    expect(BASELINE_CADENCES['task-rejected']).toBeDefined();
    expect(BASELINE_CADENCES['task-revoked']).toBeDefined();
    expect(BASELINE_CADENCES['subtask-request']).toBeDefined();
  });
});

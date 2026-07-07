/**
 * Tasks-mobile V2 adoption (M1-S1 through M1-S4) — device-independent
 * vitest coverage.
 *
 * M1 (2026-05-18). Mirrors `apps/tasks-v0/test/v2-adoption.test.js`
 * coverage where the tests are device-independent (no native modules,
 * no real filesystem, no camera/keychain).
 *
 * Coverage:
 *   S1 — `buildCircleState` storage-field normalization; embeds route
 *        through `buildAddTaskArgs` (unchanged from tasks-v0)
 *   S2 — CreateCircleScreen uses `ROUTES.CreateCircle` (navigation key)
 *   S3 — `buildCircleState({ meshAgent })` wires substrate slots +
 *        populates `_podCtx` with classify/reverse (M4 active seam)
 *   S4 — `ROUTES.PodSettings` exists; PodSettingsScreen exports correctly
 */

import { describe, it, expect, vi } from 'vitest';

import {
  buildCircleState,
  CIRCLE_STORAGE_POLICIES,
} from '../src/lib/buildCircleState.js';
import { ROUTES } from '../src/navigation.js';

const ANNE = 'webid://anne';
const BOB  = 'webid://bob';

const BASE_CIRCLE = {
  circleId:  'test-circle',
  name:    'Test',
  kind:    'household',
  members: [
    { webid: ANNE, displayName: 'Anne', role: 'admin', pubKey: 'pk-anne' },
    { webid: BOB,  displayName: 'Bob',  role: 'member', pubKey: 'pk-bob' },
  ],
};

// ── M1-S1: storage-field normalization ──────────────────────────────

describe('M1-S1 — CIRCLE_STORAGE_POLICIES constant', () => {
  it('exports all four §II.2 policies', () => {
    expect(CIRCLE_STORAGE_POLICIES).toEqual(
      Object.freeze(['no-pod', 'centralised', 'decentralised', 'hybrid']),
    );
  });
});

describe('M1-S1 — buildCircleState storage normalization', () => {
  it('defaults storage to no-pod when omitted', async () => {
    const cs = await buildCircleState({ circleConfig: BASE_CIRCLE });
    expect(cs.liveCircle.storage).toEqual({ policy: 'no-pod', groupPodUri: null });
  });

  it('accepts string shorthand "centralised"', async () => {
    const cs = await buildCircleState({
      circleConfig: { ...BASE_CIRCLE, storage: 'centralised' },
    });
    expect(cs.liveCircle.storage).toEqual({ policy: 'centralised', groupPodUri: null });
  });

  it('accepts structured object with groupPodUri', async () => {
    const storage = { policy: 'hybrid', groupPodUri: 'https://pod.example/group/' };
    const cs = await buildCircleState({ circleConfig: { ...BASE_CIRCLE, storage } });
    expect(cs.liveCircle.storage).toEqual(storage);
  });

  it('falls back to no-pod for unknown policy strings', async () => {
    const cs = await buildCircleState({
      circleConfig: { ...BASE_CIRCLE, storage: 'future-policy-unknown' },
    });
    expect(cs.liveCircle.storage).toEqual({ policy: 'no-pod', groupPodUri: null });
  });

  it('normalises all four policy values without groupPodUri', async () => {
    for (const policy of CIRCLE_STORAGE_POLICIES) {
      const cs = await buildCircleState({
        circleConfig: { ...BASE_CIRCLE, storage: policy },
      });
      expect(cs.liveCircle.storage.policy).toBe(policy);
      expect(cs.liveCircle.storage.groupPodUri).toBeNull();
    }
  });
});

// ── M1-S3: substrate slots + _podCtx seam ───────────────────────────

describe('M1-S3 — buildCircleState without meshAgent', () => {
  it('has null substrate slots when no meshAgent supplied', async () => {
    const cs = await buildCircleState({ circleConfig: BASE_CIRCLE });
    expect(cs.pseudoPod).toBeNull();
    expect(cs.podRouting).toBeNull();
    expect(cs.notifyEnvelope).toBeNull();
    expect(cs.agentRegistry).toBeNull();
    expect(cs.tasksMirror).toBeNull();
    expect(cs.substrateDeviceId).toBeNull();
  });

  it('_podCtx is populated with classify/reverse from podPathMap (M4 seam)', async () => {
    const cs = await buildCircleState({ circleConfig: BASE_CIRCLE });
    expect(cs._podCtx).toBeTruthy();
    expect(typeof cs._podCtx.classify).toBe('function');
    expect(typeof cs._podCtx.reverse).toBe('function');
    expect(cs._podCtx.active).toBe(false);   // inactive until pod attached
    expect(cs._podCtx.podRouting).toBeNull(); // wired at attach time
    expect(cs._podCtx.circleId).toBe('test-circle');
  });
});

describe('M1-S3 — buildCircleState with stubbed meshAgent', () => {
  function makeMockAgent() {
    return {
      address: 'pk-device-test',
      skills:  new Map(),
      transportFor: () => null,
      on: vi.fn(),
      off: vi.fn(),
    };
  }

  it('sets substrateDeviceId from agent.address', async () => {
    const agent = makeMockAgent();
    // buildTasksSubstrateStack + wireTasksSubstrateMirror may throw in test
    // (no real transport) — that is acceptable (best-effort).
    const cs = await buildCircleState({ circleConfig: BASE_CIRCLE, meshAgent: agent });
    // Either it wired successfully or fell back gracefully.
    expect(cs.substrateDeviceId).toBe('pk-device-test');
    // _podCtx is pre-populated with classify/reverse; inactive until pod attached.
    expect(cs._podCtx?.active).toBe(false);
  });

  it('circle core state is intact regardless of substrate outcome', async () => {
    // Even when the agent is minimal (e.g. no transport), the circle
    // itself must remain functional. Substrate slots may or may not
    // be populated depending on which step succeeds.
    const agent = { address: 'broken-test-agent' };
    const cs = await buildCircleState({ circleConfig: BASE_CIRCLE, meshAgent: agent });
    // Core circle state is always present.
    expect(cs.circleId).toBe('test-circle');
    expect(cs.liveCircle.name).toBe('Test');
    // _podCtx is always populated at M4 (classify/reverse pre-loaded; inactive).
    expect(cs._podCtx?.active).toBe(false);
    // substrateDeviceId is always set when meshAgent.address exists.
    expect(cs.substrateDeviceId).toBe('broken-test-agent');
  });
});

// ── M1-S2 + M1-S4: navigation routes ────────────────────────────────

describe('M1-S2 + M1-S4 — navigation routes', () => {
  it('ROUTES.CreateCircle is defined', () => {
    expect(ROUTES.CreateCircle).toBe('CreateCircle');
  });

  it('ROUTES.PodSettings is defined', () => {
    expect(ROUTES.PodSettings).toBe('PodSettings');
  });

  it('all M1 routes are present in ROUTES', () => {
    expect(ROUTES).toMatchObject({
      CreateCircle:  'CreateCircle',
      PodSettings: 'PodSettings',
    });
  });
});

// ── M1-S4: PodSettingsScreen export smoke test ────────────────────────

describe('M1-S4 — PodSettingsScreen module', () => {
  it('exports PodSettingsScreen function', async () => {
    const mod = await import('../src/screens/PodSettingsScreen.jsx');
    expect(typeof mod.PodSettingsScreen).toBe('function');
  });
});

// ── M1-S2: CreateCircleScreen export smoke test ────────────────────────

describe('M1-S2 — CreateCircleScreen module', () => {
  it('exports CreateCircleScreen function', async () => {
    const mod = await import('../src/screens/CreateCircleScreen.jsx');
    expect(typeof mod.CreateCircleScreen).toBe('function');
  });
});

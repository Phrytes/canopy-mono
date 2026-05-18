/**
 * Tasks-mobile V2 adoption (M1-S1 through M1-S4) — device-independent
 * vitest coverage.
 *
 * M1 (2026-05-18). Mirrors `apps/tasks-v0/test/v2-adoption.test.js`
 * coverage where the tests are device-independent (no native modules,
 * no real filesystem, no camera/keychain).
 *
 * Coverage:
 *   S1 — `buildCrewState` storage-field normalization; embeds route
 *        through `buildAddTaskArgs` (unchanged from tasks-v0)
 *   S2 — CreateCrewScreen uses `ROUTES.CreateCrew` (navigation key)
 *   S3 — `buildCrewState({ meshAgent })` wires substrate slots +
 *        sets `_podCtx: null` (M4 seam)
 *   S4 — `ROUTES.PodSettings` exists; PodSettingsScreen exports correctly
 */

import { describe, it, expect, vi } from 'vitest';

import {
  buildCrewState,
  CREW_STORAGE_POLICIES,
} from '../src/lib/buildCrewState.js';
import { ROUTES } from '../src/navigation.js';

const ANNE = 'webid://anne';
const BOB  = 'webid://bob';

const BASE_CREW = {
  crewId:  'test-crew',
  name:    'Test',
  kind:    'household',
  members: [
    { webid: ANNE, displayName: 'Anne', role: 'admin', pubKey: 'pk-anne' },
    { webid: BOB,  displayName: 'Bob',  role: 'member', pubKey: 'pk-bob' },
  ],
};

// ── M1-S1: storage-field normalization ──────────────────────────────

describe('M1-S1 — CREW_STORAGE_POLICIES constant', () => {
  it('exports all four §II.2 policies', () => {
    expect(CREW_STORAGE_POLICIES).toEqual(
      Object.freeze(['no-pod', 'centralised', 'decentralised', 'hybrid']),
    );
  });
});

describe('M1-S1 — buildCrewState storage normalization', () => {
  it('defaults storage to no-pod when omitted', async () => {
    const cs = await buildCrewState({ crewConfig: BASE_CREW });
    expect(cs.liveCrew.storage).toEqual({ policy: 'no-pod', groupPodUri: null });
  });

  it('accepts string shorthand "centralised"', async () => {
    const cs = await buildCrewState({
      crewConfig: { ...BASE_CREW, storage: 'centralised' },
    });
    expect(cs.liveCrew.storage).toEqual({ policy: 'centralised', groupPodUri: null });
  });

  it('accepts structured object with groupPodUri', async () => {
    const storage = { policy: 'hybrid', groupPodUri: 'https://pod.example/group/' };
    const cs = await buildCrewState({ crewConfig: { ...BASE_CREW, storage } });
    expect(cs.liveCrew.storage).toEqual(storage);
  });

  it('falls back to no-pod for unknown policy strings', async () => {
    const cs = await buildCrewState({
      crewConfig: { ...BASE_CREW, storage: 'future-policy-unknown' },
    });
    expect(cs.liveCrew.storage).toEqual({ policy: 'no-pod', groupPodUri: null });
  });

  it('normalises all four policy values without groupPodUri', async () => {
    for (const policy of CREW_STORAGE_POLICIES) {
      const cs = await buildCrewState({
        crewConfig: { ...BASE_CREW, storage: policy },
      });
      expect(cs.liveCrew.storage.policy).toBe(policy);
      expect(cs.liveCrew.storage.groupPodUri).toBeNull();
    }
  });
});

// ── M1-S3: substrate slots + _podCtx seam ───────────────────────────

describe('M1-S3 — buildCrewState without meshAgent', () => {
  it('has null substrate slots when no meshAgent supplied', async () => {
    const cs = await buildCrewState({ crewConfig: BASE_CREW });
    expect(cs.pseudoPod).toBeNull();
    expect(cs.podRouting).toBeNull();
    expect(cs.notifyEnvelope).toBeNull();
    expect(cs.agentRegistry).toBeNull();
    expect(cs.tasksMirror).toBeNull();
    expect(cs.substrateDeviceId).toBeNull();
  });

  it('_podCtx is null (M4 seam present from day-one)', async () => {
    const cs = await buildCrewState({ crewConfig: BASE_CREW });
    expect(cs._podCtx).toBeNull();
  });
});

describe('M1-S3 — buildCrewState with stubbed meshAgent', () => {
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
    const cs = await buildCrewState({ crewConfig: BASE_CREW, meshAgent: agent });
    // Either it wired successfully or fell back gracefully.
    expect(cs.substrateDeviceId).toBe('pk-device-test');
    // _podCtx remains null regardless (M4 seam).
    expect(cs._podCtx).toBeNull();
  });

  it('crew core state is intact regardless of substrate outcome', async () => {
    // Even when the agent is minimal (e.g. no transport), the crew
    // itself must remain functional. Substrate slots may or may not
    // be populated depending on which step succeeds.
    const agent = { address: 'broken-test-agent' };
    const cs = await buildCrewState({ crewConfig: BASE_CREW, meshAgent: agent });
    // Core crew state is always present.
    expect(cs.crewId).toBe('test-crew');
    expect(cs.liveCrew.name).toBe('Test');
    // _podCtx is always null at M1 (M4 seam).
    expect(cs._podCtx).toBeNull();
    // substrateDeviceId is always set when meshAgent.address exists.
    expect(cs.substrateDeviceId).toBe('broken-test-agent');
  });
});

// ── M1-S2 + M1-S4: navigation routes ────────────────────────────────

describe('M1-S2 + M1-S4 — navigation routes', () => {
  it('ROUTES.CreateCrew is defined', () => {
    expect(ROUTES.CreateCrew).toBe('CreateCrew');
  });

  it('ROUTES.PodSettings is defined', () => {
    expect(ROUTES.PodSettings).toBe('PodSettings');
  });

  it('all M1 routes are present in ROUTES', () => {
    expect(ROUTES).toMatchObject({
      CreateCrew:  'CreateCrew',
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

// ── M1-S2: CreateCrewScreen export smoke test ────────────────────────

describe('M1-S2 — CreateCrewScreen module', () => {
  it('exports CreateCrewScreen function', async () => {
    const mod = await import('../src/screens/CreateCrewScreen.jsx');
    expect(typeof mod.CreateCrewScreen).toBe('function');
  });
});

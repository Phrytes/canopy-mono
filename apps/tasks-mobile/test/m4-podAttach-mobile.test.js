/**
 * Tasks-mobile M4 — device-independent pod-attach depth tests.
 *
 * Verifies:
 *   1. `buildCrewState` now populates `_podCtx` with Tasks'
 *      classify/reverse functions (inactive; active at attach time).
 *   2. `attachTasksBundle` — called by ServiceContext.attachPod —
 *      activates routing and wires _podCtx on the shared bundle.
 *   3. `detachTasksBundle` reverts without touching the cache.
 *
 * Device-independent: no native modules, no real filesystem, no
 * real OIDC flow. Mirrors apps/stoop-mobile (analogous coverage).
 *
 * NOTE: written, not run here — orchestrator verifies in the main
 * tree (worktree node_modules is the known-incomplete install).
 */

import { describe, it, expect, vi } from 'vitest';
import { buildCrewState } from '../src/lib/buildCrewState.js';
import { attachTasksBundle, detachTasksBundle } from '@canopy-app/tasks-v0/lib/attachTasksBundle';
import { classify, reverseResolve } from '@canopy-app/tasks-v0/lib/podPathMap';

const BASE_CREW = {
  crewId:  'mobile-crew',
  name:    'Mobile Crew',
  kind:    'team',
  members: [{ webid: 'https://alice.pod/profile/card#me', role: 'admin' }],
};

// ── _podCtx seam: buildCrewState now pre-loads classify/reverse ──────

describe('M4 — buildCrewState._podCtx is pre-populated', () => {
  it('classify + reverse are the Tasks podPathMap functions', async () => {
    const cs = await buildCrewState({ crewConfig: BASE_CREW });
    expect(cs._podCtx).toBeTruthy();
    expect(cs._podCtx.classify).toBe(classify);
    expect(cs._podCtx.reverse).toBe(reverseResolve);
  });

  it('starts inactive (no pod attached yet)', async () => {
    const cs = await buildCrewState({ crewConfig: BASE_CREW });
    expect(cs._podCtx.active).toBe(false);
    expect(cs._podCtx.podRouting).toBeNull();
  });

  it('crewId is set from the crew config', async () => {
    const cs = await buildCrewState({ crewConfig: BASE_CREW });
    expect(cs._podCtx.crewId).toBe('mobile-crew');
  });
});

// ── attachTasksBundle activates the _podCtx ──────────────────────────

describe('M4 — attachTasksBundle activates _podCtx on a CrewState-shaped bundle', () => {
  function mkBundle(crewId) {
    const _podCtx = { active: false, classify: null, reverse: null,
                      podRouting: null, crewId, vars: null };
    return {
      _podCtx,
      cache:           { attachInner: vi.fn(async () => {}) },
      podRouting:      { setAnchor: vi.fn() },
      substrateDeviceId: 'mobile-dev',
    };
  }

  it('fills _podCtx + calls attachInner after setAnchor', async () => {
    const bundle = mkBundle('mobile-crew');
    const source = { tag: 'SolidPodSource' };
    await attachTasksBundle({
      bundle, source, podRoot: 'https://pod.example/alice/', fetch: vi.fn(),
    });

    expect(bundle.podRouting.setAnchor).toHaveBeenCalledWith('https://pod.example/alice/');
    expect(bundle._podCtx.active).toBe(true);
    expect(bundle._podCtx.classify).toBe(classify);
    expect(bundle._podCtx.reverse).toBe(reverseResolve);
    expect(bundle.cache.attachInner).toHaveBeenCalledWith(source);
  });

  it('remains byte-neutral when there is no podRouting (_podCtx.active stays false)', async () => {
    const bundle = mkBundle('mobile-crew');
    bundle.podRouting = undefined;
    await attachTasksBundle({
      bundle, source: {}, podRoot: 'https://pod.example/alice/', fetch: vi.fn(),
    });
    expect(bundle._podCtx.active).toBe(false);
    expect(bundle.cache.attachInner).toHaveBeenCalled();
  });
});

// ── detachTasksBundle reverts routing ────────────────────────────────

describe('M4 — detachTasksBundle', () => {
  it('deactivates _podCtx + reverts the anchor', () => {
    const bundle = {
      _podCtx: { active: true },
      podRouting: { setAnchor: vi.fn() },
    };
    detachTasksBundle({ bundle });
    expect(bundle._podCtx.active).toBe(false);
    expect(bundle.podRouting.setAnchor).toHaveBeenCalledWith(null);
  });

  it('tolerates missing bundle', () => {
    expect(() => detachTasksBundle({ bundle: undefined })).not.toThrow();
  });
});

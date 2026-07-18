/**
 * Tasks-mobile M4 — device-independent pod-attach depth tests.
 *
 * Verifies:
 *   1. `buildCircleState` now populates `_podCtx` with Tasks'
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
import { buildCircleState } from '../src/lib/buildCircleState.js';
import { attachTasksBundle, detachTasksBundle } from '@onderling-app/tasks/lib/attachTasksBundle';
import { classify, reverseResolve } from '@onderling-app/tasks/lib/podPathMap';

const BASE_CIRCLE = {
  circleId:  'mobile-circle',
  name:    'Mobile Circle',
  kind:    'team',
  members: [{ webid: 'https://alice.pod/profile/card#me', role: 'admin' }],
};

// ── _podCtx seam: buildCircleState now pre-loads classify/reverse ──────

describe('M4 — buildCircleState._podCtx is pre-populated', () => {
  it('classify + reverse are the Tasks podPathMap functions', async () => {
    const cs = await buildCircleState({ circleConfig: BASE_CIRCLE });
    expect(cs._podCtx).toBeTruthy();
    expect(cs._podCtx.classify).toBe(classify);
    expect(cs._podCtx.reverse).toBe(reverseResolve);
  });

  it('starts inactive (no pod attached yet)', async () => {
    const cs = await buildCircleState({ circleConfig: BASE_CIRCLE });
    expect(cs._podCtx.active).toBe(false);
    expect(cs._podCtx.podRouting).toBeNull();
  });

  it('circleId is set from the circle config', async () => {
    const cs = await buildCircleState({ circleConfig: BASE_CIRCLE });
    expect(cs._podCtx.circleId).toBe('mobile-circle');
  });
});

// ── attachTasksBundle activates the _podCtx ──────────────────────────

describe('M4 — attachTasksBundle activates _podCtx on a CircleState-shaped bundle', () => {
  function mkBundle(circleId) {
    const _podCtx = { active: false, classify: null, reverse: null,
                      podRouting: null, circleId, vars: null };
    return {
      _podCtx,
      cache:           { attachInner: vi.fn(async () => {}) },
      podRouting:      { setAnchor: vi.fn() },
      substrateDeviceId: 'mobile-dev',
    };
  }

  it('fills _podCtx + calls attachInner after setAnchor', async () => {
    const bundle = mkBundle('mobile-circle');
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
    const bundle = mkBundle('mobile-circle');
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

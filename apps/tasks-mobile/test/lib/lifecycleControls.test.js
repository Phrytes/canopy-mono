/**
 * lifecycleControls — gating-helper coverage.
 *
 * Task #227 (2026-05-24).
 *
 * Mirrors the substrate's role policy from
 * `apps/tasks-v0/src/skills/circleControls.js`:
 *   - admin  → pause + unpause + archive + unarchive
 *   - coord  → pause + unpause only
 *   - others → read-only label, no CTAs
 *
 * The UI mirrors this by hiding archive controls from coords; the
 * substrate enforces the same rule defensively. Both layers must stay
 * in sync — this test pins the UI side.
 *
 * Pure-function style matches `test/lib/useActiveRole.test.js`: no
 * React tree, no svc plumbing, just the derivation function.
 */

import { describe, it, expect } from 'vitest';
import { lifecycleControlsFor } from '../../src/lib/lifecycleControls.js';

describe('lifecycleControlsFor — admin', () => {
  it('admin on an active circle can pause + archive (not unpause/unarchive)', () => {
    const r = lifecycleControlsFor({ role: 'admin', paused: false, archived: false });
    expect(r.stateKey).toBe('active');
    expect(r.canPause).toBe(true);
    expect(r.canArchive).toBe(true);
    expect(r.canUnpause).toBe(false);
    expect(r.canUnarchive).toBe(false);
    expect(r.showReadOnly).toBe(false);
  });

  it('admin on a paused circle can unpause + archive', () => {
    const r = lifecycleControlsFor({ role: 'admin', paused: true, archived: false });
    expect(r.stateKey).toBe('paused');
    expect(r.canPause).toBe(false);
    expect(r.canUnpause).toBe(true);
    expect(r.canArchive).toBe(true);
    expect(r.canUnarchive).toBe(false);
  });

  it('admin on an archived circle can only unarchive (archived wins over paused)', () => {
    const r = lifecycleControlsFor({ role: 'admin', paused: true, archived: true });
    expect(r.stateKey).toBe('archived');
    expect(r.canPause).toBe(false);
    expect(r.canUnpause).toBe(false);
    expect(r.canArchive).toBe(false);
    expect(r.canUnarchive).toBe(true);
  });
});

describe('lifecycleControlsFor — coordinator', () => {
  it('coord can pause but NOT archive', () => {
    const r = lifecycleControlsFor({ role: 'coordinator', paused: false, archived: false });
    expect(r.canPause).toBe(true);
    expect(r.canArchive).toBe(false);
    expect(r.canUnarchive).toBe(false);
    expect(r.showReadOnly).toBe(false);
  });

  it('coord on a paused circle can unpause but NOT archive', () => {
    const r = lifecycleControlsFor({ role: 'coordinator', paused: true, archived: false });
    expect(r.canUnpause).toBe(true);
    expect(r.canPause).toBe(false);
    expect(r.canArchive).toBe(false);
    expect(r.canUnarchive).toBe(false);
  });

  it('coord on an archived circle sees no CTAs (only admins can unarchive)', () => {
    const r = lifecycleControlsFor({ role: 'coordinator', paused: false, archived: true });
    expect(r.canPause).toBe(false);
    expect(r.canUnpause).toBe(false);
    expect(r.canArchive).toBe(false);
    expect(r.canUnarchive).toBe(false);
    // Coord still owns the section header (not the member read-only
    // bail-out) — they keep getting state-aware copy, just no usable
    // CTAs while the circle is archived.
    expect(r.showReadOnly).toBe(false);
    expect(r.showAnyControl).toBe(false);
  });
});

describe('lifecycleControlsFor — member / observer / null', () => {
  it.each(['member', 'observer', null, undefined])(
    'role=%s shows the read-only label and no CTAs',
    (role) => {
      const r = lifecycleControlsFor({ role, paused: false, archived: false });
      expect(r.canPause).toBe(false);
      expect(r.canUnpause).toBe(false);
      expect(r.canArchive).toBe(false);
      expect(r.canUnarchive).toBe(false);
      expect(r.showReadOnly).toBe(true);
      expect(r.showAnyControl).toBe(false);
    },
  );

  it('stateKey still derives correctly for members (used by the member label)', () => {
    expect(lifecycleControlsFor({ role: 'member', paused: true, archived: false }).stateKey)
      .toBe('paused');
    expect(lifecycleControlsFor({ role: 'member', paused: false, archived: true }).stateKey)
      .toBe('archived');
  });
});

describe('lifecycleControlsFor — defaults', () => {
  it('handles an empty argument object as null-role read-only', () => {
    const r = lifecycleControlsFor({});
    expect(r.stateKey).toBe('active');
    expect(r.showReadOnly).toBe(true);
    expect(r.showAnyControl).toBe(false);
  });

  it('handles no argument at all', () => {
    const r = lifecycleControlsFor();
    expect(r.stateKey).toBe('active');
    expect(r.showReadOnly).toBe(true);
  });
});

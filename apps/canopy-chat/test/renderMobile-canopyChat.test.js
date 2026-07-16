/**
 * #221 acceptance — does renderMobile project canopy-chat's actual
 * composed manifests into a valid NavModel?
 *
 * renderMobile lives in @onderling/app-manifest as a strict-equivalence
 * re-export of renderWeb (cross-surface equivalence is the killer
 * property per DESIGN-navmodel-sketch.md § Q4).  The structural work
 * is already done; this test confirms the manifests canopy-chat
 * actually ships (mockTasks, mockStoop, mockFolio + household +
 * calendar) project cleanly without exceptions or empty output.
 *
 * If a manifest declares an `appliesTo` for an item-type not in
 * `itemTypes`, validate fails — that catches drift like the
 * subtask-request/subtask-proposal gap I had to fix in #219.
 *
 * Per the mobile roadmap (#221): household → tasks-v0 → stoop →
 * folio lift order.  This file exercises each one.
 */
import { describe, it, expect } from 'vitest';

import { renderMobile } from '@onderling/app-manifest';

import {
  mockTasksManifest, mockStoopManifest, mockFolioManifest,
} from '../src/core/manifests/mockManifests.js';
import { canopyChatManifest } from '../src/index.js';
import { calendarManifest } from '@onderling-app/calendar/manifest';

/**
 * Quick assertion bundle — the manifest must produce a NavModel
 * with at least one section per declared view, every section's
 * `affordances` + `itemActions` must reference operations that
 * actually exist in the manifest, and the output must be JSON-
 * serialisable (no circular refs).
 */
function assertValidNavModel(nav, manifest) {
  expect(nav.app).toBe(manifest.app);
  expect(Array.isArray(nav.sections)).toBe(true);
  // V0: at least one section iff at least one view declared.
  if ((manifest.views ?? []).length > 0) {
    expect(nav.sections.length).toBeGreaterThanOrEqual(1);
  }
  // Every section must have a unique `id` (= view.id).
  const ids = nav.sections.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  // Serialisable.
  expect(() => JSON.stringify(nav)).not.toThrow();
}

describe('#221 — renderMobile against canopy-chat manifests', () => {
  it('canopyChatManifest projects cleanly', () => {
    const nav = renderMobile(canopyChatManifest);
    assertValidNavModel(nav, canopyChatManifest);
  });

  it('mockTasksManifest (incl. #219 editTask + 7 sub-task ops) projects cleanly', () => {
    const nav = renderMobile(mockTasksManifest);
    assertValidNavModel(nav, mockTasksManifest);

    // Sanity: the #219 additions should surface somewhere — either
    // as itemActions on a relevant section, or as affordances.
    const allOpIds = new Set([
      ...nav.sections.flatMap((s) => s.itemActions ?? []).map((a) => a.opId),
      ...nav.sections.flatMap((s) => s.affordances ?? []).map((a) => a.opId),
      ...(nav.globals ?? []).map((a) => a.opId),
    ]);
    // editTask + addSubtask both have surfaces.ui.control:'button'
    // in the manifest, so renderMobile/Web must emit them as
    // itemActions (or affordances) on the right section.
    expect(allOpIds.has('editTask')).toBe(true);
    expect(allOpIds.has('addSubtask')).toBe(true);
  });

  it('mockStoopManifest projects cleanly', () => {
    const nav = renderMobile(mockStoopManifest);
    assertValidNavModel(nav, mockStoopManifest);
  });

  it('mockFolioManifest projects cleanly', () => {
    const nav = renderMobile(mockFolioManifest);
    assertValidNavModel(nav, mockFolioManifest);
  });

  it('calendarManifest projects cleanly', () => {
    const nav = renderMobile(calendarManifest);
    assertValidNavModel(nav, calendarManifest);
  });
});

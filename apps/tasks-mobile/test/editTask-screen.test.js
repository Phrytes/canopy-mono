/**
 * TaskDetailScreen editTask UI affordance (tasks-mobile).
 *
 * Pure static-analysis sibling of the substrate round-trip test in
 * `apps/tasks-v0/test/edit-task.test.js`.  The mobile screen test
 * surface in this repo is mostly static analysis + skill-binding
 * smoke (see `useAdapterAction.test.js`, `scaffold.test.js`) —
 * full React-Native render is not wired here (App.js doesn't
 * render under vitest per `scaffold.test.js`).  These tests pin
 * the things that matter:
 *
 *   1. The new editTask skill is wired into the screen
 *      (`useSkill('editTask')` present).  Caught duplicatively by
 *      `screen-skill-drift.test.js`, but this asserts the
 *      affordance didn't regress out of the file.
 *   2. The [Edit] button is gated by status (ready / waiting /
 *      blocked / claimed only — not submitted / complete /
 *      rejected) per the spec.
 *   3. The new locale keys exist in both en + nl bundles (no
 *      hardcoded strings — [[no-hardcoded-strings]]).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import enBundle from '../locales/en.json';
import nlBundle from '../locales/nl.json';

const HERE   = dirname(fileURLToPath(import.meta.url));
const SCREEN = join(HERE, '..', 'src', 'screens', 'TaskDetailScreen.jsx');

describe('#226 — TaskDetailScreen editTask wiring', () => {
  const src = readFileSync(SCREEN, 'utf8');

  it('happy path: binds the editTask skill via useSkill', () => {
    // Substrate round-trip lives in
    // apps/tasks-v0/test/edit-task.test.js; here we prove the
    // mobile screen actually calls the skill via the standard
    // useSkill seam (same pathway as claimTask / submitTask).
    expect(src).toMatch(/useSkill\(['"]editTask['"]\)/);
    // And that the dispatch is wired through _withErr (so errors
    // surface in the same banner as every other skill failure).
    expect(src).toMatch(/_withErr\(['"]editTask['"]/);
  });

  it('gates the [Edit] CTA on status.kind ∈ {ready, waiting, blocked, claimed}', () => {
    // The screen must only show Edit for open/claimed states; this
    // pins the four kind checks together so a future refactor that
    // moves them to a helper still has to satisfy the guard.
    for (const kind of ['ready', 'waiting', 'blocked', 'claimed']) {
      expect(src).toMatch(new RegExp(`status\\.kind\\s*===\\s*['"]${kind}['"]`));
    }
  });

  it('forbidden-field rejection: the patch builder only forwards text + notes', () => {
    // Mobile mirror of the substrate test's forbidden-field
    // assertion. The screen's onSubmitEdit must NOT include any
    // forbidden lifecycle / attribution fields in the call (those
    // have dedicated CTAs — Claim, Submit, Approve, Reassign, …).
    //
    // Concretely: the patch builder may set only `text` and
    // `notes` (plus the required `id`).  We pin the absence of
    // every forbidden field name in the dispatch site so a future
    // edit that adds a new form field has to also extend the
    // substrate's whitelist.
    const forbidden = [
      'assignee', 'claimedAt', 'completedAt', 'addedBy',
      'reviewLog', 'deliverable', 'approval', 'master',
      'parentTaskId',
    ];
    // Look for the onSubmitEdit body (between the function
    // declaration and the next `useCallback` close-paren).
    const m = src.match(/const onSubmitEdit\s*=\s*useCallback\(async\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\[/);
    expect(m, 'onSubmitEdit must be defined as a useCallback').toBeTruthy();
    const body = m[1];
    for (const f of forbidden) {
      expect(
        body.includes(`patch.${f}`),
        `onSubmitEdit must not set patch.${f} — forbidden lifecycle/attribution field`,
      ).toBe(false);
    }
  });

  it('uses t() for every new edit-form label (no hardcoded English in the affordance)', () => {
    // The six edit_* keys we own — every label routed via t().
    for (const key of [
      'mobile.task_detail.edit',
      'mobile.task_detail.edit_title',
      'mobile.task_detail.edit_text_label',
      'mobile.task_detail.edit_notes_label',
      'mobile.task_detail.edit_cancel',
      'mobile.task_detail.edit_save',
    ]) {
      expect(src).toContain(`t('${key}')`);
    }
  });
});

describe('#226 — locale bundles carry every new edit_* key', () => {
  const keys = ['edit', 'edit_title', 'edit_text_label', 'edit_notes_label',
                'edit_cancel', 'edit_save'];

  for (const key of keys) {
    it(`en.json mobile.task_detail.${key}.text is non-empty`, () => {
      const entry = enBundle?.mobile?.task_detail?.[key];
      expect(typeof entry?.text).toBe('string');
      expect(entry.text.length).toBeGreaterThan(0);
    });
    it(`nl.json mobile.task_detail.${key}.text is non-empty`, () => {
      const entry = nlBundle?.mobile?.task_detail?.[key];
      expect(typeof entry?.text).toBe('string');
      expect(entry.text.length).toBeGreaterThan(0);
    });
  }
});

/**
 * SP-3 V0 manifest test.
 *
 * Asserts:
 *   - The tasks-v0 manifest validates (`validateManifest`).
 *   - Every manifest op id matches a `defineSkill` id in
 *     `src/skills/index.js`'s `buildSkills()` output (so the manifest
 *     and the agent stay in sync — if a skill is renamed / removed,
 *     this test catches it before the LLM hits a wall).
 *   - `renderChat(manifest)` produces a well-formed toolCatalog
 *     covering every op with the expected shape.
 *   - `commandMenu` is empty (no `surfaces.slash` in V0 — chat-only).
 *
 * No web-UI tests; the existing 47 test files cover that surface.
 */

import { describe, it, expect } from 'vitest';

import { renderChat, validateManifest } from '@canopy/app-manifest';

import { tasksManifest }        from '../manifest.js';
import { buildSkills }          from '../src/skills/index.js';
import { buildWorkspaceSkills } from '../src/skills/workspace.js';
import { buildInboxSkills }     from '../src/skills/inbox.js';

describe('SP-3 V0: tasks-v0 manifest', () => {
  it('validateManifest = ok', () => {
    const { ok, errors } = validateManifest(tasksManifest);
    expect(ok, JSON.stringify(errors, null, 2)).toBe(true);
  });

  it('every manifest op id matches a defineSkill across the registered builders', () => {
    // SP-3 V0 ops live in `buildSkills`; Slice B.1 (2026-05-20) added
    // `getDagTree`, which lives in `buildWorkspaceSkills`.  Slice B.2.3
    // (2026-05-20) added `listMyInbox` + `clearInboxItem`, which live
    // in `buildInboxSkills`.  This is the same registration set that
    // `wireSkills` wires onto the meshAgent — expand here when new
    // builders surface manifest ops.
    const defs = [
      ...buildSkills({ bundleResolver: () => null }),
      ...buildWorkspaceSkills({ bundleResolver: () => null }),
      ...buildInboxSkills({ bundleResolver: () => null }),
    ];
    const skillIds = new Set(defs.map((d) => d.id));
    for (const op of tasksManifest.operations) {
      expect(
        skillIds,
        `manifest op "${op.id}" must have a matching skill in the registered builders`,
      ).toContain(op.id);
    }
  });

  it('renderChat produces well-formed toolCatalog covering every op', () => {
    const stub = Object.fromEntries(
      tasksManifest.operations.map((op) => [
        op.id,
        async () => ({ replies: [], stateUpdates: [] }),
      ]),
    );
    const out = renderChat(tasksManifest, {
      skillRegistry: stub,
      toSkillCtx:    (c) => c,
    });

    expect(out.toolCatalog).toHaveLength(tasksManifest.operations.length);
    expect(Object.keys(out.toolHandlers)).toHaveLength(tasksManifest.operations.length);

    for (const t of out.toolCatalog) {
      expect(t.id).toBeTruthy();
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.schema.type).toBe('object');
      expect(t.schema.properties).toBeTypeOf('object');
    }

    // Spot-check a state-gated op carries the multi-state array (F-SP3-a).
    const revoke = tasksManifest.operations.find((op) => op.id === 'revokeTask');
    expect(revoke.appliesTo.state).toEqual(['claimed', 'submitted', 'rejected']);
  });

  it('commandMenu is empty (no surfaces.slash in V0; chat-only)', () => {
    const out = renderChat(tasksManifest, {
      skillRegistry: {},
      toSkillCtx:    (c) => c,
    });
    expect(out.commandMenu).toEqual([]);
  });

  it('inlineKeyboardFor honours F-SP3-a multi-state gates on real ops', () => {
    const stub = Object.fromEntries(
      tasksManifest.operations.map((op) => [op.id, async () => ({})]),
    );
    const out = renderChat(tasksManifest, { skillRegistry: stub, toSkillCtx: (c) => c });

    // A submitted task → submit's gate is ['claimed','rejected'] so it
    // should NOT match; approve and reject's gate is ['submitted'] so
    // both SHOULD match; revoke's gate includes 'submitted' so it
    // matches too; claim only matches 'open'.
    const submittedKeys = out.inlineKeyboardFor({ id: 't1', type: 'task', state: 'submitted' })
      .map((b) => b.callbackData.split(':')[0]);
    expect(submittedKeys).toEqual(expect.arrayContaining(['approveTask', 'rejectTask', 'revokeTask']));
    expect(submittedKeys).not.toContain('submitTask');
    expect(submittedKeys).not.toContain('claimTask');

    // An open task → only claim matches.
    const openKeys = out.inlineKeyboardFor({ id: 't2', type: 'task', state: 'open' })
      .map((b) => b.callbackData.split(':')[0]);
    expect(openKeys).toEqual(['claimTask']);
  });
});

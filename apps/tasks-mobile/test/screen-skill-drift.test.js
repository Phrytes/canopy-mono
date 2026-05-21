/**
 * tasks-mobile screen skill drift canary (2026-05-21).
 *
 * RN sibling of `apps/tasks-v0/test/page-skill-drift.test.js`.
 * Tasks-mobile dispatches skills against the tasks-v0 agent (same
 * SDK, same skill set) — so the "real" skill IDs are tasks-v0's
 * builder outputs.  This test imports the same builder list and
 * scans `apps/tasks-mobile/src/screens/*.jsx` + `lib/*.js` for
 * `useSkill('<id>')` + `useSkillResult('<id>', ...)` calls.
 *
 * Catches:
 *   - typos in skill IDs in RN screens
 *   - skill renames where one site was missed
 *   - dead screens still using deleted skills
 *
 * JS comment stripping handles JSDoc blocks that contain example
 * usage like `useSkill('id')` (without it, the canary picks up
 * false positives from documentation strings).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname }                       from 'node:path';
import { fileURLToPath }                       from 'node:url';

// Same builder list as apps/tasks-v0/test/page-skill-drift.test.js —
// tasks-mobile and tasks-v0 share the same skill space.  Keep in
// sync.
import { buildSkills }                    from '../../tasks-v0/src/skills/index.js';
import { buildWorkspaceSkills }           from '../../tasks-v0/src/skills/workspace.js';
import { buildInboxSkills }               from '../../tasks-v0/src/skills/inbox.js';
import { buildSubtaskSkills }             from '../../tasks-v0/src/skills/subtasks.js';
import { buildCrewControlSkills }         from '../../tasks-v0/src/skills/crewControls.js';
import { buildAppealSkill }               from '../../tasks-v0/src/skills/appeal.js';
import { buildAvailabilitySkills }        from '../../tasks-v0/src/skills/availability.js';
import { buildBotBindingSkills }          from '../../tasks-v0/src/skills/botBindings.js';
import { buildCalendarEmissionSkills }    from '../../tasks-v0/src/skills/calendarEmission.js';
import { buildChatSkills }                from '../../tasks-v0/src/skills/chat.js';
import { buildCustomRoleSkills }          from '../../tasks-v0/src/skills/customRoles.js';
import { buildDashboardSkills }           from '../../tasks-v0/src/skills/dashboard.js';
import { buildForceCompleteSkill }        from '../../tasks-v0/src/skills/forceComplete.js';
import { buildInvoicingSkills }           from '../../tasks-v0/src/skills/invoicing.js';
import { buildMultiCrewOnboardingSkills } from '../../tasks-v0/src/skills/multiCrewOnboarding.js';
import { buildObservabilitySkills }       from '../../tasks-v0/src/skills/observability.js';
import { buildPlannerSkills }             from '../../tasks-v0/src/skills/planner.js';
import { buildProfileSkills }             from '../../tasks-v0/src/skills/profile.js';
import { buildPushTokenSkills }           from '../../tasks-v0/src/skills/pushTokens.js';

const HERE       = dirname(fileURLToPath(import.meta.url));
const SCREENS    = join(HERE, '..', 'src', 'screens');
const SCREENS_C  = join(SCREENS, 'crewSettings');  // crew-settings sub-tree
const LIB        = join(HERE, '..', 'src', 'lib');

// Substrate / cross-app skills tasks-mobile may invoke that aren't in
// tasks-v0's builder set.  Each entry must cite the source.
const ALLOWLIST = new Set([
  // @canopy/identity-resolver — buildIdentitySkills + buildOnboardingSkills
  'issueInvite',
  'redeemInvite',
  'resolveMember',
  // @canopy/sync-engine-rn — pod-attach diagnostics
  'whoAmI',
  // pod sign-in skills wired into the agent at runtime via
  // tasks-mobile/src/lib/podSignInSkillsMobile.js (composed on top
  // of tasks-v0's agent for the multi-skill service context).
  'podSignInStatus',
  'startPodSignIn',
  'completePodSignIn',
  'signOutOfPod',
  // ProfileMineScreen composes stoop's profile skills onto the shared
  // agent (per apps/tasks-mobile/docs/screen-inventory.md lines
  // 101 + 166 — intentional cross-app reuse).  Source:
  // apps/stoop/src/skills/index.js (setMyHandle, setMyDisplayName,
  // setMyAvatarUrl, setHolidayMode, getMyProfile).
  'getMyProfile',
  'setMyHandle',
  'setMyDisplayName',
  'setMyAvatarUrl',
  'setHolidayMode',
]);

/**
 * Strip JS line + block comments before scanning so JSDoc examples
 * (`useSkill('id')` inside `/** ... *​/` blocks) don't show up as
 * false positives.
 */
function stripJsComments(text) {
  // Block comments first (greediness handled by non-greedy `*?`),
  // then line comments.  Don't try to be clever about strings — if
  // someone has `useSkill('//foo')` they deserve what they get.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function collectIdsFromText(text) {
  const stripped = stripJsComments(text);
  const ids = new Set();
  // useSkill, useSkillResult, callSkill — all the RN dispatch entries.
  for (const m of stripped.matchAll(
    /(?:useSkill|useSkillResult|callSkill)\(['"]([A-Za-z_][\w-]*)['"]/g,
  )) {
    ids.add(m[1]);
  }
  return ids;
}

function walkJsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walkJsFiles(p, out);
      continue;
    }
    if (!/\.(jsx?|tsx?)$/.test(name)) continue;
    out.push(p);
  }
  return out;
}

function collectScreenSkillIds() {
  const ids = new Set();
  const files = [...walkJsFiles(SCREENS), ...walkJsFiles(LIB)];
  for (const p of files) {
    const text = readFileSync(p, 'utf8');
    for (const id of collectIdsFromText(text)) ids.add(id);
  }
  return ids;
}

function collectRealSkillIds() {
  const stub = { bundleResolver: () => null };
  const defs = [
    ...buildSkills({ ...stub, crewsProvider: () => [] }),
    ...buildWorkspaceSkills(stub),
    ...buildInboxSkills(stub),
    ...buildSubtaskSkills(stub),
    ...buildCrewControlSkills(stub),
    ...buildAppealSkill(stub),
    ...buildAvailabilitySkills(stub),
    ...buildBotBindingSkills(stub),
    ...buildCalendarEmissionSkills(stub),
    ...buildChatSkills(stub),
    ...buildCustomRoleSkills(stub),
    ...buildDashboardSkills({ ...stub, crewsProvider: () => [] }),
    ...buildForceCompleteSkill(stub),
    ...buildInvoicingSkills(stub),
    ...buildMultiCrewOnboardingSkills(stub),
    ...buildObservabilitySkills(stub),
    ...buildPlannerSkills(stub),
    ...buildProfileSkills(stub),
    ...buildPushTokenSkills(stub),
  ];
  return new Set(defs.map((d) => d.id));
}

describe('tasks-mobile screen skill drift canary', () => {
  it('every useSkill/useSkillResult/callSkill(<id>) in screens + lib maps to a real defineSkill', () => {
    const screenIds = collectScreenSkillIds();
    const real      = collectRealSkillIds();

    const orphans = [...screenIds]
      .filter((id) => !real.has(id) && !ALLOWLIST.has(id))
      .sort();

    expect(
      orphans,
      `tasks-mobile screens call skill IDs that are not defined anywhere:\n` +
        `  ${orphans.join('\n  ')}\n\n` +
        `Fix by:\n` +
        `  (a) correcting the typo in the screen, OR\n` +
        `  (b) adding the skill via defineSkill in the right tasks-v0 builder, OR\n` +
        `  (c) if the call is to a substrate skill (identity-resolver,\n` +
        `      sync-engine-rn, etc.), add the id to ALLOWLIST with a comment.\n`,
    ).toEqual([]);
  });

  it('reports the size of both sets (sanity check — non-empty)', () => {
    const screenIds = collectScreenSkillIds();
    const real      = collectRealSkillIds();
    expect(screenIds.size, 'should find at least some useSkill calls').toBeGreaterThan(10);
    expect(real.size,      'should find at least some defineSkill builders').toBeGreaterThan(50);
  });
});

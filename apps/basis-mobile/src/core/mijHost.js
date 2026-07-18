/**
 * mij#personas — the MOBILE host wiring behind the "Mij → persona's" surface.
 *
 * Portable twin of web's `openAboutMePanel` op sequence (apps/basis/web/v2/
 * circleApp.js): listAgents (role 'profile') → getProfileProperties /
 * getProfileDisclosure per persona → getPersonaRelease per enabled context →
 * `buildMijViewModel` (the SHARED read-model, apps/basis/src/v2/personaView.js
 * — web ≡ mobile by construction). The RN screen (CircleMijScreen) renders the
 * model and calls the op helpers below; NO model logic lives in the screen.
 *
 * Kept out of `src/screens/` on purpose: vitest excludes RN screens, so this
 * module is where the mobile half of the wiring is testable (test/mijHost.test.js),
 * matching the other mobile logic-level screen tests.
 *
 * All ops ride the injected 3-arg `callSkill(origin, opId, args)` — the same
 * bridge every v2 screen uses; reads re-run after each edit so the surface
 * reflects the PERSISTED state (verify the result, not the dispatch).
 */
// Relative paths (not `@onderling-app/basis` subpaths) — Metro doesn't honor
// package.json "exports" subpaths (same pattern as hostOps.js). The loader
// itself is the SHARED one (phase-D consolidation): web and mobile run the
// identical sequence by construction; pass `activeCircleId` to also run the
// marker-guarded roster-skills migration for that circle.
export { loadMijModel } from '../../../basis/src/v2/mijLoader.js';
export { shareDisclosureToCircle } from '../../../basis/src/core/handlers/personaPropsUpdate.js';

/** Section-1 edit — set a charter property on the GENERAL persona (the truth layer). */
export async function setGeneralProperty({ callSkill, defaultId, key, value }) {
  try { await callSkill('agents', 'setProfileProperty', { id: defaultId ?? 'default', key, value }); } catch { /* */ }
}

/** The shared skill key derivation — keyed by the phrase; re-using it edits. */
export { skillKeyFor } from '../../../basis/src/core/skillsMigration.js';
import { skillKeyFor as sharedSkillKeyFor } from '../../../basis/src/core/skillsMigration.js';

/** Skills (#Q1) — add a skill-kind driver ({text, tags}) to the GENERAL persona. */
export async function addGeneralSkill({ callSkill, defaultId, text, tags }) {
  const key = sharedSkillKeyFor({ text, tags });
  try { await callSkill('agents', 'setProfileDriver', { id: defaultId ?? 'default', key, kind: 'offering', text, tags }); } catch { /* */ }
}

/** Section-2 add-affordance — create a new persona (createProfile). */
export async function createPersona({ callSkill, name }) {
  try { await callSkill('agents', 'createProfile', { id: name }); } catch { /* */ }
}

/** Section-3 toggle — enable/withdraw one key's disclosure for a circle. */
export async function toggleDisclosure({ callSkill, personaId, defaultId, contextId, key, enabled }) {
  try { await callSkill('agents', 'setProfileDisclosure', { id: personaId ?? (defaultId ?? 'default'), contextId, key, enabled }); } catch { /* */ }
}

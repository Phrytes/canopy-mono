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
// Relative path (not a `@onderling-app/basis` subpath) — the basis package
// index does not export personaView yet, and Metro doesn't honor package.json
// "exports" subpaths (same pattern as hostOps.js / CircleAboutMeScreen).
import { buildMijViewModel } from '../../../basis/src/v2/personaView.js';
export { shareDisclosureToCircle } from '../../../basis/src/core/handlers/personaPropsUpdate.js';

/**
 * Load everything the Mij surface needs and build the shared view-model.
 * Mirrors the web host's `draw()` read sequence exactly.
 *
 * @param {object} args
 * @param {(origin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {string} [args.personaId]   the tapped profile row (kept in the list even when listAgents degrades)
 * @param {Array<{id: string, name?: string, charter?: object}>} [args.circles]
 * @returns {Promise<object>} the buildMijViewModel result
 */
export async function loadMijModel({ callSkill, personaId, circles = [] } = {}) {
  // Every profile-role registry entry is a persona; the opened row + the
  // default profile are included even when the list op degrades.
  let rows = [];
  try {
    const listed = await callSkill('agents', 'listAgents', {});
    rows = (listed?.agents ?? []).filter((a) => a?.role === 'profile');
  } catch { rows = []; }
  if (!rows.some((r) => r.agentId === 'default')) rows.unshift({ agentId: 'default', name: 'default' });
  if (personaId && !rows.some((r) => r.agentId === personaId)) rows.push({ agentId: personaId, name: personaId });

  const personas = await Promise.all(rows.map(async (r) => {
    let props = null; let disc = null;
    try { props = await callSkill('agents', 'getProfileProperties', { id: r.agentId }); } catch { /* */ }
    try { disc = await callSkill('agents', 'getProfileDisclosure', { id: r.agentId }); } catch { /* */ }
    return {
      id:         r.agentId,
      name:       r.name ?? r.agentId,
      properties: props?.properties ?? {},
      disclosure: disc?.disclosure ?? { perContext: {} },
    };
  }));

  // The released values per persona × circle (only where something is enabled).
  const releases = {};
  await Promise.all(personas.map(async (p) => {
    for (const [ctxId, policy] of Object.entries(p.disclosure?.perContext ?? {})) {
      const keys = Object.entries(policy ?? {}).filter(([, e]) => e?.enabled === true).map(([k]) => k);
      if (!keys.length) continue;
      try {
        const rel = await callSkill('agents', 'getPersonaRelease', { id: p.id, contextId: ctxId, keys: keys.join(',') });
        if (rel?.ok) (releases[p.id] ??= {})[ctxId] = rel.released ?? {};
      } catch { /* */ }
    }
  }));

  return buildMijViewModel({ personas, circles, releases });
}

/** Section-1 edit — set a charter property on the GENERAL persona (the truth layer). */
export async function setGeneralProperty({ callSkill, defaultId, key, value }) {
  try { await callSkill('agents', 'setProfileProperty', { id: defaultId ?? 'default', key, value }); } catch { /* */ }
}

/** The web host's skill key derivation — keyed by the phrase; re-using it edits. */
export function skillKeyFor({ text, tags }) {
  return (text || tags).trim().toLowerCase().slice(0, 40);
}

/** Skills (#Q1) — add a skill-kind driver ({text, tags}) to the GENERAL persona. */
export async function addGeneralSkill({ callSkill, defaultId, text, tags }) {
  const key = skillKeyFor({ text, tags });
  try { await callSkill('agents', 'setProfileDriver', { id: defaultId ?? 'default', key, kind: 'skill', text, tags }); } catch { /* */ }
}

/** Section-2 add-affordance — create a new persona (createProfile). */
export async function createPersona({ callSkill, name }) {
  try { await callSkill('agents', 'createProfile', { id: name }); } catch { /* */ }
}

/** Section-3 toggle — enable/withdraw one key's disclosure for a circle. */
export async function toggleDisclosure({ callSkill, personaId, defaultId, contextId, key, enabled }) {
  try { await callSkill('agents', 'setProfileDisclosure', { id: personaId ?? (defaultId ?? 'default'), contextId, key, enabled }); } catch { /* */ }
}

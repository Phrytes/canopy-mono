/**
 * @onderling/sdk/high — the HIGH-layer opinionated helpers.
 *
 * sub-path: the thin helpers built ON the low layer that inject the
 * defaults — createAgent (Tier-3 run-as-agent), connectSkill (Tier-1 plain
 * fn → skill) and wireSkill (manifest op → skill handler). A consumer who
 * wants only the high layer:
 *
 *     import { createAgent, connectSkill } from '@onderling/sdk/high';
 *
 * These re-export the existing helper modules unchanged; the main barrel
 * re-exports this slice, so `import { createAgent } from '@onderling/sdk'` is
 * identical.
 */
export { createAgent }  from './createAgent.js';
export { connectSkill } from './connectSkill.js';
export { wireSkill }    from './wireSkill.js';
export { buildSkillsFromManifest } from './buildSkillsFromManifest.js';

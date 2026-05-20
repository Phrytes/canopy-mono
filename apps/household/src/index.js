/**
 * @canopy-app/household — public exports.
 *
 * Phase 0 scaffold; Phase 1 foundation only at first commit.  Each
 * Phase 1 stream adds its own exports.
 */

// Phase 1 foundation:
export * as Types from './types.js';

// Phase 1 streams:
export { MockBridge }     from './bridges/MockBridge.js';
export { TelegramBridge } from './bridges/TelegramBridge.js';
export { regexParse }     from './parsers/regexCommands.js';
export * as Skills        from './skills/index.js';
export { InMemoryStore }  from './storage/InMemoryStore.js';

// Phase 1 convergence:
export { HouseholdAgent } from './HouseholdAgent.js';

// V2 prototype — additive coexistence with the legacy HouseholdAgent.
// See `apps/household/docs/EXPERIMENT-RESULTS.md` § "Future work" for
// the V2 architecture pivot plan.  Phase 1: this class ships in src/
// alongside the legacy agent; Phase 2 retires the legacy.
export { HouseholdAgentFreeform } from './HouseholdAgentFreeform.js';

// SP-4b/SP-11 (2026-05-20) — household as a `@canopy/manifest-host`
// mountable (consumed by `examples/manifest-host-demo/` + any future
// multi-app host).  Also re-export the manifest so consumers don't
// have to dig into the package layout.
export { createHouseholdMountable }    from './mountable.js';
export { HOUSEHOLD_SKILL_REGISTRY,
         noopContextBuilder }          from './skillRegistry.js';
export { householdManifest }           from '../manifest.js';

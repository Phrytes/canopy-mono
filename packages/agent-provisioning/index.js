/**
 * @canopy/agent-provisioning — one-call agent bring-up facade.
 *
 * Composes `@canopy/core` + the standardisation substrates into a
 * single `provisionAgent({...})` factory.  Apps that want the canonical
 * Hub-free bring-up use this; anything bespoke composes substrates
 * manually (every substrate stands alone).
 *
 * Authored 2026-05-11 as part of standardisation Phase 50.5.b — see
 * `Project Files/SDK/core-v2-coding-plan-2026-05-11.md`.
 */

export { provisionAgent } from './src/provisionAgent.js';

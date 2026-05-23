/**
 * @canopy/secure-agent — public entry.
 *
 * Safety-by-default agent factory.  See createSecureAgent.js for
 * the full design + opt list.
 *
 * Convention (after this lands, codified in
 * Project Files/conventions/architectural-layering.md):
 *   New apps composing a real network transport MUST use this
 *   factory.  Per-opt opt-outs require a grep-able
 *   `// SECURITY: opted out — <reason>` comment.
 */

export { createSecureAgent } from './createSecureAgent.js';
export { makeBrowserVault, restoreOrGenerate } from './vault.js';

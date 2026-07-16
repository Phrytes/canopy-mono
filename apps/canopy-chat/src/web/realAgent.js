/**
 * canopy-chat — web entry for the real-Agent factory.
 *
 * #225.1 (2026-05-24) split the previously single-file `realAgent.js`
 * (~1700 lines) into:
 *   - `src/core/agent/realAgent.js`  — portable factory (this re-exports it)
 *   - `src/web/realAgent.js`         — this file: web-side wrapper
 *
 * Today the factory is fully portable (browser-globals already accessed
 * via `typeof globalThis.X` guards; OIDC + window/location wiring lives
 * in `web/main.js` + `src/web/podAuth.js`, not here).  This wrapper
 * exists so:
 *   1. Existing imports (`web/main.js`, `test/*.test.js`) keep working
 *      without a churn-only path rewrite.
 *   2. Future web-only adapters (OIDC redirect handlers, browser-only
 *      diagnostic seams) have an obvious home — add them here without
 *      polluting the portable core.
 *
 * The canopy-chat-mobile bundle imports the core factory directly via
 * `@onderling-app/canopy-chat/core-realAgent`.
 */

export { createRealHouseholdAgent } from '../core/agent/realAgent.js';

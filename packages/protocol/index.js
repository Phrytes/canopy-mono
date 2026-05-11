/**
 * @canopy/protocol — state-machine substrate.
 *
 * Direction-only — Phase 52.13. The Tasks `propose-subtask` flow is
 * the canonical first consumer. V0 ships ONE consumer so the API
 * gets shaped against a real load-bearing case before opening to
 * other apps.
 *
 * See `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md` §52.13.
 */

export { defineProtocol, findTransition } from './src/defineProtocol.js';
export { createProtocolOrchestrator }     from './src/orchestrator.js';
export { PROPOSE_SUBTASK }                from './src/protocols/propose-subtask.js';

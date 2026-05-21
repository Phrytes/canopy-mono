/**
 * canopy-chat-rn — entry point.
 *
 * v0.2.5 ships the SCAFFOLD only — directory layout + module
 * structure + bootstrap shape.  Full feature parity with the web
 * app (multi-thread workspace, A2 lifecycle in RN, OIDC handoff in
 * v0.6, etc.) is its own multi-slice effort scheduled after the
 * v0.2 → v0.3 web work stabilises.
 *
 * Per the platform-parity convention
 * (`Project Files/conventions/architectural-layering.md` + the
 * canopy-chat coding plan): the PURE-LOGIC substrate is shared
 * with web via `@canopy-app/canopy-chat`.  Only the rendering
 * shell + native bootstrap is RN-specific.
 *
 * Phase v0.2 sub-slice 2.9 per `/Project Files/canopy-chat/coding-plan.md`.
 */

export { App } from './App.js';

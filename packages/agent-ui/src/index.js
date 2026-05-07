// Re-exports for convenience.  Apps typically import from
// './server' or './client' subpaths to avoid pulling in the other side.
//
// L1d's job (per Project Files/Substrates/L1d-agent-ui.md, re-scoped
// 2026-05-04): localhost-only A2A glue. The server side spins up a
// real `core.A2ATransport` bound to 127.0.0.1; the client side speaks
// A2A's wire shape from the same host.

export { mountLocalUi }     from './server/mountLocalUi.js';
export { LocalUiAuth }      from './server/LocalUiAuth.js';
export { LocalAgentClient } from './client/LocalAgentClient.js';

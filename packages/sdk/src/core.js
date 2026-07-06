/**
 * @canopy/sdk/core — the kernel BASE slice.
 *
 * SP-9 sub-path: the LOW-layer kernel only. This is `@canopy/core`
 * re-exported verbatim (the ports + kernel logic: Agent, AgentIdentity,
 * InternalBus/InternalTransport, OfflineTransport, Parts, Emitter, …) with
 * NONE of the concrete adapter extensions (vault / transports / pod) and
 * NONE of the HIGH-layer helpers. A consumer who wants only the kernel base
 * imports from here:
 *
 *     import { Agent, AgentIdentity } from '@canopy/sdk/core';
 *
 * The main `@canopy/sdk` barrel re-exports this slice unchanged, so
 * `import { Agent } from '@canopy/sdk'` is identical.
 */
export * from '@canopy/core';

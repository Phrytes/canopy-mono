/**
 * @onderling/sdk/core — the kernel BASE slice.
 *
 * sub-path: the LOW-layer kernel only. This is `@onderling/core`
 * re-exported verbatim (the ports + kernel logic: Agent, AgentIdentity,
 * InternalBus/InternalTransport, OfflineTransport, Parts, Emitter, …) with
 * NONE of the concrete adapter extensions (vault / transports / pod) and
 * NONE of the HIGH-layer helpers. A consumer who wants only the kernel base
 * imports from here:
 *
 *     import { Agent, AgentIdentity } from '@onderling/sdk/core';
 *
 * The main `@onderling/sdk` barrel re-exports this slice unchanged, so
 * `import { Agent } from '@onderling/sdk'` is identical.
 */
export * from '@onderling/core';

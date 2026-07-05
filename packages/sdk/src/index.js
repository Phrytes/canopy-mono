/**
 * @canopy/sdk — the batteries-included, LAYERED developer facade.
 *
 * ONE import for the whole SDK, in two layers:
 *
 * ── LOW layer (explicit / concrete) ─────────────────────────────────────
 * Named re-exports so a dev has a single import but passes adapters
 * EXPLICITLY (maximal clarity + compatibility). The whole kernel is
 * re-exported (`export * from '@canopy/core'`), plus the default concrete
 * adapters that were de-fatted OUT of the kernel:
 *   - the Vault family from @canopy/vault (VaultMemory is the default),
 *   - the network transports from @canopy/transports,
 *   - the pod pieces from @canopy/pod-client.
 * A dev who wants control uses these directly, e.g.:
 *
 *     import { Agent, AgentIdentity, VaultMemory, RelayTransport } from '@canopy/sdk';
 *     const id = await AgentIdentity.generate(new VaultMemory());
 *     const agent = new Agent({ identity: id, transport: new RelayTransport({ identity: id, relayUrl }) });
 *     await agent.start();
 *
 * ── HIGH layer (opinionated / "import one thing, done") ──────────────────
 * Thin helpers built ON the low layer that inject the defaults:
 *   - createAgent(opts)                 — Tier-3 run-as-agent, batteries in.
 *   - connectSkill(agent, name, appFn)  — Tier-1 plain-fn → skill adapter.
 *
 *     import { createAgent, connectSkill } from '@canopy/sdk';
 *     const agent = await createAgent();                       // VaultMemory + in-process transport, started
 *     connectSkill(agent, 'greet', (args) => `Hi ${args.name}`);
 *
 * Defaults live HERE (in the facade), never back in @canopy/core — the
 * kernel stays de-fatted; this package restores the DX on top of it.
 */

// ── LOW layer: the kernel ────────────────────────────────────────────────
export * from '@canopy/core';

// ── LOW layer: default adapters (concrete pieces de-fatted out of core) ──
// Vault family (VaultMemory is createAgent's default) + OAuth helper.
export {
  Vault,
  VaultMemory,
  VaultLocalStorage,
  VaultIndexedDB,
  VaultNodeFs,
  OAuthVault,
  makeAuthorizedFetch,
} from '@canopy/vault';

// Concrete network transports (the base Transport + InternalTransport /
// OfflineTransport stay in @canopy/core, re-exported above).
export {
  NknTransport,
  MqttTransport,
  RelayTransport,
  RendezvousTransport,
} from '@canopy/transports';

// Pod pieces — the whole @canopy/pod-client public surface (PodClient, Auth,
// SolidPodSource, ConflictResolver, sealing/sharing/tombstones, …).
export * from '@canopy/pod-client';

// ── HIGH layer: opinionated helpers ──────────────────────────────────────
export { createAgent }  from './createAgent.js';
export { connectSkill } from './connectSkill.js';

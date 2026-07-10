/**
 * companion-node — Slice R1 composition root.
 *
 * A user-hostable Node process that remotely hosts Folio's ALREADY-RELOCATABLE
 * (`runtime:'browser'`) pod-file agent, reachable by the user's own devices
 * over the mesh.  Everything from the skill-wire DOWN already exists and is
 * reused as-is; this file is the ~200-line composition root the plan calls for
 * (PLAN-companion-node-remote-hosting.md §R1), NOT a new substrate.
 *
 * On boot `startCompanionNode` does, in order:
 *   1. Load/persist a host `AgentIdentity` (stable pubKey across restarts, so a
 *      device can re-find the host) — VaultNodeFs under a config dir, or an
 *      injected vault (tests).
 *   2. Boot a local relay in-process (hermetic R1 proof) OR connect to a shared
 *      relay as a client (decision #5).  `blobGate` is left PASS-THROUGH so the
 *      media edge (server.js §blobGate mount) can compose into the same host
 *      later — R1 wires no media.
 *   3. Build the Node `store` satisfying agentCores.js's contract (store.js).
 *   4. Compose folio's relocatable agent: register EVERY `buildFolioSkills({
 *      store })` handler byte-for-byte like browser.js:219, plus the two direct
 *      pure ops browser.js registers (searchFiles / folio_briefSummary).
 *   5. Connect the host agent over `RelayTransport({ relayUrl, identity })`.
 *   6. `registerFolioAgent(...)` so a device discovers the host's pubKey +
 *      capabilities (the relocatable browser subset — node ops stay local).
 *   7. NO PolicyEngine — R1 is trusted/LAN.  The `requires-token` inbound gate
 *      lights up in R2 (marked below).
 *
 * REAL vs STUBBED (see README phase table + store.js / podSource.js headers):
 *   REAL   — the wire (RelayTransport), the registry (createAgentRegistry), the
 *            skill path (buildFolioSkills → wireSkill → pure cores), folio's
 *            cores, the pod round-trip (listPodFolio over a dev pod client),
 *            PodCapabilityToken issuance.
 *   STUBBED— pod *auth/delegation* (dev pod client held directly; no
 *            CapabilityAuth pod-direct token) and the registry *storage* (an
 *            in-memory Map, not a pod-backed resource).  Both are R1.5/R2.
 */
import { Agent, AgentIdentity }        from '@canopy/core';
import { RelayTransport }              from '@canopy/transports';
import { startRelay }                  from '@canopy/relay';
import { VaultNodeFs }                 from '@canopy/vault';

import { homedir }                     from 'node:os';
import { join }                        from 'node:path';

// Folio composition, reused verbatim (relative import into apps/folio/src —
// folio's node_modules resolves the transitive @canopy/* deps; mirrors folio's
// own relative `wireSkill` import). We do NOT reimplement folio's cores.
import { buildFolioSkills }            from '../../folio/src/wireSkills.js';
import { registerFolioAgent, FOLIO_CAPABILITIES } from '../../folio/src/registerFolioAgent.js';
import { searchFiles as searchFilesCore, folioBriefSummary } from '../../folio/src/agentCores.js';

import { buildCompanionStore }         from './store.js';
import { buildDevPodSource }           from './podSource.js';
import { makeMemoryRegistryPod }       from './registryPod.js';

const IDENTITY_FILE = 'host-identity.json';

/** XDG-style config dir for the host keypair (override with COMPANION_NODE_CONFIG_DIR). */
export function resolveConfigDir(explicit) {
  if (explicit) return explicit;
  if (process.env.COMPANION_NODE_CONFIG_DIR) return process.env.COMPANION_NODE_CONFIG_DIR;
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && xdg.length > 0 ? xdg : join(homedir(), '.config'), 'canopy-companion');
}

/**
 * Boot a companion node.
 *
 * @param {object} [opts]
 * @param {string}  [opts.relayUrl]        connect to a shared relay (decision #5);
 *                                         when absent, a local relay is booted in-process.
 * @param {number}  [opts.port=0]          local-relay port (0 ⇒ OS-assigned; ignored when relayUrl is set)
 * @param {string}  [opts.host='127.0.0.1'] local-relay bind host
 * @param {object}  [opts.blobGate=null]   PASS-THROUGH to startRelay (media edge; unused in R1)
 * @param {string}  [opts.configDir]       config dir for the persisted host keypair
 * @param {object}  [opts.identityVault]   inject a Vault (tests) — else VaultNodeFs on disk
 * @param {Array}   [opts.seedFiles]       override the store's demo seed index
 * @param {string}  [opts.podRoot]         token `pod` field for shareFolder
 * @param {{ podClient, containerUri }} [opts.podSource]  inject a pod source — else folio's dev pseudo-pod
 * @param {object}  [opts.registryPseudoPod]  inject the registry pod — else in-memory (R1)
 * @param {string}  [opts.label='companion-folio']
 * @returns {Promise<{
 *   agent: import('@canopy/core').Agent,
 *   identity: import('@canopy/core').AgentIdentity,
 *   relay: object|null,
 *   relayUrl: string,
 *   pseudoPod: object,
 *   deviceId: string,
 *   registry: object|null,
 *   store: object,
 *   capabilities: string[],
 *   stop: () => Promise<void>,
 * }>}
 */
export async function startCompanionNode(opts = {}) {
  const {
    relayUrl:  existingRelayUrl,
    port       = 0,
    host       = '127.0.0.1',
    blobGate   = null,
    configDir,
    identityVault,
    seedFiles,
    podRoot,
    podSource,
    registryPseudoPod,
    label      = 'companion-folio',
  } = opts;

  // ── 1. Host identity — persisted so the pubKey is stable across restarts ──
  const vault = identityVault
    ?? new VaultNodeFs(join(resolveConfigDir(configDir), IDENTITY_FILE));
  const identity = (await vault.has('agent-privkey'))
    ? await AgentIdentity.restore(vault)
    : await AgentIdentity.generate(vault);

  // ── 2. Relay — connect to a shared one (decision #5), else boot local ─────
  let relay    = null;
  let relayUrl = existingRelayUrl ?? null;
  if (!relayUrl) {
    // blobGate stays pass-through: the media edge composes into this same
    // process later (server.js mounts it additively) without R1 precluding it.
    relay    = await startRelay({ port, host, blobGate });
    relayUrl = `ws://${host}:${relay.port}`;
  }

  // ── 3. Node store satisfying agentCores.js's contract (real skill path) ───
  const resolvedPodSource = podSource ?? await buildDevPodSource();
  const store = buildCompanionStore({
    identity, seedFiles, podRoot, podSource: resolvedPodSource,
  });

  // ── 4. Compose folio's relocatable agent (byte-identical to browser.js) ───
  const transport = new RelayTransport({ relayUrl, identity });
  const agent = new Agent({ identity, transport, label });

  for (const skill of buildFolioSkills({ store })) {
    agent.register(skill.id, skill.handler);
  }
  // The two ops browser.js registers directly (no manifest op; pure + node-free).
  agent.register('searchFiles',        async ({ parts }) => searchFilesCore(store, parts?.[0]?.data ?? {}));
  agent.register('folio_briefSummary', async () => folioBriefSummary(store));

  // R2: attach PolicyEngine here (requires-token inbound gate + TrustRegistry) —
  //     first activation of the parked gate. R1 is trusted/LAN, so no gate.

  // ── 5. Connect the host agent over the relay ──────────────────────────────
  await agent.start();

  // ── 6. Self-register so a device discovers the host's pubKey + capabilities ─
  // deviceId = the pseudoPod URI authority = agent.address (browser convention).
  const pseudoPod = registryPseudoPod ?? makeMemoryRegistryPod();
  const deviceId  = agent.address;
  const registry  = await registerFolioAgent({ pseudoPod, deviceId, agent });

  async function stop() {
    try { await agent.stop?.(); } catch { /* best-effort */ }
    if (relay) { try { await relay.stop(); } catch { /* best-effort */ } }
  }

  return {
    agent,
    identity,
    relay,
    relayUrl,
    pseudoPod,
    deviceId,
    registry,
    store,
    capabilities: [...FOLIO_CAPABILITIES],
    stop,
  };
}

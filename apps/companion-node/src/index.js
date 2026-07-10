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
 *   7. R2 — attach a `PolicyEngine` (+ `TrustRegistry` + `TokenRegistry`) so the
 *      relocatable pod-file skills become `requires-token`: an inbound `callSkill`
 *      is now gated by `runGatedSkill → agent.policyEngine.checkInbound`
 *      (`taskExchange.js:467`).  This is the FIRST real activation of the parked
 *      invoke-gate.  Default gate ON (a remote host SHOULD be gated); pass
 *      `opts.gate === false` to fall back to R1's trusted-LAN, no-gate mode.
 *
 * ── R2 trust / issuance model (Host-as-authority) ─────────────────────────────
 *   The host is the token AUTHORITY.  `host.authorizeDevice(devicePubKey, …)`
 *   mints a per-skill `CapabilityToken` signed by the HOST identity
 *   (issuer = host, subject = device, agentId = host).  The host pins its OWN
 *   pubKey at 'trusted' in its TrustRegistry so its self-issued tokens clear
 *   `checkInbound`'s issuer-trust check; the device's default tier
 *   ('authenticated') clears the visibility gate; the token's subject == the
 *   calling peer defeats theft/forwarding; per-skill scope is enforced by
 *   `skillMatches`; and revocation is the host's issuer-side list
 *   (`host.revokeToken(id)` → the PolicyEngine's `isRevoked` consults
 *   `TokenRegistry.isRevoked`).  Expiry rides on the token.  What R2 does NOT do:
 *   pod-side credential delegation (still the R1 dev pod client held directly —
 *   that's R2b/CapabilityAuth pod-direct) and the BYO agent-proxy (R3).
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
import { Agent, AgentIdentity,
         PolicyEngine, TrustRegistry, TokenRegistry, CapabilityToken } from '@canopy/core';
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
import { buildDevMediaEdge }           from './mediaEdge.js';

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
 * @param {object}  [opts.blobGate=null]   explicit blobGate config (real-infra injection); wins over `media`.
 * @param {boolean} [opts.media=false]     R-media: mount the media blob edge as the 2nd tenant on the
 *                                         local relay (dev bucket + capability verifier, sealed-only,
 *                                         deny-by-default). OFF by default so R1/R2 tests are unaffected.
 * @param {object}  [opts.mediaEdge]       media-edge config forwarded to `buildDevMediaEdge`
 *                                         ({ uploaders, ttl, requiredSkill, route, bucket, verifyToken });
 *                                         passing it also enables the edge. `uploaders` defaults to [] = NOBODY.
 * @param {string}  [opts.configDir]       config dir for the persisted host keypair
 * @param {object}  [opts.identityVault]   inject a Vault (tests) — else VaultNodeFs on disk
 * @param {boolean} [opts.gate=true]       R2 inbound capability-token gate. Default ON:
 *                                         the folio pod-file skills become `requires-token`
 *                                         and a PolicyEngine is attached. `false` ⇒ R1
 *                                         trusted-LAN mode (no gate, no PolicyEngine).
 * @param {object}  [opts.permissionsVault] vault backing the host's TrustRegistry + TokenRegistry
 *                                         (trust pins + issuer-side revocation). Defaults to the
 *                                         identity vault (a multi-key store), so pins/revocations
 *                                         persist alongside the keypair; inject a separate one to isolate.
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
    media      = false,
    mediaEdge,
    configDir,
    identityVault,
    seedFiles,
    podRoot,
    podSource,
    registryPseudoPod,
    label      = 'companion-folio',
    gate       = true,
    permissionsVault,
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
  let mediaEdgeCfg = null;
  if (!relayUrl) {
    // R-media: the media blob edge is the companion's SECOND tenant. The blobGate
    // seam (server.js:254) mounts it additively on THIS relay's HTTP server — one
    // process, one port, folio-over-WS + blob-edge-over-HTTP. When media is
    // requested we supply a real dev blobGate config (dev bucket + capability
    // verifier, sealed-only / deny-by-default) instead of R1's pass-through null.
    // An explicit `blobGate` opt still wins (real-infra injection).
    // real bucket/verifier swap = Frits' infra action (one documented seam — mediaEdge.js).
    mediaEdgeCfg = blobGate ?? ((media || mediaEdge)
      ? buildDevMediaEdge((mediaEdge && typeof mediaEdge === 'object') ? mediaEdge : {})
      : null);
    relay    = await startRelay({ port, host, blobGate: mediaEdgeCfg });
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

  // R2: when the gate is ON, every relocatable pod-file skill is marked
  //     `requires-token` — the PolicyEngine (attached below) reads this `policy`
  //     field off `agent.skills` in `checkInbound`, so an inbound call with no
  //     (or a bad/expired/revoked/out-of-scope) token is REJECTED before the
  //     handler runs. Gate OFF ⇒ R1 behaviour (default `on-request` policy).
  const skillOpts = gate ? { policy: 'requires-token' } : {};

  for (const skill of buildFolioSkills({ store })) {
    agent.register(skill.id, skill.handler, skillOpts);
  }
  // The two ops browser.js registers directly (no manifest op; pure + node-free).
  agent.register('searchFiles',        async ({ parts }) => searchFilesCore(store, parts?.[0]?.data ?? {}), skillOpts);
  agent.register('folio_briefSummary', async () => folioBriefSummary(store), skillOpts);

  // ── R2. Inbound capability-token gate — first activation of the parked engine ─
  // Host-as-authority model (see header). Only built when the gate is ON.
  let trustRegistry = null;
  let tokenRegistry = null;
  let policyEngine  = null;
  if (gate) {
    const permVault = permissionsVault ?? vault;   // multi-key store; reuse identity vault by default
    trustRegistry   = new TrustRegistry(permVault);
    tokenRegistry   = new TokenRegistry(permVault);

    // The host trusts ITSELF as the token issuer: its self-issued tokens must
    // clear `checkInbound`'s issuer-trust floor (≥ 'trusted'). Unknown peers
    // default to 'authenticated', which is below the floor — so ONLY host-issued
    // (or host-trusted) tokens verify.
    await trustRegistry.setTier(identity.pubKey, 'trusted');

    policyEngine = new PolicyEngine({
      trustRegistry,
      skillRegistry: agent.skills,        // same registry the skills registered on — reads `policy`
      agentPubKey:   identity.pubKey,     // binds token.agentId → this host
      // Issuer-side revocation: the host's own TokenRegistry revocation list.
      // `host.revokeToken(id)` sets it; a previously-valid token then fails here.
      isRevoked:     (tokenId) => tokenRegistry.isRevoked(tokenId),
    });
    // Attach-once setter — THIS is what makes `runGatedSkill` consult the engine
    // (taskExchange.js:467). Without it the engine is inert (the createSecureAgent
    // lesson: policyEngineAttach.test.js).
    agent.policyEngine = policyEngine;
  }

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

  /**
   * R2 — authorize a device to call gated skills on this host. Mints one
   * skill-scoped `CapabilityToken` per requested skill, signed by the HOST
   * identity (issuer = host, subject = device, agentId = host). The device
   * stores each returned token in its own `TokenRegistry`; the outbound
   * `callSkill` path then auto-attaches it (taskExchange.js:87-90) and this
   * host's `checkInbound` verifies subject == caller · scope · issuer-trust ·
   * revocation · expiry.
   *
   * @param {string}   devicePubKey        the calling device's Ed25519 pubKey (base64url)
   * @param {object}   [o]
   * @param {string[]} [o.skills]          skill ids to grant (default: the advertised set).
   *                                       Use `['*']` for a blanket grant.
   * @param {number}   [o.expiresIn]       ms until expiry (default: CapabilityToken default, 1h)
   * @returns {Promise<import('@canopy/core').CapabilityToken[]>} one token per skill
   */
  async function authorizeDevice(devicePubKey, { skills, expiresIn } = {}) {
    if (!gate || !tokenRegistry) {
      throw new Error('authorizeDevice: gate is OFF — no permission substrate to issue against');
    }
    if (!devicePubKey || typeof devicePubKey !== 'string') {
      throw new Error('authorizeDevice: devicePubKey (string) required');
    }
    const grantSkills = (Array.isArray(skills) && skills.length > 0)
      ? skills
      : [...FOLIO_CAPABILITIES];
    const tokens = [];
    for (const skill of grantSkills) {
      const token = await CapabilityToken.issue(identity, {
        subject: devicePubKey,
        agentId: identity.pubKey,
        skill,
        ...(typeof expiresIn === 'number' ? { expiresIn } : {}),
      });
      // Keep an issuer-side ledger so `revokeToken` has something to revoke.
      await tokenRegistry.store(token);
      tokens.push(token);
    }
    return tokens;
  }

  /**
   * R2 — revoke a token this host issued (by id). The PolicyEngine's
   * `isRevoked` consults this list, so the SAME previously-valid call is
   * rejected on the next attempt — live, per-token revocation.
   * @param {string} tokenId
   */
  async function revokeToken(tokenId) {
    if (!tokenRegistry) {
      throw new Error('revokeToken: gate is OFF — no revocation list');
    }
    await tokenRegistry.revoke(tokenId);
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
    // R-media (2nd tenant): the assembled blob-edge config ({ verifyToken, bucket,
    // uploaders, ttl, route }) when media is ON, else null. The LIVE ACL store is
    // on `relay.blobGate.acl` (mount default). Both null when media is OFF.
    mediaEdge: mediaEdgeCfg,
    capabilities: [...FOLIO_CAPABILITIES],
    // R2 — the inbound gate + its authority surface (all null when gate is OFF).
    gate,
    policyEngine,
    trustRegistry,
    tokenRegistry,
    authorizeDevice,
    revokeToken,
    stop,
  };
}

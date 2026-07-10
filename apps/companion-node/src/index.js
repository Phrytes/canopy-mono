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
import { Agent, AgentIdentity, Parts, PodCapabilityToken,
         PolicyEngine, TrustRegistry, TokenRegistry, CapabilityToken } from '@canopy/core';
import { RelayTransport }              from '@canopy/transports';
import { startRelay }                  from '@canopy/relay';
import { VaultNodeFs }                 from '@canopy/vault';
import { createPodTokenVerifier, PodClient, CapabilityAuth } from '@canopy/pod-client';

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
import { ScopedPodClient, closedPodClient } from './scopedPodClient.js';
import { ACCEPT_DELEGATION_OP }        from './authorizePod.js';
import { makeMemoryRegistryPod }       from './registryPod.js';
import { buildDevMediaEdge }           from './mediaEdge.js';

const IDENTITY_FILE = 'host-identity.json';

/**
 * R3.0 — bound the host→device `pod.proxyRequest` invoke so an OFFLINE device
 * degrades to an EXPLICIT `device-unreachable` instead of hanging on the
 * default 30 s task timeout (§R3 decision #3).
 */
const PROXY_INVOKE_TIMEOUT_MS = 8_000;

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
 * @param {object}  [opts.podToken]        R2b.1 — boot-time injection of a `PodCapabilityToken` delegating pod
 *                                         access to THIS host (back-compat). When supplied, the held pod client
 *                                         is wrapped in a `ScopedPodClient` at boot so every pod op is
 *                                         scope/expiry/revocation-checked (deny-by-default). The REAL R2b.2 path
 *                                         is the `pod.acceptDelegation` handshake: the device (owner) delivers
 *                                         the token over the wire and the host installs it after verifying
 *                                         signature + `subject == host` + `issuer == podOwnerPubKey`.
 * @param {string}  [opts.podOwnerPubKey]  R2b.2 — the pod owner's pubKey, the host's DELEGATION TRUST ROOT.
 *                                         (1) It is the token-ISSUER the `ScopedPodClient` verifier trusts
 *                                         (`isTrusted: (i) => i === podOwnerPubKey`); (2) `pod.acceptDelegation`
 *                                         REJECTS any delivered token whose `issuer !== podOwnerPubKey`; and
 *                                         (3) when it is set but NO `podToken` is pre-injected, the host boots
 *                                         FAILING CLOSED — every pod op denies until a valid delegation arrives.
 * @param {object}  [opts.podTokenRegistry] R2b.1 — a `PodTokenRegistry` (owner-side) whose `isRevoked` the
 *                                         pod gate consults, so revoking the delegation denies live.
 * @param {() => number} [opts.podNow]     R2b.1 — injectable clock (unix-ms) for the pod gate's expiry check
 *                                         (tests force expiry without wall-clock waits). Default: Date.now.
 * @param {boolean} [opts.podProxy=false]  R3.0 — the AGENT-PROXY pod path. When ON, a valid
 *                                         `pod.acceptDelegation` swaps the pod source to a real
 *                                         `PodClient({ auth: CapabilityAuth{ mode:'agent-proxy' } })`
 *                                         instead of R2b.1's in-process `ScopedPodClient`: every pod
 *                                         `fetch` is proxied back to the DELEGATING DEVICE (captured
 *                                         from `ctx.from`), which holds the pod's OIDC session and is
 *                                         the AUTHORITATIVE scope check — so NO pod secret reaches this
 *                                         host. `podRoot` = the token's `pod`; the container browsed =
 *                                         `opts.podContainer` (or `opts.podSource.containerUri`).
 * @param {string}  [opts.podContainer]   R3.0 — container URI the proxy `PodClient` browses
 *                                         (default: `opts.podSource.containerUri`).
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
    podToken,
    podOwnerPubKey,
    podTokenRegistry,
    podNow,
    podProxy   = false,
    podContainer,
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

  // ── R2b. Scope-enforce the POD LEG behind a delegated PodCapabilityToken ──
  // R2b.2: the token now arrives over the `pod.acceptDelegation` handshake (see
  // below) — `opts.podToken` is kept as R2b.1's boot-time injection (back-compat).
  //
  // `wrapScopedPodSource(token)` wraps the held pod client in a `ScopedPodClient`
  // so EVERY pod op the folio cores reach (today: `.list` via listFiles/pod) is
  // verified — scope · expiry · issuer-trust · revocation, deny-by-default — before
  // it touches the client. Owner-issued trust: the host trusts the pod OWNER's key
  // as the token issuer. The SAME verifier config is reused whether the token was
  // injected at boot or delivered over the wire, so the handshake path enforces
  // exactly what R2b.1 did (revocation/expiry/scope all hold post-delivery).
  function wrapScopedPodSource(token) {
    return {
      ...resolvedPodSource,
      podClient: new ScopedPodClient({
        inner:   resolvedPodSource.podClient,
        token,
        podRoot: token.pod ?? token.toJSON?.().pod ?? podRoot,
        verify:  createPodTokenVerifier({
          // Owner-issued: trust the pod owner's key as issuer. When no owner key
          // is pinned, accept the token as issued (still scope/expiry/revocation-
          // gated). The R2b.2 handshake pins the real owner key (podOwnerPubKey).
          ...(podOwnerPubKey ? { isTrusted: (i) => i === podOwnerPubKey } : {}),
          ...(podTokenRegistry ? { isRevoked: (id) => podTokenRegistry.isRevoked(id) } : {}),
          ...(typeof podNow === 'function' ? { now: podNow } : {}),
        }),
      }),
    };
  }

  // ── R3.0. AGENT-PROXY pod source — the network-adversary boundary ─────────
  // Instead of holding a pod client (even a scoped one), the host runs a real
  // `PodClient` whose ONLY pod credential is a proxying `fetch`: every request
  // is shipped back to the DELEGATING DEVICE via `pod.proxyRequest`. The device
  // holds the pod's OIDC session and is the authoritative scope check, so this
  // host never touches the pod or its secrets — it only carries the signed
  // capability token (a scoped grant, not a credential). `deviceAddr` is the
  // device we captured at `pod.acceptDelegation` (`ctx.from`).
  function buildProxyPodSource(token, deviceAddr) {
    const container = podContainer ?? resolvedPodSource?.containerUri;
    if (!container) {
      throw new Error('companion-node: podProxy requires a container URI (opts.podContainer or opts.podSource.containerUri)');
    }
    const podRootForToken = token.pod ?? token.toJSON?.().pod ?? podRoot;
    const auth = new CapabilityAuth({
      mode:       'agent-proxy',
      token,
      deviceAddr,
      // The proxying fetch calls this; it must resolve to the device handler's
      // reply DATA. A bounded timeout turns an offline device into an explicit
      // `device-unreachable` (thrown inside CapabilityAuth) rather than a hang.
      invoke: async (addr, skill, payload) =>
        Parts.data(await agent.invoke(addr, skill, payload, { timeout: PROXY_INVOKE_TIMEOUT_MS })),
    });
    const podClient = new PodClient({ podRoot: podRootForToken, auth });
    return { podClient, containerUri: container };
  }

  // Boot posture for the pod leg:
  //   (a) podToken injected (R2b.1 back-compat) → wrap NOW, gated from boot.
  //   (b) configured for delegation (podOwnerPubKey set) but NO token yet →
  //       FAIL CLOSED: every pod op denies until a valid `pod.acceptDelegation`
  //       arrives and rewraps the source. An un-delegated host CANNOT read the pod.
  //   (c) neither (R1/R2/R-media) → the held client is ungated.
  const initialPodSource = (podToken && resolvedPodSource?.podClient)
    ? wrapScopedPodSource(podToken)
    : (podOwnerPubKey && resolvedPodSource?.podClient)
      ? { ...resolvedPodSource, podClient: closedPodClient(resolvedPodSource.podClient) }
      : resolvedPodSource;

  const store = buildCompanionStore({
    identity, seedFiles, podRoot, podSource: initialPodSource,
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

  // ── R2b.2. `pod.acceptDelegation` — the device→host delegation RECEIVE op ──
  // Registered UNGATED (default `on-request`, NOT `requires-token`) and this is
  // SAFE: the op is SELF-AUTHORIZING — the delivered `PodCapabilityToken` IS the
  // authorization, and the host cryptographically verifies it (Ed25519 signature +
  // `subject == this host` + `issuer == the configured owner`) BEFORE installing.
  // A prior R2 skill token would add nothing (the owner's signature over a token
  // bound to THIS host's subject is the trust root), and requiring one would create
  // a chicken-and-egg (the device would need a host-issued skill token just to
  // deliver the owner's pod grant). No prior authorization ⇒ no chicken-and-egg;
  // a bogus/mis-delegated token can never install because all three checks must
  // pass. Rejection is OPAQUE (`{ok:false,error:'delegation rejected'}`) — it never
  // leaks WHICH check failed. On reject the pod source is untouched, so an
  // un-delegated (or wrongly-delegated) host keeps failing closed.
  agent.register(ACCEPT_DELEGATION_OP, async (ctx) => {
    try {
      const { parts } = ctx;
      // R3.0 — CAPTURE the delegating device's address (the proxy origin). R2b
      // discarded this; agent-proxy needs it to `invoke` pod requests back to
      // the exact device that delegated (its OIDC session is the pod secret).
      const capturedFrom = ctx.originFrom ?? ctx.from;
      const raw = Parts.data(parts)?.token;
      if (!raw || typeof raw !== 'object') return { ok: false, error: 'delegation rejected' };

      // The host must be pre-configured with its owner's key; only that owner may
      // delegate this host's pod access. No configured owner ⇒ nothing to trust.
      if (!podOwnerPubKey) return { ok: false, error: 'delegation rejected' };

      // Verification order (all deny-by-default; any miss ⇒ opaque reject, no install):
      //   1. signature + expiry (+ pod binding when the host pins podRoot)
      const expectedPod = podRoot ?? undefined;
      if (PodCapabilityToken.verify(raw, expectedPod) !== true) {
        return { ok: false, error: 'delegation rejected' };
      }
      //   2. subject == THIS host — the grant was delegated to us, not replayed
      //      against us (the binding R2b.1 deferred to the wire-delivery point).
      if (raw.subject !== agent.pubKey) {
        return { ok: false, error: 'delegation rejected' };
      }
      //   3. issuer == the configured owner — only the legitimate owner may
      //      delegate; a random device cannot install a bogus delegation.
      if (raw.issuer !== podOwnerPubKey) {
        return { ok: false, error: 'delegation rejected' };
      }

      // Install. Two paths, opts-gated:
      //   • R3.0 (podProxy ON): swap to a real `PodClient` whose fetch is
      //     proxied back to the delegating DEVICE (`capturedFrom`). The device
      //     is the authoritative scope check; this host holds NO pod secret.
      //     We deliberately do NOT also wrap in the advisory `ScopedPodClient`
      //     here so the DEVICE remains provably the sole scope authority in the
      //     R3.0 fitness proof (a local pre-filter would mask device authority).
      //     (Decision #4's advisory pre-filter is deferred to a later slice.)
      //   • R2b (podProxy OFF): rewrap the held pod source in a `ScopedPodClient`
      //     presenting the delivered token — the in-process delegation path.
      const token = PodCapabilityToken.fromJSON(raw);
      if (podProxy) {
        if (!capturedFrom) return { ok: false, error: 'delegation rejected' };
        store.setPodSource(buildProxyPodSource(token, capturedFrom));
      } else {
        store.setPodSource(wrapScopedPodSource(token));
      }

      return { ok: true, subject: token.subject, scopes: token.scopes, expiresAt: token.expiresAt };
    } catch {
      // Deny-by-default: any parse/verify throw ⇒ opaque reject, no install.
      return { ok: false, error: 'delegation rejected' };
    }
  });

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

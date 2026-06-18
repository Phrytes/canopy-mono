/**
 * @canopy/secure-agent — createSecureAgent factory.
 *
 * Safety-by-default composition.  This file ships the FOUNDATION
 * (S0 in the security roadmap); future slices (S1-S8) add opts
 * for mute / helloGates / signed-claim / passphrase-vault /
 * identity-resolver / capability-tokens / audit-log / groups /
 * PFS — each as a checkbox flag, not manual wiring.
 *
 * See Project Files/canopy-chat/security-roadmap-2026-05-23.md.
 *
 * # What lands in S0 (this file)
 *
 *   - Persistent identity (vault-backed) via restoreOrGenerate
 *   - Agent with auto-SecurityLayer (already core default)
 *   - Optional NknTransport, wired with useSecurityLayer + auto-HI
 *   - rotateIdentity wrapper (Agent.rotateIdentity + grace + broadcast)
 *   - securityStatus diagnostic
 *
 * # What lands in S1 + S2 + S3 (also this file)
 *
 *   - muteListVaultKey   (S1 — A.1)   persistent mute set + send-side block
 *   - helloGate          (S1 — A+.1)  PSK / predicate gate + mute base gate
 *   - webidClaim         (S2 — A.2)   sa.claim.sign/verify/serialize/parse
 *   - passphrase         (S3 — A.3)   forwards to vault picker → VaultIndexedDB
 *   - webAuthnUnlock     (S3 — A+.5)  sa.passkey.{register,unlock} via PRF
 *   - identityResolver   (S4 — A.4)   sa.resolver.* + alias-fanout mute
 *   - trustRegistry      (S5 — A+.3)  sa.trust (vault-backed)
 *   - capabilityIssuer   (S5 — A.5)   sa.caps.issue/verify
 *   - policyEngine       (S5 — A.5b)  sa.policy (composes trust + skills)
 *   - Roles re-exported as sa.ROLES + module export
 *   - auditLog           (S6 — A.6)   sa.audit signed hash-chain + autoLog
 *   - groupManager       (S7 — A.7)   sa.groups (auto-threaded into policy)
 *   - a2aTls             (S7 — A+.4)  sa.a2aTls (A2ATransport helper)
 *   - rateLimit          (S7 — A+.8)  drops over-quota envelopes
 *   - sa.migrateVaultToPod helper bound to our identity + vault
 *   - usePerfectFwdSec   (S8 — A.8)   sa.pfs partial Double-Ratchet
 *                                      (symmetric ratchet; no DH ratchet —
 *                                      see pfs.js header for scope)
 *
 * # Future work
 *
 *   - S8b — full Double-Ratchet (DH ratchet + per-message ephemerals)
 *           — requires transport-level integration; not in current scope
 *
 * All roadmap slices S0–S8 are now wired.  STUB_OPTS is empty.
 */

import {
  Agent,
  AgentIdentity,
  InternalBus,
  InternalTransport,
  NknTransport,
  RelayTransport,
  RoutingStrategy,
} from '@canopy/core';

import {
  tokenGate,
  TrustRegistry,
  CapabilityToken,
  PolicyEngine,
  ROLES,
  GroupManager,
  A2ATLSLayer,
  migrateVaultToPod as migrateVaultToPodFn,
} from '@canopy/core';
import { createRateLimiter } from './rateLimit.js';
import { loadPFSChain }      from './pfs.js';

import { makeBrowserVault, restoreOrGenerate } from './vault.js';
import { loadMuteSet }                          from './mute.js';
import {
  signClaim    as signClaimFn,
  verifyClaim  as verifyClaimFn,
  serializeClaim,
  parseClaim,
} from './claim.js';
import {
  registerPasskey   as registerPasskeyFn,
  unlockWithPasskey as unlockWithPasskeyFn,
  webauthnAvailable,
  PASSKEY_ERRORS,
} from './passkey.js';
import { createPeerResolver } from './resolver.js';
import { loadAuditLog }       from './auditLog.js';

/**
 * @typedef {object} CreateSecureAgentOpts
 *
 * @property {object}  [vault]                  Pre-built Vault (e.g. VaultMemory for tests)
 * @property {string}  [identityVaultPrefix]    Default 'sa-id:'
 * @property {object}  [bus]                    Pre-built InternalBus — share when this agent needs to talk to others in-process (e.g. canopy-chat's host+chat topology).  Default: factory builds its own siloed bus.
 * @property {string}  [passphrase]             S3 — wraps vault with AES-GCM via PBKDF2 (browser/IndexedDB)
 * @property {boolean|object} [webAuthnUnlock]  S3 — true | { rpId, prfSalt, userName, ... }
 *
 * @property {object}  [nknLib]                 window.nkn from CDN, or RN nkn-sdk; absent → no peer transport
 *
 * @property {string}  [muteListVaultKey]       S1 — persistent mute slot (omit = in-memory)
 * @property {Function|string|object} [helloGate] S1 — fn(envelope)=>bool, PSK string, or { token }
 * @property {object}  [webidClaim]             S2 — { webid } binds default WebID for claim.sign()
 * @property {object}  [identityResolver]       S4 — MemberMap-shape (or { memberMap }) for alias-aware mute + sa.resolver.*
 * @property {object}  [circleEnforcement]      5.7c — host-injected `{groupsIndex, getOverride, getCirclePolicy, memberMap, getCircleIdForEnv?}` accessors.  Inbound envelopes from a peer in any circle the local user has set `override.chatOff` on, OR from a peer whose MemberMap relation is `'agent'` in a circle where agents are blocked, are dropped after the existing mute-gate.  Fails OPEN on accessor throw so a broken store never silently drops inbound.
 * @property {boolean|object} [capabilityIssuer] S5 — true | { defaultExpiresIn }  exposes sa.caps
 * @property {boolean|object} [trustRegistry]    S5 — true | { vault }  exposes sa.trust
 * @property {boolean|object} [policyEngine]     S5 — true | { groupManager, isRevoked, actorResolver }  exposes sa.policy (requires trustRegistry)
 * @property {boolean|object} [auditLog]        S6 — true | { vaultKey, vault?, autoLog? }  exposes sa.audit
 * @property {boolean|object} [groupManager]    S7 — true | { vault } exposes sa.groups (auto-threaded into policy)
 * @property {boolean|object} [a2aTls]          S7 — true | { a2aAuth } exposes sa.a2aTls
 * @property {boolean|object} [rateLimit]       S7 — true | { perPeer, global } drops over-quota envelopes
 * @property {boolean|object} [usePerfectFwdSec] S8 — true | { vaultKeyPrefix, maxSkip } exposes sa.pfs
 *
 * @property {Function} [onPeerMessage]         ({from, payload, ts}) => void
 * @property {object}   [podWriter]             For S2 / S6 pod-side writes
 *
 * @property {boolean}  [warnOnInsecure=true]   console.warn when a safety opt is off
 */

/**
 * Stubbed opts list — when the caller sets one of these, we warn
 * that it's not implemented yet but the API is reserved.  When the
 * corresponding S slice lands, the warning becomes an activation.
 */
const STUB_OPTS = Object.freeze([
  // passphrase        — wired in S3 (forwarded to vault picker)
  // webAuthnUnlock    — wired in S3 (exposes sa.passkey.{register,unlock})
  // muteListVaultKey  — wired in S1
  // helloGate         — wired in S1
  // webidClaim        — wired in S2
  // identityResolver  — wired in S4 (sa.resolver.* + mute-fanout)
  // capabilityIssuer  — wired in S5 (sa.caps.{issue,verify})
  // trustRegistry     — wired in S5 (sa.trust.* — vault-backed)
  // policyEngine      — wired in S5 (sa.policy)
  // auditLog          — wired in S6 (sa.audit.* signed hash-chain)
  // groupManager      — wired in S7 (sa.groups)
  // a2aTls            — wired in S7 (sa.a2aTls)
  // rateLimit         — wired in S7 (drops envelopes over quota)
  // usePerfectFwdSec  — wired in S8 (sa.pfs — partial Double-Ratchet)
]);

/**
 * Build a secure agent + (optional) cross-peer transport.
 *
 * @param {CreateSecureAgentOpts} [opts]
 * @returns {Promise<{
 *   agent: Agent,
 *   identity: { pubKey: string, stableId: string, vault: object },
 *   peer: {
 *     connect: () => Promise<{ address: string, status: string }>,
 *     sendTo:  (addr: string, payload: any) => Promise<void>,
 *     status:  string,
 *     address: string|null,
 *   },
 *   rotateIdentity: (opts?: object) => Promise<{ oldPubKey, newPubKey, graceUntilDays }>,
 *   securityStatus: () => object,
 *   shutdown: () => Promise<void>,
 *   mute: {
 *     add: (addr) => Promise<boolean>,
 *     remove: (addr) => Promise<boolean>,
 *     has: (addr) => boolean,
 *     list: () => string[],
 *     clear: () => Promise<void>,
 *     size: number,
 *   },
 *   claim: {
 *     sign: (args?: { webid?: string, nknAddr?: string, ttlMs?: number }) => object,
 *     verify: (claim, opts?) => { ok: true, body } | { ok: false, reason },
 *     serialize: (claim) => string,
 *     parse: (str) => object,
 *     boundWebid: string|null,
 *   },
 * }>}
 */
export async function createSecureAgent(opts = {}) {
  // S0 — warn about stubbed opts so callers know what's wired now
  // vs what they're asking for that will activate in a future slice.
  if (opts.warnOnInsecure !== false && typeof console !== 'undefined') {
    for (const key of STUB_OPTS) {
      if (opts[key] !== undefined) {
        console.warn(
          `[secure-agent] opt "${key}" is RESERVED for a future slice ` +
          `(see security-roadmap-2026-05-23.md).  Currently a no-op; the ` +
          `factory's S0 foundation has wired identity + SecurityLayer + ` +
          `auto-HI + rotation.  Your "${key}" value is preserved on the ` +
          `returned object as .pendingOpts.${key}.`,
        );
      }
    }
  }

  // Forward-declared so async ops below can fire-and-forget into the
  // audit log without caring whether it's wired or not.
  let auditLog = null;
  const audit = (event, subject, data) => {
    if (!auditLog) return;
    auditLog.append({ event, subject, data })
      .catch((err) => console.warn('[secure-agent] audit append failed', err));
  };

  // ─── Identity (persists across page loads when vault supports it) ───
  // S3 — when opts.passphrase is set, the picker promotes us from
  // VaultLocalStorage (plaintext) to VaultIndexedDB (AES-GCM via
  // PBKDF2(passphrase, dbName)).  See vault.js for the picker.
  const vault = opts.vault ?? makeBrowserVault({
    prefix:     opts.identityVaultPrefix ?? 'sa-id:',
    passphrase: opts.passphrase ?? null,
  });
  const identity = await restoreOrGenerate(vault);

  // ─── Agent on an InternalBus ─────────────────────────────────────
  // Default: factory builds its own siloed bus (single-agent topology).
  // Override: pass opts.bus when this agent must talk to other in-process
  // agents (e.g. canopy-chat's host+chat topology — chatAgent comes from
  // the factory; hostAgent is built manually; both share the bus).
  const bus = opts.bus ?? new InternalBus();
  const transport = new InternalTransport(bus, identity.pubKey);
  const agent = new Agent({ identity, transport });
  await agent.start();

  // ─── S1 — persistent mute set (A.1) ───────────────────────────────
  // Match key today = NKN peer address.  S4 (identity-resolver) will
  // additionally match on stableId + webid when those mappings exist.
  const muteSet = await loadMuteSet({
    vault,
    vaultKey: opts.muteListVaultKey ?? null,
  });

  // ─── S1 — helloGate (A+.1) ────────────────────────────────────────
  // Two layers, composed via anyOf-style AND (we want ALL to pass):
  //   1. mute-block gate (always installed): reject HI from muted peer addr
  //   2. user-supplied gate (optional): tokenGate(string) | groupGate | custom fn
  // Composition: AND (both must return true to accept).  Helper:
  // helloGates.anyOf is OR, so we manually AND here.
  const userHelloGate = resolveHelloGate(opts.helloGate);
  const muteBlockGate = async (env) => !muteSet.has(env?._from);
  const composedGate  = userHelloGate
    ? async (env) => (await muteBlockGate(env)) && (await userHelloGate(env))
    : muteBlockGate;
  agent.setHelloGate(composedGate);

  // ─── S2 — signed WebID claim (A.2) ────────────────────────────────
  // Bind the WebID once (factory-time) if the caller passed one; then
  // signClaim() can default to it.  No bound webid → caller must pass
  // it to each signClaim call.
  const boundWebid = (typeof opts.webidClaim === 'object' && opts.webidClaim)
    ? (opts.webidClaim.webid ?? null)
    : null;

  // ─── S3 — passphrase + WebAuthn (A.3 + A+.5) ──────────────────────
  // The passphrase has already been forwarded to the vault picker
  // above.  Here we record whether the vault was actually wrapped,
  // for securityStatus reporting.
  // (No way to introspect VaultIndexedDB's enc state from outside;
  //  we proxy on the user's opts + runtime support.)
  const vaultEncrypted = !!opts.passphrase
                      && typeof globalThis.indexedDB !== 'undefined'
                      && !opts.vault;

  // WebAuthn binding — config + helpers.  Accept:
  //   true                          → infer rpId from window.location.hostname
  //   { rpId, rpName, prfSalt, ... }→ explicit config
  const passkeyConfig = resolvePasskeyConfig(opts.webAuthnUnlock);

  // ─── S4 — identity-resolver (A.4) ─────────────────────────────────
  // Compose SecurityLayer (addr→pubKey) with the caller-supplied
  // MemberMap-like (pubKey/webid/stableId→member).  Either source may
  // be absent; the resolver degrades gracefully (returns null).
  //
  // identityResolver opt forms:
  //   memberMap-shape       → treat as MemberMap directly
  //   { memberMap }         → object form for future expansion
  const resolverMemberMap = pickResolverMemberMap(opts.identityResolver);
  const peerResolver = createPeerResolver({
    security:  agent.security,
    memberMap: resolverMemberMap,
  });

  // ─── 5.7c — circle override enforcement (chat-off + agent-block) ──
  // Host-injected accessors let the substrate (canopy-chat v2) consult
  // its GroupsIndex + per-circle override store + per-circle policy
  // store without secure-agent knowing about them.  Only the addr→
  // webid resolution + the decision boundary live here.
  //
  // Failure model: FAIL-OPEN.  An accessor that throws — or the
  // predicate itself — is treated as "no decision" so a broken store
  // never silently drops user-facing inbound.  The audit log records
  // the throw when wired so operators can see the misconfig.
  //
  // Order vs mute-set: the receive handler runs the mute fast-path
  // FIRST (so muted peers never even reach the override layer); only
  // non-muted envelopes are evaluated against the circle gates.
  const circleEnf = pickCircleEnforcement(opts.circleEnforcement);

  /**
   * Resolve the inbound peer's webid via the identityResolver chain.
   * Returns null when the resolver/security layer don't yet know the
   * peer (e.g. a stranger pre-HI) — the caller treats null as "no
   * enforcement decision possible" and lets the envelope through.
   */
  async function peerWebidFor(addr) {
    if (!addr) return null;
    try {
      const m = await peerResolver.resolveByAddr(addr);
      return m?.webid ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Evaluate the 5.7c chat-off + agent-block gates for an inbound
   * envelope.  Returns `true` if the envelope must be DROPPED; `false`
   * otherwise.  Fails open on any error.
   */
  async function isInboundCircleBlocked(env) {
    if (!circleEnf) return false;
    const addr = env?._from;
    if (!addr) return false;
    let peerWebid = null;
    try {
      peerWebid = await peerWebidFor(addr);
    } catch (err) {
      console.warn('[secure-agent] circleEnforcement: webid resolve failed', err?.message ?? err);
      audit('circleEnforcement.error', addr, { stage: 'resolveWebid', error: String(err?.message ?? err) });
      return false;
    }
    if (!peerWebid) return false;   // unknown peer → no enforcement signal

    // 1) Chat-off — any shared-circle override silences this peer.
    try {
      const off = await isInboundChatOffLocal({
        peerWebid,
        groupsIndex: circleEnf.groupsIndex,
        getOverride: circleEnf.getOverride,
      });
      if (off) {
        audit('circleEnforcement.drop', addr, { reason: 'chatOff', peerWebid });
        return true;
      }
    } catch (err) {
      console.warn('[secure-agent] circleEnforcement: chat-off predicate threw', err?.message ?? err);
      audit('circleEnforcement.error', addr, { stage: 'chatOff', error: String(err?.message ?? err) });
      // fail open
    }

    // 2) Agent-block — needs a circleId scope; ask the host to pick.
    let circleId = null;
    try {
      circleId = typeof circleEnf.getCircleIdForEnv === 'function'
        ? circleEnf.getCircleIdForEnv(env, peerWebid)
        : null;
    } catch (err) {
      console.warn('[secure-agent] circleEnforcement: getCircleIdForEnv threw', err?.message ?? err);
      audit('circleEnforcement.error', addr, { stage: 'getCircleIdForEnv', error: String(err?.message ?? err) });
      circleId = null;
    }
    if (typeof circleId === 'string' && circleId) {
      try {
        const blocked = await isInboundAgentBlockedLocal({
          peerWebid,
          circleId,
          memberMap:       circleEnf.memberMap,
          getCirclePolicy: circleEnf.getCirclePolicy,
          getOverride:     circleEnf.getOverride,
        });
        if (blocked) {
          audit('circleEnforcement.drop', addr, { reason: 'agentBlocked', peerWebid, circleId });
          return true;
        }
      } catch (err) {
        console.warn('[secure-agent] circleEnforcement: agent-block predicate threw', err?.message ?? err);
        audit('circleEnforcement.error', addr, { stage: 'agentBlock', error: String(err?.message ?? err) });
        // fail open
      }
    }
    return false;
  }

  /**
   * Mute check with resolver fanout.  An envelope from `addr` is
   * considered muted if EITHER:
   *   - addr is in the mute set (sync fast-path), OR
   *   - any of {pubKey, webid, stableId} for addr is in the mute set.
   *
   * Without a resolver wired, this collapses to the sync fast-path.
   */
  async function isPeerMuted(addr) {
    if (!addr) return false;
    if (muteSet.has(addr)) return true;
    if (!resolverMemberMap) return false;
    const aliases = await peerResolver.aliasesFor(addr);
    for (const a of aliases) if (muteSet.has(a)) return true;
    return false;
  }

  // ─── S5 — TrustRegistry + CapabilityTokens + PolicyEngine ─────────
  // (A.5 caps + A+.2 Roles + A+.3 Trust)
  //
  // TrustRegistry: persistent per-peer trust/tier/group/token-grant
  // records.  Vault-backed; reuses the agent's vault by default (so
  // identity + trust live side-by-side), or a separate vault may be
  // supplied for isolation (e.g. pod-mirrored trust vs local identity).
  let trustRegistry = null;
  if (opts.trustRegistry) {
    const trustVault = (typeof opts.trustRegistry === 'object' && opts.trustRegistry.vault)
      ? opts.trustRegistry.vault
      : vault;
    trustRegistry = new TrustRegistry(trustVault);
  }

  // CapabilityToken issuance + verification helpers, bound to the
  // factory's identity (signer) and pubKey (expected-agent on verify).
  const capDefaults = (typeof opts.capabilityIssuer === 'object' && opts.capabilityIssuer)
    ? opts.capabilityIssuer
    : {};
  const capsWired = !!opts.capabilityIssuer;

  // ─── S7 — GroupManager (A.7) ──────────────────────────────────────
  // Closed-group membership proofs.  Vault-backed; reuses identity
  // vault by default.  Threaded into PolicyEngine when both are wired
  // (so policy checks can consult group membership).
  let groupManager = null;
  if (opts.groupManager) {
    const gmOpts = (typeof opts.groupManager === 'object') ? opts.groupManager : {};
    const gmVault = gmOpts.vault ?? vault;
    groupManager = new GroupManager({ identity, vault: gmVault });
  }

  // PolicyEngine wiring — composed when opted in.  Requires
  // trustRegistry (created here) + agent.skills (always present).  An
  // optional actorResolver may be the same MemberMap-shape we received
  // in S4 (it must expose .resolve to satisfy PolicyEngine — we adapt
  // below).
  let policyEngine = null;
  if (opts.policyEngine) {
    if (!trustRegistry) {
      throw new Error(
        'createSecureAgent: policyEngine requires trustRegistry to also be enabled.',
      );
    }
    const peOpts = (typeof opts.policyEngine === 'object') ? opts.policyEngine : {};
    policyEngine = new PolicyEngine({
      trustRegistry,
      skillRegistry: agent.skills,
      agentPubKey:   identity.pubKey,
      // Auto-thread the GroupManager we built above unless the caller
      // explicitly supplied a different one (covers the "use my own
      // pre-built GroupManager" escape hatch).
      groupManager:  peOpts.groupManager  ?? groupManager ?? null,
      isRevoked:     peOpts.isRevoked     ?? null,
      actorResolver: peOpts.actorResolver ?? null,
    });
  }

  // ─── S7 — A2ATLSLayer (A+.4) ──────────────────────────────────────
  // For agents that compose A2ATransport (HTTPS + Bearer JWT).  The
  // layer itself just wraps A2AAuth (which the caller supplies if any).
  let a2aTls = null;
  if (opts.a2aTls) {
    const aOpts = (typeof opts.a2aTls === 'object') ? opts.a2aTls : {};
    a2aTls = new A2ATLSLayer({ a2aAuth: aOpts.a2aAuth ?? null });
  }

  // ─── S7 — rate-limit (A+.8) ───────────────────────────────────────
  // Per-peer + global token-bucket; drops over-quota envelopes BEFORE
  // they reach onPeerMessage.  Default tuning is chat-pace; apps with
  // bursty traffic should pass explicit limits or false.
  let rateLimiter = null;
  if (opts.rateLimit) {
    const rlOpts = (typeof opts.rateLimit === 'object') ? opts.rateLimit : {};
    rateLimiter = createRateLimiter({
      perPeer: rlOpts.perPeer,
      global:  rlOpts.global,
    });
  }

  // ─── S8 — Perfect Forward Secrecy (A.8, partial Double-Ratchet) ──
  // Per-peer symmetric KDF chain.  Each message gets a fresh one-time
  // key derived via HKDF-SHA256; old keys are deleted after use.
  //
  // SCOPE NOTE: this implements the SYMMETRIC ratchet only.  Without
  // a DH ratchet, an attacker who later steals an identity private
  // key can recompute the chain seed (it's derived from static DH
  // over identity keys) and decrypt every message ever sent on the
  // chain.  Closing this gap is S8b (DH ratchet via per-message
  // ephemeral keys) — left as future work.  See pfs.js header.
  //
  // The chains are NOT auto-wrapped onto the transport: apps opt in
  // by passing payloads through sa.pfs.encrypt(peer, ...) before
  // sending, and sa.pfs.decrypt(peer, wire) on receive.  Auto-
  // wrapping needs the same DH ratchet to be done correctly, hence
  // S8b territory.
  const pfsEnabled = !!opts.usePerfectFwdSec;
  const pfsOpts    = (typeof opts.usePerfectFwdSec === 'object')
    ? opts.usePerfectFwdSec : {};
  const pfsChains  = new Map();   // peerPubKey → PFSChain

  async function pfsChainFor(peerPubKey) {
    if (!pfsEnabled) {
      throw new Error('sa.pfs: usePerfectFwdSec opt is off');
    }
    let c = pfsChains.get(peerPubKey);
    if (!c) {
      c = await loadPFSChain({
        identity,
        peerPubKey,
        maxSkip:  pfsOpts.maxSkip,
        vault,
        vaultKey: pfsOpts.vaultKeyPrefix
          ? `${pfsOpts.vaultKeyPrefix}${peerPubKey}`
          : null,
      });
      pfsChains.set(peerPubKey, c);
    }
    return c;
  }

  // ─── S6 — signed activity / audit log (A.6) ───────────────────────
  //
  // auditLog opt forms:
  //   true             → in-memory log, autoLog ON
  //   { vaultKey?, autoLog?, vault? }
  //                    → persistent (vault, vaultKey) + opt-in autoLog
  //
  // The autoLog flag (default true) wires fire-and-forget audit
  // entries for the security-critical actions exposed by the factory:
  // identity.rotate, mute.add, mute.remove, caps.issue, peer.connect,
  // claim.sign.  Disable with `autoLog: false` if you want full
  // manual control via sa.audit.append.
  let auditAutoLog = false;
  if (opts.auditLog) {
    const aOpts = (typeof opts.auditLog === 'object') ? opts.auditLog : {};
    auditAutoLog = aOpts.autoLog !== false;
    auditLog = await loadAuditLog({
      identity,
      vault:    aOpts.vault    ?? vault,
      vaultKey: aOpts.vaultKey ?? null,
    });
  }

  // ─── Peer state (NKN cross-peer; stays idle until connect()) ───
  let peerTransport = null;
  const peerState = { status: 'idle', address: null, error: null };
  const helloedPeers = new Set();

  // ─── Relay state (WebSocket relay; stays idle until connectRelay) ───
  // A1 (2026-05-23): second cross-peer transport.  Both transports
  // share the same envelope handler (extracted into makeReceiveHandler
  // below) + the same helloed-peers cache, so a peer that HI'd via
  // NKN is also implicitly trusted on relay (same identity, same
  // SecurityLayer).  sendToPeer picks the transport based on
  // `transportMode` ('nkn' | 'relay' | 'both', default 'nkn').
  let relayTransport = null;
  const relayState = { status: 'idle', address: null, error: null, url: null };
  let transportMode = opts.transportMode ?? 'nkn';

  // ─── T2 (unification / OBJ-1) — RoutingStrategy over the connected transports ───
  // The first step toward the unified secure-mesh (option iii): instead of the fixed
  // prefer-NKN picker, in `transportMode:'both'` we ask the core RoutingStrategy for the
  // BEST reachable route per peer (canonical priority mdns > rendezvous > relay > nkn …,
  // reachability/latency-aware). Transports register here as they connect — their security
  // is already applied by `makeReceiveHandler`, so adding rendezvous/mdns/ble later (T3/T4)
  // is just connect + `routing.addTransport(name, tx)`. Explicit 'nkn'/'relay' still pin.
  const routing = new RoutingStrategy({ transports: new Map() });

  // v0.7.cc — rolling buffer of recent peer traffic for /debug-dump.
  // Tiny memory footprint (last 10 envelopes); diagnostic-only.
  const RECENT_LIMIT = 10;
  const recentTraffic = [];
  const recordTraffic = (entry) => {
    recentTraffic.push({ ts: Date.now(), ...entry });
    if (recentTraffic.length > RECENT_LIMIT) recentTraffic.shift();
  };

  // Late-binding hook for onPeerMessage: factory opts may not have it
  // (canopy-chat-style flow: construct first, wire UI later).  Caller
  // can pass onPeerMessage to connect() OR set it via setPeerMessageHandler().
  let onPeerMessageFn = (typeof opts.onPeerMessage === 'function')
    ? opts.onPeerMessage : null;

  /**
   * Wire a transport's receive-handler.  Shared by connectPeer (NKN)
   * and connectRelay (RelayTransport) so both apply the same
   * mute/rate-limit gates + reciprocal-HI + onPeerMessage fanout.
   *
   * @param {object} tx  any Transport-shaped object (NknTransport,
   *                     RelayTransport, ...) with .on('envelope', …)
   *                     and .sendHello(addr, payload).
   */
  function makeReceiveHandler(tx) {
    // Auto-wire SecurityLayer so every outbound envelope is signed
    // + nacl.box encrypted with a per-peer shared secret.  HI stays
    // plaintext-but-signed so peers can bootstrap.
    tx.useSecurityLayer(agent.security);
    // v0.7.S0 — bilateral HI auto-handshake on receive.  When we
    // receive an envelope from a peer we haven't HI'd, send HI to
    // them so THEIR SecurityLayer registers our pubKey too.
    // Without this:
    //   A → B HI    : B knows A's pubKey ✓
    //   A → B OW    : encrypt requires B's pubKey at A — FAILS
    //   B → A HI    : A knows B's pubKey ✓ (only on B's first send)
    //   B → A OW    : encrypt requires A's pubKey at B — A already HI'd ✓
    // Bilateral fix: when B receives A's HI, B auto-sends HI back.
    // Now A also knows B's pubKey + can encrypt OW.
    tx.on('envelope', async (env) => {
      // 2026-05-27 (DM cross-device debug) — log every inbound
      // envelope so we can see HI / chat-message deliveries on the
      // other phone's Metro log.  Top-level type + subtype identify
      // the envelope shape; the from-address is truncated.
      if (typeof console !== 'undefined') {
        console.log('[secure-agent] recv envelope from=' + String(env?._from ?? '?').slice(0, 16) + '… type=' + (env?.type ?? '?') + ' subtype=' + (env?.payload?.subtype ?? 'n/a'));
      }
      // S1 — drop envelopes from muted peers BEFORE any further
      // bookkeeping (no reciprocal HI, no onPeerMessage fire).
      // S4 — fanout the check across resolver-known aliases.
      if (await isPeerMuted(env?._from)) return;
      // 5.7c — circle override enforcement runs AFTER mute (so muted
      // peers never reach the override layer) and BEFORE rate-limit /
      // reciprocal HI / onPeerMessage.  When the local user has
      // `override.chatOff` set for any circle the peer is in, OR the
      // peer is marked relation:'agent' in a circle that blocks agents,
      // the envelope is silently dropped.  Fails open if accessors
      // throw — never silently swallow inbound on a broken store.
      if (await isInboundCircleBlocked(env)) return;
      // S7 — rate-limit drop.  Over-quota peers are silently
      // ignored at the receive boundary (no reciprocal HI either —
      // we don't want them to make us spam them in return).
      if (rateLimiter && !rateLimiter.check(env?._from)) return;
      // v0.7.cc — record for /debug-dump.  Size is the JSON-
      // serialised length of the envelope; matches the wire bytes
      // the transport actually received.
      recordTraffic({
        dir:     'recv',
        from:    env?._from,
        subtype: env?.payload?.subtype ?? env?.type ?? null,
        size:    JSON.stringify(env ?? {}).length,
      });
      try {
        // First-contact reciprocal HI: when we receive from a peer we
        // haven't HI'd, send ours so THEIR SecurityLayer registers our
        // pubKey.  (We do NOT re-send on every inbound HI — that
        // creates an infinite HI ping-pong between two peers who both
        // keep replying.  The real cross-device delivery asymmetry is
        // handled at the transport layer via MultiClient.)
        if (!helloedPeers.has(env._from)) {
          if (typeof console !== 'undefined') {
            console.log('[secure-agent] sending reciprocal HI to ' + String(env._from).slice(0, 16) + '…');
          }
          try {
            await tx.sendHello(env._from, { pubKey: identity.pubKey });
            helloedPeers.add(env._from);
            if (typeof console !== 'undefined') {
              console.log('[secure-agent] reciprocal HI sent OK to ' + String(env._from).slice(0, 16) + '…');
            }
          } catch (err) {
            console.warn('[secure-agent] reciprocal HI failed (will retry on next envelope)', err?.message ?? err);
            // Don't add to helloedPeers — next inbound envelope from
            // this peer triggers another HI attempt.
          }
        }
      } catch (err) {
        console.warn('[secure-agent] reciprocal-HI bookkeeping failed', err);
      }
      if (typeof onPeerMessageFn === 'function') {
        try {
          onPeerMessageFn({
            from:    env._from,
            payload: env.payload,
            ts:      env._ts ?? Date.now(),
          });
        } catch (err) {
          if (typeof console !== 'undefined') {
            console.error('[secure-agent] onPeerMessage threw', err);
          }
        }
      }
    });
  }

  /**
   * Establish the cross-peer NKN transport, wired with SecurityLayer
   * + receive-path that calls onPeerMessage.
   *
   * Both `nknLib` and `onPeerMessage` can be supplied here as overrides
   * for late-binding flows (e.g. apps that construct the agent before
   * window.nkn has loaded from a CDN).  Either takes precedence over
   * the factory-time opt.
   */
  async function connectPeer(callOpts = {}) {
    const nknLib = callOpts.nknLib ?? opts.nknLib;
    if (callOpts.onPeerMessage) onPeerMessageFn = callOpts.onPeerMessage;
    if (!nknLib) {
      throw new Error(
        'createSecureAgent: connect() called but no nknLib provided.  ' +
        'Pass window.nkn (CDN-loaded in browser) or the RN nkn-sdk — ' +
        'either at factory time (opts.nknLib) or at connect time ' +
        '(sa.peer.connect({ nknLib })).',
      );
    }
    if (peerState.status === 'connected' || peerState.status === 'connecting') {
      return { ...peerState };
    }
    peerState.status = 'connecting';
    try {
      const tx = new NknTransport({ identity, nknLib });
      makeReceiveHandler(tx);
      await tx.connect();
      peerTransport     = tx;
      peerState.status  = 'connected';
      peerState.address = tx.address;
      peerState.error   = null;
      routing.addTransport('nkn', tx);   // T2 — register for router-based selection ('both' mode)
      // A1 NOTE: we deliberately do NOT call agent.addTransport('nkn', tx)
      // here.  Agent.addTransport on an already-started agent re-wraps
      // useSecurityLayer + setReceiveHandler, which breaks the wiring
      // makeReceiveHandler() already set up.  secure-agent's
      // sendToPeer routes directly via peerTransport/relayTransport so
      // the Agent doesn't need to know about either transport.  If a
      // future app wants Agent-level routing (e.g. RoutingStrategy
      // picking transports per peer), this is the place to wire it.
      if (auditAutoLog) audit('peer.connect', tx.address);
      return { ...peerState };
    } catch (err) {
      peerState.status = 'error';
      peerState.error  = err?.message ?? String(err);
      throw err;
    }
  }

  /**
   * A1 (2026-05-23) — connect the optional RelayTransport (WebSocket
   * relay).  Independent of NKN; either can be on alone, or both.
   * sendToPeer() honours `transportMode` to pick which one routes
   * outbound traffic; both transports always feed the same
   * onPeerMessage receive handler.
   *
   * @param {object} callOpts
   * @param {string} callOpts.relayUrl  ws:// or wss:// URL
   */
  async function connectRelay(callOpts = {}) {
    const relayUrl = callOpts.relayUrl ?? opts.relayUrl;
    if (callOpts.onPeerMessage) onPeerMessageFn = callOpts.onPeerMessage;
    if (!relayUrl) {
      throw new Error(
        'createSecureAgent: connectRelay() called but no relayUrl provided.  ' +
        'Pass relayUrl at factory time (opts.relayUrl) or call-time ' +
        '(sa.relay.connect({relayUrl})).',
      );
    }
    if (relayState.status === 'connected' || relayState.status === 'connecting') {
      return { ...relayState };
    }
    relayState.status = 'connecting';
    relayState.url    = relayUrl;
    try {
      const tx = new RelayTransport({ identity, relayUrl });
      makeReceiveHandler(tx);
      await tx.connect();
      relayTransport     = tx;
      relayState.status  = 'connected';
      relayState.address = tx.address;
      relayState.error   = null;
      routing.addTransport('relay', tx);   // T2 — register for router-based selection ('both' mode)
      // Same NOTE as connectPeer: don't agent.addTransport here;
      // sendToPeer routes via relayTransport directly.
      if (auditAutoLog) audit('relay.connect', relayUrl);
      return { ...relayState };
    } catch (err) {
      relayState.status = 'error';
      relayState.error  = err?.message ?? String(err);
      throw err;
    }
  }

  async function disconnectRelay() {
    if (relayTransport) {
      try { await relayTransport.disconnect(); } catch { /* swallow */ }
      try { agent.removeTransport?.('relay'); } catch { /* defensive */ }
      try { routing.removeTransport('relay'); } catch { /* defensive */ }   // T2 — deregister from the router
      relayTransport = null;
    }
    relayState.status = 'idle';
    relayState.address = null;
    relayState.url = null;
    relayState.error = null;
  }

  function setTransportMode(mode) {
    if (mode !== 'nkn' && mode !== 'relay' && mode !== 'both') {
      throw new Error(`setTransportMode: invalid mode "${mode}"; expected nkn|relay|both`);
    }
    transportMode = mode;
  }

  /**
   * Send an envelope to a peer.  Auto-HI on first contact so the
   * peer registers our pubKey + can decrypt the subsequent payload.
   *
   * Bilateral HI race fix (2026-05-23): the OW encrypt needs the
   * PEER's pubKey at our SecurityLayer.  We get it via their HI
   * envelope back to us — which is asynchronous.  Without waiting,
   * the first send to a never-contacted peer fails with
   * "No pubKey registered for recipient".  Solution: after sending
   * our HI, poll agent.security.getPeerKey(addr) for up to
   * `firstSendTimeoutMs` (default 5s) so the peer's bilateral HI
   * has time to arrive.  Subsequent sends to the same peer skip
   * the wait (helloedPeers cache).
   *
   * `firstSendTimeoutMs` opt at factory time lets transport-heavy
   * apps (RN, slow networks) extend the wait; set to 0 to opt out
   * (fall back to old eager-send behavior).
   */
  /**
   * A1 — pick which transport to use for outbound sends based on the
   * current transportMode.  Returns null if no suitable transport is
   * connected.
   *
   *   'nkn'   — NknTransport only (current default; throws if NKN not connected)
   *   'relay' — RelayTransport only (throws if relay not connected)
   *   'both'  — prefer NKN; fall back to relay if NKN isn't connected.
   *             (Doesn't broadcast on both — that would duplicate at
   *             the receiver.)
   */
  async function pickTransport(addr) {
    // Explicit pin — respect a user-chosen single transport.
    if (transportMode === 'nkn')   return peerTransport ?? null;
    if (transportMode === 'relay') return relayTransport ?? null;
    // 'both' (auto) — T2: let the RoutingStrategy pick the BEST reachable route for this peer
    // (canonical priority + reachability), instead of the old fixed prefer-NKN. Falls back to
    // the static prefer-NKN-then-relay if the router can't decide (no addr / nothing reachable).
    if (addr) {
      try {
        const sel = await routing.selectTransport(addr);
        if (sel?.transport) return sel.transport;
      } catch { /* fall through to the static fallback */ }
    }
    return peerTransport ?? relayTransport ?? null;
  }

  /**
   * Public sendToPeer wraps the inner _sendToPeerOnce with retry-on-
   * handshake-error so first-contact sends survive races between
   * sendHello + the peer's reciprocal HI.  Callers no longer need
   * application-layer retry wrappers.
   *
   * Default policy: 2 retries with 3s + 5s backoff (~8s total).
   * Override via `opts.retryDelays: number[]` per-call (e.g. `[]`
   * to disable retry).  Non-handshake errors throw immediately.
   *
   * Triggered by 2026-05-24 canopy-chat user reports of:
   *   - "No pubKey registered for recipient … — send HI first"
   *   - "did not respond with HI within 5000ms"
   * Both surface because HI is asynchronous + the very first send
   * to a fresh peer races the handshake.
   */
  async function sendToPeer(addr, payload, opts = {}) {
    const delays = Array.isArray(opts.retryDelays) ? opts.retryDelays : [3000, 5000];
    let lastErr = null;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await _sendToPeerOnce(addr, payload);
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message ?? err);
        const isHandshake = /No pubKey registered|send HI first|did not respond with HI/i.test(msg);
        if (!isHandshake) throw err;
        if (attempt === delays.length) break;
        if (typeof console !== 'undefined') {
          console.info(`[secure-agent] HI race for ${String(addr).slice(0, 16)}…, retrying in ${delays[attempt]}ms (${attempt + 1}/${delays.length})`);
        }
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
    throw lastErr;
  }

  async function _sendToPeerOnce(addr, payload) {
    const tx = await pickTransport(addr);
    if (!tx) {
      throw new Error(
        `Peer transport not connected (mode=${transportMode}).  ` +
        `Call sa.peer.connect() and/or sa.relay.connect() first.`,
      );
    }
    // S1 + S4 — refuse to send to a muted peer (alias-aware).  Throws
    // (not silent) so the caller knows their intent didn't reach the
    // wire.
    if (await isPeerMuted(addr)) {
      throw new Error(`secure-agent: peer "${addr}" is muted; sendTo refused`);
    }
    if (!helloedPeers.has(addr)) {
      if (typeof console !== 'undefined') {
        console.log('[secure-agent] sending outbound HI to ' + String(addr).slice(0, 16) + '…');
      }
      try {
        await tx.sendHello(addr, { pubKey: identity.pubKey });
        if (typeof console !== 'undefined') {
          console.log('[secure-agent] outbound HI sent OK to ' + String(addr).slice(0, 16) + '…');
        }
      } catch (err) {
        // Log + continue — sendOneWay may still succeed if the peer
        // already has our pubKey from a previous session.
        if (typeof console !== 'undefined') {
          console.warn('[secure-agent] HI failed (continuing)', err.message ?? err);
        }
      }
      // Wait for the peer's reciprocal HI to register their pubKey
      // at our SecurityLayer.  Otherwise the OW encrypt below throws
      // 'No pubKey registered for recipient'.
      const waitMs = typeof opts.firstSendTimeoutMs === 'number'
        ? opts.firstSendTimeoutMs : 5000;
      if (waitMs > 0 && agent.security
            && typeof agent.security.getPeerKey === 'function'
            && !agent.security.getPeerKey(addr)) {
        const start = Date.now();
        while (Date.now() - start < waitMs) {
          if (agent.security.getPeerKey(addr)) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        if (!agent.security.getPeerKey(addr)) {
          // 2026-05-24 — DON'T add to helloedPeers when the poll
          // times out.  Previously this happened right after
          // tx.sendHello, so subsequent retries skipped the HI
          // re-send entirely and threw "No pubKey registered"
          // forever.  Leaving helloedPeers unset lets the next call
          // retry the full handshake (which may succeed if the peer
          // came online or the previous HI was lost in flight).
          throw new Error(
            `secure-agent: peer "${addr}" did not respond with HI within ${waitMs}ms; ` +
            `they may be offline.  Try again after they reconnect.`,
          );
        }
      }
      // Only mark as helloed after the bidirectional handshake fully
      // completed (or wasn't needed because we already had their key).
      helloedPeers.add(addr);
    }
    // v0.7.cc — record outbound for /debug-dump diagnostic.
    recordTraffic({
      dir:     'send',
      to:      addr,
      subtype: payload?.subtype ?? payload?.type ?? null,
      size:    JSON.stringify(payload ?? {}).length,
    });
    return tx.sendOneWay(addr, payload);
  }

  /**
   * Rotate the agent's Ed25519 identity.  Wraps Agent.rotateIdentity
   * + emits KeyRotation.broadcast to known peers.  Old key valid for
   * the grace period (default 7 days) so in-flight envelopes decrypt.
   */
  async function rotateIdentity(rotateOpts = {}) {
    const oldPubKey = agent.identity.pubKey;
    await agent.rotateIdentity(rotateOpts);
    const result = {
      oldPubKey,
      newPubKey: agent.identity.pubKey,
      graceUntilDays: rotateOpts.gracePeriodSeconds
        ? rotateOpts.gracePeriodSeconds / 86_400
        : 7,
    };
    if (auditAutoLog) audit('identity.rotate', oldPubKey, { newPubKey: result.newPubKey });
    return result;
  }

  /**
   * Diagnostic snapshot.  Initially reports identity + peer transport
   * state; later slices add audit log status / mute count / token
   * count / group memberships.
   */
  function securityStatus() {
    return {
      layerWired:     !!agent.security,
      identityPub:    agent.identity.pubKey,
      identityStable: agent.identity.stableId,
      peerTransportConnected: !!peerTransport,
      peerAddress:    peerState.address,
      helloedPeerCount: helloedPeers.size,
      helloedPeers:   [...helloedPeers],
      // S1 — mute state
      muteCount:       muteSet.size,
      mutedPeers:      muteSet.list(),
      muteIsPersistent: !!opts.muteListVaultKey,
      helloGateWired:  !!userHelloGate,
      // S2 — claim state
      claimWebidBound: boundWebid,
      // S3 — vault encryption + passkey
      vaultEncrypted,
      passkeyConfigured: !!passkeyConfig,
      passkeyAvailable:  webauthnAvailable(),
      // S4 — resolver state
      resolverWired:    !!resolverMemberMap,
      // 5.7c — circle override enforcement
      circleEnforcementWired: !!circleEnf,
      // S5 — caps + trust + policy
      trustWired:       !!trustRegistry,
      capsWired,
      policyWired:      !!policyEngine,
      // S6 — audit log
      auditWired:       !!auditLog,
      auditAutoLog,
      auditSize:        auditLog?.size ?? 0,
      // S7 — groups + a2aTls + rate-limit
      groupsWired:      !!groupManager,
      a2aTlsWired:      !!a2aTls,
      rateLimitWired:   !!rateLimiter,
      rateLimitState:   rateLimiter?.snapshot() ?? null,
      // S8 — PFS (partial)
      pfsWired:         pfsEnabled,
      pfsChainCount:    pfsChains.size,
      pfsPartial:       true,            // honest: no DH ratchet
      // STUB sections — surfaces what's reserved vs what's wired:
      pendingOpts: pickStubOpts(opts),
    };
  }

  /**
   * Close the peer transport + stop the in-process agent.
   */
  async function shutdown() {
    try { await peerTransport?.disconnect?.(); } catch { /* defensive */ }
    try { await agent.stop?.(); } catch { /* defensive */ }
    peerTransport = null;
    peerState.status = 'idle';
    peerState.address = null;
  }

  return {
    agent,
    identity: {
      pubKey:   identity.pubKey,
      stableId: identity.stableId,
      vault,
    },
    peer: {
      connect: connectPeer,
      sendTo:  sendToPeer,
      get status()  { return peerState.status;  },
      get address() { return peerState.address; },
      get error()   { return peerState.error;   },
    },
    // A1 (2026-05-23) — second cross-peer transport: WebSocket relay.
    // Independent of NKN; either or both can be active.  sa.sendToPeer
    // honours `transportMode` (default 'nkn') to pick which routes.
    relay: {
      connect:    connectRelay,
      disconnect: disconnectRelay,
      get status()  { return relayState.status;  },
      get address() { return relayState.address; },
      get url()     { return relayState.url;     },
      get error()   { return relayState.error;   },
    },
    get transportMode() { return transportMode; },
    setTransportMode,
    rotateIdentity,
    securityStatus,
    shutdown,

    /** v0.7.cc — diagnostic snapshot of the last 10 envelopes,
     * inbound + outbound, for /debug-dump bug reports. */
    recentTraffic: () => recentTraffic.slice(),

    // S1 — mute / block list (S6 — instrumented for autoLog)
    mute: {
      async add(addr) {
        const r = await muteSet.add(addr);
        if (auditAutoLog && r) audit('mute.add', addr);
        return r;
      },
      async remove(addr) {
        const r = await muteSet.remove(addr);
        if (auditAutoLog && r) audit('mute.remove', addr);
        return r;
      },
      has:    (addr) => muteSet.has(addr),
      list:   ()     => muteSet.list(),
      clear:  ()     => muteSet.clear(),
      get size() { return muteSet.size; },
    },

    // S4 — identity-resolver (peer alias resolution + mute fanout)
    resolver: peerResolver,

    // S5 — TrustRegistry (vault-backed per-peer trust)
    trust: trustRegistry,                  // null when not opted in

    // S5 — CapabilityToken issuance + verification (S6 — autoLog issue)
    caps: capsWired ? {
      async issue(issueOpts = {}) {
        const token = await CapabilityToken.issue(identity, {
          agentId:   identity.pubKey,
          expiresIn: capDefaults.defaultExpiresIn ?? 3_600_000,
          skill:     '*',
          ...issueOpts,
        });
        if (auditAutoLog) {
          audit('caps.issue', issueOpts.subject, {
            tokenId:   token.id,
            skill:     token.skill,
            expiresAt: token.expiresAt,
          });
        }
        return token;
      },
      verify(token, vOpts = {}) {
        return CapabilityToken.verify(
          token,
          vOpts.expectedAgentId ?? identity.pubKey,
          vOpts,
        );
      },
    } : null,

    // S5 — PolicyEngine
    policy: policyEngine,                  // null when not opted in

    // S5 — Roles constants (no per-instance state)
    ROLES,

    // S6 — signed activity / audit log
    audit: auditLog,                       // null when not opted in
    auditAutoLog,                          // diagnostic: were auto-fires wired?

    // S7 — closed groups
    groups: groupManager,                  // null when not opted in

    // S7 — A2A TLS layer (for A2ATransport composition)
    a2aTls,                                // null when not opted in

    // S7 — rate limiter (the running instance, for inspection)
    rateLimit: rateLimiter,                // null when not opted in

    // 5.7c — circle override enforcement.  When `circleEnforcement`
    // wasn't opted in, `wired === false` and `isInboundBlocked` always
    // resolves false.  Exposed for tests + diagnostics; the live
    // receive handler invokes the same predicate.
    circleEnforcement: {
      get wired() { return !!circleEnf; },
      isInboundBlocked(env) { return isInboundCircleBlocked(env); },
    },

    // S8 — Perfect Forward Secrecy chains (partial Double-Ratchet)
    pfs: pfsEnabled ? {
      enabled: true,
      get partial() { return true; },     // honest about scope
      async encrypt(peerPubKey, plaintext) {
        const chain = await pfsChainFor(peerPubKey);
        return chain.encrypt(plaintext);
      },
      async decrypt(peerPubKey, wire) {
        const chain = await pfsChainFor(peerPubKey);
        return chain.decrypt(wire);
      },
      async chainFor(peerPubKey)   { return pfsChainFor(peerPubKey); },
      knownPeers() { return [...pfsChains.keys()]; },
    } : null,

    // S7 — pod-mirror identity migration (bound to our identity + vault)
    async migrateVaultToPod(args = {}) {
      if (!args.podClient || !args.podRoot || !args.mnemonic) {
        throw new Error(
          'sa.migrateVaultToPod: { podClient, podRoot, mnemonic } required.',
        );
      }
      const report = await migrateVaultToPodFn({
        vault,
        identity,
        podClient:  args.podClient,
        podRoot:    args.podRoot,
        mnemonic:   args.mnemonic,
        deviceMeta: args.deviceMeta ?? {},
        dryRun:     args.dryRun ?? false,
        force:      args.force ?? false,
      });
      if (auditAutoLog) audit('vault.migrate', args.podRoot, {
        migrated: report.migrated.length,
        skipped:  report.skipped.length,
        dryRun:   report.dryRun,
      });
      return report;
    },

    // S3 — WebAuthn / passkey unlock helpers
    passkey: {
      get available() { return webauthnAvailable(); },
      get config()    { return passkeyConfig; },
      async register(extra = {}) {
        if (!passkeyConfig) {
          throw new Error(
            'passkey.register: opt webAuthnUnlock not set at factory time.',
          );
        }
        return registerPasskeyFn({ ...passkeyConfig, ...extra });
      },
      async unlock(extra = {}) {
        if (!passkeyConfig) {
          throw new Error(
            'passkey.unlock: opt webAuthnUnlock not set at factory time.',
          );
        }
        return unlockWithPasskeyFn({ ...passkeyConfig, ...extra });
      },
      ERRORS: PASSKEY_ERRORS,
    },

    // S2 — signed WebID claim (S6 — autoLog claim.sign)
    claim: {
      sign(args = {}) {
        const webid = args.webid ?? boundWebid;
        if (!webid) {
          throw new Error(
            'claim.sign: no webid bound + none passed.  Either set ' +
            'opts.webidClaim.webid at factory time or pass {webid} here.',
          );
        }
        const c = signClaimFn(identity, { ...args, webid });
        if (auditAutoLog) audit('claim.sign', webid, { nknAddr: args.nknAddr ?? null });
        return c;
      },
      verify:    (c, vOpts) => verifyClaimFn(c, vOpts),
      serialize: (c)        => serializeClaim(c),
      parse:     (s)        => parseClaim(s),
      get boundWebid() { return boundWebid; },
    },

    // S0 — pendingOpts is the bridge between 'caller asked for X' and
    // 'X not wired yet'.  Future slices delete each entry from
    // STUB_OPTS as they activate.
    pendingOpts: pickStubOpts(opts),
  };
}

/**
 * Resolve the helloGate opt to a predicate fn.  Accepts:
 *   - function           → use as-is
 *   - string             → tokenGate(secret)
 *   - { token: 'xyz' }   → tokenGate('xyz')
 *   - null / undefined   → no user gate (mute-only base gate still applies)
 *
 * Returns null when no user gate; the factory installs only the mute
 * base gate in that case.
 */
function resolveHelloGate(opt) {
  if (opt == null) return null;
  if (typeof opt === 'function') return opt;
  if (typeof opt === 'string')   return tokenGate(opt);
  if (typeof opt === 'object' && typeof opt.token === 'string') {
    return tokenGate(opt.token);
  }
  throw new Error(
    'createSecureAgent: helloGate must be a function, a string ' +
    '(PSK), or { token: string }.  Got: ' + typeof opt,
  );
}

/**
 * Normalise the identityResolver opt to a MemberMap-shaped object,
 * or null if the opt wasn't set.
 *
 *   memberMapInstance  → used directly (must expose resolveByPubKey OR resolveByWebid)
 *   { memberMap }      → unwrapped
 */
function pickResolverMemberMap(opt) {
  if (opt == null) return null;
  const mm = (opt.memberMap && typeof opt.memberMap === 'object') ? opt.memberMap : opt;
  // Sanity check: at least one resolver method must be present.
  if (typeof mm.resolveByPubKey !== 'function'
   && typeof mm.resolveByWebid  !== 'function'
   && typeof mm.resolveByStableId !== 'function') {
    throw new Error(
      'createSecureAgent: identityResolver must expose at least one of ' +
      'resolveByPubKey / resolveByWebid / resolveByStableId.',
    );
  }
  return mm;
}

function pickStubOpts(opts) {
  const out = {};
  for (const key of STUB_OPTS) {
    if (opts[key] !== undefined) out[key] = opts[key];
  }
  return out;
}

/**
 * 5.7c — normalise the circleEnforcement opt to a `{groupsIndex,
 * getOverride, getCirclePolicy, memberMap, getCircleIdForEnv?}` bundle,
 * or null if the opt wasn't set / is empty.  Accepts a partial bundle
 * (any missing accessor degrades gracefully — the predicates handle
 * `null` / `undefined` and return false).
 */
function pickCircleEnforcement(opt) {
  if (opt == null) return null;
  if (typeof opt !== 'object') {
    throw new TypeError(
      'createSecureAgent: circleEnforcement must be an object with ' +
      '{groupsIndex, getOverride, getCirclePolicy, memberMap, ' +
      'getCircleIdForEnv?} accessors.',
    );
  }
  const {
    groupsIndex, getOverride, getCirclePolicy, memberMap, getCircleIdForEnv,
  } = opt;
  return {
    groupsIndex:     groupsIndex     ?? null,
    getOverride:     getOverride     ?? null,
    getCirclePolicy: getCirclePolicy ?? null,
    memberMap:       memberMap       ?? null,
    getCircleIdForEnv: typeof getCircleIdForEnv === 'function'
      ? getCircleIdForEnv
      : null,
  };
}

/**
 * 5.7c — inlined predicate logic.  Duplicates `isInboundChatOff` from
 * apps/canopy-chat/src/v2/circleEnforcement.js so secure-agent doesn't
 * have to depend on canopy-chat (layering: substrates may not import
 * apps).  Keep the two in sync; canopy-chat's substrate version is the
 * source of truth + has the full test matrix.
 */
async function isInboundChatOffLocal({ peerWebid, groupsIndex, getOverride } = {}) {
  if (typeof peerWebid !== 'string' || !peerWebid) return false;
  if (!groupsIndex || typeof groupsIndex.groupsFor !== 'function') return false;
  let circles;
  try { circles = groupsIndex.groupsFor(peerWebid); }
  catch { return false; }
  if (!Array.isArray(circles) || circles.length === 0) return false;
  for (const circleId of circles) {
    let ov = null;
    try { ov = await getOverride?.(circleId); }
    catch { ov = null; }
    if (ov?.chatOff === true) return true;
  }
  return false;
}

/**
 * 5.7c — inlined predicate logic mirroring `isInboundAgentBlocked`
 * from apps/canopy-chat/src/v2/circleEnforcement.js.
 */
async function isInboundAgentBlockedLocal({
  peerWebid, circleId, memberMap, getCirclePolicy, getOverride,
} = {}) {
  if (typeof peerWebid !== 'string' || !peerWebid) return false;
  if (typeof circleId  !== 'string' || !circleId)  return false;
  if (!memberMap || typeof memberMap.resolveByWebid !== 'function') return false;

  let member = null;
  try { member = await memberMap.resolveByWebid(peerWebid); }
  catch { member = null; }
  if (!member || member.relation !== 'agent') return false;

  let policy = null;
  try { policy = await getCirclePolicy?.(circleId); }
  catch { policy = null; }
  if (policy?.agents === 'no') return true;

  let ov = null;
  try { ov = await getOverride?.(circleId); }
  catch { ov = null; }
  if (ov?.agentsMayContactMe === false) return true;

  return false;
}

/**
 * Normalise the webAuthnUnlock opt to a config object usable by
 * the passkey helpers, or null if the opt wasn't set.
 *
 *   true         → infer rpId from window.location.hostname; userName='canopy-user'
 *   { rpId, … }  → use as-is, fill in defaults
 */
function resolvePasskeyConfig(opt) {
  if (opt == null || opt === false) return null;
  const base = (opt === true) ? {} : opt;
  const inferredRpId =
    (typeof globalThis.location !== 'undefined' && globalThis.location.hostname)
      ? globalThis.location.hostname
      : null;
  const rpId = base.rpId ?? inferredRpId;
  if (!rpId) {
    throw new Error(
      'createSecureAgent: webAuthnUnlock=true requires window.location.hostname; ' +
      'pass { rpId } explicitly outside a browser.',
    );
  }
  return {
    rpId,
    rpName:   base.rpName   ?? rpId,
    userName: base.userName ?? 'canopy-user',
    userId:   base.userId   ?? 'canopy-user',
    prfSalt:  base.prfSalt  ?? 'canopy/secure-agent/v1',
    ...(base.credentialId ? { credentialId: base.credentialId } : {}),
  };
}

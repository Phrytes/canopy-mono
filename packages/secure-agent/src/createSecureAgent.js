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
 * # What's a stub in S0 (filled by later slices)
 *
 *   - muteListVaultKey   (S1 — A.1)
 *   - helloGate          (S1 — A+.1)
 *   - webidClaim         (S2 — A.2)
 *   - passphrase         (S3 — A.3)
 *   - webAuthnUnlock     (S3 — A+.5)
 *   - identityResolver   (S4 — A.4)
 *   - capabilityIssuer   (S5 — A.5)
 *   - trustRegistry      (S5 — A+.3)
 *   - auditLog           (S6 — A.6)
 *   - groupManager       (S7 — A.7)
 *   - a2aTls             (S7 — A+.4)
 *   - rateLimit          (S7 — A+.8)
 *   - usePerfectFwdSec   (S8 — A.8)
 *
 * For each stubbed opt: if the caller supplies it, createSecureAgent
 * console.warns with a 'not yet implemented' notice + ignores; the
 * eventual slice will read the same opt + activate behaviour.
 * Opts are explicit IN THE FACTORY SIGNATURE today so apps can
 * write `passphrase: '...'` now + it just works the day S3 lands.
 */

import {
  Agent,
  AgentIdentity,
  InternalBus,
  InternalTransport,
  NknTransport,
} from '@canopy/core';

import { makeBrowserVault, restoreOrGenerate } from './vault.js';

/**
 * @typedef {object} CreateSecureAgentOpts
 *
 * @property {object}  [vault]                  Pre-built Vault (e.g. VaultMemory for tests)
 * @property {string}  [identityVaultPrefix]    Default 'sa-id:'
 * @property {string}  [passphrase]             [STUB — S3] passphrase to wrap vault
 * @property {boolean} [webAuthnUnlock]         [STUB — S3a] use passkey to unlock vault
 *
 * @property {object}  [nknLib]                 window.nkn from CDN, or RN nkn-sdk; absent → no peer transport
 *
 * @property {string}  [muteListVaultKey]       [STUB — S1] persistent mute set
 * @property {Function|string} [helloGate]      [STUB — S1] gate fn or 'pre-shared-secret'
 * @property {object}  [webidClaim]             [STUB — S2] { sign, publishOnSignIn }
 * @property {boolean} [identityResolver]       [STUB — S4]
 * @property {boolean} [capabilityIssuer]       [STUB — S5]
 * @property {boolean} [trustRegistry]          [STUB — S5b]
 * @property {object}  [auditLog]               [STUB — S6] { signEvery, podSyncEvery }
 * @property {boolean} [groupManager]           [STUB — S7]
 * @property {boolean} [a2aTls]                 [STUB — S7a]
 * @property {object}  [rateLimit]              [STUB — S7b] { perPeer, perSkill }
 * @property {boolean} [usePerfectFwdSec]       [STUB — S8]
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
  'passphrase',
  'webAuthnUnlock',
  'muteListVaultKey',
  'helloGate',
  'webidClaim',
  'identityResolver',
  'capabilityIssuer',
  'trustRegistry',
  'auditLog',
  'groupManager',
  'a2aTls',
  'rateLimit',
  'usePerfectFwdSec',
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

  // ─── Identity (persists across page loads when vault supports it) ───
  const vault = opts.vault ?? makeBrowserVault(opts.identityVaultPrefix ?? 'sa-id:');
  const identity = await restoreOrGenerate(vault);

  // ─── Agent on a single-agent InternalBus (no co-located peers) ───
  // Note: in-process app topologies (host+chat in canopy-chat) build
  // their own bus + multi-agent setup; secure-agent gives them a
  // CLEAN cross-peer agent that they can compose alongside.
  const bus = new InternalBus();
  const transport = new InternalTransport(bus, identity.pubKey);
  const agent = new Agent({ identity, transport });
  await agent.start();

  // ─── Peer state (NKN cross-peer; stays idle until connect()) ───
  let peerTransport = null;
  const peerState = { status: 'idle', address: null, error: null };
  const helloedPeers = new Set();

  /**
   * Establish the cross-peer NKN transport, wired with SecurityLayer
   * + receive-path that calls onPeerMessage.
   */
  async function connectPeer() {
    if (!opts.nknLib) {
      throw new Error(
        'createSecureAgent: connect() called but no nknLib provided.  ' +
        'Pass window.nkn (CDN-loaded in browser) or the RN nkn-sdk.',
      );
    }
    if (peerState.status === 'connected' || peerState.status === 'connecting') {
      return { ...peerState };
    }
    peerState.status = 'connecting';
    try {
      const tx = new NknTransport({ identity, nknLib: opts.nknLib });
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
      tx.on('envelope', (env) => {
        try {
          if (!helloedPeers.has(env._from)) {
            tx.sendHello(env._from, { pubKey: identity.pubKey })
              .catch((err) => console.warn('[secure-agent] reciprocal HI failed', err));
            helloedPeers.add(env._from);
          }
        } catch (err) {
          console.warn('[secure-agent] reciprocal-HI bookkeeping failed', err);
        }
        if (typeof opts.onPeerMessage === 'function') {
          try {
            opts.onPeerMessage({
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
      await tx.connect();
      peerTransport     = tx;
      peerState.status  = 'connected';
      peerState.address = tx.address;
      peerState.error   = null;
      return { ...peerState };
    } catch (err) {
      peerState.status = 'error';
      peerState.error  = err?.message ?? String(err);
      throw err;
    }
  }

  /**
   * Send an envelope to a peer.  Auto-HI on first contact so the
   * peer registers our pubKey + can decrypt the subsequent payload.
   */
  async function sendToPeer(addr, payload) {
    if (!peerTransport) {
      throw new Error('Peer transport not connected.  connect() first.');
    }
    if (!helloedPeers.has(addr)) {
      try {
        await peerTransport.sendHello(addr, { pubKey: identity.pubKey });
        helloedPeers.add(addr);
      } catch (err) {
        // Log + continue — sendOneWay may still succeed if the peer
        // already has our pubKey from a previous session.
        if (typeof console !== 'undefined') {
          console.warn('[secure-agent] HI failed (continuing)', err.message ?? err);
        }
      }
    }
    return peerTransport.sendOneWay(addr, payload);
  }

  /**
   * Rotate the agent's Ed25519 identity.  Wraps Agent.rotateIdentity
   * + emits KeyRotation.broadcast to known peers.  Old key valid for
   * the grace period (default 7 days) so in-flight envelopes decrypt.
   */
  async function rotateIdentity(rotateOpts = {}) {
    const oldPubKey = agent.identity.pubKey;
    await agent.rotateIdentity(rotateOpts);
    return {
      oldPubKey,
      newPubKey: agent.identity.pubKey,
      graceUntilDays: rotateOpts.gracePeriodSeconds
        ? rotateOpts.gracePeriodSeconds / 86_400
        : 7,
    };
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
    rotateIdentity,
    securityStatus,
    shutdown,
    // S0 — pendingOpts is the bridge between 'caller asked for X' and
    // 'X not wired yet'.  Future slices delete each entry from
    // STUB_OPTS as they activate.
    pendingOpts: pickStubOpts(opts),
  };
}

function pickStubOpts(opts) {
  const out = {};
  for (const key of STUB_OPTS) {
    if (opts[key] !== undefined) out[key] = opts[key];
  }
  return out;
}

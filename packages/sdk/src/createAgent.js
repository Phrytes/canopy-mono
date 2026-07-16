/**
 * createAgent — the HIGH-layer, batteries-included "run as an agent" helper.
 *
 * This is the Tier-3 (run-as-agent) entry point of the facade: one call
 * wires an identity, a vault, an (optional) transport and any skills into a
 * STARTED `core.Agent`, injecting sensible defaults so a dev can "import one
 * thing, done".
 *
 * It is modelled on the wiring in `@onderling/secure-agent`'s createSecureAgent
 * and `@onderling/react-native`'s createMeshAgent, but kept deliberately
 * PLATFORM-AGNOSTIC (Node + browser; no react-native-only imports) and THIN:
 * the defaults live HERE, on top of the low layer, never back in the kernel.
 *
 * Defaults (all overridable):
 *   - vault      → `new VaultMemory()`            (RAM-only; swap for a
 *                                                  persistent Vault family
 *                                                  member from @onderling/vault)
 *   - identity   → `AgentIdentity.generate(vault)` (or restore-or-generate
 *                                                  when the vault already
 *                                                  holds an identity)
 *   - transport  → in-process `InternalTransport` on a fresh `InternalBus`
 *                  (offline / same-process). If `opts.relayUrl` is set, a
 *                  `RelayTransport` from @onderling/transports is used instead.
 *
 * DEFAULT-TRANSPORT POLICY (v1 fork — see report): with neither `transport`
 * nor `relayUrl` given, we default to the in-process InternalTransport rather
 * than core's OfflineTransport. Rationale: InternalTransport is a real,
 * loopback-capable bus, so a lone agent (and other in-process agents sharing
 * the same bus) can actually register + call skills with no network — which
 * is exactly the zero-config "just works" path this helper promises.
 * OfflineTransport, by contrast, rejects every send with a clean error, so a
 * batteries-included agent built on it could never run a local skill. Pass
 * your own `opts.transport` (e.g. `new OfflineTransport({ identity })`) to
 * opt out.
 */

import {
  Agent,
  AgentIdentity,
  InternalBus,
  InternalTransport,
} from '@onderling/core';
import { RelayTransport } from '@onderling/transports';
import { VaultMemory }    from '@onderling/vault';

import { connectSkill } from './connectSkill.js';

/**
 * @typedef {object} CreateAgentOpts
 * @property {object}  [identity]   Pre-built AgentIdentity. Default: restore-or-generate against `vault`.
 * @property {object}  [vault]      Any @onderling/vault Vault. Default: `new VaultMemory()`.
 * @property {object}  [transport]  Pre-built Transport. Overrides the relayUrl / in-process defaults entirely.
 * @property {string}  [relayUrl]   ws:// or wss:// relay URL → builds a RelayTransport (ignored if `transport` given).
 * @property {object}  [bus]        Share an InternalBus so multiple in-process agents can reach each other (ignored if `transport`/`relayUrl` given).
 * @property {Array|object} [skills] Skills to register before start. Array of `{ name, handler, opts?, plain? }` or a `{ name: handler }` map. `plain: true` (or a non-skill-shaped fn) routes through connectSkill (appFn(args, ctx)); otherwise handler is a raw core skill handler(ctx).
 * @property {Array<[string,string]>} [peers] `[address, pubKey]` pairs to pre-register (so cross-agent in-process calls can encrypt on first send).
 * @property {string}  [label]      Optional display label on the agent.
 * @property {boolean} [autoStart=true] Start the agent before returning. `false` lets the caller register more skills first.
 * @property {object}  [config]     Forwarded to the Agent as `config`.
 */

/**
 * Build and (by default) start a batteries-included agent.
 *
 * @param {CreateAgentOpts} [opts]
 * @returns {Promise<import('@onderling/core').Agent>} the started core.Agent
 */
export async function createAgent(opts = {}) {
  const {
    identity: identityOpt,
    vault:    vaultOpt,
    transport: transportOpt,
    relayUrl,
    bus:      busOpt,
    skills,
    peers,
    label     = null,
    autoStart = true,
    config,
  } = opts;

  // ── Vault (default: RAM-only) ──────────────────────────────────────────
  const vault = vaultOpt ?? new VaultMemory();

  // ── Identity (restore-or-generate against the vault) ───────────────────
  let identity = identityOpt;
  if (!identity) {
    try {
      identity = await AgentIdentity.restore(vault);
    } catch {
      identity = await AgentIdentity.generate(vault);
    }
  }

  // ── Transport (explicit > relay > in-process default) ──────────────────
  // See DEFAULT-TRANSPORT POLICY in the file header for why the zero-config
  // fallback is the loopback-capable InternalTransport, not OfflineTransport.
  let transport = transportOpt;
  if (!transport) {
    if (relayUrl) {
      transport = new RelayTransport({ identity, relayUrl });
    } else {
      const bus = busOpt ?? new InternalBus();
      transport = new InternalTransport(bus, identity.pubKey, { identity });
    }
  }

  // ── Agent ──────────────────────────────────────────────────────────────
  const agent = new Agent({
    identity,
    transport,
    ...(config ? { config } : {}),
    ...(label  ? { label }  : {}),
  });

  // ── Pre-register peers (so cross-agent encryption works on first send) ──
  if (Array.isArray(peers)) {
    for (const pair of peers) {
      if (Array.isArray(pair) && pair.length === 2) agent.addPeer(pair[0], pair[1]);
    }
  }

  // ── Skills (before start, so inbound HI sees a correct capability set) ──
  registerSkills(agent, skills);

  if (autoStart) await agent.start();
  return agent;
}

/**
 * Register the `skills` opt onto an agent.
 *
 * Accepts either:
 *   - an array of `{ name|id, handler, opts?, plain? }`, or
 *   - a plain object map `{ name: handler }`.
 *
 * A `plain: true` flag (or omission of a recognisable core-skill shape)
 * routes the handler through {@link connectSkill} so it is treated as a
 * plain `appFn(args, ctx)`. Otherwise the handler is registered verbatim as
 * a raw core skill handler (`handler(ctx)`).
 */
function registerSkills(agent, skills) {
  if (!skills) return;

  const list = Array.isArray(skills)
    ? skills
    : Object.entries(skills).map(([name, handler]) => ({ name, handler }));

  for (const entry of list) {
    if (!entry) continue;
    const name    = entry.name ?? entry.id;
    const handler = entry.handler;
    if (!name || typeof handler !== 'function') {
      throw new Error('createAgent: each skill needs a { name, handler } (handler must be a function)');
    }
    if (entry.plain) {
      connectSkill(agent, name, handler, entry.opts);
    } else {
      agent.register(name, handler, entry.opts ?? {});
    }
  }
}

/**
 * Agent — developer-facing class.
 *
 * Owns: identity, transport(s), security, skill registry, state manager,
 * optional policy engine, optional peer graph, optional storage, optional config.
 *
 * Single-transport usage (backward compat):
 *   const agent = new Agent({ identity, transport });
 *   agent.register('echo', async ({ parts }) => parts);
 *   await agent.start();
 *   await agent.hello(peerAddress);
 *   const result = await agent.invoke(peerAddress, 'echo', [TextPart('hi')]);
 *
 * Multi-transport usage:
 *   const agent = new Agent({ identity, transport: relayTransport });
 *   agent.addTransport('ble', bleTransport);
 *   await agent.start();           // connects all transports
 *
 * With full wiring:
 *   const agent = new Agent({ identity, transport, peers, storage, config });
 *   // agent.peers  → PeerGraph
 *   // agent.storage → StorageManager
 *   // agent.config  → AgentConfig
 */
import { Emitter }            from './Emitter.js';
import { SecurityLayer }      from './security/SecurityLayer.js';
import { SkillRegistry }      from './skills/SkillRegistry.js';
import { defineSkill }        from './skills/defineSkill.js';
import { StateManager }       from './state/StateManager.js';
import { Parts }              from './Parts.js';
import { P }                  from './Envelope.js';
import { sendHello, handleHello }                    from './protocol/hello.js';
import { handleMessage }                             from './protocol/messaging.js';
import { handleSkillDiscovery }                      from './protocol/skillDiscovery.js';
import { callSkill, handleTaskRequest, handleTaskOneWay } from './protocol/taskExchange.js';
import { handlePubSub }                              from './protocol/pubSub.js';
import { invokeWithHop }                             from './routing/invokeWithHop.js';
import { registerRelayForward }                      from './skills/relayForward.js';
import { PeerDiscovery }                             from './discovery/PeerDiscovery.js';

export class Agent extends Emitter {
  #identity;
  #transport;              // primary / default transport (backward compat)
  #transports;             // Map<name, Transport> — all named transports
  #security;
  #skills;
  #stateManager;
  #policyEngine  = null;
  #trustRegistry = null;
  #tokenRegistry = null;
  #peers         = null;   // PeerGraph | null
  #storage       = null;   // StorageManager | null
  #config        = null;   // AgentConfig | null
  #routing       = null;   // RoutingStrategy | null
  #discovery     = null;   // PeerDiscovery | null — lazy, via startDiscovery()
  #maxTaskTtl    = null;
  #pubSubHistory = 0;
  #started       = false;
  #label         = null;

  /**
   * @param {object} opts
   * @param {import('./identity/AgentIdentity.js').AgentIdentity}     opts.identity
   * @param {import('./transport/Transport.js').Transport}             opts.transport   — primary transport
   * @param {import('./security/SecurityLayer.js').SecurityLayer}      [opts.security]
   * @param {import('./permissions/PolicyEngine.js').PolicyEngine}     [opts.policyEngine]
   * @param {import('./permissions/TrustRegistry.js').TrustRegistry}  [opts.trustRegistry]
   * @param {import('./permissions/TokenRegistry.js').TokenRegistry}   [opts.tokenRegistry]
   * @param {import('./discovery/PeerGraph.js').PeerGraph}             [opts.peers]
   * @param {import('./storage/StorageManager.js').StorageManager}     [opts.storage]
   * @param {import('./config/AgentConfig.js').AgentConfig}            [opts.config]
   * @param {import('./routing/RoutingStrategy.js').RoutingStrategy}   [opts.routing]
   * @param {Array}  [opts.skills]
   * @param {string} [opts.label]
   */
  constructor({ identity, transport, security, policyEngine, trustRegistry,
                tokenRegistry, peers, storage, config, routing,
                maxTaskTtl, pubSubHistory,
                skills = [], label } = {}) {
    super();
    if (!identity)  throw new Error('Agent requires an identity');
    if (!transport) throw new Error('Agent requires a transport');

    this.#identity      = identity;
    this.#transport     = transport;
    this.#transports    = new Map([['default', transport]]);
    this.#security      = security ?? new SecurityLayer({ identity });
    this.#skills        = new SkillRegistry();
    this.#stateManager  = new StateManager();
    this.#policyEngine  = policyEngine  ?? null;
    this.#trustRegistry = trustRegistry ?? null;
    this.#tokenRegistry = tokenRegistry ?? null;
    this.#peers         = peers         ?? null;
    this.#storage       = storage       ?? null;
    this.#config        = config        ?? null;
    this.#routing       = routing       ?? null;
    this.#maxTaskTtl    = maxTaskTtl    ?? null;
    this.#pubSubHistory = pubSubHistory ?? 0;
    this.#label         = label         ?? null;

    for (const s of skills) this.#skills.register(s);
  }

  // ── Identity / address ────────────────────────────────────────────────────

  get address()       { return this.#transport.address; }
  get pubKey()        { return this.#identity.pubKey; }
  get label()         { return this.#label; }
  get identity()      { return this.#identity; }
  get security()      { return this.#security; }
  get skills()        { return this.#skills; }
  get stateManager()  { return this.#stateManager; }
  get policyEngine()  { return this.#policyEngine; }
  get trustRegistry() { return this.#trustRegistry; }
  get tokenRegistry() { return this.#tokenRegistry; }
  get transport()     { return this.#transport; }

  /** PeerGraph — optional. Populated automatically by hello() when provided. */
  get peers()    { return this.#peers; }
  /** StorageManager — optional. */
  get storage()  { return this.#storage; }
  /** AgentConfig — optional. */
  get config()   { return this.#config; }
  /** RoutingStrategy — optional. Used by call() when multiple transports are present. */
  get routing()  { return this.#routing; }

  get maxTaskTtl()    { return this.#maxTaskTtl; }
  get pubSubHistory() { return this.#pubSubHistory; }

  // ── Multi-transport management ────────────────────────────────────────────

  /**
   * Add a named transport. On start() (or immediately if already started)
   * the transport is connected and its receive handler wired to this agent's
   * dispatch loop.
   *
   * @param {string} name  — e.g. 'relay', 'ble', 'nkn'
   * @param {import('./transport/Transport.js').Transport} transport
   */
  addTransport(name, transport) {
    this.#transports.set(name, transport);
    if (this.#started) {
      transport.useSecurityLayer(this.#security);
      transport.setReceiveHandler(env => this._dispatch(env));
      transport.on('security-error', err => this.emit('security-error', err));
      transport.connect().catch(err => this.emit('error', err));
    }
    return this;
  }

  /** Remove and disconnect a named transport. */
  removeTransport(name) {
    const t = this.#transports.get(name);
    if (t) {
      t.disconnect().catch(() => {});
      this.#transports.delete(name);
      if (t === this.#transport && this.#transports.size > 0) {
        // Promote next transport as primary
        this.#transport = this.#transports.values().next().value;
      }
    }
    return this;
  }

  /** Get a named transport by name. */
  getTransport(name) {
    return this.#transports.get(name) ?? null;
  }

  /** All transport names currently registered. */
  get transportNames() {
    return [...this.#transports.keys()];
  }

  // ── Peer management ───────────────────────────────────────────────────────

  /**
   * Manually register a peer's pubKey (skip hello).
   * @param {string} address
   * @param {string} pubKeyB64
   */
  addPeer(address, pubKeyB64) {
    this.#security.registerPeer(address, pubKeyB64);
    return this;
  }

  /**
   * Forget a peer: clear their key from SecurityLayer, remove from PeerGraph,
   * and tell every transport to drop its caches.  Each transport can then
   * re-discover the peer (and re-emit peer-discovered) if they're still
   * reachable — so forget → natural re-hello.
   *
   * @param {string} pubKeyOrAddress
   */
  async forget(pubKeyOrAddress) {
    this.#security.unregisterPeer(pubKeyOrAddress);
    if (this.#peers) await this.#peers.remove(pubKeyOrAddress).catch(() => {});
    for (const t of this.#transports.values()) {
      try { t.forgetPeer?.(pubKeyOrAddress); } catch {}
    }
    this.emit('peer-forgotten', pubKeyOrAddress);
  }

  // ── Skill registration ────────────────────────────────────────────────────

  /**
   * Register a skill handler inline.
   * @param {string}   id
   * @param {Function} handler  async ({ parts, from, taskId, envelope, agent }) → Part[]|any
   *                            async function*(...) for streaming
   * @param {object}   [opts]
   */
  register(id, handler, opts = {}) {
    this.#skills.register(defineSkill(id, handler, opts));
    return this;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start() {
    if (this.#started) return;
    this.#started = true;

    for (const [, transport] of this.#transports) {
      transport.useSecurityLayer(this.#security);
      transport.setReceiveHandler(env => this._dispatch(env));
      transport.on('security-error', err => this.emit('security-error', err));
    }
    // Connect all transports (in parallel; errors on non-primary are soft)
    const entries = [...this.#transports.entries()];
    await Promise.all(entries.map(([name, t]) =>
      t.connect().catch(err => {
        if (t === this.#transport) throw err; // primary failure is fatal
        this.emit('error', Object.assign(err, { transportName: name }));
      })
    ));
    this.emit('start', { address: this.address });
  }

  async stop() {
    if (!this.#started) return;
    this.#started = false;
    await Promise.allSettled([...this.#transports.values()].map(t => t.disconnect()));
    this.emit('stop');
  }

  // ── Transport selection ───────────────────────────────────────────────────

  /**
   * Resolve the best transport for a peer.
   * Uses RoutingStrategy when available; otherwise returns the primary transport.
   *
   * @param {string} peerId
   * @param {object} [opts]   — passed to RoutingStrategy.selectTransport
   * @returns {Promise<import('./transport/Transport.js').Transport>}
   */
  async transportFor(peerId, opts = {}) {
    if (this.#routing && this.#transports.size > 1) {
      const result = await this.#routing.selectTransport(peerId, opts);
      if (result?.transport) return result.transport;
    }
    return this.#transport;
  }

  // ── High-level API ────────────────────────────────────────────────────────

  /**
   * Bidirectional hello handshake.  After resolving, both SecurityLayers
   * have each other's pubKey.  If agent.peers (PeerGraph) is set, the peer
   * record is upserted automatically.
   *
   * @param {string} peerAddress
   * @param {number} [timeout=15000]
   */
  async hello(peerAddress, timeout) {
    await sendHello(this, peerAddress, timeout);
    // Wire into PeerGraph if available (best-effort — don't fail hello on graph error)
    if (this.#peers) {
      const peerPubKey = this.#security.getPeerKey(peerAddress);
      if (peerPubKey) {
        this.#peers.upsert({
          type:          'native',
          pubKey:        peerPubKey,
          transports:    { default: { address: peerAddress, lastSeen: Date.now() } },
          lastSeen:      Date.now(),
          reachable:     true,
          discoveredVia: 'hello',
        }).catch(() => {});
      }
    }
  }

  /**
   * Call a skill on a peer. Returns a Task immediately.
   * Await task.done() or iterate task.stream() for chunks.
   *
   * @param {string}   peerId
   * @param {string}   skillId
   * @param {Array|*}  input
   * @param {object}   [opts]
   * @param {number}   [opts.timeout]
   * @param {string}   [opts.transport]   — named transport to use (bypasses routing)
   * @returns {import('./protocol/Task.js').Task}
   */
  call(peerId, skillId, input = [], opts = {}) {
    const parts = Parts.wrap(input);
    // If a specific transport name is requested, use it directly
    if (opts.transport) {
      const t = this.#transports.get(opts.transport);
      if (!t) throw new Error(`Unknown transport: ${opts.transport}`);
      return callSkill({ ...this._asCallCtx(), _overrideTransport: t }, peerId, skillId, parts, opts);
    }
    return callSkill(this, peerId, skillId, parts, opts);
  }

  /**
   * call() + await done() + return parts.  Throws if task fails.
   * @returns {Promise<import('./Parts.js').Part[]>}
   */
  async invoke(peerId, skillId, input = [], opts = {}) {
    const task   = this.call(peerId, skillId, input, opts);
    const result = await task.done();
    if (result.state === 'failed') throw new Error(result.error ?? `Skill "${skillId}" failed`);
    return result.parts;
  }

  /**
   * Hop-aware invoke: tries direct first, falls back to relay-forward via a
   * bridge peer (record.via or any reachable direct peer). Handles the
   * "hello not yet done" case by auto-hello'ing once and retrying.
   *
   * See packages/core/src/routing/invokeWithHop.js for the full strategy.
   *
   * @param {string}   peerId
   * @param {string}   skillId
   * @param {Array|*}  [input]
   * @param {object}   [opts]
   * @returns {Promise<import('./Parts.js').Part[]>}
   */
  invokeWithHop(peerId, skillId, input = [], opts = {}) {
    return invokeWithHop(this, peerId, skillId, Parts.wrap(input), opts);
  }

  /**
   * Opt-in: register the 'relay-forward' skill so trusted peers can ask us
   * to forward their messages to third parties we can reach directly.
   * Idempotent — calling twice does nothing the second time.
   *
   * @param {object} [opts]
   * @param {'never'|'authenticated'|'trusted'|`group:${string}`|'always'} [opts.policy]
   *        Override for the allowRelayFor policy. Otherwise pulls from
   *        agent.config.get('policy.allowRelayFor') and then 'never'.
   */
  enableRelayForward(opts = {}) {
    if (this.#skills.get('relay-forward')) return this;
    if (opts.policy !== undefined && this.#config?.set) {
      this.#config.set('policy.allowRelayFor', opts.policy);
    }
    registerRelayForward(this, opts);
    return this;
  }

  /**
   * Opt-in: start the ping + gossip loops (PeerDiscovery). Also registers
   * the 'peer-list' skill.  Idempotent — second call is a no-op.
   *
   * @param {object} [opts]
   * @param {number} [opts.pingIntervalMs=30000]
   * @param {number} [opts.gossipIntervalMs=60000]
   * @param {number} [opts.maxGossipPeers=8]
   * @returns {import('./discovery/PeerDiscovery.js').PeerDiscovery}
   */
  startDiscovery(opts = {}) {
    if (this.#discovery) return this.#discovery;
    this.#discovery = new PeerDiscovery({
      agent:           this,
      peerGraph:       this.#peers,
      pingIntervalMs:  opts.pingIntervalMs,
      gossipIntervalMs: opts.gossipIntervalMs,
      maxGossipPeers:  opts.maxGossipPeers,
    });
    this.#discovery.start();
    return this.#discovery;
  }

  /** The active PeerDiscovery instance, if startDiscovery() has been called. */
  get discovery() { return this.#discovery; }

  /**
   * Send a one-way message (OW). No delivery confirmation.
   */
  async message(peerId, partsOrValue) {
    await this.#transport.sendOneWay(peerId, {
      type:  'message',
      parts: Parts.wrap(partsOrValue),
    });
  }

  /**
   * Forward a peer's contact card to another peer (introduction).
   * The recipient can then use the card to initiate hello.
   *
   * @param {string} peerId   — who receives the introduction
   * @param {object} card     — { pubKey, address, label?, skills? }
   */
  async introduce(peerId, card) {
    await this.#transport.sendOneWay(peerId, {
      type: 'introduction',
      card,
    });
  }

  /**
   * Fetch and register an A2A agent by its base URL.
   * Upserts into agent.peers (PeerGraph) if available.
   *
   * @param {string} url  — base URL, e.g. 'https://agent.example.com'
   * @returns {Promise<object>}  — the A2A peer record
   */
  async discoverA2A(url, opts = {}) {
    const { discoverA2A: _discover } = await import('./a2a/a2aDiscover.js');
    return _discover(this, url, { peerGraph: this.#peers, ...opts });
  }

  /**
   * Issue a signed capability token granting a native peer access to a skill.
   *
   * @param {object} opts
   * @param {string}  opts.subject      — recipient pubKey (base64url)
   * @param {string}  opts.skill        — skill id, or '*' for all
   * @param {number}  [opts.expiresIn]  — seconds (default 86400)
   * @param {object}  [opts.constraints]
   * @param {object}  [opts.parentToken]
   * @returns {Promise<import('./permissions/CapabilityToken.js').CapabilityToken>}
   */
  async issueCapabilityToken(opts = {}) {
    const { CapabilityToken } = await import('./permissions/CapabilityToken.js');
    return CapabilityToken.issue(this.#identity, {
      agentId: this.pubKey,
      ...opts,
    });
  }

  /**
   * Issue a JWT capability token for an A2A peer.
   *
   * @param {object} opts — same as issueCapabilityToken
   * @returns {Promise<string>}  — signed JWT string
   */
  async issueA2ACapabilityToken(opts = {}) {
    const { CapabilityToken } = await import('./permissions/CapabilityToken.js');
    return CapabilityToken.issueJWT(this.#identity, {
      agentId: this.pubKey,
      ...opts,
    });
  }

  /**
   * Store an outbound Bearer token for an A2A peer URL.
   * Used by A2AAuth.buildHeaders when calling that peer.
   *
   * @param {string} peerUrl
   * @param {string} token
   */
  async storeA2AToken(peerUrl, token) {
    const vault = this.#identity._vault ?? this.#identity.vault;
    if (!vault) throw new Error('No vault available on identity');
    await vault.set(`a2a-token:${peerUrl}`, token);
  }

  /**
   * Request the skill list from a peer.
   * @returns {Promise<Array>}
   */
  async discoverSkills(peerId, timeout) {
    const { requestSkills } = await import('./protocol/skillDiscovery.js');
    return requestSkills(this, peerId, timeout);
  }

  /**
   * Publish to all subscribed peers.
   */
  async publish(topic, partsOrValue) {
    const { publish: _publish } = await import('./protocol/pubSub.js');
    return _publish(this, topic, partsOrValue);
  }

  /**
   * Clear stored pub/sub history.
   * @param {string} [topic]
   */
  clearPubSubHistory(topic) {
    if (topic) {
      this._pubSubHistory?.delete(topic);
    } else {
      this._pubSubHistory?.clear();
    }
    return this;
  }

  /**
   * Export this agent as a plain object (no secrets).
   * Suitable for serialisation, QR codes, or card sharing.
   */
  export() {
    const skills = this.#skills.all()
      .filter(s => s.visibility !== 'private' && s.enabled)
      .map(s => ({
        id:          s.id,
        description: s.description,
        inputModes:  s.inputModes,
        outputModes: s.outputModes,
        tags:        s.tags,
        streaming:   s.streaming,
        visibility:  s.visibility,
      }));

    return {
      pubKey:  this.pubKey,
      address: this.address,
      label:   this.#label ?? null,
      skills,
      transports: [...this.#transports.entries()].map(([name, t]) => ({
        name,
        address: t.address,
      })),
    };
  }

  // ── Static factory methods ────────────────────────────────────────────────

  /**
   * Create a new agent with a freshly generated identity.
   *
   * @param {object} opts
   * @param {import('./transport/Transport.js').Transport} opts.transport
   * @param {import('./identity/Vault.js').Vault}          [opts.vault]    — defaults to VaultMemory
   * @param {string}                                        [opts.label]
   * @param {object}                                        rest            — any other Agent constructor options
   * @returns {Promise<Agent>}
   */
  static async createNew({ transport, vault, label, ...rest } = {}) {
    if (!transport) throw new Error('Agent.createNew requires transport');
    const { VaultMemory }    = await import('./identity/VaultMemory.js');
    const { AgentIdentity }  = await import('./identity/AgentIdentity.js');
    const resolvedVault      = vault ?? new VaultMemory();
    const identity           = await AgentIdentity.generate(resolvedVault);
    return new Agent({ identity, transport, label, ...rest });
  }

  /**
   * Restore an agent from an existing vault (private key must already be stored).
   *
   * @param {object} opts
   * @param {import('./transport/Transport.js').Transport} opts.transport
   * @param {import('./identity/Vault.js').Vault}          opts.vault
   * @returns {Promise<Agent>}
   */
  static async restore({ transport, vault, ...rest } = {}) {
    if (!transport) throw new Error('Agent.restore requires transport');
    if (!vault)     throw new Error('Agent.restore requires vault');
    const { AgentIdentity } = await import('./identity/AgentIdentity.js');
    const identity          = await AgentIdentity.restore(vault);
    return new Agent({ identity, transport, ...rest });
  }

  /**
   * Restore an agent from a BIP39 mnemonic.
   * The same mnemonic always produces the same keypair.
   *
   * @param {string} mnemonic
   * @param {object} opts
   * @param {import('./transport/Transport.js').Transport} opts.transport
   * @param {import('./identity/Vault.js').Vault}          [opts.vault]
   * @returns {Promise<Agent>}
   */
  static async restoreFromMnemonic(mnemonic, { transport, vault, ...rest } = {}) {
    if (!transport) throw new Error('Agent.restoreFromMnemonic requires transport');
    const { VaultMemory }   = await import('./identity/VaultMemory.js');
    const { AgentIdentity } = await import('./identity/AgentIdentity.js');
    const resolvedVault     = vault ?? new VaultMemory();
    const identity          = await AgentIdentity.fromMnemonic(mnemonic, resolvedVault);
    return new Agent({ identity, transport, ...rest });
  }

  /**
   * Create an agent from a plain config object.
   *
   * The object shape follows the YAML agent file format (agent.* fields):
   * {
   *   label?: string,
   *   connections?: { relay?: { url }, nkn?: {}, mqtt?: { broker } },
   *   skills?: object[],       // registered after construction
   * }
   * The caller must supply transport (or connections) and optionally vault.
   *
   * @param {object} obj
   * @param {object} opts
   * @param {import('./transport/Transport.js').Transport} [opts.transport]
   * @param {import('./identity/Vault.js').Vault}          [opts.vault]
   * @returns {Promise<Agent>}
   */
  static async fromPlainObject(obj, { transport, vault, ...rest } = {}) {
    const { VaultMemory }   = await import('./identity/VaultMemory.js');
    const { AgentIdentity } = await import('./identity/AgentIdentity.js');
    const { AgentConfig }   = await import('./config/AgentConfig.js');

    const agentSection = obj.agent ?? obj;
    const resolvedVault = vault ?? new VaultMemory();

    // Try restore first (existing key in vault), else generate
    let identity;
    try {
      identity = await AgentIdentity.restore(resolvedVault);
    } catch {
      identity = await AgentIdentity.generate(resolvedVault);
    }

    // Build transport from connections config if not provided explicitly
    let resolvedTransport = transport;
    if (!resolvedTransport && agentSection.connections) {
      resolvedTransport = await _buildTransportFromConnections(
        agentSection.connections, identity
      );
    }
    if (!resolvedTransport) throw new Error('Agent.fromPlainObject requires transport or connections');

    const config = new AgentConfig({ file: agentSection });

    const agent = new Agent({
      identity,
      transport: resolvedTransport,
      label: agentSection.label ?? agentSection.id ?? null,
      config,
      ...rest,
    });

    return agent;
  }

  /**
   * Create an agent from a JSON string.
   * @param {string} json
   * @param {object} [opts]  — same as fromPlainObject opts
   */
  static async fromJson(json, opts = {}) {
    let obj;
    try { obj = JSON.parse(json); }
    catch (e) { throw new Error(`Agent.fromJson: invalid JSON — ${e.message}`); }
    return Agent.fromPlainObject(obj, opts);
  }

  /**
   * Create an agent from a YAML string.
   * Requires js-yaml to be available (import or CDN).
   * Falls back to JSON parsing if the string is valid JSON.
   *
   * @param {string} yaml
   * @param {object} [opts]
   */
  static async fromYaml(yaml, opts = {}) {
    // Try JSON first (YAML is a superset of JSON)
    let obj;
    try { obj = JSON.parse(yaml); }
    catch {
      // Try dynamic import of js-yaml (must be available in the environment)
      let jsYaml;
      try {
        jsYaml = (await import('js-yaml')).default ?? (await import('js-yaml'));
      } catch {
        throw new Error(
          'Agent.fromYaml: js-yaml not available. ' +
          'Install js-yaml (npm/esm.sh) or pass pre-parsed object to Agent.fromPlainObject().'
        );
      }
      obj = jsYaml.load(yaml);
    }
    return Agent.fromPlainObject(obj, opts);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Internal: return a context object for callSkill when an override transport
   * is needed.  Not part of the public API.
   */
  _asCallCtx() { return this; }

  // ── Inbound dispatch ──────────────────────────────────────────────────────

  _dispatch(envelope) {
    switch (envelope._p) {

      case P.HI:
        handleHello(this, envelope).catch(err => this.emit('error', err));
        break;

      case P.RQ:
        handleTaskRequest(this, envelope)
          .then(handled => {
            if (handled) return;
            return handleSkillDiscovery(this, envelope);
          })
          .then(handled => {
            if (!handled) this.emit('envelope', envelope);
          })
          .catch(err => this.emit('error', err));
        break;

      case P.OW:
      case P.AS: {
        if (handleTaskOneWay(this, envelope)) break;
        if (handlePubSub(this, envelope)) break;
        handleMessage(this, envelope);
        break;
      }

      case P.PB:
        this.emit('publish', {
          from:  envelope._from,
          topic: envelope._topic ?? envelope.payload?.topic,
          parts: envelope.payload?.parts ?? [],
        });
        break;

      default:
        this.emit('envelope', envelope);
    }
  }
}

// ── Transport factory helper ──────────────────────────────────────────────────

async function _buildTransportFromConnections(connections, identity) {
  const transports = [];

  if (connections.relay?.url) {
    const { RelayTransport } = await import('./transport/RelayTransport.js');
    transports.push(new RelayTransport({ relayUrl: connections.relay.url, identity }));
  }
  if (connections.nkn != null) {
    const { NknTransport } = await import('./transport/NknTransport.js');
    transports.push(new NknTransport({ identity }));
  }
  if (connections.mqtt?.broker) {
    const { MqttTransport } = await import('./transport/MqttTransport.js');
    transports.push(new MqttTransport({ brokerUrl: connections.mqtt.broker, identity }));
  }

  if (transports.length === 0) throw new Error('No transport could be built from connections config');

  // Return first as primary; caller can addTransport() for the rest
  return transports[0];
}

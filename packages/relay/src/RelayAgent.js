/**
 * RelayAgent — an Agent that also operates a WebSocket relay server.
 *
 * Built-in skills:
 *   relay-info       — returns relay capabilities and connected peer count
 *   relay-peer-list  — returns connected peer addresses
 *
 * Usage:
 *   const relay = await RelayAgent.create({ port: 8080 });
 *   await relay.start();
 *   console.log(`Relay listening on ws://localhost:${relay.port}`);
 */
import { Agent, AgentIdentity, VaultMemory, VaultNodeFs,
         InternalBus, InternalTransport,
         DataPart, Parts } from '@canopy/core';
import { WsServerTransport } from './WsServerTransport.js';

export class RelayAgent extends Agent {
  #wsTransport;

  /**
   * Low-level constructor — prefer RelayAgent.create() for async identity generation.
   *
   * @param {object} opts
   * @param {import('@canopy/core').AgentIdentity} opts.identity
   * @param {WsServerTransport} opts.wsTransport
   * @param {string} [opts.label]
   * @param {object} [opts.policy]
   */
  constructor({ identity, wsTransport, label = 'relay', policy = {} }) {
    super({ identity, transport: wsTransport, label });
    this.#wsTransport = wsTransport;
    this._relayPolicy = policy;
  }

  /** The underlying WsServerTransport instance. */
  get wsTransport() { return this.#wsTransport; }

  /** Bound WebSocket port (available after start()). */
  get port() { return this.#wsTransport.port; }

  // ── Factory ───────────────────────────────────────────────────────────────

  /**
   * Create a RelayAgent, generating a fresh identity if none is provided.
   *
   * @param {object} opts
   * @param {number} [opts.port=0]                — WebSocket server port (0 = OS-assigned)
   * @param {string} [opts.label='relay']
   * @param {object} [opts.policy]                — { mode: 'accept_all'|'group_only'|'whitelist' }
   * @param {import('@canopy/core').AgentIdentity} [opts.identity]
   * @param {import('@canopy/core').Vault}          [opts.vault]
   * @param {number} [opts.offlineQueueTtl]
   * @returns {Promise<RelayAgent>}
   */
  static async create({
    port = 0,
    label = 'relay',
    policy = { mode: 'accept_all' },
    identity = null,
    vault = null,
    offlineQueueTtl,
  } = {}) {
    const v  = vault ?? new VaultMemory();
    const id = identity ?? await AgentIdentity.generate(v);

    const wsTransport = new WsServerTransport({
      port,
      address: id.pubKey,
      ...(offlineQueueTtl != null ? { offlineQueueTtl } : {}),
    });

    return new RelayAgent({ identity: id, wsTransport, label, policy });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start() {
    await this.#wsTransport.start();
    await super.start();
    this.#registerBuiltins();
  }

  async stop() {
    await super.stop();
    await this.#wsTransport.stop();
  }

  // ── Built-in skills ───────────────────────────────────────────────────────

  #registerBuiltins() {
    this.register('relay-info', async () => {
      return [DataPart({
        connectedPeers: this.#wsTransport.getConnectedPeers().length,
        mode:           this._relayPolicy.mode ?? 'accept_all',
        offlineQueue:   true,
      })];
    }, { visibility: 'public', description: 'Relay capabilities and peer count' });

    this.register('relay-peer-list', async () => {
      if (this._relayPolicy.mode === 'whitelist') {
        return [DataPart({ peers: [] })];
      }
      return [DataPart({ peers: this.#wsTransport.getConnectedPeers() })];
    }, { visibility: 'public', description: 'List of currently connected peer addresses' });
  }
}

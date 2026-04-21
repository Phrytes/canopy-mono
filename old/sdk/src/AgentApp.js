/**
 * AgentApp — the main entry point for app developers.
 *
 * Responsibilities:
 *   1. Load the user's .agentnet.yaml definition file
 *   2. Instantiate app-side agents (defined by the developer)
 *   3. Wire capabilities from the global registry (capability() decorator)
 *   4. Create stub connections to network agents from the definition file
 *   5. Expose invoke() so app agents can call remote agents by logical id
 *
 * Usage:
 *
 *   const app = new AgentApp('./agents.agentnet.yaml', { masterKey: '...' });
 *
 *   // Define an app agent
 *   const processor = app.defineAgent({ id: 'processor', name: 'Processor' });
 *
 *   // Register capabilities (or use the capability() decorator)
 *   processor.register('summarise', async ({ text }) => ({ summary: text.slice(0, 80) }));
 *
 *   await app.start();
 *
 *   // Invoke a network agent by its definition-file id
 *   const result = await app.invoke('processor', 'db-guardian', 'query', { sql: '...' });
 */

import { Agent }          from './Agent.js';
import { NknTransport }   from './transport/NknTransport.js';
import { DefinitionFile } from './definition/DefinitionFile.js';
import { getRegistry }    from './capability.js';

// Built-in transport registry — developers can extend this
const TRANSPORTS = {
  nkn: (opts) => new NknTransport(opts),
};

export class AgentApp {
  constructor(definitionFilePath, { masterKey, transportOptions = {} } = {}) {
    this._defPath          = definitionFilePath;
    this._masterKey        = masterKey;
    this._transportOptions = transportOptions;

    this._appAgents     = new Map();   // id -> Agent (app-side)
    this._remoteStubs   = new Map();   // id -> { address, transport, groups }
    this._def           = null;
    this._started       = false;
  }

  // ── Transport extensibility ───────────────────────────────────────────────

  /**
   * Register a custom transport type.
   *
   *   app.registerTransport('bluetooth', (opts) => new MyBluetoothTransport(opts));
   */
  static registerTransport(type, factory) {
    TRANSPORTS[type] = factory;
  }

  // ── Agent definition ──────────────────────────────────────────────────────

  defineAgent({ id, name, description, transportType = 'nkn', transportOptions = {} } = {}) {
    const factory   = TRANSPORTS[transportType];
    if (!factory) throw new Error(`Unknown transport type: "${transportType}"`);

    const transport = factory({ ...this._transportOptions[transportType], ...transportOptions });
    const agent     = new Agent({ id, name, description, transport });

    this._appAgents.set(id, agent);
    return agent;
  }

  // ── Start ─────────────────────────────────────────────────────────────────

  async start() {
    if (this._started) return this;

    // Load definition file if provided
    if (this._defPath && this._masterKey) {
      this._def = new DefinitionFile(this._defPath, this._masterKey);
      this._def.load();
      this._loadRemoteStubs();
    }

    // Wire capabilities from the global decorator registry
    this._wireDecoratorRegistry();

    // Start all app agents
    await Promise.all(
      Array.from(this._appAgents.values()).map((a) => a.start())
    );

    this._started = true;
    console.log('[AgentApp] started');
    return this;
  }

  async stop() {
    await Promise.all(
      Array.from(this._appAgents.values()).map((a) => a.stop())
    );
    this._started = false;
  }

  // ── Invoke ────────────────────────────────────────────────────────────────

  /**
   * Invoke a skill on a network agent.
   *
   *   await app.invoke('my-app-agent', 'db-guardian', 'query', { sql: '...' });
   *
   * @param {string} fromAgentId  - id of the app-side agent that sends the task
   * @param {string} toAgentId    - id of the network agent (from definition file)
   * @param {string} skill        - skill id
   * @param {object} params       - task params
   */
  async invoke(fromAgentId, toAgentId, skill, params = {}) {
    const sender = this._appAgents.get(fromAgentId);
    if (!sender) throw new Error(`App agent "${fromAgentId}" not found`);

    const stub = this._remoteStubs.get(toAgentId);
    if (!stub) throw new Error(`Network agent "${toAgentId}" not found in definition file`);

    this._assertConnection(fromAgentId, toAgentId);

    return sender.invoke(stub.address, skill, params);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _loadRemoteStubs() {
    for (const agent of this._def.agents) {
      this._remoteStubs.set(agent.id, {
        id:          agent.id,
        address:     agent.address,
        transport:   agent.transport,
        groups:      agent.groups ?? [],
        credentials: agent.credentials,   // already decrypted by DefinitionFile
      });
    }
  }

  _wireDecoratorRegistry() {
    const registry = getRegistry();
    for (const [agentId, skills] of registry.entries()) {
      const agent = this._appAgents.get(agentId);
      if (!agent) {
        console.warn(`[AgentApp] capability() references unknown agent "${agentId}" — skipping`);
        continue;
      }
      for (const [skillId, { handler, meta }] of skills.entries()) {
        agent.register(skillId, handler, meta);
      }
    }
  }

  _assertConnection(fromAgentId, toAgentId) {
    const allowed = this._def?.connectionsFrom(fromAgentId) ?? [];
    const ok = allowed.length === 0   // no definition file loaded = open
      || allowed.some((c) => c.to === toAgentId);

    if (!ok) {
      throw new Error(
        `Agent "${fromAgentId}" is not allowed to reach "${toAgentId}" per the definition file`
      );
    }
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  getAppAgent(id) { return this._appAgents.get(id) ?? null; }

  getRemoteStub(id) { return this._remoteStubs.get(id) ?? null; }

  get definition() { return this._def; }
}

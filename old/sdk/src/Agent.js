import { Emitter }        from './Emitter.js';
import { Task, TaskState } from './protocol/Task.js';
import { PatternHandler }  from './patterns/PatternHandler.js';
import { GroupManager }    from './groups/GroupManager.js';

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * Agent — the central object for the decentralised agent SDK.
 *
 * An Agent can:
 *  - Connect over one or more transports (NKN, MQTT, BLE, …)
 *  - Register capabilities (skills) that remote peers can invoke
 *  - Invoke capabilities on remote agents (request / submitTask)
 *  - Participate in groups with cryptographic proof
 *  - Export its definition for peer discovery (agent card)
 *
 * Emits:
 *   'start'                                      — after all transports connect
 *   'stop'                                       — after all transports disconnect
 *   'peer'           { address, card }           — agent card received from peer
 *   'message'        { from, payload, envelope } — unhandled OW/AS message
 *   'request'        { from, payload, envelope, reply } — unhandled RQ message
 *   'publish'        { topic, payload, from }    — PubSub message
 *   'task:approve'   { from, task, approve }     — manual policy prompt (approve(bool))
 *   'transport:connect'    { transport, address }
 *   'transport:disconnect' { transport }
 *   'transport:error'      { transport, error }
 *   'transport:warn'       { transport, message }
 *
 * Usage:
 *   const agent = new Agent({ name: 'My Bot', transports: [nknTransport, mqttTransport] });
 *   agent.capability('echo', async ({ message }) => ({ echo: message }));
 *   await agent.start();
 *   const result = await agent.request(peerAddress, 'echo', { message: 'hi' });
 */
export class Agent extends Emitter {
  #id;
  #name;
  #description;
  #role;
  #policy;

  #transports = [];          // Transport[]
  #handlers   = [];          // PatternHandler[] — parallel to #transports

  #capabilities = new Map(); // name -> { handler, meta }
  #peers        = new Map(); // address -> { transport, handler, card }
  #pending      = new Map(); // taskId  -> { resolve, reject, timer }
  #groups;

  #started = false;

  /**
   * @param {object}   options
   * @param {string}   [options.name]
   * @param {string}   [options.id]          — stable agent ID, generated if omitted
   * @param {string}   [options.description]
   * @param {string}   [options.role]        — role label (informational)
   * @param {Array}    [options.transports]  — Transport instances
   * @param {object}   [options.policy]      — { mode: 'accept_all'|'group_only'|'manual'|'skill_whitelist', group?, allowedSkills? }
   * @param {Array}    [options.groups]      — [{ id, proof, adminSecret }]
   */
  constructor({
    name        = 'Agent',
    id,
    description = '',
    role        = null,
    transports  = [],
    policy      = { mode: 'accept_all' },
    groups      = [],
  } = {}) {
    super();
    this.#id          = id ?? uid();
    this.#name        = name;
    this.#description = description;
    this.#role        = role;
    this.#policy      = policy;
    this.#groups      = new GroupManager();

    for (const t of transports) this.addTransport(t);
    for (const g of groups)     this.#groups.join(g.id, g.proof, g.adminSecret);
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  get id()          { return this.#id; }
  get name()        { return this.#name; }
  get description() { return this.#description; }

  /** Primary address (first connected transport). */
  get address() {
    return this.#transports.find(t => t.address)?.address ?? null;
  }

  /** Map of transport-name → address for all connected transports. */
  get addresses() {
    const out = {};
    for (const t of this.#transports) {
      if (t.address) {
        out[t.constructor.name.replace('Transport', '').toLowerCase()] = t.address;
      }
    }
    return out;
  }

  // ── Transport management ──────────────────────────────────────────────────

  addTransport(transport) {
    const handler = new PatternHandler(transport);
    this.#transports.push(transport);
    this.#handlers.push(handler);

    handler.on('message', ({ from, payload, envelope }) => {
      this.#trackPeer(from, transport, handler);
      this.#dispatchMessage(from, payload, envelope, handler);
    });

    handler.on('request', ({ from, payload, envelope, reply }) => {
      this.#trackPeer(from, transport, handler);
      this.#dispatchRequest(from, payload, envelope, reply, handler);
    });

    handler.on('publish', (ev) => this.emit('publish', ev));

    transport.on('connect',    (ev)  => this.emit('transport:connect',    { transport, ...ev }));
    transport.on('disconnect', ()    => this.emit('transport:disconnect', { transport }));
    transport.on('error',      (err) => this.emit('transport:error',      { transport, error: err }));
    transport.on('warn',       (msg) => this.emit('transport:warn',       { transport, message: msg }));

    return this;
  }

  // ── Capabilities ──────────────────────────────────────────────────────────

  /**
   * Register a capability (skill).
   * Can be called before or after start() — a post-start call broadcasts the
   * updated agent card to all known peers automatically.
   *
   * @param {string}   name     — skill identifier
   * @param {Function} handler  — async (params) => result
   * @param {object}   [meta]   — { description?, params? }
   */
  capability(name, handler, meta = {}) {
    this.#capabilities.set(name, { handler, meta: { name, ...meta } });
    if (this.#started) this.#broadcastCard().catch(() => {});
    return this;
  }

  removeCapability(name) {
    this.#capabilities.delete(name);
    if (this.#started) this.#broadcastCard().catch(() => {});
    return this;
  }

  // ── Groups ────────────────────────────────────────────────────────────────

  joinGroup(groupId, proof, adminSecret) {
    this.#groups.join(groupId, proof, adminSecret);
    return this;
  }

  leaveGroup(groupId) {
    this.#groups.leave(groupId);
    return this;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start() {
    if (this.#started) return this;

    // Kick off all transports in parallel; resolve as soon as the FIRST one
    // connects. Slower transports keep going in the background and emit
    // 'transport:connect' when ready. Only throws if ALL transports fail.
    await new Promise((resolve, reject) => {
      let resolved  = false;
      let failCount = 0;
      const total   = this.#transports.length;

      if (total === 0) { resolve(); return; }

      for (const t of this.#transports) {
        t.connect()
          .then(() => {
            if (!resolved) { resolved = true; resolve(); }
          })
          .catch(err => {
            const e = err instanceof Error ? err : new Error(String(err));
            this.emit('transport:error', { transport: t, error: e });
            failCount++;
            if (failCount === total && !resolved) {
              resolved = true;
              reject(new Error('All transports failed to connect'));
            }
          });
      }
    });

    this.#started = true;
    this.emit('start');
    return this;
  }

  async stop() {
    await Promise.all(this.#transports.map(t => t.disconnect()));
    this.#started = false;
    this.emit('stop');
  }

  // ── Agent Card ────────────────────────────────────────────────────────────

  get agentCard() {
    return {
      id:          this.#id,
      name:        this.#name,
      description: this.#description,
      role:        this.#role,
      version:     '1.0',
      addresses:   this.addresses,
      groups:      this.#groups.groups(),
      capabilities: Array.from(this.#capabilities.values()).map(({ meta }) => ({
        name:        meta.name,
        description: meta.description ?? '',
        params:      meta.params ?? {},
      })),
    };
  }

  // ── Discovery ─────────────────────────────────────────────────────────────

  /**
   * Initiate a handshake with a peer — request their agent card.
   * @param {string} peerAddress
   */
  async connect(peerAddress) {
    const h = this.#bestHandler(peerAddress);
    if (!h) throw new Error('No transport available');
    await h.sendOneWay(peerAddress, { type: 'agent_card_request' });
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  /**
   * Ping a peer — measures round-trip time.
   * @returns {Promise<number>} RTT in milliseconds
   */
  async ping(to, { timeout = 5_000 } = {}) {
    const h = this.#bestHandler(to);
    if (!h) throw new Error('No transport available');
    const t0 = Date.now();
    await h.sendAck(to, { type: 'ping' }, timeout);
    return Date.now() - t0;
  }

  /**
   * Send a one-way message — no reply expected.
   */
  async send(to, payload) {
    const h = this.#bestHandler(to);
    if (!h) throw new Error('No transport available');
    await h.sendOneWay(to, payload);
  }

  /**
   * Request–Response: invoke a skill on a remote agent and wait for a single reply.
   * Use for short, synchronous-style interactions.
   *
   * @returns {Promise<*>} the result returned by the remote skill
   */
  async request(to, skill, params = {}, { timeout = 30_000 } = {}) {
    const h = this.#bestHandler(to);
    if (!h) throw new Error('No transport available');
    const reply = await h.request(to, { type: 'skill_request', skill, params }, timeout);
    if (reply?.error) throw new Error(reply.error);
    return reply?.result ?? reply;
  }

  /**
   * Submit a task to a remote agent and track it through the state machine:
   *   submitted → working → completed | failed | rejected
   *
   * Use for long-running operations where intermediate progress matters.
   *
   * @returns {Promise<*>} the task result when completed
   */
  submitTask(to, skill, params = {}, { timeout = 60_000 } = {}) {
    const task = new Task({ skill, params });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(task.id);
        reject(new Error(`Task "${task.id}" timed out`));
      }, timeout);

      this.#pending.set(task.id, { resolve, reject, timer });

      const h = this.#bestHandler(to);
      if (!h) {
        clearTimeout(timer);
        this.#pending.delete(task.id);
        reject(new Error('No transport available'));
        return;
      }

      h.sendOneWay(to, { type: 'task', task: task.toJSON() }).catch((err) => {
        clearTimeout(timer);
        this.#pending.delete(task.id);
        reject(err);
      });
    });
  }

  // ── Export / Import ───────────────────────────────────────────────────────

  /**
   * Export the agent definition as a plain object (serialisable to JSON/YAML).
   *
   * @param {{ includeSeed?: boolean }} options
   *   includeSeed: if true, transport seeds are included. Developer opts in explicitly.
   */
  export({ includeSeed = false } = {}) {
    const connections = {};
    for (const t of this.#transports) {
      const key = t.constructor.name.replace('Transport', '').toLowerCase();
      connections[key] = { address: t.address };
      if (includeSeed && typeof t.seed === 'string') {
        connections[key].seed = t.seed;
      }
    }
    return {
      version: 1,
      agent: {
        id:          this.#id,
        name:        this.#name,
        description: this.#description,
        role:        this.#role,
      },
      capabilities: Array.from(this.#capabilities.values()).map(({ meta }) => meta),
      connections,
      groups: this.#groups.groups().map(g => {
        const m = this.#groups.getMembership(g);
        return { id: g, proof: m?.proof };
      }),
      policy: this.#policy,
    };
  }

  /**
   * Reconstruct an Agent from an exported definition.
   * Transports must be provided separately — the import restores identity and
   * configuration, not transport instances.
   *
   * @param {object}  json
   * @param {object}  [options]
   * @param {Array}   [options.transports]
   */
  static from(json, { transports = [] } = {}) {
    const a = json.agent ?? json;
    return new Agent({
      id:          a.id,
      name:        a.name ?? 'Unnamed',
      description: a.description,
      role:        a.role,
      policy:      json.policy,
      transports,
      groups:      (json.groups ?? []).map(g => ({ id: g.id, proof: g.proof, adminSecret: null })),
    });
  }

  // ── Inbound message handling ──────────────────────────────────────────────

  #dispatchMessage(from, payload, envelope, handler) {
    if (!payload || typeof payload !== 'object') {
      this.emit('message', { from, payload, envelope });
      return;
    }

    switch (payload.type) {
      case 'agent_card_request':
        handler.sendOneWay(from, { type: 'agent_card_response', card: this.agentCard })
          .catch(() => {});
        break;

      case 'agent_card_response':
        if (payload.card) {
          const existing = this.#peers.get(from);
          if (existing) existing.card = payload.card;
          else this.#peers.set(from, { transport: handler.transport, handler, card: payload.card });
          this.emit('peer', { address: from, card: payload.card });
        }
        break;

      case 'task':
        this.#handleIncomingTask(from, payload.task, handler).catch(() => {});
        break;

      case 'task_update':
        this.#handleTaskUpdate(payload.task);
        break;

      case 'ping':
        break;   // AckSend auto-acknowledges; nothing more needed here

      default:
        this.emit('message', { from, payload, envelope });
    }
  }

  #dispatchRequest(from, payload, envelope, reply, handler) {
    if (!payload || typeof payload !== 'object') {
      this.emit('request', { from, payload, envelope, reply });
      return;
    }

    if (payload.type === 'skill_request') {
      const entry = this.#capabilities.get(payload.skill);
      if (!entry) {
        reply({ error: `Unknown skill: "${payload.skill}"` });
        return;
      }
      Promise.resolve(entry.handler(payload.params ?? {}))
        .then((result) => reply({ result }))
        .catch((err)   => reply({ error: err.message }));
    } else {
      this.emit('request', { from, payload, envelope, reply });
    }
  }

  async #handleIncomingTask(from, taskData, handler) {
    const task  = Task.fromJSON(taskData);
    const entry = this.#capabilities.get(task.skill);

    const update = (state, extra = {}) =>
      handler.sendOneWay(from, {
        type: 'task_update',
        task: { ...task.toJSON(), state, ...extra },
      }).catch(() => {});

    if (!entry) {
      return update(TaskState.FAILED, { error: `Unknown skill: "${task.skill}"` });
    }

    const allowed = await this.#checkPolicy(from, task);
    if (!allowed) {
      return update(TaskState.REJECTED, { error: 'Rejected by agent policy' });
    }

    await update(TaskState.WORKING);

    try {
      const result = await entry.handler(task.params);
      await update(TaskState.COMPLETED, { result });
    } catch (err) {
      await update(TaskState.FAILED, { error: err.message });
    }
  }

  #handleTaskUpdate(taskData) {
    const p = this.#pending.get(taskData.id);
    if (!p) return;

    const { COMPLETED, FAILED, REJECTED } = TaskState;
    if (taskData.state === COMPLETED) {
      clearTimeout(p.timer); this.#pending.delete(taskData.id);
      p.resolve(taskData.result);
    } else if (taskData.state === FAILED || taskData.state === REJECTED) {
      clearTimeout(p.timer); this.#pending.delete(taskData.id);
      p.reject(new Error(taskData.error ?? `Task ${taskData.state}`));
    }
    // WORKING: timer keeps running; the app can extend it if needed
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Pick the best PatternHandler for a peer. */
  #bestHandler(peerAddress) {
    if (!this.#handlers.length) return null;
    // If we already know this peer, use the transport we established with them
    const known = this.#peers.get(peerAddress);
    if (known?.handler) return known.handler;
    // Otherwise, first transport that is connected
    return this.#handlers.find(h => h.transport.address) ?? this.#handlers[0];
  }

  #trackPeer(address, transport, handler) {
    if (!this.#peers.has(address)) {
      this.#peers.set(address, { transport, handler, card: null });
    }
  }

  async #checkPolicy(from, task) {
    const { mode, group, allowedSkills } = this.#policy ?? {};
    if (!mode || mode === 'accept_all') return true;
    if (mode === 'skill_whitelist') return (allowedSkills ?? []).includes(task.skill);
    if (mode === 'group_only') {
      const peer = this.#peers.get(from);
      return peer?.card?.groups?.includes(group) ?? false;
    }
    if (mode === 'manual') {
      return new Promise(resolve =>
        this.emit('task:approve', { from, task, approve: resolve })
      );
    }
    return true;
  }

  async #broadcastCard() {
    const card = this.agentCard;
    for (const [addr, { handler }] of this.#peers) {
      handler.sendOneWay(addr, { type: 'agent_card_response', card }).catch(() => {});
    }
  }
}

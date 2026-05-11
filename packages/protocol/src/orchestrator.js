/**
 * createProtocolOrchestrator — runtime that drives protocol instances.
 *
 * Each instance is a single state-machine invocation. State persists
 * as a protocol-instance resource on the pseudo-pod under
 * `pseudo-pod://<deviceId>/protocols/<protocolId>/<instanceId>`.
 *
 * V0 surface:
 *   - `registerProtocol(def)`     — load a `defineProtocol` result.
 *   - `start(protocolId, args)`   — create a new instance.
 *   - `step(instanceId, event, payload?)` — apply a transition.
 *   - `read(instanceId)`          — read current state + context.
 *   - `subscribe(instanceId, cb)` — fires on state changes.
 *
 * Standardisation Phase 52.13.3.
 *
 * @typedef {import('./defineProtocol.js').ProtocolDef} ProtocolDef
 *
 * @typedef {object} ProtocolInstance
 * @property {string}  protocolId
 * @property {string}  instanceId
 * @property {string}  state
 * @property {object}  context
 * @property {string}  startedAt           — ISO
 * @property {string}  updatedAt           — ISO
 * @property {Array<{at: string, event: string, from: string, to: string}>} history
 */

import { findTransition } from './defineProtocol.js';

const RESOURCE_PREFIX = 'protocols/';

/**
 * @param {object} opts
 * @param {object} opts.pseudoPod
 * @param {string} opts.deviceId
 * @param {() => string} [opts.now]
 * @param {() => string} [opts.makeId]
 */
export function createProtocolOrchestrator({
  pseudoPod,
  deviceId,
  now    = () => new Date().toISOString(),
  makeId = () => Math.random().toString(36).slice(2, 10),
} = {}) {
  if (!pseudoPod || typeof pseudoPod.read !== 'function' || typeof pseudoPod.write !== 'function') {
    throw Object.assign(
      new Error('createProtocolOrchestrator: pseudoPod is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    throw Object.assign(
      new Error('createProtocolOrchestrator: deviceId is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  /** @type {Map<string, ProtocolDef>} */
  const protocols = new Map();
  /** @type {Map<string, Set<(inst: ProtocolInstance, event?: object) => void>>} */
  const subscribers = new Map();

  function _uri(protocolId, instanceId) {
    return `pseudo-pod://${deviceId}/${RESOURCE_PREFIX}${protocolId}/${instanceId}`;
  }

  function registerProtocol(def) {
    if (!def || typeof def.id !== 'string') {
      throw Object.assign(
        new Error('registerProtocol: protocol def required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    protocols.set(def.id, def);
  }

  function _fanOut(instanceId, event) {
    const subs = subscribers.get(instanceId);
    if (!subs) return;
    for (const cb of subs) {
      try { cb(event); } catch { /* swallow */ }
    }
  }

  async function start(protocolId, initialContext = {}) {
    const def = protocols.get(protocolId);
    if (!def) {
      throw Object.assign(
        new Error(`start: unknown protocol "${protocolId}"`),
        { code: 'UNKNOWN_PROTOCOL' },
      );
    }
    if (typeof def.validators?.initial === 'function' && !def.validators.initial(initialContext)) {
      throw Object.assign(
        new Error('start: initial context failed validation'),
        { code: 'INVALID_INITIAL_CONTEXT' },
      );
    }
    const instanceId = makeId();
    const ts = now();
    /** @type {ProtocolInstance} */
    const instance = {
      protocolId,
      instanceId,
      state:     def.initial,
      context:   { ...initialContext },
      startedAt: ts,
      updatedAt: ts,
      history:   [],
    };
    await pseudoPod.write(_uri(protocolId, instanceId), instance);
    _fanOut(instanceId, { op: 'start', instance });
    return instance;
  }

  async function read(instanceId, protocolId) {
    if (typeof instanceId !== 'string' || instanceId.length === 0) return null;
    if (typeof protocolId === 'string' && protocolId.length > 0) {
      const rec = await pseudoPod.read(_uri(protocolId, instanceId));
      return rec?.bytes ?? null;
    }
    // Caller didn't supply protocolId — scan all registered protocols.
    for (const id of protocols.keys()) {
      const rec = await pseudoPod.read(_uri(id, instanceId));
      if (rec?.bytes) return rec.bytes;
    }
    return null;
  }

  async function step(instanceId, event, payload) {
    if (typeof instanceId !== 'string' || instanceId.length === 0) {
      throw Object.assign(
        new Error('step: instanceId required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof event !== 'string' || event.length === 0) {
      throw Object.assign(
        new Error('step: event required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    const instance = await read(instanceId);
    if (!instance) {
      throw Object.assign(
        new Error(`step: instance "${instanceId}" not found`),
        { code: 'INSTANCE_NOT_FOUND' },
      );
    }
    const def = protocols.get(instance.protocolId);
    if (!def) {
      throw Object.assign(
        new Error(`step: protocol "${instance.protocolId}" not registered`),
        { code: 'UNKNOWN_PROTOCOL' },
      );
    }
    const transition = findTransition(def, instance.state, event);
    if (!transition) {
      throw Object.assign(
        new Error(`step: no transition from "${instance.state}" on event "${event}"`),
        { code: 'NO_TRANSITION' },
      );
    }
    if (typeof transition.guard === 'function' && !transition.guard(instance.context, payload)) {
      throw Object.assign(
        new Error(`step: guard rejected transition ${instance.state} → ${transition.to}`),
        { code: 'GUARD_REJECTED' },
      );
    }
    const nextContext = typeof transition.reducer === 'function'
      ? await transition.reducer(instance.context, payload)
      : instance.context;
    const ts = now();
    const next = {
      ...instance,
      state:     transition.to,
      context:   { ...nextContext },
      updatedAt: ts,
      history:   [
        ...instance.history,
        { at: ts, event, from: instance.state, to: transition.to },
      ],
    };
    await pseudoPod.write(_uri(instance.protocolId, instanceId), next);
    _fanOut(instanceId, { op: 'step', instance: next, event, payload, from: instance.state });
    return next;
  }

  function subscribe(instanceId, cb) {
    if (typeof instanceId !== 'string' || instanceId.length === 0) {
      throw Object.assign(
        new Error('subscribe: instanceId required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof cb !== 'function') {
      throw Object.assign(
        new Error('subscribe: callback must be a function'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    let subs = subscribers.get(instanceId);
    if (!subs) { subs = new Set(); subscribers.set(instanceId, subs); }
    subs.add(cb);
    return () => {
      subs.delete(cb);
      if (subs.size === 0) subscribers.delete(instanceId);
    };
  }

  return {
    registerProtocol,
    start,
    read,
    step,
    subscribe,

    // Introspection
    get _protocols() { return new Map(protocols); },
    get _resourcePrefix() { return RESOURCE_PREFIX; },
  };
}

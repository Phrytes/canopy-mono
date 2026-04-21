/**
 * taskExchange.js — Task lifecycle: outbound callSkill + inbound handleTaskRequest.
 *
 * Outbound (callSkill):
 *   1. Create Task, register in StateManager
 *   2. Look up CapabilityToken for (peerId, skillId) if agent.tokenRegistry present
 *   3. Send RQ with { type:'task', taskId, skillId, parts, ttl?, _token? }
 *   4. RS arrives → Task._transition('completed'|'failed')
 *   5. IR arrives (OW) → Task._transition('input-required')
 *   6. ST/SE arrive (OW) → Task._pushChunk() / Task._closeStream()
 *   7. task-expired arrives (OW) → Task._transition('expired')
 *   8. Return Task immediately (caller awaits task.done() or task.stream())
 *
 * Inbound (handleTaskRequest):
 *   1. Extract { type, taskId, skillId, parts, ttl?, _token? } from RQ payload
 *   2. PolicyEngine.checkInbound (if available), passing token + agentPubKey
 *   3. Create AbortController; setup TTL expiry timer if effectiveTtl is finite
 *   4. Dispatch to skill handler with AbortSignal in ctx
 *   5. Regular handler → RS
 *   6. Generator handler → ST chunks + SE/RS; respects signal.aborted
 *   7. Task.InputRequired thrown → IR OW + wait for RI + resume (multi-round loop)
 *   8. TTL expiry: abort handler + reject any pending IR wait + send task-expired OW
 *
 * Envelope payload formats:
 *   RQ  { type:'task',          taskId, skillId, parts, ttl?, _token? }
 *   RS  { type:'task-result',   taskId, status:'completed'|'failed', parts, error? }
 *   OW  { type:'stream-chunk',  taskId, parts }       ← ST
 *   OW  { type:'stream-end',    taskId, parts? }      ← SE
 *   OW  { type:'input-required',taskId, parts }       ← IR
 *   OW  { type:'task-input',    taskId, parts }       ← RI
 *   OW  { type:'cancel',        taskId }              ← CX
 *   OW  { type:'task-expired',  taskId }              ← EX (receiver → caller)
 */
import { Task }  from './Task.js';
import { Parts } from '../Parts.js';
import { genId } from '../Envelope.js';

/** @param {object} x */
const isAsyncGen = x => x && typeof x[Symbol.asyncIterator] === 'function';

/**
 * Compute effective TTL: min of what the caller requested and the agent's
 * configured ceiling.  Returns null when no finite limit applies.
 */
function _effectiveTtl(requested, ceiling) {
  const r   = (requested != null && isFinite(requested)) ? requested : Infinity;
  const c   = (ceiling   != null && isFinite(ceiling))   ? ceiling   : Infinity;
  const eff = Math.min(r, c);
  return isFinite(eff) ? eff : null;
}

// ── Outbound ──────────────────────────────────────────────────────────────────

/**
 * Call a skill on a remote peer. Returns a Task immediately.
 * Await task.done() for the final result, or iterate task.stream() for chunks.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string}    peerId
 * @param {string}    skillId
 * @param {import('../Parts.js').Part[]} parts
 * @param {object}    [opts]
 * @param {number}    [opts.timeout=30000]
 * @param {number}    [opts.ttl]   — suggested task TTL ms (receiver may cap)
 * @returns {Task}
 */
export function callSkill(agent, peerId, skillId, parts, opts = {}) {
  const taskId = genId();
  const task   = new Task({ taskId, skillId, agent, peerId, state: 'submitted' });
  agent.stateManager.createTask(taskId, task);
  task._transition('working');

  const timeout = opts.timeout ?? 30_000;

  (async () => {
    // Attach a capability token if the agent holds one for this peer + skill.
    let tokenJson = null;
    if (agent.tokenRegistry) {
      const token = await agent.tokenRegistry.get(peerId, skillId);
      if (token) tokenJson = token.toJSON();
    }

    try {
      const t  = opts._overrideTransport ?? await agent.transportFor(peerId);
      console.log(`[callSkill] ${skillId} → ${peerId.slice(0,12)} via ${t?.constructor?.name}`);
      const rs = await t.request(
        peerId,
        {
          type: 'task', taskId, skillId, parts,
          ttl:     opts.ttl    ?? null,
          _token:  tokenJson,
          // Optional unverified origin header — set by relay-forward so the
          // receiver can attribute a relayed message to the original caller.
          _origin: opts.origin ?? null,
        },
        timeout,
      );
      const { status, parts: rParts = [], error } = rs.payload ?? {};
      if (status === 'completed') {
        task._transition('completed', { parts: rParts });
      } else {
        task._transition('failed', { error: error ?? 'Remote skill failed' });
      }
    } catch (err) {
      // Suppress security errors — expected when gossip contacts unhello'd peers.
      if (!err.message?.includes('pubKey')) {
        console.warn(`[callSkill] ${skillId} → ${peerId.slice(0,12)} FAILED:`, err.message);
      }
      task._transition('failed', { error: err.message });
    }
  })();

  return task;
}

// ── Inbound ───────────────────────────────────────────────────────────────────

/**
 * Handle an inbound RQ that carries a task request.
 * Returns false if the envelope is not a task RQ.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object} envelope  — decrypted RQ envelope
 */
export async function handleTaskRequest(agent, envelope) {
  const payload = envelope.payload ?? {};
  if (payload.type !== 'task') return false;

  const {
    taskId,
    skillId,
    parts        = [],
    ttl: reqTtl  = null,
    _token       = null,
    _origin      = null,   // unverified; set by relay-forward to preserve original caller
  } = payload;

  // Reply on the same transport the request arrived on.
  // envelope._transport is tagged by Transport._receive(); fall back to routing
  // only if the tag is missing (e.g. unit tests that bypass Transport._receive).
  const t = envelope._transport ?? await agent.transportFor(envelope._from);
  console.log(`[handleTaskRequest] ${skillId} from ${envelope._from?.slice(0,12)} via ${t?.constructor?.name}`);

  // ── Policy check ───────────────────────────────────────────────────────────
  if (agent.policyEngine) {
    try {
      await agent.policyEngine.checkInbound({
        peerPubKey: envelope._from,
        skillId,
        action:     'call',
        token:      _token,
        agentPubKey: agent.pubKey,
      });
    } catch (err) {
      await t.respond(envelope._from, envelope._id, {
        type:   'task-result',
        taskId,
        status: 'failed',
        error:  err.message,
        parts:  [],
      }).catch(() => {});
      return true;
    }
  }

  // ── Skill lookup ───────────────────────────────────────────────────────────
  const skill = agent.skills.get(skillId);
  if (!skill || !skill.enabled) {
    await t.respond(envelope._from, envelope._id, {
      type:   'task-result',
      taskId,
      status: 'failed',
      error:  skill ? `Skill "${skillId}" is disabled` : `Unknown skill: "${skillId}"`,
      parts:  [],
    }).catch(() => {});
    return true;
  }

  // ── AbortController + TTL expiry ───────────────────────────────────────────
  const controller   = new AbortController();
  agent.stateManager.createTask(`abort:${taskId}`, { controller });

  const effectiveTtl = _effectiveTtl(reqTtl, agent.maxTaskTtl);
  let expiryTimer    = null;

  if (effectiveTtl !== null) {
    expiryTimer = setTimeout(async () => {
      controller.abort();
      const irEntry = agent.stateManager.getTask(`ir:${taskId}`);
      if (irEntry?.rejecter) irEntry.rejecter(new Error('Task expired'));
      agent.stateManager.deleteTask(`ir:${taskId}`);
      agent.stateManager.deleteTask(`abort:${taskId}`);
      await t.sendOneWay(envelope._from, {
        type: 'task-expired', taskId,
      }).catch(() => {});
    }, effectiveTtl);
  }

  /** Call once the handler finishes (any outcome) to release resources. */
  const cleanup = () => {
    clearTimeout(expiryTimer);
    agent.stateManager.deleteTask(`abort:${taskId}`);
  };

  // ── Run handler ────────────────────────────────────────────────────────────
  // If _origin is set we came through a relay. Expose both the immediate sender
  // (envelope._from = the relay) and the original caller (originFrom).
  // Handlers that care about identity (e.g. chat) should prefer originFrom.
  const ctx = {
    parts,
    from:       envelope._from,
    originFrom: _origin ?? envelope._from,
    relayedBy:  _origin ? envelope._from : null,
    taskId,
    envelope,
    agent,
    signal:     controller.signal,
  };

  let result;
  try {
    result = skill.handler(ctx);
  } catch (err) {
    cleanup();
    await _respondFailed(t, envelope, taskId, err, agent);
    return true;
  }

  // Async generator → streaming path.
  if (isAsyncGen(result)) {
    await _runStreamingHandler(t, agent, envelope, taskId, result, controller.signal, cleanup);
    return true;
  }

  // Regular async handler.
  let resolved;
  try {
    resolved = await result;
  } catch (err) {
    if (err?.name === 'InputRequired') {
      await _handleInputRequired(
        t, agent, envelope, taskId, skill, ctx, err, controller.signal, cleanup,
      );
      return true;
    }
    cleanup();
    await _respondFailed(t, envelope, taskId, err, agent);
    return true;
  }

  cleanup();
  const outParts = resolved == null    ? []
    : Array.isArray(resolved)          ? resolved
    : Parts.wrap(resolved);

  await t.respond(envelope._from, envelope._id, {
    type:   'task-result',
    taskId,
    status: 'completed',
    parts:  outParts,
  }).catch(err => agent.emit('error', err));

  return true;
}

// ── OW sub-type dispatcher ────────────────────────────────────────────────────

/**
 * Dispatch an inbound OW envelope that carries a task sub-type.
 * Returns true if handled.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object} envelope  — decrypted OW/AS envelope
 */
export function handleTaskOneWay(agent, envelope) {
  const { type, taskId, parts = [] } = envelope.payload ?? {};
  if (!taskId) return false;

  const task = agent.stateManager.getTask(taskId);

  switch (type) {
    case 'stream-chunk':
      if (task) task._pushChunk(parts);
      return true;

    case 'stream-end':
      if (task) {
        if (parts.length) task._pushChunk(parts);
        task._closeStream();
      }
      return true;

    case 'input-required':
      if (task) task._transition('input-required', { parts });
      return true;

    case 'task-expired':
      if (task) task._transition('expired');
      agent.stateManager.deleteTask(taskId);
      return true;

    case 'cancel':
      if (task) task._transition('cancelled');
      // Abort any running inbound handler.
      { const abortEntry = agent.stateManager.getTask(`abort:${taskId}`);
        if (abortEntry?.controller) abortEntry.controller.abort();
        agent.stateManager.deleteTask(`abort:${taskId}`);
      }
      // Unblock any pending input-required wait so the loop can exit cleanly.
      { const irEntry = agent.stateManager.getTask(`ir:${taskId}`);
        if (irEntry?.rejecter) irEntry.rejecter(new Error('Task cancelled'));
        agent.stateManager.deleteTask(`ir:${taskId}`);
      }
      agent.stateManager.deleteTask(taskId);
      return true;

    case 'task-input':
      // RI — resume inbound handler that was paused for input.
      { const entry = agent.stateManager.getTask(`ir:${taskId}`);
        if (entry?.resolver) entry.resolver(parts);
        agent.stateManager.deleteTask(`ir:${taskId}`);
      }
      return true;

    default:
      return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _runStreamingHandler(t, agent, envelope, taskId, gen, signal, cleanup) {
  try {
    for await (const chunk of gen) {
      if (signal?.aborted) {
        await gen.return?.();
        cleanup();
        return;
      }
      const chunkParts = chunk == null ? []
        : Array.isArray(chunk) ? chunk
        : Parts.wrap(chunk);
      await t.sendOneWay(envelope._from, {
        type:  'stream-chunk',
        taskId,
        parts: chunkParts,
      });
    }
    if (signal?.aborted) { cleanup(); return; }
    cleanup();
    await t.respond(envelope._from, envelope._id, {
      type:   'task-result',
      taskId,
      status: 'completed',
      parts:  [],
    });
  } catch (err) {
    cleanup();
    if (err?.name === 'AbortError' || signal?.aborted) return;
    await _respondFailed(t, agent, envelope, taskId, err);
  }
}

/**
 * Multi-round input-required loop.
 * Re-invokes the skill handler each time new parts arrive.
 * Loops until the handler returns a result, throws a non-InputRequired error,
 * is aborted (cancel/expiry), or times out.
 */
async function _handleInputRequired(t, agent, envelope, taskId, skill, ctx, irErr, signal, cleanup) {
  while (true) {
    if (signal?.aborted) { cleanup(); return; }

    let inputParts;
    try {
      inputParts = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Input-required timeout')),
          120_000,
        );
        agent.stateManager.createTask(`ir:${taskId}`, {
          resolver: (p)   => { clearTimeout(timer); resolve(p); },
          rejecter: (err) => { clearTimeout(timer); reject(err); },
        });
        t.sendOneWay(envelope._from, {
          type:  'input-required',
          taskId,
          parts: irErr.parts ?? [],
        }).catch(err => { clearTimeout(timer); reject(err); });
      });
    } catch (err) {
      cleanup();
      if (err.message !== 'Task expired' && !signal?.aborted) {
        await _respondFailed(t, agent, envelope, taskId, err);
      }
      return;
    }

    if (signal?.aborted) { cleanup(); return; }

    const newCtx = { ...ctx, parts: inputParts };
    let resumed;
    try {
      resumed = await skill.handler(newCtx);
    } catch (err) {
      if (err?.name === 'InputRequired') {
        irErr = err;
        ctx   = newCtx;
        continue;
      }
      cleanup();
      await _respondFailed(t, agent, envelope, taskId, err);
      return;
    }

    cleanup();
    const outParts = resumed == null    ? []
      : Array.isArray(resumed)          ? resumed
      : Parts.wrap(resumed);

    await t.respond(envelope._from, envelope._id, {
      type:   'task-result',
      taskId,
      status: 'completed',
      parts:  outParts,
    }).catch(() => {});
    return;
  }
}

async function _respondFailed(t, agent, envelope, taskId, err) {
  console.warn('[taskExchange] skill error:', envelope.payload?.skillId, err?.message);
  agent.emit('skill-error', { skillId: envelope.payload?.skillId, error: err });
  await t.respond(envelope._from, envelope._id, {
    type:   'task-result',
    taskId,
    status: 'failed',
    error:  err?.message ?? String(err),
    parts:  [],
  }).catch(() => {});
}

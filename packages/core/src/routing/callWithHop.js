/**
 * callWithHop — hop-aware version of agent.call() that returns a Task.
 *
 * Group CC Alice side. Differs from invokeWithHop in that:
 *   • Returns a Task synchronously (matches agent.call) instead of a
 *     Promise<Parts[]>.
 *   • When the chosen bridge advertises `tunnel: true` in its
 *     `get-capabilities` snapshot, opens a bidirectional tunnel via
 *     `tunnel-open`.  Streaming chunks, input-required, and cancel
 *     round-trip through the bridge transparently.
 *   • When no capable tunnel bridge is available (or tunnel-open
 *     refuses), falls back to the existing one-shot `relay-forward`
 *     path — the returned Task completes in one shot with the same
 *     semantics as today.
 *
 * invokeWithHop remains as the Promise<Parts[]> facade and is now
 * implemented in terms of callWithHop.
 *
 * This file is the orchestrator + direct-path attempt.  The three
 * extracted helpers carry the rest:
 *   • hopBridges.js   — buildBridgeList, bridgeSupportsTunnel
 *   • hopTunnel.js    — openTunnel (plaintext), openSealedTunnel
 *   • hopOneShot.js   — oneShotForward (relay-forward fallback)
 *
 * See Design-v3/hop-tunnel.md for the protocol design.
 */
import { Task }                           from '../protocol/Task.js';
import { genId }                           from '../Envelope.js';
import { signOrigin }                      from '../security/originSignature.js';
import { packSealed }                      from '../security/sealedForward.js';
import { buildBridgeList,
         bridgeSupportsTunnel }            from './hopBridges.js';
import { openTunnel,
         openSealedTunnel }                from './hopTunnel.js';
import { oneShotForward }                  from './hopOneShot.js';

const TRANSPORT_ERROR_KEYWORDS = [
  'not connected', 'no connection', 'timeout', 'offline', 'unreachable',
  'no route', 'not reachable',
];

function _isTransportError(msg = '') {
  const lower = String(msg).toLowerCase();
  return TRANSPORT_ERROR_KEYWORDS.some(k => lower.includes(k));
}
function _isMissingKeyError(msg = '') { return /pubkey/i.test(String(msg)); }

/**
 * @param {import('../Agent.js').Agent} agent
 * @param {string} targetPubKey
 * @param {string} skillId
 * @param {import('../Parts.js').Part[]} [parts]
 * @param {object} [opts]
 * @returns {Task}
 */
export function callWithHop(agent, targetPubKey, skillId, parts = [], opts = {}) {
  const taskId = genId();
  const task = new Task({
    taskId,
    skillId,
    agent,
    peerId: targetPubKey,
    state:  'submitted',
  });
  // stateManager registration lets handleTaskOneWay route inbound OWs to
  // this Task.  Optional so stub agents in tests (that mock agent.invoke)
  // don't need to provide a full stateManager surface.
  agent.stateManager?.createTask?.(taskId, task);
  task._transition('working');

  _runHopCall(agent, targetPubKey, skillId, parts, opts, task).catch(err => {
    if (!_isTerminal(task)) {
      task._transition('failed', { error: err?.message ?? String(err) });
    }
  });

  return task;
}

function _isTerminal(task) {
  return ['completed', 'failed', 'cancelled', 'expired'].includes(task.state);
}

async function _runHopCall(agent, targetPubKey, skillId, parts, opts, outerTask) {
  const record     = await agent.peers?.get?.(targetPubKey);
  const skipDirect = (record?.hops ?? 0) > 0;

  // ── 1. Direct attempt ──────────────────────────────────────────────────────
  if (!skipDirect) {
    const tried = await _tryDirect(agent, targetPubKey, skillId, parts, opts, outerTask);
    if (tried === 'handled') return;
  }

  // ── 2. Bridge candidates ──────────────────────────────────────────────────
  const bridges = await buildBridgeList(agent, targetPubKey, record);
  if (bridges.length === 0) {
    outerTask._transition('failed', {
      error: `No route to ${String(targetPubKey).slice(0, 12)}… — direct failed and no bridge peer available`,
    });
    return;
  }

  // ── 3. Origin signature (Group Z) ─────────────────────────────────────────
  let originSig = null, originTs = null;
  if (agent.identity?.sign) {
    const signed = signOrigin(agent.identity, {
      target: targetPubKey,
      skill:  skillId,
      parts,
    });
    originSig = signed.sig;
    originTs  = signed.originTs;
  }

  // ── 4. Sealed-forward decision (Group BB) ────────────────────────────────
  const groupCfg = opts.group
    ? agent.getSealedForwardConfig?.(opts.group) ?? null
    : null;
  const useSealed = opts.sealed === true || !!groupCfg?.enabled;

  if (useSealed && !agent.identity?.pubKey) {
    outerTask._transition('failed', {
      error: 'callWithHop: sealed forward requires an identity',
    });
    return;
  }

  // ── 5. Per bridge: tunnel (plaintext or sealed) → one-shot ──────────────
  // Preference order per bridge:
  //   1. Tunnel (plaintext)  — bridge advertises tunnel:true and call is
  //                             not sealed.
  //   2. Tunnel (sealed)     — both useSealed and tunnel:true.  Ships a
  //                             sealed opening RQ carrying a session key
  //                             K as extras; Carol decrypts, runs skill,
  //                             encrypts all outbound OWs with K.
  //   3. One-shot relay      — fallback.  Sealed calls use sealed-forward
  //                             (relay-receive-sealed) end-to-end.
  let lastErr;
  for (const bridge of bridges) {
    const tunnelCapable = await bridgeSupportsTunnel(agent, bridge, opts);

    if (tunnelCapable) {
      try {
        const open = useSealed ? openSealedTunnel : openTunnel;
        await open(
          agent, bridge, targetPubKey, skillId, parts,
          outerTask, originSig, originTs, opts,
        );
        return;
      } catch (err) {
        lastErr = new Error(`tunnel via ${bridge.slice(0, 12)}… failed: ${err?.message ?? err}`);
        continue;
      }
    }

    // One-shot fallback.
    let sealedBlob = null;
    if (useSealed) {
      const { sealed, nonce } = packSealed({
        identity:        agent.identity,
        recipientPubKey: targetPubKey,
        skill:           skillId,
        parts,
        origin:          agent.pubKey,
        originSig,
        originTs,
      });
      sealedBlob = { sealed, nonce };
      agent.emit?.('sealed-forward-sent', {
        target: targetPubKey, skill: skillId, group: opts.group ?? null,
      });
    }

    try {
      const resultParts = await oneShotForward(
        agent, bridge, targetPubKey, skillId, parts,
        sealedBlob, originSig, originTs, opts,
      );
      outerTask._transition('completed', { parts: resultParts });
      return;
    } catch (err) {
      lastErr = new Error(`bridge ${bridge.slice(0, 12)}… failed: ${err?.message ?? err}`);
    }
  }

  outerTask._transition('failed', {
    error: lastErr?.message ?? `No working bridge to ${String(targetPubKey).slice(0, 12)}…`,
  });
}

// ── Direct path ──────────────────────────────────────────────────────────────

async function _tryDirect(agent, targetPubKey, skillId, parts, opts, outerTask) {
  // Agents without a call() method (mock stubs in tests) fall back to the
  // simpler invoke-only path.  Real Agents always have call() and use the
  // task-mirroring path so streaming / IR / cancel work on the direct leg.
  if (typeof agent.call !== 'function') {
    return _tryDirectViaInvoke(agent, targetPubKey, skillId, parts, opts, outerTask);
  }

  // Kick off a direct call; mirror its Task events onto our outer Task.
  const inner = agent.call(targetPubKey, skillId, parts, opts);

  // Listen for inner done/fail before deciding.  We need to know whether to
  // continue with bridges (transport error) or fail terminally (skill error).
  const result = await new Promise(resolve => {
    const onDone = (snap) => { cleanup(); resolve({ kind: 'done', snap }); };
    const onFail = (err)  => { cleanup(); resolve({ kind: 'fail', err });  };
    const cleanup = () => {
      inner.off('done',      onDone);
      inner.off('failed',    onFail);
      inner.off('cancelled', onCan);
      inner.off('expired',   onExp);
    };
    const onCan = () => { cleanup(); resolve({ kind: 'done', snap: { state: 'cancelled', parts: [] } }); };
    const onExp = () => { cleanup(); resolve({ kind: 'done', snap: { state: 'expired', parts: [] } }); };

    inner.on('done',      onDone);
    inner.on('failed',    onFail);
    inner.on('cancelled', onCan);
    inner.on('expired',   onExp);

    // Mirror live events (stream / IR) while waiting.
    inner.on('stream-chunk',   parts => outerTask._pushChunk(parts));
    inner.on('input-required', parts => outerTask._transition('input-required', { parts }));
  });

  if (result.kind === 'done') {
    if (result.snap.state === 'completed') {
      outerTask._transition('completed', { parts: result.snap.parts ?? [] });
      // Rewire outer cancel/send so they hit the peer directly (rare after
      // completion, but keeps behaviour consistent for late callers).
      outerTask.cancel = () => inner.cancel();
      outerTask.send   = (p) => inner.send(p);
      return 'handled';
    }
    // cancelled / expired — also terminal, but leave state to the outer.
    outerTask._transition(result.snap.state);
    return 'handled';
  }

  // Inner failed.  Decide: transport error → fall through to bridges.
  const msg = result.err ?? '';
  if (_isMissingKeyError(msg)) {
    // Try hello + retry once.
    try {
      await agent.hello(targetPubKey, opts.helloTimeout ?? 10_000);
      const retry = agent.call(targetPubKey, skillId, parts, opts);
      const snap  = await retry.done();
      if (snap.state === 'completed') {
        outerTask._transition('completed', { parts: snap.parts });
      } else {
        outerTask._transition(snap.state, { error: snap.error });
      }
      return 'handled';
    } catch { /* fall through to bridges */ }
  } else if (!_isTransportError(msg)) {
    // Genuine skill error → surface, don't mask with a bridge retry.
    outerTask._transition('failed', { error: msg });
    return 'handled';
  }
  // Transport error → caller should try bridges.
  return 'fallback';
}

// Invoke-only fallback for agents that don't expose call() (test stubs).
// Synthesises a completed Task from the Parts[] result.  No streaming or
// IR support on this path — that's OK because it's only used when the
// caller already opted into an invoke-shaped surface.
async function _tryDirectViaInvoke(agent, targetPubKey, skillId, parts, opts, outerTask) {
  try {
    const result = await agent.invoke(targetPubKey, skillId, parts, opts);
    outerTask._transition('completed', { parts: result });
    return 'handled';
  } catch (err) {
    const msg = err?.message ?? '';
    if (_isMissingKeyError(msg)) {
      try {
        await agent.hello?.(targetPubKey, opts.helloTimeout ?? 10_000);
        const retry = await agent.invoke(targetPubKey, skillId, parts, opts);
        outerTask._transition('completed', { parts: retry });
        return 'handled';
      } catch { /* fall through to bridges */ }
    } else if (!_isTransportError(msg)) {
      outerTask._transition('failed', { error: msg });
      return 'handled';
    }
    return 'fallback';
  }
}

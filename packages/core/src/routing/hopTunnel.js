/**
 * hopTunnel — open a Group CC tunnel through a bridge.
 *
 * Two flavours, both wire the outer Task's cancel/send to flow through
 * the bridge:
 *   • openTunnel        — plaintext (Group CC1).  Bridge sees the inner
 *                         payload but cannot tamper without breaking
 *                         the originSig (Group Z).
 *   • openSealedTunnel  — sealed (Group CC3b).  Bridge sees only the
 *                         opaque ciphertext + nonce; the session key K
 *                         is sealed-forward'd to Carol who decrypts and
 *                         encrypts every outbound OW.
 *
 * Both are extracted from callWithHop.js so the orchestrator stays
 * focused on flow.  See Design-v3/hop-tunnel.md for the protocol.
 */
import { DataPart, Parts }     from '../Parts.js';
import { genId }               from '../Envelope.js';
import { packSealed }          from '../security/sealedForward.js';
import { generateTunnelKey,
         sealTunnelOW }         from '../security/tunnelSeal.js';

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled', 'expired']);
function _isTerminal(task) { return TERMINAL_STATES.has(task.state); }

/**
 * Open a plaintext tunnel via `bridgePubKey` to `targetPubKey` and
 * wire `outerTask.cancel` / `outerTask.send` to route through it.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string} bridgePubKey
 * @param {string} targetPubKey
 * @param {string} skillId
 * @param {import('../Parts.js').Part[]} parts
 * @param {import('../protocol/Task.js').Task} outerTask
 * @param {string|null} originSig
 * @param {number|null} originTs
 * @param {object} opts
 */
export async function openTunnel(
  agent, bridgePubKey, targetPubKey, skillId, parts,
  outerTask, originSig, originTs, opts,
) {
  const aliceTaskId = outerTask.taskId;
  const timeoutMs   = opts.timeout ?? 10_000;

  const rs = await agent.invoke(
    bridgePubKey,
    'tunnel-open',
    [DataPart({
      targetPubKey,
      skill:       skillId,
      payload:     parts,
      aliceTaskId,
      originSig,
      originTs,
      timeout:     timeoutMs,
      ttlMs:       opts.tunnelTtlMs,
    })],
    { timeout: timeoutMs + 2_000 },
  );

  const data = Parts.data(rs) ?? {};
  if (data.error) throw new Error(data.error);
  if (!data.tunnelId) throw new Error('tunnel-open: missing tunnelId in reply');

  const tunnelId = data.tunnelId;

  // Override cancel / send on the outer Task to route through tunnel-ow.
  // The existing handleTaskOneWay dispatch already routes OWs addressed to
  // aliceTaskId (= outerTask.taskId) to the outer Task — no wiring needed
  // on the inbound side.
  outerTask.cancel = async () => {
    if (_isTerminal(outerTask)) return;
    outerTask._transition('cancelled');
    await agent.invoke(
      bridgePubKey,
      'tunnel-ow',
      [DataPart({ tunnelId, inner: { type: 'cancel', taskId: aliceTaskId } })],
      { timeout: 5_000 },
    ).catch(() => {});
  };

  outerTask.send = async (responseParts) => {
    if (outerTask.state !== 'input-required') {
      throw new Error(`Task.send() requires state=input-required, got "${outerTask.state}"`);
    }
    outerTask._transition('working');
    await agent.invoke(
      bridgePubKey,
      'tunnel-ow',
      [DataPart({
        tunnelId,
        inner: { type: 'task-input', taskId: aliceTaskId, parts: responseParts },
      })],
      { timeout: 5_000 },
    );
  };
}

/**
 * Open a sealed tunnel (Group CC3b) via `bridgePubKey` to `targetPubKey`.
 *
 * Differs from openTunnel in that:
 *   • The opening RQ carries a `packSealed` blob instead of plaintext
 *     parts; the bridge cannot read the skill, payload, or origin sig.
 *   • A session key K is generated, registered on the agent under the
 *     pre-allocated tunnelId BEFORE the open round-trip, and the
 *     outer Task's send/cancel encrypt every outbound OW with K via
 *     sealTunnelOW.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string} bridgePubKey
 * @param {string} targetPubKey
 * @param {string} skillId
 * @param {import('../Parts.js').Part[]} parts
 * @param {import('../protocol/Task.js').Task} outerTask
 * @param {string|null} originSig
 * @param {number|null} originTs
 * @param {object} opts
 */
export async function openSealedTunnel(
  agent, bridgePubKey, targetPubKey, skillId, parts,
  outerTask, originSig, originTs, opts,
) {
  const aliceTaskId = outerTask.taskId;
  const timeoutMs   = opts.timeout ?? 10_000;

  // 1. Generate K and pre-allocate the tunnelId so Alice can register K
  //    BEFORE the open round-trip.  Otherwise Carol may emit the first
  //    sealed-tunnel-ow (a stream-chunk from an eager generator) before
  //    Alice knows the tunnelId, and her sealed-tunnel-ow handler would
  //    drop it as "unknown tunnel."
  const K        = generateTunnelKey();
  const tunnelId = genId();

  agent._sealedTunnelKeys ??= new Map();
  agent._sealedTunnelKeys.set(tunnelId, {
    K,
    taskId:  aliceTaskId,
    side:    'alice',
    bobAddr: bridgePubKey,
  });

  // 2. Pack the sealed opening RQ.  `extras` carries K + aliceTaskId so
  //    Bob never sees either.
  const { sealed, nonce } = packSealed({
    identity:        agent.identity,
    recipientPubKey: targetPubKey,
    skill:           skillId,
    parts,
    origin:          agent.pubKey,
    originSig,
    originTs,
    extras:          { tunnelKey: K, aliceTaskId },
  });
  agent.emit?.('sealed-forward-sent', {
    target: targetPubKey, skill: skillId, group: opts.group ?? null, tunnelled: true,
  });

  // 3. Install the Task overrides BEFORE the open round-trip.  Carol's
  //    handler runs asynchronously the moment Bob delivers; it can emit
  //    the first OW (commonly an IR) before tunnel-open's RS returns.
  //    If the overrides weren't in place yet, task.send would fall
  //    through to Task's default impl which sendOneWays directly to
  //    targetPubKey — Alice has no HI with Carol, so SecurityLayer
  //    throws UNKNOWN_RECIPIENT.  Installing the overrides first routes
  //    task.send / task.cancel through the bridge unconditionally.
  const sendSealedOW = async (innerOW) => {
    const { sealed: cSealed, nonce: cNonce } = sealTunnelOW({ key: K, innerOW });
    await agent.invoke(
      bridgePubKey,
      'tunnel-ow',
      [DataPart({ tunnelId, sealedInner: { sealed: cSealed, nonce: cNonce } })],
      { timeout: 5_000 },
    );
  };

  const cleanupKey = () => { agent._sealedTunnelKeys?.delete?.(tunnelId); };
  outerTask.on('done',      cleanupKey);
  outerTask.on('failed',    cleanupKey);
  outerTask.on('cancelled', cleanupKey);
  outerTask.on('expired',   cleanupKey);

  outerTask.cancel = async () => {
    if (_isTerminal(outerTask)) return;
    outerTask._transition('cancelled');
    await sendSealedOW({ type: 'cancel' }).catch(() => {});
  };

  outerTask.send = async (responseParts) => {
    if (outerTask.state !== 'input-required') {
      throw new Error(`Task.send() requires state=input-required, got "${outerTask.state}"`);
    }
    outerTask._transition('working');
    await sendSealedOW({ type: 'task-input', parts: responseParts });
  };

  // 4. Send the sealed blob to Bob via tunnel-open with the pre-allocated
  //    tunnelId.  Bob forwards to Carol via tunnel-receive-sealed.
  try {
    const rs = await agent.invoke(
      bridgePubKey,
      'tunnel-open',
      [DataPart({
        targetPubKey,
        sealed,
        nonce,
        sender:      agent.pubKey,
        aliceTaskId,
        tunnelId,
        timeout:     timeoutMs,
        ttlMs:       opts.tunnelTtlMs,
      })],
      { timeout: timeoutMs + 2_000 },
    );
    const data = Parts.data(rs) ?? {};
    if (data.error) {
      agent._sealedTunnelKeys?.delete?.(tunnelId);
      throw new Error(data.error);
    }
    if (data.tunnelId && data.tunnelId !== tunnelId) {
      const existing = agent._sealedTunnelKeys.get(tunnelId);
      agent._sealedTunnelKeys.delete(tunnelId);
      agent._sealedTunnelKeys.set(data.tunnelId, existing);
    }
  } catch (err) {
    agent._sealedTunnelKeys?.delete?.(tunnelId);
    throw err;
  }
}

/**
 * streaming.js — dedicated streaming module (Group D).
 *
 * Provides standalone streamOut / handleStreamChunk functions extracted
 * from the inline logic in taskExchange.js. The same OW-typed protocol
 * is used so both paths are wire-compatible:
 *   OW { type:'stream-chunk', taskId, parts }   — one chunk
 *   OW { type:'stream-end',   taskId, parts? }  — final / close
 *
 * Bidirectional streaming (streamBidi) creates two parallel OW streams
 * and is native-transport only.
 */
import { Parts }  from '../Parts.js';
import { genId }  from '../Envelope.js';

// ── Outbound ──────────────────────────────────────────────────────────────────

/**
 * Send a unidirectional stream from an async generator.
 * Each yielded value becomes one OW stream-chunk envelope.
 * A stream-end OW is sent automatically when the generator returns.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string}   peerId
 * @param {string}   taskId
 * @param {AsyncGenerator|AsyncIterable} generator
 * @param {AbortSignal} [signal]   — abort mid-stream gracefully
 */
export async function streamOut(agent, peerId, taskId, generator, signal) {
  try {
    for await (const chunk of generator) {
      if (signal?.aborted) { await generator.return?.(); break; }

      const parts = chunk == null      ? []
                  : Array.isArray(chunk) ? chunk
                  : Parts.wrap(chunk);

      await agent.transport.sendOneWay(peerId, { type: 'stream-chunk', taskId, parts });
    }
  } finally {
    if (!signal?.aborted) {
      await agent.transport.sendOneWay(peerId, {
        type: 'stream-end', taskId, parts: [],
      }).catch(() => {});
    }
  }
}

// ── Inbound ───────────────────────────────────────────────────────────────────

/**
 * Handle an inbound stream-chunk or stream-end OW envelope.
 * Pushes chunks onto the Task registered in StateManager.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object} envelope
 * @returns {boolean} true if handled
 */
export function handleStreamChunk(agent, envelope) {
  const { type, taskId, parts = [] } = envelope.payload ?? {};
  if (type !== 'stream-chunk' && type !== 'stream-end') return false;

  const task = agent.stateManager.getTask(taskId);
  if (type === 'stream-chunk') {
    task?._pushChunk(parts);
    return true;
  }
  // stream-end
  if (parts.length) task?._pushChunk(parts);
  task?._closeStream();
  return true;
}

// ── Bidirectional ─────────────────────────────────────────────────────────────

/**
 * Open two parallel OW streams between this agent and a peer.
 * Native-only — A2A peers receive a 'requires-native-transport' error.
 *
 * `handler` is an async generator that:
 *   - receives incoming chunks via `ctx.incoming` (AsyncIterable<Part[]>)
 *   - yields outgoing chunks
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string}   peerId
 * @param {string}   [taskId]  — defaults to a fresh UUID
 * @param {function(ctx): AsyncGenerator} handler
 * @returns {Promise<{ streamId: string }>}
 */
export async function streamBidi(agent, peerId, taskId, handler) {
  const streamId = taskId ?? genId();

  // --- Incoming side: buffer inbound stream-chunk messages for this streamId.
  const inQueue   = [];
  const inWaiters = [];

  const incoming = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (inQueue.length) return Promise.resolve({ value: inQueue.shift(), done: false });
          return new Promise((resolve, reject) => {
            inWaiters.push({ resolve, reject });
          });
        },
        return() {
          for (const w of inWaiters) w.resolve({ value: undefined, done: true });
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };

  // Register a temporary message listener for incoming chunks.
  const onMsg = ({ from, parts, payload }) => {
    if (from !== peerId) return;
    const p = payload ?? {};
    if (p.taskId !== streamId) return;
    if (p.type === 'stream-chunk') {
      const chunk = p.parts ?? [];
      if (inWaiters.length) inWaiters.shift().resolve({ value: chunk, done: false });
      else inQueue.push(chunk);
    } else if (p.type === 'stream-end') {
      for (const w of inWaiters) w.resolve({ value: undefined, done: true });
      inWaiters.length = 0;
      agent.off('message', onMsg);
    }
  };
  agent.on('message', onMsg);

  // Notify peer we're starting a bidi stream.
  await agent.transport.sendOneWay(peerId, {
    type: 'bidi-start', taskId: streamId,
  });

  // Run the handler and stream its output.
  const gen = handler({ taskId: streamId, peerId, incoming });
  await streamOut(agent, peerId, streamId, gen);

  agent.off('message', onMsg);
  return { streamId };
}

/**
 * Task — A2A-compatible task state machine.
 *
 * State machine:
 *   submitted → working → completed
 *                       → failed
 *                       → cancelled
 *              working → input-required → working   (RI received)
 *                                       → cancelled (CX received)
 *
 * Caller API:
 *   const task = await agent.call(peer, 'skill', parts);
 *   const { parts } = await task.done();           // wait for result
 *   for await (const chunk of task.stream()) { }   // streaming result
 *   await task.cancel();                           // request cancellation
 *   await task.send(parts);                        // reply to input-required
 *
 * Handler API (throw inside a skill handler):
 *   throw new Task.InputRequired([TextPart('What is your name?')]);
 *
 * Generator handlers stream automatically — just yield Part[]:
 *   async function* handler({ parts }) {
 *     yield [TextPart('chunk 1')];
 *     yield [TextPart('chunk 2')];
 *   }
 */
import { Emitter } from '../Emitter.js';

export class Task extends Emitter {
  // ── State ────────────────────────────────────────────────────────────────
  #taskId;
  #skillId;
  #state;
  #resultParts = null;
  #resultError = null;

  // ── Promises ─────────────────────────────────────────────────────────────
  #doneWaiters  = [];   // [{ resolve, reject }]

  // ── Stream ───────────────────────────────────────────────────────────────
  #streamQueue    = [];  // Part[][] — buffered chunks
  #streamWaiters  = [];  // resolvers waiting for next chunk
  #streamClosed   = false;

  // ── Agent back-ref (for cancel / send) ───────────────────────────────────
  #agent  = null;
  #peerId = null;

  /**
   * @param {object} opts
   * @param {string} opts.taskId
   * @param {string} opts.skillId
   * @param {string} [opts.state='submitted']
   * @param {object} [opts.agent]   — Agent instance (for cancel/send)
   * @param {string} [opts.peerId]  — peer address
   */
  constructor({ taskId, skillId, state = 'submitted', agent = null, peerId = null }) {
    super();
    this.#taskId  = taskId;
    this.#skillId = skillId;
    this.#state   = state;
    this.#agent   = agent;
    this.#peerId  = peerId;
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  get taskId()  { return this.#taskId; }
  get skillId() { return this.#skillId; }
  get state()   { return this.#state; }

  // ── Caller API ────────────────────────────────────────────────────────────

  /**
   * Wait for the task to reach a terminal state.
   * @returns {Promise<{ state: string, parts: Part[], error?: string }>}
   */
  done() {
    if (this.#isTerminal()) return Promise.resolve(this.#snapshot());
    return new Promise((resolve, reject) => this.#doneWaiters.push({ resolve, reject }));
  }

  /**
   * Async generator — yields each streaming Part[] chunk as it arrives.
   * Completes when the stream is closed (SE received or task completes).
   */
  async * stream() {
    while (true) {
      if (this.#streamQueue.length > 0) {
        yield this.#streamQueue.shift();
        continue;
      }
      if (this.#streamClosed) return;
      await new Promise(res => this.#streamWaiters.push(res));
    }
  }

  /** Send a CX cancel envelope to the peer. */
  async cancel() {
    if (this.#isTerminal()) return;
    this._transition('cancelled');
    if (this.#agent && this.#peerId) {
      await this.#agent.transport
        .sendOneWay(this.#peerId, { type: 'cancel', taskId: this.#taskId })
        .catch(() => {});
    }
  }

  /**
   * Reply to an input-required request (sends RI envelope).
   * Throws if task is not in `input-required` state.
   */
  async send(parts) {
    if (this.#state !== 'input-required') {
      throw new Error(`Task.send() requires state=input-required, got "${this.#state}"`);
    }
    this._transition('working');
    if (this.#agent && this.#peerId) {
      await this.#agent.transport.sendOneWay(this.#peerId, {
        type: 'task-input',
        taskId: this.#taskId,
        parts,
      });
    }
  }

  // ── Internal API (called by taskExchange.js) ──────────────────────────────

  /** Transition to a new state and fire all relevant listeners. */
  _transition(state, data = {}) {
    const VALID = {
      submitted:        ['working', 'cancelled', 'failed'],
      working:          ['completed', 'failed', 'cancelled', 'input-required', 'expired'],
      // input-required → completed is a legal direct transition: a bridge
      // agent (Group CC tunnel-open) never calls task.send, so its local
      // copy of the task never returns to 'working' before the remote
      // handler responds with task-result.  We accept the RS directly.
      'input-required': ['working', 'completed', 'cancelled', 'failed', 'expired'],
    };
    // Allow transitions from terminal state only if no-op.
    if (this.#isTerminal() && state === this.#state) return;
    if (this.#isTerminal()) return;  // ignore late arrivals silently

    const allowed = VALID[this.#state] ?? [];
    if (!allowed.includes(state)) {
      // Soft warn — don't throw; protocol races can produce unexpected transitions.
      return;
    }

    this.#state = state;

    if (state === 'completed') {
      this.#resultParts = data.parts ?? [];
      this.#closeStream();
      this.#resolveDone();
      this.emit('done', this.#snapshot());
    } else if (state === 'failed') {
      this.#resultError = data.error ?? 'Unknown error';
      this.#closeStream();
      this.#rejectDone(new Error(this.#resultError));
      this.emit('failed', this.#resultError);
    } else if (state === 'cancelled') {
      this.#closeStream();
      this.#resolveDone();
      this.emit('cancelled');
    } else if (state === 'expired') {
      this.#closeStream();
      this.#resolveDone();
      this.emit('expired');
    } else if (state === 'input-required') {
      this.emit('input-required', data.parts ?? []);
    }
    // 'working': no specific resolution, just state change
  }

  /** Push a streaming chunk. */
  _pushChunk(parts) {
    this.#streamQueue.push(parts);
    this.#wakeStreamWaiters();
    this.emit('stream-chunk', parts);
  }

  /** Close the stream (all pending stream() generators will return). */
  _closeStream() { this.#closeStream(); }

  // ── Private ───────────────────────────────────────────────────────────────

  #isTerminal() {
    return ['completed', 'failed', 'cancelled', 'expired'].includes(this.#state);
  }

  #snapshot() {
    return {
      state:  this.#state,
      parts:  this.#resultParts ?? [],
      error:  this.#resultError ?? undefined,
    };
  }

  #closeStream() {
    this.#streamClosed = true;
    this.#wakeStreamWaiters();
  }

  #wakeStreamWaiters() {
    while (this.#streamWaiters.length) this.#streamWaiters.shift()();
  }

  #resolveDone() {
    const snap = this.#snapshot();
    for (const { resolve } of this.#doneWaiters) resolve(snap);
    this.#doneWaiters = [];
  }

  #rejectDone(err) {
    for (const { reject } of this.#doneWaiters) reject(err);
    this.#doneWaiters = [];
  }
}

// ── Static helpers ────────────────────────────────────────────────────────────

/**
 * Throw this from a skill handler to pause execution and ask the caller
 * for additional input.
 *
 * Example:
 *   throw new Task.InputRequired([TextPart('What is your name?')]);
 */
Task.InputRequired = class InputRequiredError extends Error {
  constructor(parts = []) {
    super('InputRequired');
    this.name = 'InputRequired';
    this.parts = parts;
  }
};

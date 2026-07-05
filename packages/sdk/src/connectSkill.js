/**
 * connectSkill — the HIGH-layer, Tier-1 "any app function maps to a skill"
 * helper.
 *
 * A thin, correct wrapper over `agent.register(name, handler, opts)` that
 * adapts a PLAIN application function into the core skill-handler shape. The
 * app author writes an ordinary function:
 *
 *     function greet(args, ctx) { return `Hi ${args.name}`; }
 *     connectSkill(agent, 'greet', greet);
 *
 * ...and it becomes a callable skill — no knowledge of Parts, envelopes or
 * the task protocol required.
 *
 * ── The adaptation ──────────────────────────────────────────────────────
 * Core dispatches a skill handler with a rich context object
 * `{ parts, from, originFrom, taskId, envelope, agent, signal, ... }` and
 * auto-wraps the return value into `Part[]`. connectSkill:
 *
 *   1. DECODES the inbound `parts` into a friendly `args`:
 *        - the merged DataPart payload if present (object args), else
 *        - the first TextPart's text if present (string args), else
 *        - the raw `Part[]` (nothing decodable — hand it through verbatim).
 *   2. Calls `appFn(args, ctx)` — `ctx` is the FULL core skill context, so an
 *      app that DOES care about `from` / `envelope` / `signal` still has it.
 *   3. Returns the value unchanged; core's Parts.wrap() turns a string /
 *      object / Part[] into the wire response.
 *
 * v1 fork (see report): connectSkill is HANDLER-based, not manifest-based.
 * It maps one function → one skill and does not read/emit a manifest. The
 * manifest-driven projector story (renderChat/renderGate/…) stays the app's
 * job; this helper is only the "plain fn → skill handler" adapter. `opts`
 * passes straight through to core's defineSkill (description, visibility,
 * streaming, policy, …).
 */

/** @typedef {import('@canopy/core').Agent} Agent */

/**
 * Decode a core skill context's `parts` into friendly `args` for a plain fn.
 *
 * @param {object} ctx  core skill context ({ parts, ... })
 * @returns {object|string|Array} object (DataPart), string (TextPart) or raw Part[]
 */
export function decodeArgs(ctx) {
  const parts = ctx?.parts ?? [];

  // Merged DataPart fields — the common "object args" case.
  const data = parts.filter?.((p) => p?.type === 'DataPart') ?? [];
  if (data.length) return Object.assign({}, ...data.map((p) => p.data));

  // First TextPart — the "string arg" case.
  const text = parts.find?.((p) => p?.type === 'TextPart');
  if (text) return text.text;

  // Nothing decodable — hand the raw parts through.
  return parts;
}

/**
 * Register a plain app function as a skill on an agent.
 *
 * @param {Agent}    agent   a (started or not-yet-started) core.Agent
 * @param {string}   name    the skill id / op name
 * @param {(args: any, ctx: object) => any} appFn  plain app function; may be
 *          sync or async and may return a string / object / Part[] / any
 *          (auto-wrapped by core).
 * @param {object}   [opts]  forwarded to core's defineSkill (description,
 *          visibility, streaming, policy, tags, …).
 * @returns {Agent} the agent (for chaining, mirroring agent.register).
 */
export function connectSkill(agent, name, appFn, opts = {}) {
  if (!agent || typeof agent.register !== 'function') {
    throw new Error('connectSkill: first arg must be a core.Agent');
  }
  if (!name || typeof name !== 'string') {
    throw new Error('connectSkill: name must be a non-empty string');
  }
  if (typeof appFn !== 'function') {
    throw new Error(`connectSkill "${name}": appFn must be a function`);
  }

  const handler = (ctx) => appFn(decodeArgs(ctx), ctx);
  agent.register(name, handler, opts);
  return agent;
}

/**
 * Render the chat-surface projection of a manifest.
 *
 * Output is exactly what `@canopy/chat-agent`'s `ChatAgent` ctor expects
 * (`toolCatalog` + `toolHandlers` + `systemPrompt`), plus the structured
 * chat affordances (`commandMenu` for Telegram `setMyCommands`,
 * `inlineKeyboardFor(item)` for per-item inline buttons) that the manifest
 * also feeds.
 *
 * Frozen contract (PLAN flag #10 / R5, owner-approved 2026-05-19):
 *   renderChat(manifest, { skillRegistry, toSkillCtx, onStateUpdates }, opts?)
 *
 * `toolHandlers[id]` adapts an app-side skill
 *     (args, skillCtx) → { replies, stateUpdates }
 * into a ChatAgent ToolHandler
 *     (args, toolCtx)  → { replies, data: { stateUpdates } }
 * mapping ctx via `toSkillCtx(toolCtx)` and forwarding stateUpdates via
 * `onStateUpdates(updates)` (typically `scheduler.onStateUpdate`).  This
 * reproduces household's `chatAgentBridge.asToolHandler` generically.
 *
 * Deterministic: outputs follow manifest declaration order
 * (internal/order.js invariant).
 */

import { paramsToJsonSchema } from './paramsToJsonSchema.js';
import { buildPrompt }         from './internal/prompt.js';

/**
 * @param {import('./schema.js').Manifest} manifest
 * @param {object} args
 * @param {Record<string, function>} args.skillRegistry
 * @param {(toolCtx: object) => object} args.toSkillCtx
 * @param {(stateUpdates: Array<object>) => void} [args.onStateUpdates]
 * @param {object} [opts]
 * @param {{preamble?: string, perToolLine?: function, postamble?: string}} [opts.prompt]
 */
export function renderChat(manifest, args, opts = {}) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('renderChat: manifest required');
  }
  const { skillRegistry, toSkillCtx, onStateUpdates } = args || {};
  if (!skillRegistry || typeof skillRegistry !== 'object') {
    throw new Error('renderChat: skillRegistry required');
  }
  if (typeof toSkillCtx !== 'function') {
    throw new Error('renderChat: toSkillCtx required');
  }

  const ops = Array.isArray(manifest.operations) ? manifest.operations : [];

  // (a) free-text channel — exactly what ChatAgent expects.
  const toolCatalog = ops.map((op) => ({
    id:          op.id,
    description: op?.surfaces?.chat?.hint ?? op.id,
    schema:      paramsToJsonSchema(op.params ?? [], { manifest }),
  }));

  // toolHandlers: adapt skill → ToolHandler.  Permissive: ops without a
  // matching skill in the registry are omitted (so a manifest may grow
  // ahead of its skill set during development).  ChatAgent's "unknown
  // tool" path surfaces calls to absent handlers at runtime.
  const toolHandlers = {};
  for (const op of ops) {
    const skill = skillRegistry[op.id];
    if (typeof skill !== 'function') continue;
    toolHandlers[op.id] = async (toolArgs, toolCtx) => {
      const skillCtx     = toSkillCtx(toolCtx);
      const reply        = await skill(toolArgs, skillCtx);
      const stateUpdates = reply?.stateUpdates ?? [];
      if (typeof onStateUpdates === 'function' && stateUpdates.length > 0) {
        try { onStateUpdates(stateUpdates); }
        catch (err) {
          // Mirror chatAgentBridge: log + continue.  A scheduler hiccup
          // must not kill the user-facing reply.
          // eslint-disable-next-line no-console
          console.error('[renderChat] onStateUpdates threw:', err?.message ?? err);
        }
      }
      // V0.3 (d) — structured list reply shape (task #11, 2026-05-22).
      // The skill MAY return `reply.data` (e.g. `{items: [...]}` for
      // list ops, `{settings: {...}}` for record-shape views).
      // Pass through verbatim alongside `stateUpdates` so consumers
      // can read structured data without re-querying the store.
      // Forward-additive — skills without `data` work unchanged.
      // Surfaced by A.3 agent: household's listOpen returns chat-shape
      // only, forcing the web adapter to re-read the store.  With this
      // pass-through, skills can opt into the structured shape.
      const replyData = reply?.data;
      return {
        replies: reply?.replies ?? [],
        data:
          (replyData && typeof replyData === 'object' && !Array.isArray(replyData))
            ? { stateUpdates, ...replyData }
            : { stateUpdates },
      };
    };
  }

  // (b) the system prompt.  F-SP1-d (locked 2026-05-19): if the manifest
  // carries a verbatim `systemPrompt` string, use it as-is.  Otherwise build
  // one from the manifest via the parameterised prompt builder.  This is the
  // PLAN §1.6 escape hatch for prose that isn't reproducible from per-op
  // templates (e.g. household's `SYSTEM_PROMPT_CLASSIFY`).
  const systemPrompt = typeof manifest.systemPrompt === 'string'
    ? manifest.systemPrompt
    : buildPrompt(manifest, opts.prompt);

  // (c) command menu — Telegram setMyCommands shape.
  const commandMenu = ops
    .filter((op) => op?.surfaces?.slash?.command)
    .map((op) => ({
      command:     op.surfaces.slash.command,
      description: op.surfaces.chat?.hint ?? op.id,
    }));

  // (d) inline-keyboard projector — per shown item, the applicable
  // per-item buttons.  callbackData carries `<opId>:<itemId>` (the
  // triple-in-text-form: a tap → callback_query → IncomingMessage →
  // ChatAgent's existing dispatch path).
  const inlineKeyboardFor = (item) => {
    const out = [];
    for (const op of ops) {
      const ui = op?.surfaces?.ui;
      if (!ui || ui.control !== 'button') continue;
      if (!matchesAppliesTo(op.appliesTo, item)) continue;
      out.push({
        label:        ui.label ?? op.id,
        callbackData: `${op.id}:${item?.id ?? ''}`,
      });
    }
    return out;
  };

  // (e) Q28 reply-shape lookup (canopy-chat v0.1, 2026-05-21).  The
  // chat shell calls `replyShapeFor(opId)` to pick a renderer (text,
  // list, record, mini-page, file, embed-card, notification, brief).
  // When the op declares `surfaces.chat.reply`, that wins; otherwise
  // the shell falls back to a default it derives from `verb` +
  // `view.shape`.  Returning `undefined` here means "no opinion, ask
  // the consumer for a default."
  const replyShapeByOp = new Map();
  for (const op of ops) {
    const declared = op?.surfaces?.chat?.reply;
    if (declared) replyShapeByOp.set(op.id, declared);
  }
  const replyShapeFor = (opId) => replyShapeByOp.get(opId);

  return {
    toolCatalog, toolHandlers, systemPrompt, commandMenu,
    inlineKeyboardFor, replyShapeFor,
  };
}

function matchesAppliesTo(appliesTo, item) {
  if (!appliesTo) return true;
  if (!item || typeof item !== 'object') return false;
  if (appliesTo.type !== undefined) {
    const types = Array.isArray(appliesTo.type) ? appliesTo.type : [appliesTo.type];
    if (!types.includes(item.type)) return false;
  }
  if (appliesTo.state !== undefined) {
    // F-SP3-a (locked 2026-05-20): state may be a string OR an array of
    // strings.  Multi-state gates encode DoD-lifecycle ops cleanly
    // (e.g. revoke applies to `['claimed','submitted','rejected']`).
    const states = Array.isArray(appliesTo.state) ? appliesTo.state : [appliesTo.state];
    if (!states.includes(item.state)) return false;
  }
  return true;
}

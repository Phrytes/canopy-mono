/**
 * canopy-chat — input parser.
 *
 * Three parse modes, in priority order:
 *
 *   1. **Slash** — input starts with `/`; look up the slash token in
 *      the merged manifest's `commandMenu`.  When matched, emit
 *      `{kind: 'slash', opId, args, threadId}`.
 *
 *   2. **LLM** — v0.8+ deferred.  v0.1 stubs return `unknown` for
 *      anything that isn't a slash match.
 *
 *   3. **Free text** — fall-through.  v0.1 returns `unknown` with the
 *      raw text so the chat shell can render a "didn't understand"
 *      reply.
 *
 * Phase v0.1 sub-slice 1.4 per `/Project Files/canopy-chat/coding-plan.md`.
 */

/**
 * @typedef {object} SlashParseResult
 * @property {'slash'}      kind
 * @property {string}       opId       resolved op id
 * @property {object}       args       parsed args (per body-parse rules)
 * @property {string|null}  threadId   thread id from caller context (passed through)
 * @property {string}       command    the slash token actually matched (e.g. '/done')
 * @property {string}       body       raw body string (whatever followed the slash)
 */

/**
 * @typedef {object} UnknownParseResult
 * @property {'unknown'}    kind
 * @property {string}       text       raw input
 * @property {string|null}  threadId
 */

/**
 * @typedef {SlashParseResult | UnknownParseResult} ParseResult
 */

/**
 * @typedef {object} MergedCatalogLite
 * @property {Array<{ command: string, opId: string, body?: 'match' | 'reject' | 'flags' }>} commandMenu
 *   Each entry maps a slash command (e.g. '/done') to an opId.  `body`
 *   is the body-parse rule:
 *     - `'match'`   — body parses as a single positional arg (the
 *                     manifest's first required param)
 *     - `'reject'`  — any body after the slash is a parse error
 *     - `'flags'`   — body parses as `--key=value` flags (v0.4+ J2)
 *   Default when absent: `'match'`.
 */

/**
 * Parse user input.  Pure function — no I/O, no state.
 *
 * @param {string}             rawInput   the user's message text
 * @param {MergedCatalogLite}  catalog    merged manifest commandMenu
 * @param {object}             [ctx]
 * @param {string|null}        [ctx.threadId=null]  thread id from caller (passes through to result)
 * @returns {ParseResult}
 */
export function parseInput(rawInput, catalog, ctx = {}) {
  const threadId = ctx.threadId ?? null;
  const text     = String(rawInput ?? '');
  const trimmed  = text.trim();

  if (trimmed.startsWith('/')) {
    const slashResult = parseSlash(trimmed, catalog, { threadId });
    if (slashResult) return slashResult;
    // unmatched slash → fall through to unknown
  }

  // v0.1: no LLM, no free-text dispatch — just report unknown.
  return { kind: 'unknown', text: trimmed, threadId };
}

/**
 * Attempt to parse a slash-prefixed input against the catalog.
 *
 * @param {string}             trimmed   input with leading whitespace stripped
 * @param {MergedCatalogLite}  catalog
 * @param {object}             [ctx]
 * @param {string|null}        [ctx.threadId=null]
 * @returns {SlashParseResult | null}  null if no command matches
 */
export function parseSlash(trimmed, catalog, ctx = {}) {
  const threadId = ctx.threadId ?? null;
  if (!trimmed.startsWith('/')) return null;
  if (!catalog || !Array.isArray(catalog.commandMenu)) return null;

  // Split off the command token (first whitespace-separated chunk).
  const spaceIdx = trimmed.indexOf(' ');
  const command  = spaceIdx === -1 ? trimmed       : trimmed.slice(0, spaceIdx);
  const body     = spaceIdx === -1 ? ''            : trimmed.slice(spaceIdx + 1);

  // Lookup — case-sensitive match (matches Telegram conventions +
  // existing manifests' command declarations).
  const entry = catalog.commandMenu.find((e) => e.command === command);
  if (!entry) return null;

  const bodyRule = entry.body ?? 'match';
  const args     = parseBody(body, bodyRule);

  return {
    kind: 'slash',
    opId:    entry.opId,
    args,
    threadId,
    command,
    body,
  };
}

/**
 * Parse the body string per the rule the manifest declared.
 *
 * @param {string}                          body
 * @param {'match' | 'reject' | 'flags'}    rule
 * @returns {object}
 */
function parseBody(body, rule) {
  const trimmed = body.trim();

  if (rule === 'reject') {
    // Per the manifest, this op accepts NO positional body.  v0.1
    // ignores trailing junk silently; future versions may surface a
    // parse warning.  Empty result.
    return {};
  }

  if (rule === 'flags') {
    return parseFlags(trimmed);
  }

  // rule === 'match' (default).  Body is a single positional value
  // intended for the op's first required param.  v0.1 emits it as
  // `_match` — the router uses paramsSchema to bind the right name.
  if (trimmed === '') return {};
  return { _match: trimmed };
}

/**
 * Parse `--key=value` flags + bare-word positional args.
 * Designed for the J2 path: `/addtask --due=friday "fix back door"`.
 *
 * @param {string} body
 * @returns {object}
 */
function parseFlags(body) {
  const out = {};
  const positional = [];

  // Tokenize on whitespace BUT respect simple double-quoted spans.
  const tokens = tokenize(body);
  for (const tok of tokens) {
    if (tok.startsWith('--')) {
      const eq    = tok.indexOf('=');
      const key   = eq === -1 ? tok.slice(2) : tok.slice(2, eq);
      const value = eq === -1 ? true         : tok.slice(eq + 1);
      out[key] = value;
    } else {
      positional.push(tok);
    }
  }
  if (positional.length > 0) {
    out._match = positional.join(' ');
  }
  return out;
}

/**
 * Tokenize a string respecting double-quoted spans.  Each quote span
 * is one token; bare words split on whitespace.
 *
 * Lightweight v0.1 implementation — does NOT support escapes, single
 * quotes, or nested quotes.  Sufficient for J2-style command bodies.
 *
 * @param {string} s
 * @returns {string[]}
 */
function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && s[i] === ' ') i++;     // skip whitespace
    if (i >= s.length) break;
    if (s[i] === '"') {
      // quoted span
      const end = s.indexOf('"', i + 1);
      if (end === -1) {                            // unterminated → take rest
        out.push(s.slice(i + 1));
        break;
      }
      out.push(s.slice(i + 1, end));
      i = end + 1;
    } else {
      // bare word
      let j = i;
      while (j < s.length && s[j] !== ' ') j++;
      out.push(s.slice(i, j));
      i = j;
    }
  }
  return out;
}

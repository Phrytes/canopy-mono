/**
 * canopy-chat — router.
 *
 * Resolves a `ParseResult` (from `parser.js`) against the merged
 * catalog (from `manifestMerge.js`) and produces a tagged-union
 * `RouteResult`:
 *
 *   { kind: 'ready',        ...dispatchable }       — go ahead, fire
 *   { kind: 'needsForm',    schema, missing, ... }  — required params missing
 *   { kind: 'needsConfirm', severity, message, ... }— Q27 gate triggered
 *   { kind: 'unknown',      text, threadId }        — parser fell through
 *   { kind: 'error',        code, message, ... }    — invalid input
 *
 * Pure function — the renderer / chat-shell driver decides what UX
 * to show for each tag, then calls dispatch when the resolution is
 * `'ready'`.
 *
 * Phase v0.1 sub-slice 1.6 per `/Project Files/canopy-chat/coding-plan.md`.
 */

/**
 * @typedef {object} ReadyDispatch
 * @property {'ready'}         kind
 * @property {string}          opId
 * @property {object}          args
 * @property {string}          appOrigin
 * @property {string|null}     threadId
 * @property {string}          replyShape   effective Q28 shape (declared or default)
 */

/**
 * @typedef {object} NeedsFormDispatch
 * @property {'needsForm'}     kind
 * @property {object[]}        params       op.params verbatim
 * @property {string[]}        missing      names of required params not bound
 * @property {object}          prefilledArgs
 * @property {string}          opId
 * @property {string}          appOrigin
 * @property {string|null}     threadId
 * @property {string}          replyShape
 */

/**
 * @typedef {object} NeedsConfirmDispatch
 * @property {'needsConfirm'}  kind
 * @property {'warn'|'danger'} severity
 * @property {string}          [message]
 * @property {string}          opId
 * @property {object}          args
 * @property {string}          appOrigin
 * @property {string|null}     threadId
 * @property {string}          replyShape
 */

/**
 * @typedef {object} UnknownInput
 * @property {'unknown'}       kind
 * @property {string}          text
 * @property {string|null}     threadId
 */

/**
 * @typedef {object} ErrorInput
 * @property {'error'}         kind
 * @property {string}          code
 * @property {string}          message
 * @property {string|null}     threadId
 */

/**
 * @typedef {ReadyDispatch | NeedsFormDispatch | NeedsConfirmDispatch
 *          | UnknownInput | ErrorInput} RouteResult
 */

/**
 * Resolve a parser result into a route result.
 *
 * @param {import('./parser.js').ParseResult} parseResult
 * @param {import('./manifestMerge.js').MergedCatalog} catalog
 * @returns {RouteResult}
 */
export function resolveDispatch(parseResult, catalog) {
  if (!parseResult || !catalog) {
    throw new TypeError('resolveDispatch: parseResult + catalog required');
  }

  if (parseResult.kind === 'unknown') {
    return {
      kind: 'unknown',
      text:     parseResult.text,
      threadId: parseResult.threadId ?? null,
    };
  }

  if (parseResult.kind !== 'slash') {
    return {
      kind: 'error',
      code: 'unknown-parse-kind',
      message: `unsupported parse kind: ${parseResult.kind}`,
      threadId: parseResult.threadId ?? null,
    };
  }

  const { opId, args: rawArgs, threadId } = parseResult;
  const entry = catalog.opsById.get(opId);
  if (!entry) {
    return {
      kind: 'error',
      code: 'unknown-op',
      message: `unknown opId: ${opId}`,
      threadId: threadId ?? null,
    };
  }
  const { op, appOrigin } = entry;

  // Bind `_match` (positional body from parser) to the op's first
  // required string param.  If no such param exists, drop _match.
  const boundArgs = bindMatchArg(rawArgs ?? {}, op);

  // Find missing required params (excluding any we just bound).
  const missing = findMissingRequired(op.params ?? [], boundArgs);
  const replyShape = effectiveReplyShape(opId, op, catalog);

  if (missing.length > 0) {
    return {
      kind: 'needsForm',
      params:        op.params ?? [],
      missing,
      prefilledArgs: boundArgs,
      opId, appOrigin,
      threadId: threadId ?? null,
      replyShape,
    };
  }

  // Q27 — confirm gate.  Only severity ∈ {warn, danger} triggers a
  // gate.  'info' is informational only; chat shell may show the
  // message but does not block dispatch.
  const confirm = op?.surfaces?.ui?.confirm;
  if (confirm && (confirm.severity === 'warn' || confirm.severity === 'danger')) {
    return {
      kind: 'needsConfirm',
      severity: confirm.severity,
      message:  confirm.message,
      opId,
      args: boundArgs,
      appOrigin,
      threadId: threadId ?? null,
      replyShape,
    };
  }

  return {
    kind: 'ready',
    opId,
    args: boundArgs,
    appOrigin,
    threadId: threadId ?? null,
    replyShape,
  };
}

/**
 * Bind the parser's `_match` positional value to the op's first
 * required string-kind param.  If no `_match`, return args verbatim.
 * If `_match` present but no compatible target, drop it.
 *
 * @param {object}            args
 * @param {object}            op
 * @returns {object}
 */
function bindMatchArg(args, op) {
  if (args._match === undefined) return { ...args };
  const target = (op.params ?? []).find(
    (p) => p?.required && (p.kind === 'string' || p.kind === 'enum'),
  );
  const { _match, ...rest } = args;
  if (!target) return rest;
  // Don't clobber an explicit `--key=value` for the same name.
  if (rest[target.name] !== undefined) return rest;
  return { ...rest, [target.name]: _match };
}

/**
 * Iterate the op's params; return the names of required ones the
 * caller hasn't bound.  Empty string treated as missing (matches
 * existing manifest-validator semantics).
 *
 * @param {object[]}  params
 * @param {object}    boundArgs
 * @returns {string[]}
 */
function findMissingRequired(params, boundArgs) {
  const missing = [];
  for (const p of params) {
    if (!p?.required) continue;
    const v = boundArgs[p.name];
    if (v === undefined || v === null || v === '') {
      missing.push(p.name);
    }
  }
  return missing;
}

/**
 * Compute the effective Q28 reply shape:
 *
 *   1. Declared `surfaces.chat.reply` (looked up via the catalog).
 *   2. Fallback by `op.verb`: 'list' → 'list', others → 'text'.
 *
 * v0.1 ships with only `text` + `list` renderers; later phases
 * (v0.3 mini-pages, v0.5 embeds) extend the default rules without
 * breaking this contract.
 *
 * @param {string}                                          opId
 * @param {object}                                          op
 * @param {import('./manifestMerge.js').MergedCatalog}      catalog
 * @returns {string}
 */
function effectiveReplyShape(opId, op, catalog) {
  const declared = catalog.replyShapeFor?.(opId);
  if (declared) return declared;
  if (op?.verb === 'list') return 'list';
  return 'text';
}

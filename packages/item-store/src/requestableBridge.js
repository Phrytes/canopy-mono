/**
 * requestableBridge — the REQUESTABLE BRIDGE convergence (P4b · journey J6).
 *
 * Design source: `plans/NOTE-skills-vs-capabilities.md` (volleys 2–4) +
 * `plans/PLAN-cluster-verification-journeys.md` J6.
 *
 * ── The one idea ─────────────────────────────────────────────────────────────
 * "A request to a human IS a task." A member's REQUESTABLE offerings (the
 * `requestable` disclosure axis — `agent-registry` `isRequestable(policy,ctx,key)`)
 * are projected as invocable SKILLS carrying `humanInTheLoop:'required'`. When A
 * invokes B's requestable skill (DIRECT member→member over the existing transport;
 * if B is offline the invocation simply fails — no companion, no re-routing), B's
 * side does NOT execute the offering. Instead it CREATES A TASK ("A asks: <offering>")
 * that B can then accept / counter / decline through the ordinary task lifecycle
 * (`claim` → assignee = B). The invocation therefore resolves to a PENDING task
 * reference, never to an action result. That IS the convergence.
 *
 * This mirrors the core capability semantics we build ON (READ-ONLY here):
 *   • `capabilities.js` (`packages/core/src/skills`) already carries per-skill
 *     `posture: 'always'|'negotiable'` + `humanInTheLoop: 'never'|'either'|'required'`.
 *     `humanInTheLoop:'required'` == our `requestable`; `'never'` == `immediate`.
 *   • `taskExchange.js` already has the input-required (IR) round-trip: a skill can
 *     pause and return a pending obligation instead of a result. A requestable
 *     invocation returning `{ created:true, taskId, status:'pending' }` is exactly
 *     that shape — the "result" is a task the caller now waits on.
 *
 * ── The three execution modes (only `required` is built here) ────────────────
 *   • `humanInTheLoop:'required'` (requestable)  → invocation CREATES A TASK.   ← this module
 *   • `humanInTheLoop:'never'`    (immediate)     → device acts on call, no task.
 *   `standing` (a held role-bundle grant) → collapses to immediate: the
 *     holder pre-consented by accepting a role, so the invocation becomes an urgent
 *     OBLIGATION with no fresh consent step. See the STANDING-BYPASS seam below —
 *     it is DELIBERATELY NOT built here.
 *
 * ── What this module is (and is NOT) ─────────────────────────────────────────
 * A small, app-agnostic convergence over the substrate task surface. It does NOT
 * reach up into `agent-registry` (layering: item-store composes core, not sibling
 * substrates). The `requestable` disclosure PREDICATE is INJECTED (see
 * `offeringsToSkillDefinitions`'s `isRequestable` param) so the host wires
 * `agent-registry`'s real `isRequestable` at the app boundary while this stays
 * decoupled + unit-testable.
 *
 * ── TODO seams (follow-on steps, intentionally NOT built in this pass) ────────
 *   1. HOST WIRING — `offeringsToSkillDefinitions` returns skill DEFINITIONS
 *      ({id, humanInTheLoop, posture, handler}); a live host must register each on
 *      the member's `core.Agent` (`agent.register(id, handler, {humanInTheLoop})`)
 *      and route a peer's `callSkill` to it. Auto-projecting a persona's offerings
 *      onto the live agent card is the offering→skill projection (NOTE volley 3) —
 *      not done here.
 *   2. DISCOVERY / ADVERTISEMENT — advertising these skills on the AgentCard +
 *      surfacing them in the roster/request UI is a separate projector.
 *   3. STANDING-BYPASS — a `standing` grant re-advertises the SAME skill in
 *      immediate mode (invocation → obligation, no task/consent step). Building the
 *      grant check that flips a `required` handler to immediate is (J7); this
 *      module only documents the seam (`humanInTheLoop` is a plain field an upstream
 *      grant check may override before dispatch).
 *   4. NEGOTIATION / COUNTER — `posture:'negotiable'` + the core IR round-trip is
 *      the counter-proposal channel (accept / counter / decline). Here we only mint
 *      the task; the accept path is the ordinary `taskStore.claim`. The IR counter
 *      exchange (B answers a caller's counter) rides core `taskExchange` — separate.
 */

/** The task `kind` a requestable invocation mints. */
export const REQUEST_TASK_KIND = 'request';
/** The `source.kind` marker stamped on a request-task (provenance). */
export const REQUEST_SOURCE_KIND = 'requestable-skill';

/**
 * Compose the human request phrase for an offering. Override via `opts.requestText`
 * on the handler factory, or an explicit `requestText` at invocation time.
 * Default prefers a purpose-built `offering.request`, then the offering's own
 * `text`, then its `key` — never empty (the task surface requires non-empty text).
 */
function defaultRequestText(offering = {}, from) {
  const base =
    (typeof offering.request === 'string' && offering.request.trim()) ||
    (typeof offering.text === 'string' && offering.text.trim()) ||
    (typeof offering.key === 'string' && offering.key.trim()) ||
    'request';
  return from ? `${from} asks: ${base}` : base;
}

/**
 * Build a REQUESTABLE skill handler.
 *
 * The returned handler, when invoked (A → B), CREATES A TASK on B's task store
 * carrying the request + the requester, and returns a PENDING task reference. It
 * executes NOTHING — the offering is not run; B decides via the task lifecycle.
 *
 * @param {object}   args
 * @param {object}   args.taskStore   the RECIPIENT's task surface — `createTaskStore`
 *                                    over a `CircleItemStore` (needs `addItems`).
 * @param {object}   args.offering    the offering descriptor being made requestable —
 *                                    a skill-kind driver `{ key, text, tags[] }`.
 * @param {string}   args.recipient   webid of the member who holds the offering (B).
 * @param {string}   [args.from]      DEFAULT requester webid (A). Usually supplied per
 *                                    invocation instead (the A2A caller identity); an
 *                                    invocation-time `from` overrides this.
 * @param {string}   [args.contextId] the circle/context this offering is requestable in
 *                                    (stamped on the task for legibility).
 * @param {'required'} [args.humanInTheLoop='required']  the contract this handler honours.
 *                                    Only `required` is meaningful here — an `immediate`
 *                                    offering would not be projected through this factory,
 *                                    and `standing` is the documented bypass seam (not built).
 * @param {string}   [args.requestText]  a fixed request phrase (else derived per invocation).
 * @param {(offering:object, from:string)=>string} [args.renderRequest]  custom phrase fn.
 * @returns {(invocation?:object)=>Promise<{created:true, taskId:string, status:'pending', task:object}>}
 *          an async skill handler. `invocation` may carry `{ from, requestText, actorDisplayName }`.
 */
export function requestableSkillHandler({
  taskStore,
  offering,
  recipient,
  from: boundFrom,
  contextId,
  humanInTheLoop = 'required',
  requestText: boundRequestText,
  renderRequest,
} = {}) {
  if (!taskStore || typeof taskStore.addItems !== 'function') {
    throw new TypeError('requestableSkillHandler: a taskStore with addItems() is required');
  }
  if (!offering || typeof offering !== 'object') {
    throw new TypeError('requestableSkillHandler: an offering descriptor is required');
  }
  if (typeof recipient !== 'string' || !recipient) {
    throw new TypeError('requestableSkillHandler: recipient (webid) is required');
  }
  // Contract guard: this factory only mints the REQUESTABLE (human-in-the-loop)
  // path. `immediate` offerings never route through here; `standing` is a
  // documented upstream bypass (see the STANDING-BYPASS seam) — not this factory.
  if (humanInTheLoop !== 'required') {
    throw new TypeError(
      `requestableSkillHandler: only humanInTheLoop:'required' is built here (got ${JSON.stringify(humanInTheLoop)}); `
      + `'never' is immediate (device acts) and 'standing' is the documented bypass seam.`,
    );
  }

  return async function handleRequestableInvocation(invocation = {}) {
    // The requester (A) — invocation-time identity wins; else the bound default.
    const from = invocation.from ?? boundFrom;
    if (typeof from !== 'string' || !from) {
      throw new TypeError('requestableSkillHandler: a requester `from` webid is required (bind it or pass invocation.from)');
    }
    const requestText =
      (typeof invocation.requestText === 'string' && invocation.requestText.trim())
        ? invocation.requestText.trim()
        : (typeof boundRequestText === 'string' && boundRequestText.trim())
          ? boundRequestText.trim()
          : (renderRequest ? renderRequest(offering, from) : defaultRequestText(offering, from));

    // CREATE A TASK — do NOT execute the offering. The requester authors the
    // request record; `forMember` directs it at the recipient, who accepts by
    // claiming it (assignee → recipient) through the ordinary lifecycle.
    //
    // Request semantics live under `source` (verbatim-passthrough in
    // taskCrud.materialise) so the generic task CRUD stays uncoupled from the
    // bridge — no bespoke request fields bolted onto the task whitelist.
    const [task] = await taskStore.addItems(
      [{
        text: requestText,
        kind: REQUEST_TASK_KIND,
        source: {
          kind: REQUEST_SOURCE_KIND,
          requestedBy: from,
          forMember: recipient,
          humanInTheLoop,                 // 'required' — the honoured contract
          offering: {
            ...(offering.key  !== undefined ? { key:  offering.key  } : {}),
            ...(offering.text !== undefined ? { text: offering.text } : {}),
            ...(Array.isArray(offering.tags) ? { tags: [...offering.tags] } : {}),
          },
          ...(contextId ? { contextId } : {}),
        },
      }],
      { actor: from, actorDisplayName: invocation.actorDisplayName },
    );

    // The IR round-trip: resolve to a PENDING task reference, not an action result.
    return { created: true, taskId: task.id, status: 'pending', task };
  };
}

/**
 * Project a persona's REQUESTABLE offerings into skill DEFINITIONS.
 *
 * For each offering the member has marked `requestable` in `contextId` (checked via
 * the INJECTED `isRequestable` predicate — the host wires `agent-registry`'s real
 * one), emit a definition `{ id, humanInTheLoop:'required', posture, offering, handler }`
 * whose `handler` is `requestableSkillHandler(...)`. A NON-requestable offering
 * produces NO definition (the guard) — its handler is never minted, so it can never
 * be invoked as a request.
 *
 * The host REGISTERS these on the live agent (`agent.register(id, handler, {humanInTheLoop})`)
 * and routes peer `callSkill`s to them — see the HOST-WIRING TODO seam in the module doc.
 *
 * @param {object} args
 * @param {Array<{key:string, text?:string, tags?:string[]}>} args.offerings  the persona's
 *                 skill-kind offerings (e.g. `driversFromProperties` filtered to kind `skill`).
 * @param {object} args.policy      the member's disclosure policy (opaque to us).
 * @param {string} args.contextId   the circle/context to evaluate `requestable` in.
 * @param {(policy:object, contextId:string, key:string)=>boolean} args.isRequestable
 *                 the requestable-axis predicate (inject `agent-registry`'s `isRequestable`).
 * @param {object} args.taskStore   the recipient's task surface (see the handler factory).
 * @param {string} args.recipient   the member who holds the offerings (B).
 * @param {string} [args.from]      optional default requester (usually per-invocation).
 * @param {'required'} [args.humanInTheLoop='required']
 * @param {string} [args.idPrefix='requestable']  skill-id namespace.
 * @returns {Array<{id:string, humanInTheLoop:'required', posture:'negotiable', offering:object, handler:Function}>}
 */
export function offeringsToSkillDefinitions({
  offerings,
  policy,
  contextId,
  isRequestable,
  taskStore,
  recipient,
  from,
  humanInTheLoop = 'required',
  idPrefix = 'requestable',
} = {}) {
  if (typeof isRequestable !== 'function') {
    throw new TypeError('offeringsToSkillDefinitions: an isRequestable(policy, contextId, key) predicate is required');
  }
  if (typeof contextId !== 'string' || !contextId) {
    throw new TypeError('offeringsToSkillDefinitions: contextId is required');
  }
  const list = Array.isArray(offerings) ? offerings : [];
  const defs = [];
  for (const offering of list) {
    const key = offering?.key;
    if (typeof key !== 'string' || !key) continue;
    // THE GUARD — a non-requestable offering yields no handler (never invocable).
    if (!isRequestable(policy, contextId, key)) continue;
    defs.push({
      id: `${idPrefix}:${key}`,
      humanInTheLoop,                 // 'required' — mode-on-the-skill (NOTE volley 3)
      posture: 'negotiable',          // enables the IR counter channel (NOTE volley 4); seam #4
      offering,
      handler: requestableSkillHandler({ taskStore, offering, recipient, from, contextId, humanInTheLoop }),
    });
  }
  return defs;
}

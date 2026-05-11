/**
 * defineProtocol — pure declarative state-machine definition.
 *
 * A protocol is a state machine over items. State persists as a
 * protocol-instance resource on the pseudo-pod; transitions are
 * driven by events the orchestrator routes through the matching
 * transition handler.
 *
 * Standardisation Phase 52.13.2.
 *
 * @typedef {object} TransitionDef
 * @property {string} from               — source state name
 * @property {string} event              — event tag that triggers this transition
 * @property {string} to                 — target state name
 * @property {(context: object, payload?: object) => object | Promise<object>} [reducer]
 *   — optional pure (or async) function returning the next context.
 *   Receives the current context + the event payload; returns the
 *   merged-or-replaced context for the new state. If absent, the
 *   context carries over unchanged.
 * @property {(context: object, payload?: object) => boolean} [guard]
 *   — optional pre-condition. When supplied + returns false, the
 *   transition is rejected without state change.
 *
 * @typedef {object} ProtocolDef
 * @property {string}       id            — globally unique protocol id
 * @property {string}       name          — human-readable name
 * @property {string}       initial       — initial state name
 * @property {string[]}     states        — state-name vocabulary
 * @property {TransitionDef[]} transitions
 * @property {(context: object) => boolean} [validators.initial]
 *   — optional sanity check on the initial context at `start`.
 */

const VALID_KEYS = ['id', 'name', 'initial', 'states', 'transitions', 'validators'];

/**
 * Validate + freeze a protocol definition.
 *
 * @param {ProtocolDef} def
 * @returns {ProtocolDef}
 */
export function defineProtocol(def) {
  if (!def || typeof def !== 'object') {
    throw Object.assign(
      new Error('defineProtocol: definition object required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (typeof def.id !== 'string' || def.id.length === 0) {
    throw Object.assign(
      new Error('defineProtocol: `id` is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (typeof def.initial !== 'string' || def.initial.length === 0) {
    throw Object.assign(
      new Error('defineProtocol: `initial` state is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (!Array.isArray(def.states) || def.states.length === 0) {
    throw Object.assign(
      new Error('defineProtocol: `states` (non-empty array) is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (!def.states.includes(def.initial)) {
    throw Object.assign(
      new Error(`defineProtocol: \`initial\` "${def.initial}" not in states`),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  if (!Array.isArray(def.transitions)) {
    throw Object.assign(
      new Error('defineProtocol: `transitions` (array) is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  const stateSet = new Set(def.states);
  for (const t of def.transitions) {
    if (!t || typeof t !== 'object') {
      throw Object.assign(
        new Error('defineProtocol: transition entries must be objects'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (!stateSet.has(t.from)) {
      throw Object.assign(
        new Error(`defineProtocol: transition.from "${t.from}" not in states`),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (!stateSet.has(t.to)) {
      throw Object.assign(
        new Error(`defineProtocol: transition.to "${t.to}" not in states`),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    if (typeof t.event !== 'string' || t.event.length === 0) {
      throw Object.assign(
        new Error('defineProtocol: transition.event is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
  }
  for (const k of Object.keys(def)) {
    if (!VALID_KEYS.includes(k)) {
      throw Object.assign(
        new Error(`defineProtocol: unknown key "${k}"`),
        { code: 'INVALID_ARGUMENT' },
      );
    }
  }
  return Object.freeze({
    id:          def.id,
    name:        def.name ?? def.id,
    initial:     def.initial,
    states:      Object.freeze([...def.states]),
    transitions: Object.freeze(def.transitions.map(t => Object.freeze({ ...t }))),
    validators:  Object.freeze({ ...(def.validators ?? {}) }),
  });
}

/**
 * Helper — find the matching transition for (state, event).
 * Returns the first match (definitions are scanned in order; declare
 * more-specific guards first if ambiguity is possible).
 */
export function findTransition(protocolDef, state, event) {
  if (!protocolDef) return null;
  for (const t of protocolDef.transitions) {
    if (t.from === state && t.event === event) return t;
  }
  return null;
}

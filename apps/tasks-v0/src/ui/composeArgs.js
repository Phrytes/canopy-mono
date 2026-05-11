/**
 * composeArgs — pure-fn helpers that translate compose-form state
 * into the args expected by `addTask` / `forceSpawnSubtask`.
 *
 * Phase 41.18.1 (2026-05-10) — keeps the form thin + lets us
 * unit-test the field-shaping rules without React.
 *
 * Lifted 2026-05-10 from `apps/tasks-mobile/src/lib/composeArgs.js`
 * into `apps/tasks-v0/src/ui/` per the
 * "Shared UI-glue helpers between platform shells" rule
 * (`Project Files/conventions/architectural-layering.md`).
 *
 * Both shells consume from here:
 *   - `apps/tasks-mobile/src/screens/ComposeScreen.jsx`  (RN form)
 *   - `apps/tasks-v0/web/app.js`                         (web prompts)
 *
 * Pure-fn only — must not import from `react-native`, DOM globals,
 * or any platform module.
 */

/**
 * @typedef {object} ComposeForm
 * @property {string}            text             required
 * @property {string|null}       [dueAt]          'YYYY-MM-DD' or null
 * @property {string[]|string}   [requiredSkills] array OR comma-sep string
 * @property {'text'|'photo'}    [dod]            'text' (default) | 'photo'
 * @property {string[]}          [dependencies]   open-task ids
 * @property {string|null}       [master]         webid (defaults to caller)
 * @property {'auto'|'approval'|'dual-approval'|null} [approvalMode]
 * @property {string|null}       [parentTaskId]   sub-task shortcut
 * @property {string|null}       [reason]         force-spawn requires this
 */

/**
 * Build the `addTask` skill args payload from the form state.
 *
 * @param {ComposeForm} form
 * @returns {object}    addTask args (omit-undefined; only includes
 *                      fields the user actually set)
 */
export function buildAddTaskArgs(form = {}) {
  const out = {};
  out.text = (form.text ?? '').trim();
  if (!out.text) {
    throw new Error('composeArgs: text is required');
  }

  const dueMs = parseDueAt(form.dueAt);
  if (dueMs != null) out.dueAt = dueMs;

  const skills = normaliseSkills(form.requiredSkills);
  if (skills.length > 0) out.requiredSkills = skills;

  const dod = form.dod === 'photo' ? 'photo' : 'text';
  out.definitionOfDone = { kind: dod };

  const deps = normaliseDeps(form.dependencies);
  if (deps.length > 0) out.dependencies = deps;

  if (typeof form.master === 'string' && form.master.trim()) {
    out.master = form.master.trim();
  }

  if (form.approvalMode && APPROVAL_MODES.has(form.approvalMode)) {
    out.approval = form.approvalMode;
  }

  if (typeof form.parentTaskId === 'string' && form.parentTaskId.trim()) {
    out.parentTaskId = form.parentTaskId.trim();
  }

  return out;
}

/**
 * Build the `addSubtask` (or `proposeSubtask`) skill args payload.
 * Mirrors the desktop web app's `onAddSubtask` callback in
 * `apps/tasks-v0/web/index.html`.
 *
 * Distinct from `buildAddTaskArgs` in two ways:
 *   - `parentTaskId` is REQUIRED and goes flat (not on a partial).
 *   - `dependencies[]` is REJECTED — the substrate auto-wires the
 *     parent's `dependencies[]` to include the new sub-task's id.
 *     Letting Compose pass child-deps would silently desync the
 *     V2.7 hard-deps gate.
 *
 * Both `addSubtask` and `proposeSubtask` accept the same shape, so
 * the caller picks the skill based on `shouldProposeSubtask(parent,
 * actor)`.
 *
 * @param {ComposeForm & {parentTaskId: string}} form
 * @returns {object}
 */
export function buildAddSubtaskArgs(form = {}) {
  const text = (form.text ?? '').trim();
  if (!text) throw new Error('composeArgs: text is required');
  const parentTaskId = typeof form.parentTaskId === 'string' ? form.parentTaskId.trim() : '';
  if (!parentTaskId) throw new Error('composeArgs: parentTaskId is required for sub-task');

  const args = { text, parentTaskId };

  const dueMs = parseDueAt(form.dueAt);
  if (dueMs != null) args.dueAt = dueMs;

  const skills = normaliseSkills(form.requiredSkills);
  if (skills.length > 0) args.requiredSkills = skills;

  const dod = form.dod === 'photo' ? 'photo' : 'text';
  args.definitionOfDone = { kind: dod };

  if (typeof form.master === 'string' && form.master.trim()) {
    args.master = form.master.trim();
  }

  if (form.approvalMode && APPROVAL_MODES.has(form.approvalMode)) {
    args.approval = form.approvalMode;
  }

  // Intentionally NOT forwarding `dependencies` — the substrate
  // auto-wires `parent.dependencies[]`; passing child-deps here
  // would desync V2.7's hard-deps gate.
  return args;
}

/**
 * Build the `forceSpawnSubtask` skill args payload. Distinct from
 * `addTask` because it requires `parentTaskId` + `reason`, and the
 * skill takes the partial fields flat (no `definitionOfDone` wrapper
 * difference, but the wire shape is the same).
 *
 * @param {ComposeForm} form
 * @returns {object}
 */
export function buildForceSpawnArgs(form = {}) {
  const text = (form.text ?? '').trim();
  if (!text) throw new Error('composeArgs: text is required');
  const parentTaskId = typeof form.parentTaskId === 'string' ? form.parentTaskId.trim() : '';
  if (!parentTaskId) throw new Error('composeArgs: parentTaskId is required for force-spawn');
  const reason = typeof form.reason === 'string' ? form.reason.trim() : '';
  if (!reason) throw new Error('composeArgs: reason is required for force-spawn');

  const args = { text, parentTaskId, reason };

  const dueMs = parseDueAt(form.dueAt);
  if (dueMs != null) args.dueAt = dueMs;

  const skills = normaliseSkills(form.requiredSkills);
  if (skills.length > 0) args.requiredSkills = skills;

  const dod = form.dod === 'photo' ? 'photo' : 'text';
  args.definitionOfDone = { kind: dod };

  if (typeof form.master === 'string' && form.master.trim()) {
    args.master = form.master.trim();
  }

  if (form.approvalMode && APPROVAL_MODES.has(form.approvalMode)) {
    args.approval = form.approvalMode;
  }

  return args;
}

/**
 * Parse `YYYY-MM-DD` into epoch-ms (UTC). Returns null when the
 * input is empty or not in the YYYY-MM-DD shape. Mirrors the
 * `_parseDueAt` that previously lived inline in ComposeScreen.jsx.
 */
export function parseDueAt(s) {
  if (typeof s !== 'string' || !s.trim()) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  if (!Number.isFinite(ms)) return null;
  return ms;
}

/**
 * Normalise a skills value into an array. Accepts:
 *   - undefined / null / ''  → []
 *   - string                 → split on commas, trim, drop empties
 *   - string[]               → trimmed copy, dropping empties
 */
export function normaliseSkills(input) {
  if (input == null) return [];
  if (Array.isArray(input)) {
    return input
      .filter((s) => typeof s === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (typeof input !== 'string') return [];
  return input.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Normalise a dependencies array — drops non-strings + empties +
 * dedupes. The substrate-side `addTask` rejects with
 * `code: 'DEPENDENCY_CYCLE'` if the IDs would form a cycle; we
 * don't pre-check here because we don't have the open-set available.
 */
export function normaliseDeps(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const id of input) {
    if (typeof id !== 'string') continue;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

const APPROVAL_MODES = new Set(['auto', 'approval', 'dual-approval', 'self-mark']);

export const _internal = { APPROVAL_MODES };

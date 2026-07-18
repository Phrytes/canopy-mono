/**
 * taskLifecycle — the task lifecycle VERBS as FUNCTIONS-OVER-CircleItemStore.
 *
 * PLAN-capabilities-tasks-roles P1 keystone (Option A, DECIDED 2026-07-18).
 *
 * `CircleItemStore` is the canonical, deliberately-minimal per-circle store
 * (generic typed CRUD + a type index + a CAS write path). The task lifecycle —
 * `claim` / `reassign` / `markComplete` / `submit` / `approve` / `reject` /
 * `revoke` — that `ItemStore` baked into the class lives HERE as pure functions
 * over the thin store, exactly the "type-specific lifecycle lives in functions
 * over this store, not baked in here" philosophy in the CircleItemStore header.
 *
 * These functions are a behavioural PARITY port of `ItemStore`'s verbs. The one
 * real design difference is the concurrency model (the plan's "★ ARCHITECTURAL
 * CHOICE"):
 *   - AUTHORITATIVE ops that must be winner-take-all — `claim`, `reassign`,
 *     `approve` — go through `store.putIfMatch` (the DataSource-level etag CAS,
 *     the SAME mechanism `ItemStore.#casWriteOrConflict` uses). A racing second
 *     writer is REJECTED, not causally merged. `putIfMatch` returns
 *     `{ error:'conflict', current }` on a precondition failure; `claim` re-maps
 *     that to `ItemStore`'s `{ error:'already-claimed', current }` contract.
 *   - CONTENT / status ops — `markComplete`, `submit`, `reject`, `revoke` — go
 *     through `store.put` (the causal path). These mirror `ItemStore`'s LWW
 *     body/completion merge.
 *
 * ── Injected context (`ctx`) ────────────────────────────────────────────────
 * `ItemStore` carried `rolePolicy` + `enforceDependencies` as constructor state
 * and audited/emitted internally. These functions are stateless, so those move
 * into `ctx`:
 *   - `ctx.actor`               (required) webid performing the action.
 *   - `ctx.actorDisplayName`    optional display snapshot (parity with ItemStore).
 *   - `ctx.rolePolicy`          the `RolePolicy` gate (default: no-op = allow).
 *   - `ctx.enforceDependencies` V2.7 DAG gate on close-transitions (default false).
 *   - `ctx.actionOverride`      force-complete admin path (bypasses the DAG gate).
 *   - `ctx.reason`              optional reason (parity; surfaced to `ctx.emit`).
 *   - `ctx.expectedEtag`        optional base etag the caller read — threaded to
 *                               `putIfMatch` for the genuine winner-take-all race.
 *   - `ctx.emit`                optional `(eventName, payload) => void` — the
 *                               EVENT SEAM (see below).
 *
 * ── Event seam ──────────────────────────────────────────────────────────────
 * `ItemStore extends Emitter` and emits `item-claimed` / `item-completed` / … .
 * `CircleItemStore` is not an emitter; its propagation seam is the publish-on-
 * write SYNC HOOK (`setSyncHook` → `publishItem`) that `put`/`putIfMatch` already
 * fire. So a successful lifecycle write fans out through that hook automatically
 * (no extra wiring). For consumers that want the RICH, per-verb named events
 * ItemStore emitted (`item-claimed` vs `item-completed` vs …), pass `ctx.emit`
 * and these functions call it with the same event names — mirroring ItemStore.
 *
 * ── NOT audited ─────────────────────────────────────────────────────────────
 * `ItemStore` also appends an append-only audit entry per verb under
 * `<root>/audit/`. `CircleItemStore` does NOT model an audit log, and this module
 * only has the store's public surface (no raw DataSource access). Audit parity is
 * a SEPARATE seam — see the TODO block at the bottom.
 */

import { computeStatus } from './ItemStore.js';   // pure, shared status fn (reused, not reimplemented)
import {
  ItemNotFoundError,
  PermissionDeniedError,
  InvalidLifecycleError,
  MissingArgumentError,
  DependenciesOpenError,
} from './errors.js';

// ── ctx helpers ──────────────────────────────────────────────────────────────

function requireActor(ctx) {
  if (!ctx || typeof ctx.actor !== 'string' || ctx.actor.length === 0) {
    throw new TypeError('taskLifecycle: ctx.actor (webid) is required');
  }
  return ctx.actor;
}

/**
 * Role-policy gate — parity with `ItemStore#gate`. `ctx.rolePolicy` is the same
 * `RolePolicy` shape ItemStore's constructor took (a bag of `can*` predicates);
 * a missing policy or missing predicate = allow (the no-op default). `false`
 * becomes a thrown `PermissionDeniedError`.
 */
function gate(policy, method, actor, item, patch) {
  if (!policy) return;
  const fn = policy[method];
  if (typeof fn !== 'function') return;
  if (!fn(actor, item, patch)) {
    throw new PermissionDeniedError({
      action: method.replace(/^can/, '').toLowerCase(),
      actor,
      itemId: item?.id,
    });
  }
}

/** Fire the optional per-verb named event (the ItemStore-parity seam). */
function emit(ctx, eventName, payload) {
  if (ctx && typeof ctx.emit === 'function') ctx.emit(eventName, payload);
}

/**
 * V2.7 DAG gate — parity with `ItemStore._assertDepsClosed`. Walk
 * `item.dependencies[]`, read each, and throw `DependenciesOpenError` if any is
 * open (present + uncompleted). Removed-or-missing deps are treated as satisfied
 * (don't block forever). `dependencies[]` is the DAG completion gate ONLY;
 * structural subtask nesting is the separate K2-containment migration (below).
 */
async function assertDepsClosed(store, item) {
  const deps = Array.isArray(item?.dependencies) ? item.dependencies : [];
  if (deps.length === 0) return;
  const open = [];
  for (const depId of deps) {
    if (typeof depId !== 'string' || !depId) continue;
    const dep = await store.get(depId);
    if (!dep) continue;                    // missing → treat as satisfied
    if (!dep.completedAt) open.push(depId);
  }
  if (open.length > 0) {
    throw new DependenciesOpenError({ itemId: item.id, openDeps: open });
  }
}

/** Resolve a markComplete/removeItems ref. Explicit id (`{id}` or a bare
 * string) only. Fuzzy-text resolution (`{match}`) was an ItemStore convenience
 * for conversational refs; in the dissolve model the interface projector
 * resolves text → id BEFORE dispatch, so args carry a resolved id. See TODO. */
async function resolveById(store, ref) {
  const id = typeof ref === 'string' ? ref : ref?.id;
  if (typeof id !== 'string' || !id) return { id: null, item: null, explicit: false };
  return { id, item: await store.get(id), explicit: true };
}

// ── Lifecycle verbs ──────────────────────────────────────────────────────────

/**
 * Claim a task — AUTHORITATIVE, race-safe single-winner (the whole point of
 * Option A). Reads current; rejects if completed (`InvalidLifecycleError`) or
 * already assigned (`{error:'already-claimed', current}` — parity); gates
 * `canClaim`; then writes via `store.putIfMatch` so a racing second writer that
 * read the same unassigned base loses the CAS. `putIfMatch`'s
 * `{error:'conflict', current}` is re-mapped to ItemStore's
 * `{error:'already-claimed', current}`.
 *
 * @param {import('./CircleItemStore.js').CircleItemStore} store
 * @param {string} id
 * @param {object} ctx  see module doc (`actor` required; `rolePolicy`,
 *   `expectedEtag`, `emit` optional).
 * @returns {Promise<object | {error:'already-claimed', current: object|null}>}
 */
export async function claim(store, id, ctx = {}) {
  const actor = requireActor(ctx);
  const current = await store.get(id);
  if (!current) throw new ItemNotFoundError(id);
  if (current.completedAt) {
    throw new InvalidLifecycleError({ itemId: id, currentState: 'completed', attemptedAction: 'claim' });
  }
  if (current.assignee) {
    return { error: 'already-claimed', current };
  }
  gate(ctx.rolePolicy, 'canClaim', actor, current);

  const at = Date.now();
  const updated = { ...current, assignee: actor, claimedAt: at };
  const res = await store.putIfMatch(updated, { by: actor, expectedEtag: ctx.expectedEtag });
  // CAS conflict → someone else claimed between our read and our write. Re-map
  // to ItemStore's contract; `res.current` is the re-read winner.
  if (res && res.error === 'conflict') {
    return { error: 'already-claimed', current: res.current ?? current };
  }
  emit(ctx, 'item-claimed', res);
  return res;
}

/**
 * Reassign a task — AUTHORITATIVE (CAS). Parity with `ItemStore.reassign`:
 * forbids reassigning a completed item; gates `canReassign`; sets
 * `assignee`+`claimedAt` (or clears both when `newAssignee` is falsy — release);
 * records `claimBase` (the superseded assignee) for the substrate mirror's
 * causal-vs-concurrent disambiguation. Emits `item-claimed` on assign,
 * `item-updated` on release. A CAS conflict is surfaced as
 * `{error:'conflict', current}` (authoritative op — the caller retries against
 * the fresh state rather than silently clobbering).
 *
 * @returns {Promise<object | {error:'conflict', current: object|null}>}
 */
export async function reassign(store, id, newAssignee, ctx = {}) {
  const actor = requireActor(ctx);
  const current = await store.get(id);
  if (!current) throw new ItemNotFoundError(id);
  if (current.completedAt) {
    throw new InvalidLifecycleError({ itemId: id, currentState: 'completed', attemptedAction: 'reassign' });
  }
  gate(ctx.rolePolicy, 'canReassign', actor, current);

  const at = Date.now();
  const updated = { ...current, claimBase: current.assignee ?? null };
  if (newAssignee) {
    updated.assignee = newAssignee;
    updated.claimedAt = at;
  } else {
    delete updated.assignee;
    delete updated.claimedAt;
  }
  const res = await store.putIfMatch(updated, { by: actor, expectedEtag: ctx.expectedEtag });
  if (res && res.error === 'conflict') return res;
  emit(ctx, newAssignee ? 'item-claimed' : 'item-updated', res);
  return res;
}

/**
 * Mark items complete — CONTENT op (causal `put`, LWW completion, parity with
 * `ItemStore.markComplete`). For each ref: not-found + explicit → throw
 * `ItemNotFoundError`; already-completed + explicit → `InvalidLifecycleError`;
 * gate `canComplete`; V2.7 DAG gate (`assertDepsClosed`) unless
 * `ctx.actionOverride`; stamp `completedAt`/`completedBy`; write; emit
 * `item-completed`.
 *
 * @param {import('./CircleItemStore.js').CircleItemStore} store
 * @param {Array<{id?:string}|string>} refs  explicit id refs (see `resolveById`)
 * @param {object} ctx
 * @returns {Promise<object[]>} the completed items
 */
export async function markComplete(store, refs, ctx = {}) {
  if (!Array.isArray(refs) || refs.length === 0) return [];
  const actor = requireActor(ctx);
  const completed = [];
  for (const ref of refs) {
    const { id, item, explicit } = await resolveById(store, ref);
    if (!item) {
      if (explicit) throw new ItemNotFoundError(id);
      continue;
    }
    if (item.completedAt) {
      if (explicit) {
        throw new InvalidLifecycleError({ itemId: id, currentState: 'completed', attemptedAction: 'complete' });
      }
      continue;
    }
    gate(ctx.rolePolicy, 'canComplete', actor, item);
    if (ctx.enforceDependencies && !ctx.actionOverride) {
      await assertDepsClosed(store, item);
    }
    const at = Date.now();
    const updated = {
      ...item,
      completedAt: at,
      completedBy: actor,
      ...(ctx.actorDisplayName ? { completedByDisplayName: ctx.actorDisplayName } : {}),
    };
    const res = await store.put(updated, { by: actor });
    completed.push(res);
    emit(ctx, 'item-completed', res);
  }
  return completed;
}

/**
 * Submit a claimed item for approval — CONTENT op. Parity with
 * `ItemStore.submit`: allowed from `claimed` / `submitted` (re-submit) /
 * `rejected` (re-work); gate `canSubmit`; append a `submit` reviewLog entry;
 * carry the optional deliverable (stamped `submittedAt`). Emits `item-submitted`.
 */
export async function submit(store, id, args, ctx = {}) {
  const actor = requireActor(ctx);
  const current = await store.get(id);
  if (!current) throw new ItemNotFoundError(id);
  if (current.completedAt) {
    throw new InvalidLifecycleError({ itemId: id, currentState: 'completed', attemptedAction: 'submit' });
  }
  const status = computeStatus(current);
  if (status !== 'claimed' && status !== 'submitted' && status !== 'rejected') {
    throw new InvalidLifecycleError({ itemId: id, currentState: status, attemptedAction: 'submit' });
  }
  gate(ctx.rolePolicy, 'canSubmit', actor, current);

  const at = Date.now();
  const reviewLog = appendReview(current.reviewLog, { at, by: actor, decision: 'submit', note: args?.note });
  const deliverable = args?.deliverable ? { ...args.deliverable, submittedAt: at } : current.deliverable;
  const updated = {
    ...current,
    reviewLog,
    ...(deliverable ? { deliverable } : {}),
  };
  const res = await store.put(updated, { by: actor });
  emit(ctx, 'item-submitted', res);
  return res;
}

/**
 * Approve a submitted item — AUTHORITATIVE (CAS; the sign-off is winner-take-all).
 * Parity with `ItemStore.approve`: requires `submitted`; gate `canApprove`; V2.7
 * DAG gate unless `ctx.actionOverride`; append an `approve` reviewLog entry;
 * stamp `completedAt`/`completedBy`. Emits `item-completed`. A CAS conflict is
 * surfaced as `{error:'conflict', current}`.
 *
 * @returns {Promise<object | {error:'conflict', current: object|null}>}
 */
export async function approve(store, id, args, ctx = {}) {
  const actor = requireActor(ctx);
  const current = await store.get(id);
  if (!current) throw new ItemNotFoundError(id);
  if (current.completedAt) {
    throw new InvalidLifecycleError({ itemId: id, currentState: 'completed', attemptedAction: 'approve' });
  }
  const status = computeStatus(current);
  if (status !== 'submitted') {
    throw new InvalidLifecycleError({ itemId: id, currentState: status, attemptedAction: 'approve' });
  }
  gate(ctx.rolePolicy, 'canApprove', actor, current);
  if (ctx.enforceDependencies && !ctx.actionOverride) {
    await assertDepsClosed(store, current);
  }

  const at = Date.now();
  const reviewLog = appendReview(current.reviewLog, { at, by: actor, decision: 'approve', note: args?.note });
  const updated = {
    ...current,
    reviewLog,
    completedAt: at,
    completedBy: actor,
    ...(ctx.actorDisplayName ? { completedByDisplayName: ctx.actorDisplayName } : {}),
  };
  const res = await store.putIfMatch(updated, { by: actor, expectedEtag: ctx.expectedEtag });
  if (res && res.error === 'conflict') return res;
  emit(ctx, 'item-completed', res);
  return res;
}

/**
 * Reject a submitted item — CONTENT op. Parity with `ItemStore.reject`:
 * mandatory `args.note` (`MissingArgumentError`); requires `submitted`; gate
 * `canReject`; append a `reject` reviewLog entry (→ `computeStatus` reports
 * `rejected`, distinct from `claimed`). Emits `item-rejected`.
 */
export async function reject(store, id, args, ctx = {}) {
  const actor = requireActor(ctx);
  if (!args?.note || typeof args.note !== 'string' || !args.note.trim()) {
    throw new MissingArgumentError({ itemId: id, action: 'reject', argument: 'note' });
  }
  const current = await store.get(id);
  if (!current) throw new ItemNotFoundError(id);
  if (current.completedAt) {
    throw new InvalidLifecycleError({ itemId: id, currentState: 'completed', attemptedAction: 'reject' });
  }
  const status = computeStatus(current);
  if (status !== 'submitted') {
    throw new InvalidLifecycleError({ itemId: id, currentState: status, attemptedAction: 'reject' });
  }
  gate(ctx.rolePolicy, 'canReject', actor, current);

  const at = Date.now();
  const reviewLog = appendReview(current.reviewLog, { at, by: actor, decision: 'reject', note: args.note });
  const res = await store.put({ ...current, reviewLog }, { by: actor });
  emit(ctx, 'item-rejected', res);
  return res;
}

/**
 * Revoke the assignee — CONTENT op. Parity with `ItemStore.revoke`: mandatory
 * `args.reason` (`MissingArgumentError`); forbids on completed / unassigned
 * (`InvalidLifecycleError`); gate `canRevoke`; append a `revoke` reviewLog entry
 * (→ `computeStatus` returns `open`); clear `assignee`+`claimedAt`; `master`
 * preserved. Emits `item-revoked` with `{item, previousAssignee, reason}`.
 */
export async function revoke(store, id, args, ctx = {}) {
  const actor = requireActor(ctx);
  if (!args?.reason || typeof args.reason !== 'string' || !args.reason.trim()) {
    throw new MissingArgumentError({ itemId: id, action: 'revoke', argument: 'reason' });
  }
  const current = await store.get(id);
  if (!current) throw new ItemNotFoundError(id);
  if (current.completedAt) {
    throw new InvalidLifecycleError({ itemId: id, currentState: 'completed', attemptedAction: 'revoke' });
  }
  if (!current.assignee) {
    throw new InvalidLifecycleError({ itemId: id, currentState: 'open', attemptedAction: 'revoke' });
  }
  gate(ctx.rolePolicy, 'canRevoke', actor, current);

  const at = Date.now();
  const previousAssignee = current.assignee;
  const reviewLog = appendReview(current.reviewLog, { at, by: actor, decision: 'revoke', note: args.reason });
  const updated = { ...current, reviewLog };
  delete updated.assignee;
  delete updated.claimedAt;
  const res = await store.put(updated, { by: actor });
  emit(ctx, 'item-revoked', { item: res, previousAssignee, reason: args.reason });
  return res;
}

// Re-export the pure lifecycle status fn so consumers can `import { computeStatus }
// from '.../taskLifecycle.js'` alongside the verbs. (The DAG-aware status —
// ready/waiting/blocked, "waiting until subtasks/deps complete" — is
// `computeDagStatus` in `dag.js`; this is the substrate lifecycle status.)
export { computeStatus };

// ── Module-private helpers (parity with ItemStore's) ─────────────────────────

/** Append-only reviewLog writer — returns a NEW array (parity with `_appendReview`). */
function appendReview(prev, entry) {
  const arr = Array.isArray(prev) ? [...prev] : [];
  arr.push(entry);
  return arr;
}

/*
 * ── TODO seams — LATER P1 steps (deliberately NOT done here) ─────────────────
 *
 * 1. parentTaskId → K2 containment migration.
 *    `dependencies[]` is kept as the DAG completion gate ONLY (above). The
 *    structural parent/child ("is a subtask of") currently ridden on tasks-v0's
 *    immutable `parentTaskId` must move onto K2 containment (`contain` /
 *    `containedBy`, see `containment.js` / `containerOps.js`; `treeOf` already
 *    renders deps + containment as one tree). CAVEAT (from the P0-SPIKE VERDICT):
 *    `parentTaskId` is load-bearing for authz (spawn perms, master inheritance,
 *    depth-approval) — migrate carefully, not a field swap. These verbs read no
 *    `parentTaskId`; wire the containment-aware spawn/authz here when that step
 *    lands.
 *
 * 2. Consumer migration (tasks-v0 → these functions).
 *    `apps/tasks-v0` (+ stoop/household/presence-v0/tasks-mobile) still call
 *    `ItemStore`'s methods. Swapping them to `import { claim, … } from
 *    '@onderling/item-store'` over a `CircleItemStore` is the SEPARATE next step.
 *    Do NOT edit those apps or `ItemStore.js` in this pass — this module only
 *    establishes the canonical functions + proves parity.
 *
 * 3. Audit-log parity.
 *    `ItemStore` appends an append-only `<root>/audit/<id>.json` entry per verb.
 *    `CircleItemStore` models no audit log and these functions only touch its
 *    public surface. When the audit seam is designed for the per-circle store,
 *    thread the same `{action, actor, at, details}` entries from these verbs
 *    (the `ctx.reason` / display-name fields are already carried for it).
 *
 * 4. Event seam.
 *    Successful writes fan out via CircleItemStore's `setSyncHook` (publish-on-
 *    write) automatically. For ItemStore-parity NAMED events, pass `ctx.emit`
 *    (wired above). A consumer wanting the old `Emitter` surface can adapt
 *    `ctx.emit` → `store`-level events at the app boundary.
 */

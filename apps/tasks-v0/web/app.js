/**
 * Tasks V1 web UI client — speaks A2A's wire shape directly via fetch().
 *
 * Surface:
 *   - Status pills + V2.7 deps gate use `describeTaskStatus` from
 *     `../src/ui/taskStatus.js` (shared with the mobile shell per
 *     `Project Files/conventions/architectural-layering.md` §
 *     "Shared UI-glue helpers between platform shells"). The skill
 *     returns `item.status` (effective: lifecycle ∪ DAG) and
 *     `item.openDeps[]` (unmet dep IDs); the helper unifies both
 *     into a `{kind, depsBlocked, canClose, openDepIds, …}` shape.
 *   - Role-aware controls: claim/complete/submit/approve/reject/revoke/
 *     reassign/remove.
 *   - Sub-task hint: tasks with `parentTaskId` show a small label.
 *   - Inbox badge is mounted in nav by `mountInboxBadge`.
 */

import {
  describeTaskStatus,
  shouldOfferForceComplete,
} from '../src/ui/taskStatus.js';
// Slice B.2.0 (2026-05-20) — callSkill moved to @canopy/web-adapter
// (shared with apps/household/web/main.js). The previous inline copy
// was duplicated verbatim here AND in apps/household/web/main.js.
// Overlay served by `bin/tasks-ui.js` at `/lib/web-adapter/callSkill.js`.
import { callSkill as _callSkill } from '/lib/web-adapter/callSkill.js';

/**
 * Call a skill via A2A's POST /tasks/send.
 *
 * Same-origin shim pinning baseUrl=''. The shared web-adapter helper
 * is baseUrl-parameterised so a future cross-origin tool can dispatch
 * into a remote agent; the in-tree pages always call same-origin.
 *
 * @param {string} skillId
 * @param {object} args
 * @returns {Promise<object>}   data of the first DataPart in the response
 */
export async function callSkill(skillId, args = {}) {
  return _callSkill('', skillId, args);
}

/** Read the configured local actor from the agent card. */
export async function getActor() {
  try {
    const res = await fetch('/.well-known/agent.json');
    const card = await res.json();
    return card.url ?? card.name ?? 'this agent';
  } catch {
    return 'this agent';
  }
}

/** Read tasks-config.json for {actor, roles, crew?}. */
export async function getConfig() {
  try {
    const res = await fetch('/tasks-config.json');
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

/**
 * Lifecycle status — kept exported for back-compat with any external
 * consumer; the canonical shape now comes from
 * `describeTaskStatus(item).kind` in `../src/ui/taskStatus.js`.
 */
export function lifecycleStatus(item) {
  if (!item) return 'open';
  if (item.completedAt) return 'complete';
  const log = Array.isArray(item.reviewLog) ? item.reviewLog : [];
  const last = log[log.length - 1]?.decision ?? null;
  if (last === 'submit') return 'submitted';
  if (last === 'reject') return 'rejected';
  if (item.assignee)    return 'claimed';
  return 'open';
}

/**
 * Render the task list. Each task shows pill + DoD/sub-task hints +
 * role-appropriate action buttons.
 *
 * @param {HTMLElement} ul
 * @param {Array<object>} items
 * @param {{me, role, onClaim, onComplete, onSubmit, onApprove, onReject,
 *          onRevoke, onReassign, onRemove, onAddSubtask}} ctx
 */
export function renderTasks(ul, items, ctx) {
  ul.innerHTML = '';
  if (items.length === 0) {
    ul.innerHTML = '<li class="empty">No tasks here.</li>';
    return;
  }
  // 41.18 follow-up — index for parent ↔ child cross-references.
  // A row that has a parent shows "↳ sub-task of: <parent text>".
  // A row that has children shows "↓ N sub-task(s)" chip + (when
  // items[]'s status is 'waiting' / 'blocked') the count of open
  // children. Same data the mobile TaskDetail uses.
  const byId = new Map(items.map((it) => [it.id, it]));
  const childrenByParent = new Map();
  for (const it of items) {
    const pid = it?.parentTaskId;
    if (typeof pid !== 'string' || !pid) continue;
    if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
    childrenByParent.get(pid).push(it);
  }

  for (const item of items) {
    // The skill returns item.status as effectiveStatus already (lifecycle
    // ∪ DAG, post-41.18). describeTaskStatus normalises + adds the V2.7
    // deps-gate signals; same helper the mobile screens consume.
    const desc = describeTaskStatus(item);
    const status = desc.kind;
    const li = document.createElement('li');
    li.className = `item status-${status}`;
    li.dataset.id = item.id;

    const head = document.createElement('div');
    head.className = 'head';

    const parent = item.parentTaskId ? byId.get(item.parentTaskId) ?? null : null;
    const subHint = item.parentTaskId
      ? `<span class="role-chip parent-link" title="${escapeHtml(parent?.text ?? item.parentTaskId)}" data-parent="${escapeHtml(item.parentTaskId)}">↳ ${escapeHtml(parent ? `sub-task of: ${parent.text ?? '(untitled)'}` : `sub-task of #${String(item.parentTaskId).slice(-6)}`)}</span>`
      : '';

    const myKids = childrenByParent.get(item.id) ?? [];
    const openKids = myKids.filter((k) => !k.completedAt).length;
    const subCount = myKids.length > 0
      ? `<span class="role-chip subtasks-count" title="${myKids.length} sub-task(s); ${openKids} still open">↓ ${myKids.length} sub-task${myKids.length === 1 ? '' : 's'}${openKids > 0 ? ` (${openKids} open)` : ''}</span>`
      : '';

    head.innerHTML = `
      ${subHint}
      ${subCount}
      <span class="text">${escapeHtml(item.text ?? '')}</span>
      <span class="status pill">${escapeHtml(status)}</span>`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const skills = (item.requiredSkills ?? [])
      .map(s => `<span class="skill">${escapeHtml(s)}</span>`).join('');
    const due = item.dueAt
      ? `<span class="due">due ${new Date(item.dueAt).toLocaleDateString()}</span>` : '';
    const assignee = item.assignee
      ? `<span class="assignee">→ ${escapeHtml(shortWebid(item.assignee))}</span>`
      : `<span class="assignee unclaimed">unclaimed</span>`;
    const masterChip = item.master
      ? `<span class="master" title="master: ${escapeHtml(item.master)}">⚡ ${escapeHtml(shortWebid(item.master))}</span>` : '';
    meta.innerHTML = `${skills}${assignee}${masterChip}${due}`;

    li.appendChild(head);
    li.appendChild(meta);

    if (item.definitionOfDone) {
      const dod = document.createElement('div');
      dod.className = 'dod-block';
      dod.textContent = `DoD: ${item.definitionOfDone}`;
      li.appendChild(dod);
    }

    // Phase 11.1 — surface what the submitter said. Deliverable
    // (artifact reference) + the most recent submit-note from
    // reviewLog give the approver the context they need to decide.
    const lastSubmit = Array.isArray(item.reviewLog)
      ? [...item.reviewLog].reverse().find((r) => r?.decision === 'submit')
      : null;
    const lastReject = Array.isArray(item.reviewLog)
      ? [...item.reviewLog].reverse().find((r) => r?.decision === 'reject')
      : null;

    if (item.deliverable) {
      const blk = document.createElement('div');
      blk.className = 'dod-block';
      const kind = String(item.deliverable.kind ?? '');
      const ref  = String(item.deliverable.ref ?? '');
      const submittedAtTxt = Number.isFinite(item.deliverable.submittedAt)
        ? new Date(item.deliverable.submittedAt).toLocaleString()
        : '';
      let refHtml;
      if (kind === 'url' && /^https?:\/\//i.test(ref)) {
        refHtml = `<a href="${escapeHtml(ref)}" target="_blank" rel="noopener">${escapeHtml(ref)}</a>`;
      } else {
        refHtml = `<code>${escapeHtml(ref)}</code>`;
      }
      blk.innerHTML =
        `<strong>Deliverable (${escapeHtml(kind)})</strong>: ${refHtml}` +
        (submittedAtTxt ? ` <small style="color:var(--muted)">submitted ${escapeHtml(submittedAtTxt)}</small>` : '');
      li.appendChild(blk);
    }

    if (lastSubmit?.note) {
      const blk = document.createElement('div');
      blk.className = 'dod-block';
      const byTxt = lastSubmit.by ? ` — ${escapeHtml(shortWebid(lastSubmit.by))}` : '';
      blk.innerHTML =
        `<strong>Submitter's note${byTxt}</strong><div style="margin-top:0.2rem;white-space:pre-wrap">${escapeHtml(lastSubmit.note)}</div>`;
      li.appendChild(blk);
    }

    if (lastReject?.note && status === 'rejected') {
      const blk = document.createElement('div');
      blk.className = 'dod-block';
      blk.style.borderLeftColor = 'var(--status-rejected-fg)';
      const byTxt = lastReject.by ? ` — ${escapeHtml(shortWebid(lastReject.by))}` : '';
      blk.innerHTML =
        `<strong>Reviewer's reject reason${byTxt}</strong><div style="margin-top:0.2rem;white-space:pre-wrap">${escapeHtml(lastReject.note)}</div>`;
      li.appendChild(blk);
    }

    li.appendChild(buildActions(item, status, desc, ctx));
    ul.appendChild(li);
  }
}

function buildActions(item, status, desc, ctx) {
  const actions = document.createElement('div');
  actions.className = 'actions';
  const me   = ctx.me;
  const role = ctx.role;
  const isAdminish = role === 'admin' || role === 'coordinator';
  const isAdmin    = role === 'admin';
  const approval   = item.approval ?? 'self-mark';

  const isMaster   = (item.master ?? item.addedBy) === me;
  const isAssignee = item.assignee === me;
  const isApprover =
    isAdminish ||
    (approval === 'creator'  && isMaster) ||
    (approval === 'self-mark' && isAssignee) ||
    (typeof approval === 'string' && approval.startsWith('webid:') && approval.slice('webid:'.length) === me);

  const canClaim =
    !item.assignee && status !== 'blocked' && status !== 'complete' &&
    status !== 'submitted' && status !== 'rejected';
  const canCompleteSelfMark = isAssignee && approval === 'self-mark' && status === 'claimed';
  const canSubmit = isAssignee && (status === 'claimed' || status === 'rejected') && approval !== 'self-mark';
  const canApproveOrReject = status === 'submitted' && isApprover;
  const canRevoke = (isMaster || isAdminish) && (status === 'claimed' || status === 'submitted' || status === 'rejected');
  const canReassign = isAdminish;
  const canRemove   = role === 'admin';
  const canAddSub   = isAssignee || isMaster || isAdminish;

  // V2.7 — `describeTaskStatus` rolls up the lifecycle status AND
  // the unmet-deps signal (item.openDeps[] from the listOpen skill).
  // A claimed-but-deps-blocked task returns kind='claimed' AND
  // depsBlocked=true; the "Mark complete" / "Approve" buttons gate
  // on depsBlocked, mirroring the substrate's enforceDependencies
  // throw post-tap. Same logic the mobile shell uses verbatim.
  const depsBlocking = desc.depsBlocked;
  const depTooltip = depsBlocking
    ? `${desc.openDepIds.length} open sub-task(s): ${desc.openDepIds.join(', ')}`
    : '';

  if (canClaim && ctx.onClaim)
    actions.appendChild(makeButton('Claim', () => ctx.onClaim(item.id)));
  if (canCompleteSelfMark && ctx.onComplete) {
    const btn = makeButton('Mark complete', () => ctx.onComplete(item.id));
    if (depsBlocking) {
      btn.disabled = true;
      btn.title = depTooltip;
    }
    actions.appendChild(btn);
  }
  if (canSubmit && ctx.onSubmit) {
    actions.appendChild(makeButton('Submit for review', () => {
      const ref = prompt('Optional deliverable URL or note (leave blank if none):', '');
      const args = {};
      if (ref && ref.trim()) {
        args.deliverable = isUrl(ref) ? { kind: 'url', ref } : { kind: 'note', ref };
      }
      ctx.onSubmit(item.id, args);
    }));
  }
  if (canApproveOrReject) {
    if (ctx.onApprove) {
      const btn = makeButton('Approve', () => ctx.onApprove(item.id));
      if (depsBlocking) {
        btn.disabled = true;
        btn.title = depTooltip;
      }
      actions.appendChild(btn);
    }
    if (ctx.onReject)  actions.appendChild(makeButton('Reject', () => {
      const note = prompt('Reason for rejection (required):', '');
      if (!note || !note.trim()) return;
      ctx.onReject(item.id, note);
    }));
  }
  // V2.7 — admin-only force-complete override. Same gate as
  // mobile's `shouldOfferForceComplete(item, actor, role)` — see
  // `src/ui/taskStatus.js`. Admins / coordinators see the CTA when
  // a non-complete task has open deps; tap → mandatory reason →
  // bypasses the substrate's enforceDependencies gate.
  if (shouldOfferForceComplete(item, me, role) && ctx.onForceComplete) {
    actions.appendChild(makeButton('Force complete', () => {
      const reason = prompt(
        'Reason for force-completing (mandatory; recorded in the audit log):',
        '',
      );
      if (!reason || !reason.trim()) return;
      ctx.onForceComplete(item.id, reason.trim());
    }, 'danger'));
  }
  if (canRevoke && ctx.onRevoke) {
    actions.appendChild(makeButton('Revoke', () => {
      const reason = prompt('Reason for revoking (required):', '');
      if (!reason || !reason.trim()) return;
      ctx.onRevoke(item.id, reason);
    }, 'secondary'));
  }
  if (canReassign && ctx.onReassign) {
    actions.appendChild(makeButton('Reassign', () => {
      const w = prompt('New assignee webid (blank to clear):', item.assignee ?? '');
      if (w === null) return;
      ctx.onReassign(item.id, w.trim() || null);
    }, 'secondary'));
  }
  if (canAddSub) {
    // V2.7 — when parent is `submitted`, adding scope changes the
    // rules of the deal. Switch the button to "Propose sub-task"
    // (calls `proposeSubtask`); the assignee then approves/declines
    // from their inbox. Self-spawn (assignee adding to their own
    // task) takes the normal path — they're their own gate.
    const isSubmitted = status === 'submitted';
    const needsProposal = isSubmitted && !isAssignee;
    if (needsProposal && ctx.onProposeSubtask) {
      const assigneeShort = item.assignee ? shortWebid(item.assignee) : 'assignee';
      const btn = makeButton(`Propose sub-task — needs ${assigneeShort}'s approval`, () => {
        const text = prompt(
          'Proposed sub-task title (the assignee will see this in their inbox):',
          '',
        );
        if (!text || !text.trim()) return;
        ctx.onProposeSubtask(item.id, text.trim());
      }, 'secondary');
      btn.title = 'Adding scope after submission needs the assignee\'s consent.';
      actions.appendChild(btn);
    } else if (ctx.onAddSubtask) {
      actions.appendChild(makeButton('+ Sub-task', () => {
        const text = prompt('Sub-task title:', '');
        if (!text || !text.trim()) return;
        ctx.onAddSubtask(item.id, text.trim());
      }, 'secondary'));
    }
  }
  if (canRemove && ctx.onRemove) {
    actions.appendChild(makeButton('Remove', () => {
      if (confirm(`Remove "${item.text}"?`)) ctx.onRemove(item.id);
    }, 'danger'));
  }
  return actions;
}

function makeButton(label, onClick, variant) {
  const b = document.createElement('button');
  b.textContent = label;
  if (variant) b.className = variant;
  b.addEventListener('click', onClick);
  return b;
}

function shortWebid(w) {
  if (typeof w !== 'string') return String(w ?? '');
  return w.split('/').pop() || w;
}

function isUrl(s) {
  try {
    new URL(s);
    return true;
  } catch { return false; }
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Mount the inbox badge into a nav link element. Polls every 30s.
 * Silently no-ops if the `inboxBadgeCount` skill isn't registered
 * (V0 mode without `--crew`); after the first failure we stop
 * polling to keep the network panel quiet.
 *
 * @param {HTMLElement} navLink — the <a href="/inbox.html">…</a> element
 */
export function mountInboxBadge(navLink) {
  if (!navLink) return () => {};
  let stopped = false;
  let consecutiveFailures = 0;
  let badge = navLink.querySelector('.badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'badge';
    badge.hidden = true;
    navLink.appendChild(badge);
  }
  async function tick() {
    if (stopped) return;
    try {
      const r = await callSkill('inboxBadgeCount');
      consecutiveFailures = 0;
      const n = r?.count ?? 0;
      badge.textContent = String(n);
      badge.hidden = n === 0;
    } catch {
      consecutiveFailures++;
      if (consecutiveFailures >= 2) return; // V0 mode → stop polling
    }
    if (!stopped) setTimeout(tick, 30_000);
  }
  tick();
  return () => { stopped = true; };
}

/**
 * Poll-based live updates (V0). Apps wanting true SSE wire up
 * `core.protocol.LiveSyncSkill` and consume `/tasks/sendSubscribe`.
 */
export function mountLive(_events, callback) {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try { await callback(); } catch { /* swallow — UI shows the next state */ }
    if (!stopped) setTimeout(tick, 2_000);
  };
  setTimeout(tick, 2_000);
  return () => { stopped = true; };
}

/**
 * Render a friendly "feature not available" panel into a container
 * when a V1-only skill isn't reachable from this agent (typical
 * cause: the CLI is in V0 mode — `--role` / `--config` instead of
 * `--crew`).
 *
 * @param {HTMLElement} root           container to render into
 * @param {Error|object} err           the thrown / rejection value
 * @param {string} hintForV0           one-liner explaining the missing feature
 */
export function renderV1NotAvailable(root, err, hintForV0) {
  if (!root) return;
  const msg = String(err?.message ?? err ?? 'unknown error');
  root.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'empty';
  p.style.color = 'var(--muted)';
  p.innerHTML =
    `<strong>${escapeHtml(hintForV0)}</strong><br>` +
    `This page needs the V1 Crew envelope. Restart the CLI with ` +
    `<code>--crew &lt;crewconfig.json&gt;</code> instead of <code>--role</code> / <code>--config</code>.<br>` +
    `<small>(Underlying error: <code>${escapeHtml(msg)}</code>)</small>`;
  root.appendChild(p);
}

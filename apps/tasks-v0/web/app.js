/**
 * Tasks V1 web UI client — speaks A2A's wire shape directly via fetch().
 *
 * Surface:
 *   - Status pills cover both DAG status (ready/waiting/blocked) AND
 *     lifecycle status (claimed/submitted/rejected/complete). The
 *     server's `listOpen` annotates each item with `status` (DAG-side);
 *     this client computes lifecycle status from `reviewLog`/`assignee`/
 *     `completedAt` and prefers it when the item is in a non-ready
 *     lifecycle state.
 *   - Role-aware controls: claim/complete/submit/approve/reject/revoke/
 *     reassign/remove.
 *   - Sub-task hint: tasks with `parentTaskId` show a small label.
 *   - Inbox badge is mounted in nav by `mountInboxBadge`.
 */

/**
 * Call a skill via A2A's POST /tasks/send.
 *
 * @param {string} skillId
 * @param {object} args
 * @returns {Promise<object>}   data of the first DataPart in the response
 */
export async function callSkill(skillId, args = {}) {
  const body = {
    skillId,
    message: { parts: [{ type: 'DataPart', data: args }] },
  };
  const res = await fetch('/tasks/send', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`${skillId}: ${res.status} ${err}`);
  }
  const json = await res.json();
  if (json.status && json.status !== 'completed') {
    throw new Error(`${skillId}: ${json.status} — ${JSON.stringify(json.error ?? {})}`);
  }
  const outParts = json.artifacts?.[0]?.parts ?? json.parts ?? [];
  const dp = outParts.find(p => p?.type === 'DataPart');
  return dp?.data ?? {};
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

/** Lifecycle status from item state (mirrors substrate's computeStatus). */
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
 * Pick a single status string per item: lifecycle state if it's
 * past 'open' / 'claimed', else the DAG status (ready/waiting/blocked).
 */
function effectiveStatus(item) {
  const life = lifecycleStatus(item);
  if (life === 'submitted' || life === 'rejected' || life === 'complete') return life;
  if (life === 'claimed') return 'claimed';
  // life === 'open' → use the DAG status if present
  return item.status ?? 'ready';
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
  for (const item of items) {
    const status = effectiveStatus(item);
    const li = document.createElement('li');
    li.className = `item status-${status}`;
    li.dataset.id = item.id;

    const head = document.createElement('div');
    head.className = 'head';
    const subHint = item.parentTaskId
      ? `<span class="role-chip" title="sub-task">↳ sub-task</span>` : '';
    head.innerHTML = `
      ${subHint}
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

    li.appendChild(buildActions(item, status, ctx));
    ul.appendChild(li);
  }
}

function buildActions(item, status, ctx) {
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

  // V2.7 — DAG status (open/waiting/blocked) lives on `item.status`
  // independent of the lifecycle status this function passes around.
  // The substrate's gate fires on close-transitions when any dep is
  // open, so the "Mark complete" / "Approve" buttons should reflect
  // that.
  const dagStatus = item.status;
  const depsBlocking = dagStatus === 'waiting' || dagStatus === 'blocked';
  const openDeps = Array.isArray(item.dependencies) ? item.dependencies : [];
  const depTooltip = depsBlocking
    ? `${openDeps.length} open sub-task(s): ${openDeps.map((d) => String(d).slice(0, 8)).join(', ')}`
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
  // V2.7 — admin-only force-complete override on a parent that's
  // dependency-blocked. Bypasses the gate; mandatory reason; audit
  // log records `force-complete`. Only shown to admins, only when
  // the gate is the reason for the disabled close button.
  if (isAdmin && depsBlocking && status !== 'complete' && ctx.onForceComplete) {
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

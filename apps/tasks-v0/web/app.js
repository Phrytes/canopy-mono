/**
 * H4 V0 web UI client — speaks A2A's wire shape directly via fetch().
 *
 * Same shape as H5's app.js — `mountLocalUi(bundle.agent, {staticDir,
 * a2aTLSLayer: new LocalUiAuth({localActor: webid})})` ships static
 * files alongside the A2A endpoints, browser POSTs to /tasks/send.
 *
 * H4-specific surface:
 *   - Status pills (ready / waiting / blocked) computed by computeStatus().
 *   - Role-aware controls: claim/complete (anyone with the right role),
 *     reassign (admin/coordinator), remove (admin).
 *   - Errors from the role-policy gate surface as structured `error` shapes.
 */

/**
 * Call a skill via A2A's POST /tasks/send.
 *
 * @param {string} skillId
 * @param {object} args
 * @returns {Promise<object>}   the data of the first DataPart in the response
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

/**
 * Render the open-tasks list. Each task shows a status pill +
 * role-appropriate action buttons (claim if unassigned, complete if
 * mine, reassign for admin/coordinator, remove for admin).
 *
 * @param {HTMLElement} ul
 * @param {Array<object>} items
 * @param {{me: string, role: string,
 *          onClaim: (id) => Promise<void>,
 *          onComplete: (id) => Promise<void>,
 *          onReassign: (id, newAssignee) => Promise<void>,
 *          onRemove: (id) => Promise<void>}} ctx
 */
export function renderTasks(ul, items, ctx) {
  ul.innerHTML = '';
  if (items.length === 0) {
    ul.innerHTML = '<li class="empty">No open tasks.</li>';
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.className = `item status-${item.status ?? 'ready'}`;

    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = `
      <span class="text">${escapeHtml(item.text ?? '')}</span>
      <span class="status pill">${escapeHtml(item.status ?? 'ready')}</span>`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const skills = (item.requiredSkills ?? [])
      .map(s => `<span class="skill">${escapeHtml(s)}</span>`).join('');
    const due    = item.dueAt
      ? `<span class="due">due ${new Date(item.dueAt).toLocaleDateString()}</span>` : '';
    const assignee = item.assignee
      ? `<span class="assignee">→ ${escapeHtml(item.assignee)}</span>`
      : `<span class="assignee unclaimed">unclaimed</span>`;
    meta.innerHTML = `${skills}${assignee}${due}`;

    const actions = document.createElement('div');
    actions.className = 'actions';
    const canClaim    = !item.assignee && item.status !== 'blocked';
    const canComplete = item.assignee === ctx.me;
    const canReassign = ctx.role === 'admin' || ctx.role === 'coordinator';
    const canRemove   = ctx.role === 'admin';
    if (canClaim)    actions.appendChild(makeButton('Claim',    () => ctx.onClaim(item.id)));
    if (canComplete) actions.appendChild(makeButton('Complete', () => ctx.onComplete(item.id)));
    if (canReassign) {
      const reassign = document.createElement('button');
      reassign.textContent = 'Reassign';
      reassign.title = 'Prompt for a new assignee webid';
      reassign.addEventListener('click', async () => {
        const w = prompt('New assignee webid (blank to clear):', item.assignee ?? '');
        if (w === null) return;
        await ctx.onReassign(item.id, w.trim() || null);
      });
      actions.appendChild(reassign);
    }
    if (canRemove) {
      const rm = document.createElement('button');
      rm.textContent = 'Remove';
      rm.className = 'danger';
      rm.addEventListener('click', () => {
        if (confirm(`Remove "${item.text}"?`)) ctx.onRemove(item.id);
      });
      actions.appendChild(rm);
    }

    li.appendChild(head);
    li.appendChild(meta);
    li.appendChild(actions);
    ul.appendChild(li);
  }
}

function makeButton(label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

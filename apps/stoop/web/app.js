/**
 * H5 V0 web UI client — speaks A2A's wire shape directly via fetch().
 *
 * The agent process behind this UI runs `mountLocalUi(bundle.agent, {
 * staticDir: 'web/', a2aTLSLayer: new LocalUiAuth({localActor: webid}) })`,
 * so:
 *   - Static files are served from the same origin (no CORS).
 *   - Every request is treated as authenticated for the configured webid
 *     (V0 localhost-trust shim — see LocalUiAuth.js).
 *
 * No SDK runs in the browser. We POST to /tasks/send and read JSON back.
 * SSE for live updates uses /tasks/sendSubscribe per A2A.
 */

const SUBSCRIBE_SKILL = 'subscribe';   // core.protocol.subscribe — agent's event stream

/* ────────────────────────────────────────────────────────────
 * Browser-side i18n bridge
 *
 * GUI strings MUST live in `apps/stoop/locales/<lang>.json` —
 * never hardcoded in HTML or JS.  See
 * `Project Files/conventions/translatable-by-design.md`.
 *
 * Pages call `await initI18n()` once at boot, then either:
 *   (a) tag DOM nodes with `data-i18n="key.path"` (textContent) or
 *       `data-i18n-attr="placeholder"` / `title` etc., and call
 *       `applyI18n()` after page paint;
 *   (b) call `t('key.path', fallback)` from JS for dynamic strings.
 * ──────────────────────────────────────────────────────────── */

let _i18nBundle = null;
let _i18nLang   = 'nl';

/**
 * Load the locale bundle for `lang` (defaults to navigator.language
 * → 'nl').  Idempotent; subsequent calls return the cached bundle.
 */
export async function initI18n(lang) {
  if (_i18nBundle) return _i18nBundle;
  const target = lang
    ?? (typeof navigator !== 'undefined' && navigator.language?.startsWith('en') ? 'en' : 'nl');
  _i18nLang = target;
  try {
    const res = await fetch(`/locales/${target}.json`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    _i18nBundle = await res.json();
  } catch {
    _i18nBundle = {};   // fall through to fallbacks
  }
  return _i18nBundle;
}

/**
 * Resolve a dotted key path against the loaded bundle.  Leaves
 * follow the translatable-by-design convention
 * (`Project Files/conventions/translatable-by-design.md`) and come
 * in two shapes:
 *
 *   - **`{text, doc}`** (preferred — `doc` documents the string
 *         for translators).
 *   - **Plain string** (legacy; new entries SHOULD use the object
 *         form).
 *
 * Returns the rendered string only; `doc` is metadata for
 * translators / linters.
 */
function _lookupKey(bundle, key) {
  if (!bundle || typeof key !== 'string') return undefined;
  let cur = bundle;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in cur) cur = cur[part];
    else return undefined;
  }
  if (typeof cur === 'string') return cur;
  if (cur && typeof cur === 'object' && typeof cur.text === 'string') return cur.text;
  return undefined;
}

/**
 * Translate `key` to the loaded locale.  Returns `fallback` (or the
 * key itself) when the lookup misses or i18n hasn't been initialised
 * yet.  Synchronous; pages should `await initI18n()` first to avoid
 * fallback flashes.
 */
export function t(key, fallback) {
  const hit = _lookupKey(_i18nBundle, key);
  if (typeof hit === 'string') return hit;
  return fallback ?? key;
}

/**
 * Walk the document for `[data-i18n]` / `[data-i18n-attr]` nodes
 * and fill them from the loaded bundle.  Call after `initI18n()`.
 *
 * - `data-i18n="some.key"` sets `textContent`.
 * - `data-i18n-attr="placeholder"` (in addition to `data-i18n`) sets
 *   the named attribute instead.  Multiple attrs comma-separated.
 */
export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    const val = _lookupKey(_i18nBundle, key);
    if (typeof val !== 'string') continue;
    const attrs = el.getAttribute('data-i18n-attr');
    if (attrs) {
      for (const a of attrs.split(',').map(s => s.trim()).filter(Boolean)) {
        el.setAttribute(a, val);
      }
    } else {
      el.textContent = val;
    }
  }
}

/** Current locale code (set by initI18n). */
export function currentLang() { return _i18nLang; }

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
  const json  = await res.json();
  // A2A returns { id, status, artifacts: [{name, parts}] } on success.
  if (json.status && json.status !== 'completed') {
    throw new Error(`${skillId}: ${json.status} — ${JSON.stringify(json.error ?? {})}`);
  }
  const outParts = json.artifacts?.[0]?.parts ?? json.parts ?? [];
  const dp = outParts.find(p => p?.type === 'DataPart');
  return dp?.data ?? {};
}

/**
 * Read the configured local actor's WebID by asking the agent
 * itself via the `whoAmI` skill.  Cached for the page lifetime.
 *
 * Returns the actor's WebID (e.g. `https://id.example/anne`).  Use
 * `whoAmI()` directly when you also need stableId / pubKey / handle.
 */
let _actorCache = null;
export async function getActor() {
  if (_actorCache) return _actorCache;
  try {
    const me = await callSkill('whoAmI', {});
    _actorCache = me?.webid ?? 'this agent';
    return _actorCache;
  } catch {
    return 'this agent';
  }
}

/**
 * Full identity tuple {webid, stableId, pubKey, handle, displayName}
 * for the calling actor.  Use when you need more than the WebID.
 */
export async function whoAmI() {
  return callSkill('whoAmI', {});
}

/**
 * Render the group-switcher dropdown into a `<select>` element. Reads
 * `/groups.json` (served via mountLocalUi's extraStaticFiles by the
 * multi-group launcher) and renders one option per group; selecting a
 * different group navigates to its URL. When the group index is empty
 * (single-group mode), the dropdown is hidden.
 *
 * @param {HTMLSelectElement} sel
 */
export async function mountGroupSwitcher(sel) {
  if (!sel) return;
  let groups = [];
  try {
    const res = await fetch('/groups.json');
    if (res.ok) groups = await res.json();
  } catch { /* hidden when fetch fails */ }
  if (!Array.isArray(groups) || groups.length <= 1) {
    sel.hidden = true;
    return;
  }
  // Determine the active group: the one whose `url` matches our origin.
  const active = groups.find(g => g.url === location.origin) ?? groups[0];
  sel.innerHTML = '';
  for (const { groupId, url } of groups) {
    const o = document.createElement('option');
    o.value = url;
    o.textContent = groupId;
    if (groupId === active.groupId) o.selected = true;
    sel.appendChild(o);
  }
  sel.hidden = false;
  sel.addEventListener('change', () => {
    const target = sel.value;
    if (target && target !== location.origin) {
      // Preserve the path (e.g. /mine.html) when switching groups.
      location.href = target + location.pathname;
    }
  });
}

/**
 * Render a list of open requests (read-only — used on /).
 *
 * Stoop V1 (Phase 5):
 *   - Honours `addedByDisplay` (Phase 3 hydration: `{render, isRevealed,
 *     handle, displayName?}`) when present; falls back to the raw
 *     `addedBy` WebID otherwise.
 *   - Renders a per-post `…` menu wired to mute/report when the
 *     caller passes `onMute` / `onReport` handlers.
 *   - Renders a `kind` chip (Vraag / Aanbod / Te leen) when the
 *     item carries Stoop-vocabulary `type`.
 *
 * @param {HTMLUListElement} ul
 * @param {Array<object>} items
 * @param {object} [handlers]
 * @param {(peerWebid: string) => any} [handlers.onMute]
 * @param {(itemId:    string) => any} [handlers.onReport]
 */
export function renderItems(ul, items, handlers = {}) {
  const { onMute, onReport } = handlers;
  ul.innerHTML = '';
  if (items.length === 0) {
    ul.innerHTML = '<li class="empty">Niets op het prikbord.</li>';
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'item';

    const display = item.addedByDisplay;
    const actorLabel = display?.render ?? item.addedBy ?? '?';
    const actorTitle = display?.webid ?? item.addedBy ?? '';
    const avatarHtml = renderAvatar(display, actorLabel);

    const kindChip = item.type && KIND_LABELS[item.type]
      ? `<span class="kind kind-${escapeHtml(item.type)}">${KIND_LABELS[item.type]}</span>`
      : '';
    const dueChip = item.dueAt
      ? `<span class="due">terug vóór ${new Date(item.dueAt).toLocaleDateString()}</span>`
      : '';
    const targetsHtml = renderTargets(item.source?.targets, item.source?.maxDistanceKm);

    li.innerHTML = `
      <div class="row">
        <div class="text">${escapeHtml(item.text ?? '')}</div>
        ${kindChip}
      </div>
      <div class="meta">
        <span class="actor" title="${escapeHtml(actorTitle)}">${avatarHtml}${escapeHtml(actorLabel)}</span>
        ${(item.requiredSkills ?? []).map(s => `<span class="skill">${escapeHtml(s)}</span>`).join('')}
        ${dueChip}
        ${targetsHtml}
        <span class="ts">${new Date(item.addedAt ?? Date.now()).toLocaleString()}</span>
      </div>`;

    if (onMute || onReport || handlers.onAddContact) {
      const menu = renderPostMenu(item, { onMute, onReport, onAddContact: handlers.onAddContact });
      if (menu) li.appendChild(menu);
    }

    // Phase 14 — "Ik help" / "Ik wil dit lenen" reply button on non-own posts.
    // Caller supplies `viewerWebid` + `onRespond(itemId)`; we render the right
    // label per kind.  Skips author's own posts.
    if (handlers.onRespond && handlers.viewerWebid && item.addedBy !== handlers.viewerWebid) {
      const replyRow = document.createElement('div');
      replyRow.className = 'reply-row';
      const btn = document.createElement('button');
      btn.className = 'ghost';
      btn.textContent = REPLY_LABELS[item.type] ?? 'Reageer';
      btn.addEventListener('click', () => handlers.onRespond(item.source?.requestId ?? item.id));
      replyRow.appendChild(btn);
      li.appendChild(replyRow);
    }

    ul.appendChild(li);
  }
}

/**
 * Render a post's targets in plain Dutch — used in the prikbord
 * meta line so the user knows who else got the post.  Phase 27.6.
 *
 * @param {Array<object>} targets   `[{kind, groupId|minTrust|tag|listId}]`
 * @param {number|null} maxDistanceKm
 * @returns {string} HTML
 */
export function renderTargets(targets, maxDistanceKm) {
  if (!Array.isArray(targets) || targets.length === 0) return '';
  const labels = targets.map(t => {
    if (t.kind === 'group')    return `groep "${escapeHtml(t.groupId ?? '?')}"`;
    if (t.kind === 'contacts') return t.minTrust === 'vertrouwd' ? 'vertrouwde contacten' : 'bekende contacten';
    if (t.kind === 'tag')      return `contacten met tag "${escapeHtml(t.tag ?? '?')}"`;
    if (t.kind === 'list')     return `lijst`;     // listId is opaque; UI doesn't carry the name here
    return '?';
  });
  let label = labels.join(' + ');
  if (maxDistanceKm) label += ` (≤ ${maxDistanceKm} km)`;
  return `<span class="targets" title="Naar: ${escapeHtml(label.replace(/<[^>]+>/g, ''))}">→ ${label}</span>`;
}

/**
 * Render an avatar img (or initials fallback) for a member.
 * `display` is the hydrated `addedByDisplay` block; falls back to
 * the supplied `label` for the initial when no avatar URL is set.
 *
 * Avatar URLs are stored as `data:` URIs on `MemberMap.avatarUrl`
 * for V2 web — small (resized to 256×256 client-side, ~50 KB).
 * V3 mobile may split avatar bytes off MemberMap into a separate
 * cache path.
 *
 * @param {{avatarUrl?: string|null} | null | undefined} display
 * @param {string} label   actor label, used to derive an initial
 * @returns {string} HTML
 */
export function renderAvatar(display, label = '?') {
  const url = display?.avatarUrl;
  if (typeof url === 'string' && url) {
    return `<img class="avatar" src="${escapeHtml(url)}" alt="">`;
  }
  const initial = String(label).replace(/^@/, '').charAt(0).toUpperCase() || '?';
  return `<span class="avatar-fallback" aria-hidden="true">${escapeHtml(initial)}</span>`;
}

const REPLY_LABELS = Object.freeze({
  ask:     'Ik help',
  offer:   'Ik wil dit',
  lend:    'Ik wil dit lenen',
  request: 'Ik help',
});

const KIND_LABELS = Object.freeze({
  ask:    'Vraag',
  offer:  'Aanbod',
  lend:   'Te leen',
  report: 'Melding',
});

/**
 * Build the per-post "…" menu DOM with mute / report wired to the
 * provided handlers.  Returns the rendered element, or `null` if no
 * handlers are supplied.
 *
 * Pure UI; the actual skill calls live in the page bootstrap so the
 * client knows how to refresh after a successful action.
 */
export function renderPostMenu(item, { onMute, onReport, onAddContact } = {}) {
  if (!onMute && !onReport && !onAddContact) return null;
  const wrap = document.createElement('div');
  wrap.className = 'post-menu';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'post-menu-trigger';
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.textContent = '⋯';

  const list = document.createElement('ul');
  list.className = 'post-menu-list';
  list.hidden = true;

  if (onMute && item.addedBy) {
    const mute = document.createElement('button');
    mute.type = 'button';
    mute.textContent = 'Mute deze persoon';
    mute.addEventListener('click', async () => {
      list.hidden = true;
      try { await onMute(item.addedBy); } catch (e) { alert(`Mute mislukt: ${e?.message ?? e}`); }
    });
    const li = document.createElement('li'); li.appendChild(mute); list.appendChild(li);
  }

  if (onReport && item.id) {
    const report = document.createElement('button');
    report.type = 'button';
    report.textContent = 'Rapporteer post';
    report.addEventListener('click', async () => {
      list.hidden = true;
      try { await onReport(item.id); } catch (e) { alert(`Rapport mislukt: ${e?.message ?? e}`); }
    });
    const li = document.createElement('li'); li.appendChild(report); list.appendChild(li);
  }

  // Phase 24.8 — promote post-author into a contact at "bekend" trust.
  if (onAddContact && item.addedBy) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = 'Toevoegen aan contacten';
    addBtn.addEventListener('click', async () => {
      list.hidden = true;
      try { await onAddContact(item); } catch (e) { alert(`Toevoegen mislukt: ${e?.message ?? e}`); }
    });
    const li = document.createElement('li'); li.appendChild(addBtn); list.appendChild(li);
  }

  trigger.addEventListener('click', () => { list.hidden = !list.hidden; });
  // Click-away close.
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) list.hidden = true;
  });

  wrap.appendChild(trigger);
  wrap.appendChild(list);
  return wrap;
}

/** Render the requester's own requests + claim-accept controls. */
export function renderMyItems(ul, items, { onAccept, onCancel }) {
  ul.innerHTML = '';
  if (items.length === 0) {
    ul.innerHTML = '<li class="empty">You haven\'t posted any open requests.</li>';
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'item';
    const actions = document.createElement('div');
    actions.className = 'actions';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => onCancel(item.id));
    actions.appendChild(cancel);

    li.innerHTML = `
      <div class="text">${escapeHtml(item.text ?? '')}</div>
      <div class="meta">
        ${(item.requiredSkills ?? []).map(s => `<span class="skill">${escapeHtml(s)}</span>`).join('')}
        <span class="ts">${new Date(item.addedAt ?? Date.now()).toLocaleString()}</span>
      </div>`;
    li.appendChild(actions);
    ul.appendChild(li);
  }
}

/** Escape user-supplied content for safe innerHTML insertion. */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Mount a live-update listener that re-runs `callback` whenever the
 * agent emits one of the named events. V0 uses polling-via-SSE on a
 * dedicated `'subscribe'`-style skill; for now the simpler approach
 * is a configurable poll loop that calls `callback`.
 *
 * Phase 28.3 — the poll interval comes from
 * `bundle.settings.pollIntervalMs` (cadence settings).  The caller
 * either passes an explicit `pollIntervalMs` opt OR omits it and we
 * read it from `getSettings` once on mount.  Default fallback: 2s.
 *
 * @param {Array<string>} _events    Event types the caller cares about
 * @param {() => void|Promise<void>} callback
 * @param {object} [opts]
 * @param {number} [opts.pollIntervalMs]   override; otherwise auto-detect
 */
export function mountLive(_events, callback, opts = {}) {
  let stopped = false;
  let pollMs = typeof opts.pollIntervalMs === 'number' && opts.pollIntervalMs >= 100
    ? opts.pollIntervalMs
    : null;

  const tick = async () => {
    if (stopped) return;
    try { await callback(); } catch { /* swallow — UI shows the next state */ }
    if (!stopped) setTimeout(tick, pollMs ?? 2_000);
  };

  // Auto-detect from settings on first run.  Cheap fire-and-forget;
  // failures fall back to the 2s default.
  if (pollMs === null) {
    callSkill('getSettings', {}).then((r) => {
      const fromSettings = r?.settings?.pollIntervalMs;
      if (typeof fromSettings === 'number' && fromSettings >= 100) {
        pollMs = fromSettings;
      }
    }).catch(() => { /* keep default */ });
  }

  setTimeout(tick, pollMs ?? 2_000);
  return () => { stopped = true; };
}

/* ───────────────────────────── In-app banner (Phase 18) */

/**
 * Show a transient banner near the top of the page.  Auto-dismisses
 * after `timeout` ms.  Optional `actionLabel` + `onAction` adds a
 * button that the user can tap to navigate / open something.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.timeout=8000]
 * @param {string} [opts.actionLabel]
 * @param {() => void} [opts.onAction]
 */
export function showBanner(text, { timeout = 8_000, actionLabel, onAction } = {}) {
  let el = document.getElementById('stoop-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'stoop-banner';
    document.body.appendChild(el);
  }
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = text;
  el.appendChild(span);

  if (actionLabel && typeof onAction === 'function') {
    const btn = document.createElement('button');
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => { onAction(); hideBanner(); });
    el.appendChild(btn);
  }
  const dismiss = document.createElement('button');
  dismiss.className = 'banner-dismiss';
  dismiss.textContent = '×';
  dismiss.setAttribute('aria-label', 'Sluit banner');
  dismiss.addEventListener('click', hideBanner);
  el.appendChild(dismiss);

  // requestAnimationFrame ensures the transition fires.
  requestAnimationFrame(() => el.classList.add('show'));
  if (timeout > 0) setTimeout(hideBanner, timeout);
}

function hideBanner() {
  const el = document.getElementById('stoop-banner');
  if (el) el.classList.remove('show');
}

/**
 * Poll the agent for incoming chat-message / reveal-event items
 * since the last tick, and surface them via `showBanner`.  Filters
 * to events the user hasn't seen on screen (the page is not
 * /chat.html?thread=<theirs>).
 *
 * Returns a stop fn.
 */
export function mountNotifyBanner({ pollIntervalMs = 4_000 } = {}) {
  let stopped = false;
  let lastSeenAt = Date.now();

  async function tick() {
    if (stopped) return;
    try {
      const r = await callSkill('listChatThreads', {});
      const me = await getActor();
      const fresh = (r.threads ?? []).filter((t) => t.lastSentAt > lastSeenAt && t.lastFrom !== me);
      // Only fire for the most recent fresh thread to avoid spam.
      const target = fresh[0];
      if (target) {
        lastSeenAt = target.lastSentAt;
        // Don't surface if the user is already on that chat thread.
        const onSameThread = location.pathname === '/chat.html'
          && location.search.includes(`thread=${encodeURIComponent(target.threadId)}`);
        if (!onSameThread) {
          showBanner(`Nieuw bericht: "${truncate(target.lastBody, 60)}"`, {
            actionLabel: 'Open',
            onAction: () => {
              location.href = `/chat.html?thread=${encodeURIComponent(target.threadId)}`;
            },
          });
        }
      }
    } catch { /* swallow */ }
    if (!stopped) setTimeout(tick, pollIntervalMs);
  }
  setTimeout(tick, pollIntervalMs);
  return () => { stopped = true; };
}

function truncate(s, n) { return (s ?? '').length > n ? s.slice(0, n - 1) + '…' : (s ?? ''); }

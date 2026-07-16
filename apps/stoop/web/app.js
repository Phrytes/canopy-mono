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
 * Browser-side localisation bridge
 *
 * GUI strings MUST live in `apps/stoop/locales/<lang>.json` —
 * never hardcoded in HTML or JS.  See
 * `Project Files/conventions/translatable-by-design.md`.
 *
 * Pages call `await initLocalisation()` once at boot, then either:
 *   (a) tag DOM nodes with `data-i18n="key.path"` (textContent) or
 *       `data-i18n-attr="placeholder"` / `title` etc., and call
 *       `applyLocalisation()` after page paint;
 *   (b) call `t('key.path', fallback)` from JS for dynamic strings.
 * ──────────────────────────────────────────────────────────── */

let _i18nBundle = null;
let _i18nLang   = 'nl';

/**
 * Load the locale bundle for `lang` (defaults to navigator.language
 * → 'nl').  Idempotent; subsequent calls return the cached bundle.
 */
export async function initLocalisation(lang) {
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
 * key itself) when the lookup misses or localisation hasn't been initialised
 * yet.  Synchronous; pages should `await initLocalisation()` first to avoid
 * fallback flashes.
 */
export function t(key, fallback) {
  const hit = _lookupKey(_i18nBundle, key);
  if (typeof hit === 'string') return hit;
  return fallback ?? key;
}

/**
 * Walk the document for `[data-i18n]` / `[data-i18n-attr]` nodes
 * and fill them from the loaded bundle.  Call after `initLocalisation()`.
 *
 * - `data-i18n="some.key"` sets `textContent`.
 * - `data-i18n-attr="placeholder"` (in addition to `data-i18n`) sets
 *   the named attribute instead.  Multiple attrs comma-separated.
 */
export function applyLocalisation(root = document) {
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

/** Current locale code (set by initLocalisation). */
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

    // Phase 39 — render thumbnails for any source.attachments.
    const attachmentsHtml = renderAttachmentThumbs(item);

    // A4 (2026-05-14) — cross-pod ref chips below the body.
    const embedsHtml = renderEmbedChips(item);

    li.innerHTML = `
      <div class="row">
        <div class="text">${escapeHtml(item.text ?? '')}</div>
        ${kindChip}
      </div>
      ${attachmentsHtml}
      ${embedsHtml}
      <div class="meta">
        <span class="actor" title="${escapeHtml(actorTitle)}">${avatarHtml}${escapeHtml(actorLabel)}</span>
        ${(item.requiredSkills ?? []).map(s => `<span class="skill">${escapeHtml(s)}</span>`).join('')}
        ${dueChip}
        ${targetsHtml}
        <span class="ts">${new Date(item.addedAt ?? Date.now()).toLocaleString()}</span>
      </div>`;

    // Wire click-to-open on each thumbnail.
    for (const thumb of li.querySelectorAll('.attachment-thumb')) {
      thumb.addEventListener('click', () => openAttachmentModal({
        itemId: thumb.dataset.itemId,
        attId:  thumb.dataset.attId,
        thumb:  thumb.dataset.thumb,
      }));
    }

    // Phase 3.3c — progressively materialise cross-pod embeds. The
    // chips above are the instant + fallback view; when getItemTree
    // (treeOf + cross-pod resolver) returns, swap in the walked tree.
    if (item.id && Array.isArray(item.source?.embeds) && item.source.embeds.length > 0) {
      callSkill('getItemTree', { itemId: item.id })
        .then((r) => {
          if (!r || !r.tree) return;
          const walked = renderEmbedTree(r.tree);
          const box = li.querySelector('.embeds');
          if (box && walked) box.outerHTML = walked;
        })
        .catch(() => { /* keep the chips — best-effort */ });
    }

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
export function renderMyItems(ul, items, { onAccept, onCancel, onMarkReturned } = {}) {
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

    // Parity with stoop-mobile ItemDetailScreen: an open lend can be
    // marked returned by its author (closes the lending loop on web).
    if (item.kind === 'lend' && !item.completedAt && typeof onMarkReturned === 'function') {
      const ret = document.createElement('button');
      ret.className = 'ghost';
      ret.textContent = t('mine.mark_returned', 'Markeer als teruggebracht');
      ret.addEventListener('click', () => onMarkReturned(item.id));
      actions.appendChild(ret);
    }

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

/* ── A4 (2026-05-14) — Cross-pod ref chip rendering ─────────── */

/**
 * Render the embed-ref chips for an item's `source.embeds: [{type,
 * ref}, ...]`. Each chip shows the canonical type pill + a short
 * tail of the ref. Click-through is a future affordance (Hub-
 * mediated cross-app routing, P6 of the standardisation plan); for
 * now the chip is informational.
 */
export function renderEmbedChips(item) {
  const embeds = Array.isArray(item?.source?.embeds) ? item.source.embeds : [];
  if (embeds.length === 0) return '';
  const chips = embeds
    .filter(e => e && typeof e.type === 'string' && typeof e.ref === 'string')
    .map(e => {
      const tail = e.ref.length > 28 ? `…${e.ref.slice(-26)}` : e.ref;
      return `<span class="embed-chip" title="${escapeHtml(e.ref)}">`
           + `<span class="embed-type embed-type-${escapeHtml(e.type)}">${escapeHtml(e.type)}</span>`
           + `<span class="embed-ref">${escapeHtml(tail)}</span>`
           + `</span>`;
    }).join('');
  if (!chips) return '';
  return `<div class="embeds">${chips}</div>`;
}

/**
 * Phase 3.3c — render the *walked* embed tree from `getItemTree`
 * (item-store `treeOf` + cross-pod resolver). Three-tier render
 * (`conventions/cross-pod-refs.md`): a resolved external item shows
 * its content; a placeholder shows a human reason (permission /
 * missing); anything else falls back to the bare ref. Returns a
 * `.embeds` div so it can replace the instant `renderEmbedChips`
 * output in place.
 */
const _EMBED_REASON_NL = {
  PERMISSION_DENIED: '🔒 op een andere pod — geen toegang',
  NOT_FOUND:         'onvindbaar of verwijderd',
  PARSE_ERROR:       'kon niet gelezen worden',
  RESOLVE_FAILED:    'tijdelijk niet beschikbaar',
  NO_RESOLVER:       'niet beschikbaar',
  BAD_EMBED:         'ongeldige verwijzing',
  CYCLE_OR_DEPTH:    'verwijzing te diep',
};
export function renderEmbedTree(tree) {
  const nodes = Array.isArray(tree?.embeds) ? tree.embeds : [];
  if (nodes.length === 0) return '';
  const cells = nodes.map((n) => {
    const type = escapeHtml(n?.type ?? n?.item?.type ?? 'item');
    if (n?.source === 'external' && n.item) {
      const snippet = truncate(
        n.item.text ?? n.item.title ?? n.item.body ?? n.item.id ?? '', 60);
      return `<span class="embed-chip embed-ok" title="${escapeHtml(n.ref ?? '')}">`
           + `<span class="embed-type embed-type-${type}">${type}</span>`
           + `<span class="embed-ref">${escapeHtml(snippet)}</span></span>`;
    }
    if (n?.source === 'placeholder') {
      const why = _EMBED_REASON_NL[n.reason] ?? 'niet beschikbaar';
      return `<span class="embed-chip embed-missing" title="${escapeHtml(n.ref ?? '')}">`
           + `<span class="embed-type embed-type-${type}">${type}</span>`
           + `<span class="embed-ref">${escapeHtml(why)}</span></span>`;
    }
    return '';
  }).join('');
  if (!cells) return '';
  return `<div class="embeds">${cells}</div>`;
}

/* ── Phase 39 — Attachment rendering ─────────────────────────── */

/**
 * Render the thumbnail strip for an item's source.attachments.
 * Each thumb carries data-{item-id, att-id, thumb} so the click
 * handler in renderItems can open the modal with the right ids.
 *
 * Media consolidation (2026-07-10): attachment entries are canonical
 * `media` items (`@onderling/item-types` — `{type:'media', source:
 * {type,ref}, mime, width, height}` + stoop's `thumbnail` extra).
 * The renderer reads the canonical fields — `mime`/`width`/`height`
 * are writer-asserted layout hints (reserve space, never truth) —
 * and stays tolerant of legacy records (same keys, no `source`),
 * so pre-consolidation items and old peers keep rendering.
 */
export function renderAttachmentThumbs(item) {
  const atts = Array.isArray(item?.source?.attachments) ? item.source.attachments : [];
  if (atts.length === 0) return '';
  const thumbs = atts.filter(a => a && typeof a.thumbnail === 'string').map(a => {
    // Canonical hints: reserve layout space when the writer asserted
    // dimensions (media schema `width`/`height` — same keys legacy
    // records used, so both shapes hit this path).
    const dims = (Number.isFinite(a.width) && Number.isFinite(a.height)
      && a.width > 0 && a.height > 0)
      ? ` width="${a.width}" height="${a.height}"` : '';
    return `
    <button type="button" class="attachment-thumb" tabindex="0"
            data-item-id="${escapeHtml(item.id)}"
            data-att-id="${escapeHtml(a.id)}"
            data-thumb="${escapeHtml(a.thumbnail)}"
            aria-label="${escapeHtml(t('post_form.open_picture', 'Open foto'))}">
      <img src="${escapeHtml(a.thumbnail)}" alt=""${dims} loading="lazy">
    </button>`;
  }).join('');
  if (!thumbs) return '';
  return `<div class="attachments">${thumbs}</div>`;
}

/**
 * Open the full-size attachment modal.  When the local cache
 * already has the bytes (item.source.attachments[i].ref present),
 * just render them.  Otherwise call requestAttachment + listen
 * for `stoop:attachment-fetched` to flip from spinner to image.
 */
export async function openAttachmentModal({ itemId, attId, thumb }) {
  let modal = document.getElementById('attachment-modal');
  if (!modal) {
    modal = document.createElement('dialog');
    modal.id = 'attachment-modal';
    modal.className = 'attachment-modal';
    modal.innerHTML = `
      <button type="button" class="modal-close" aria-label="${escapeHtml(t('post_form.close', 'Sluiten'))}">×</button>
      <div class="modal-body">
        <img class="modal-thumb" src="" alt="">
        <div class="modal-status hint"></div>
        <img class="modal-full" src="" alt="" hidden>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('.modal-close').addEventListener('click', () => modal.close());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });
  }
  modal.querySelector('.modal-thumb').src = thumb;
  modal.querySelector('.modal-full').hidden = true;
  modal.querySelector('.modal-full').src = '';
  modal.querySelector('.modal-status').textContent = t('post_form.picture_loading', 'Foto ophalen…');
  if (!modal.open) modal.showModal();

  // Try the in-memory item first; fall back to listOpen lookup.
  const r = await callSkill('requestAttachment', { itemId, attId });
  if (r.error) {
    modal.querySelector('.modal-status').textContent =
      `${t('common.error', 'Fout')}: ${r.error}`;
    return;
  }
  if (r.ref) {
    await renderAttachmentBytes(modal, itemId, attId);
    return;
  }
  // Pending — bytes were requested over chat.  Poll the local
  // cache periodically until we have them (or the user closes).
  modal.querySelector('.modal-status').textContent =
    t('post_form.picture_pending',
      'Foto wordt opgehaald — kan even duren als de afzender offline is.');
  const stop = pollForAttachment(modal, itemId, attId);
  modal.addEventListener('close', stop, { once: true });
}

async function renderAttachmentBytes(modal, itemId, attId) {
  if (!modal.open) return false;
  const status = modal.querySelector('.modal-status');
  const full   = modal.querySelector('.modal-full');
  const r = await callSkill('getAttachmentDataUrl', { itemId, attId });
  if (r.error) {
    if (r.error === 'no-bytes') return false;
    status.textContent = `${t('common.error', 'Fout')}: ${r.error}`;
    return true;
  }
  full.src = r.dataUrl;
  full.hidden = false;
  status.textContent = '';
  return true;
}

function pollForAttachment(modal, itemId, attId) {
  let stopped = false;
  const tick = async () => {
    if (stopped || !modal.open) return;
    const done = await renderAttachmentBytes(modal, itemId, attId);
    if (done || stopped || !modal.open) return;
    setTimeout(tick, 1500);
  };
  setTimeout(tick, 1200);
  return () => { stopped = true; };
}

/* ────────────────────────────────────────────────────────────
 * Structural nav links
 *
 * The web UI's `<nav>` is hardcoded + duplicated across ~16 static
 * pages, so a per-page-only "create group / group" link drifts and
 * re-opens the web⇄mobile parity gap (mobile reaches CreateGroup from
 * Welcome + Settings). app.js is imported by every nav page, so
 * augmenting the nav here once closes it structurally for all pages.
 * Idempotent; no-op when there is no nav. Plain text to match the
 * surrounding (pre-localisation) hardcoded nav, which has not been migrated.
 * ──────────────────────────────────────────────────────────── */
export async function ensureNavLinks() {
  const nav = document.querySelector('header nav');
  if (!nav) return;
  const firstLink = nav.querySelector('a');
  if (!firstLink) return;

  let groupHref = '/group.html';
  const cur = new URLSearchParams(location.search);
  const curGid = cur.get('id') ?? cur.get('groupId');
  if (curGid) {
    groupHref = `/group.html?id=${encodeURIComponent(curGid)}`;
  } else {
    try {
      const res = await fetch('/groups.json');
      if (res.ok) {
        const groups = await res.json();
        if (Array.isArray(groups) && groups.length === 1 && groups[0]?.groupId) {
          groupHref = `/group.html?id=${encodeURIComponent(groups[0].groupId)}`;
        }
      }
    } catch { /* single-group launch has no groups.json — plain link */ }
  }

  // Insert in order so the nav reads: Buurt, Groep, Nieuwe groep, …
  const want = [
    { match: '/group.html',        href: groupHref,           label: 'Groep' },
    { match: '/create-group.html', href: '/create-group.html', label: 'Nieuwe groep' },
  ];
  let anchor = firstLink;
  for (const { match, href, label } of want) {
    if (nav.querySelector(`a[href^="${match}"]`)) continue; // idempotent
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (location.pathname === match) a.className = 'active';
    anchor.insertAdjacentElement('afterend', a);
    anchor = a;
  }
}

/**
 * Show the active group in the header on every page — the web UI
 * never surfaced "which group am I in?" (a real parity gap vs mobile,
 * which always shows/lets you switch the group). Resolves from
 * `?id=` or `/groups.json` (single- or multi-group launch). No-op
 * when it can't be determined; idempotent.
 */
export async function ensureActiveGroupBadge() {
  const header = document.querySelector('header');
  if (!header || header.querySelector('.active-group')) return;

  // Resolve active groupId (from ?id= query OR /groups.json lookup).
  const cur = new URLSearchParams(location.search);
  let gid = cur.get('id') ?? cur.get('groupId') ?? null;
  let groups = [];
  try {
    const res = await fetch('/groups.json');
    if (res.ok) {
      const raw = await res.json();
      if (Array.isArray(raw)) groups = raw;
      if (!gid && groups.length) {
        const active = groups.find((g) => g.url === location.origin) ?? groups[0];
        gid = active?.groupId ?? null;
      }
    }
  } catch { /* unknown — leave groups[] empty */ }
  if (!gid) return;

  // #245 (2026-05-24) — clickable badge → switch / join / create menu.
  // Closes the in-app group switch/create gap from
  // [[web-mobile-parity-gaps]] §"Convergence initiative".  Mobile
  // switches freely; web was per-group launcher with no switch path
  // beyond the legacy group-switcher <select>.  This makes the
  // badge a button that opens a small menu with the same three
  // actions a user might want: switch, join another, create new.
  const wrap = document.createElement('span');
  wrap.className = 'active-group';
  wrap.style.cssText = 'position: relative; margin-right:0.6rem; align-self:center;';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'active-group-btn';
  btn.textContent = `groep: ${gid} ▾`;
  btn.style.cssText = 'font-size:0.85rem;color:var(--muted,#667);background:none;border:none;cursor:pointer;padding:0.1rem 0.4rem;';
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  wrap.appendChild(btn);

  const menu = document.createElement('div');
  menu.className = 'active-group-menu';
  menu.hidden = true;
  menu.style.cssText = 'position:absolute;top:100%;left:0;background:#fff;border:1px solid #ccc;border-radius:4px;padding:0.25rem 0;min-width:14rem;box-shadow:0 2px 8px rgba(0,0,0,0.1);z-index:100;';
  wrap.appendChild(menu);

  function mkMenuItem(label, onClick, opts = {}) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = label;
    a.style.cssText = `display:block;padding:0.35rem 0.75rem;text-decoration:none;color:${opts.muted ? '#888' : 'inherit'};${opts.active ? 'font-weight:600;background:#f0f0f0;' : ''}`;
    if (typeof onClick === 'function') {
      a.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
    }
    return a;
  }

  // Section: known groups (with switch).
  if (groups.length > 0) {
    for (const g of groups) {
      const isActive = g.groupId === gid;
      const item = mkMenuItem(
        (isActive ? '✓ ' : '   ') + g.groupId,
        isActive ? null : () => {
          // Preserve path so /mine.html → /mine.html on the other group.
          location.href = g.url + location.pathname;
        },
        { active: isActive },
      );
      menu.appendChild(item);
    }
    // Divider.
    const hr = document.createElement('hr');
    hr.style.cssText = 'margin:0.25rem 0;border:none;border-top:1px solid #eee;';
    menu.appendChild(hr);
  }

  // Section: join existing buurt + create new buurt.  Strings carry
  // data-i18n so applyLocalisation() picks them up when the page's
  // init has run; pre-init they show the Dutch fallback.
  const joinItem = mkMenuItem('+ Sluit aan bij andere buurt', () => {
    location.href = '/onboard.html';
  });
  joinItem.setAttribute('data-i18n', 'group_switcher.join_other');
  menu.appendChild(joinItem);
  const createItem = mkMenuItem('+ Maak nieuwe buurt aan', () => {
    location.href = '/create-group.html';
  });
  createItem.setAttribute('data-i18n', 'group_switcher.create_new');
  menu.appendChild(createItem);

  function toggleMenu(open) {
    const willOpen = open ?? menu.hidden;
    menu.hidden = !willOpen;
    btn.setAttribute('aria-expanded', String(willOpen));
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });
  // Click-outside-to-close.
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) toggleMenu(false);
  });
  // Escape to close.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleMenu(false);
  });

  const actor = header.querySelector('#actor');
  if (actor) actor.insertAdjacentElement('beforebegin', wrap);
  else header.appendChild(wrap);
}

if (typeof document !== 'undefined') {
  const _bootHeader = () => { ensureNavLinks(); ensureActiveGroupBadge(); };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bootHeader);
  } else {
    _bootHeader();
  }
}

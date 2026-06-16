/**
 * canopy-chat v2 — ε.6: multi-offer catch-up chooser modal (web).
 *
 * Surfaces the offers collected during a negotiated catch-up's offer
 * window so the user picks WHICH source streams AND at what scope.
 * One card per offer with three mode buttons (All / Last 50 /
 * Last 7 days); a global Cancel cancels the catch-up entirely.
 *
 * Pure DOM — the host wraps this in a Promise inside `chooseOffer`
 * (the substrate hook on `makeCatchUpReceiver`).  The modal calls
 * `onResolve(decision)` once and the host removes the container.
 *
 * Mirrors γ.3's recipeConflictResolver pattern: self-contained
 * overlay with inline styles, no shared "Modal" abstraction in v2 yet.
 *
 * Locale namespace (extends ε.5 `circle.chat.catch_up.*`):
 *   - chooser_title             — modal heading
 *   - chooser_subtitle          — "{{count}} sources offered..."
 *   - chooser_msg_count         — "{{count}} messages"
 *   - chooser_size_kb           — "~{{kb}} KB"
 *   - chooser_recent            — "most recent {{when}}"
 *   - chooser_all / chooser_last_50 / chooser_last_7d
 *   - chooser_cancel
 *   - chooser_unknown_provider  — fallback display name
 */

/**
 * Format a millisecond timestamp into a short relative time string
 * (e.g. "5m ago", "2h ago", "Mon").  Pure + deterministic for tests
 * that pass `nowMs` explicitly.
 */
function formatRelativeTs(ts, nowMs = Date.now()) {
  if (!Number.isFinite(ts)) return '—';
  const diff = Math.max(0, nowMs - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1)   return 'just now';
  if (min < 60)  return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr  < 24)  return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d   < 7)   return `${d}d ago`;
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return `${d}d ago`; }
}

/** Truncate an NKN addr to a short readable form: "abcdef…uvwxyz". */
function shortAddr(addr) {
  if (typeof addr !== 'string' || addr.length === 0) return '?';
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

/**
 * @param {HTMLElement} container
 * @param {object} args
 * @param {Array<{from: string, offer: {requestId, count, sizeBytes, lastTs}}>} args.offers
 * @param {string} args.circleId
 * @param {string} [args.circleName]
 * @param {(peerAddr: string) => ({displayName?: string}|null)} [args.resolveContact]
 * @param {Function} args.t
 * @param {(decision: object) => void} args.onResolve
 * @param {number} [args.nowMs]  — test seam; defaults to Date.now() per render
 */
export function renderCatchUpChooser(container, {
  offers = [],
  circleId,
  circleName,
  resolveContact = null,
  t,
  onResolve,
  nowMs,
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  const resolved = typeof onResolve === 'function' ? onResolve : () => {};
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  container.innerHTML = '';
  container.classList.add('catch-up-chooser');

  // Self-contained backdrop — mirrors γ.3's recipeConflictResolver.
  Object.assign(container.style, {
    position: 'fixed', inset: '0', zIndex: '200',
    background: 'rgba(0,0,0,0.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '16px',
  });

  let settled = false;
  function settle(decision) {
    if (settled) return;
    settled = true;
    // Cleanup ESC binding so the chooser doesn't leak.
    try { document.removeEventListener('keydown', onKeydown); } catch { /* defensive */ }
    try { resolved(decision); } catch { /* host decides what to do with errors */ }
  }
  function onKeydown(e) {
    if (e?.key === 'Escape') {
      e.preventDefault();
      settle({ decline: true });
    }
  }
  document.addEventListener('keydown', onKeydown);

  // Backdrop click = cancel.  Stop propagation on the sheet so taps
  // inside don't dismiss.
  container.addEventListener('click', (e) => {
    if (e.target === container) settle({ decline: true });
  });

  const sheet = document.createElement('div');
  sheet.className = 'catch-up-chooser__sheet';
  Object.assign(sheet.style, {
    background: 'var(--card, #fff)',
    border: '1px solid var(--line, #ddd)',
    borderRadius: 'var(--radius, 10px)',
    padding: '18px 20px',
    maxWidth: '520px', width: '100%',
    maxHeight: '85vh', overflowY: 'auto',
    boxShadow: '0 8px 28px rgba(0,0,0,.20)',
  });
  // Stop sheet clicks from propagating to backdrop.
  sheet.addEventListener('click', (e) => e.stopPropagation());

  const titleEl = document.createElement('h2');
  titleEl.className = 'catch-up-chooser__title';
  titleEl.textContent = tr('circle.chat.catch_up.chooser_title', { kring: circleName ?? circleId });
  titleEl.style.margin = '0 0 4px';
  sheet.appendChild(titleEl);

  const subEl = document.createElement('p');
  subEl.className = 'catch-up-chooser__subtitle';
  subEl.textContent = tr('circle.chat.catch_up.chooser_subtitle', { count: offers.length });
  subEl.style.cssText = 'margin: 0 0 14px; color: var(--ink-soft, #777); font-size: 13px;';
  sheet.appendChild(subEl);

  /* Offer cards ------------------------------------------------------ */
  const list = document.createElement('ul');
  list.className = 'catch-up-chooser__list';
  list.style.cssText = 'list-style: none; padding: 0; margin: 0 0 12px;';
  for (const o of offers) {
    list.appendChild(renderOfferCard(o, { tr, resolveContact, onPick: (mode) => {
      settle({ accept: { offerFrom: o.from, mode } });
    }, now }));
  }
  sheet.appendChild(list);

  /* Footer: Cancel --------------------------------------------------- */
  const footer = document.createElement('div');
  footer.className = 'catch-up-chooser__footer';
  footer.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px; '
    + 'margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line, #eee);';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'catch-up-chooser__cancel';
  cancelBtn.textContent = tr('circle.chat.catch_up.chooser_cancel');
  cancelBtn.style.cssText = 'padding: 8px 14px; border: 1px solid var(--line, #ddd); '
    + 'background: transparent; border-radius: 8px; font: inherit; cursor: pointer;';
  cancelBtn.addEventListener('click', () => settle({ decline: true }));
  footer.appendChild(cancelBtn);
  sheet.appendChild(footer);

  container.appendChild(sheet);
  return container;
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Row renderer                                                            */
/* ─────────────────────────────────────────────────────────────────────── */

function renderOfferCard(o, { tr, resolveContact, onPick, now }) {
  const li = document.createElement('li');
  li.className = 'catch-up-chooser__offer';
  li.dataset.offerFrom = o.from;
  li.style.cssText = 'padding: 10px 0; border-bottom: 1px solid var(--line, #eee);';

  // Provider name: resolveContact wins, then shortAddr, then unknown.
  let displayName = null;
  try {
    if (typeof resolveContact === 'function') {
      const c = resolveContact(o.from);
      if (c && typeof c.displayName === 'string' && c.displayName) displayName = c.displayName;
    }
  } catch { /* defensive */ }
  if (!displayName) {
    displayName = o.from ? shortAddr(o.from) : tr('circle.chat.catch_up.chooser_unknown_provider');
  }

  const nameRow = document.createElement('div');
  nameRow.className = 'catch-up-chooser__offer-name';
  nameRow.textContent = displayName;
  nameRow.style.cssText = 'font-weight: 600; margin-bottom: 4px;';
  li.appendChild(nameRow);

  // Stats: "{{count}} messages · ~{{kb}} KB · most recent {{when}}".
  const offer = o.offer ?? {};
  const count = Number.isFinite(offer.count) ? offer.count : 0;
  const kb    = Math.max(1, Math.round((Number.isFinite(offer.sizeBytes) ? offer.sizeBytes : 0) / 1024));
  const when  = formatRelativeTs(offer.lastTs, now);

  const statsRow = document.createElement('div');
  statsRow.className = 'catch-up-chooser__offer-stats';
  statsRow.style.cssText = 'font-size: 12px; color: var(--ink-soft, #777); margin-bottom: 8px;';
  statsRow.textContent =
       `${tr('circle.chat.catch_up.chooser_msg_count', { count })} · `
     + `${tr('circle.chat.catch_up.chooser_size_kb',   { kb })} · `
     + `${tr('circle.chat.catch_up.chooser_recent',    { when })}`;
  li.appendChild(statsRow);

  // Mode buttons.
  const picker = document.createElement('div');
  picker.className = 'catch-up-chooser__picker';
  picker.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px;';
  const modes = [
    { mode: 'all',         labelKey: 'circle.chat.catch_up.chooser_all' },
    { mode: 'last-50',     labelKey: 'circle.chat.catch_up.chooser_last_50' },
    { mode: 'last-7-days', labelKey: 'circle.chat.catch_up.chooser_last_7d' },
  ];
  for (const m of modes) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `catch-up-chooser__mode catch-up-chooser__mode--${m.mode}`;
    btn.dataset.mode = m.mode;
    btn.dataset.offerFrom = o.from;
    btn.textContent = tr(m.labelKey);
    btn.style.cssText = 'padding: 6px 10px; border: 1px solid var(--line, #ddd); '
      + 'background: var(--card, #fff); border-radius: 6px; font: inherit; cursor: pointer;';
    btn.addEventListener('click', () => onPick(m.mode));
    picker.appendChild(btn);
  }
  li.appendChild(picker);
  return li;
}

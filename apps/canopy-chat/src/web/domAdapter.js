/**
 * **Platform: web** (DOM-dependent).  Needs an RN sibling under `rn/` — see
 * `Project Files/canopy-chat/coding-plan.md` § RN portability inventory.
 *
 * canopy-chat — DOM adapter.
 *
 * Converts a platform-neutral `RenderedReply` (from `renderer.js`) into
 * a DOM Element ready for insertion into the chat-message stream.
 *
 * Pure-DOM — no framework, no JSX.  Works in any DOM (browser, happy-
 * dom, jsdom).  The renderer's output is data; this adapter is the
 * "view" half.
 *
 * Phase v0.1 sub-slice 1.10 per `/Project Files/canopy-chat/coding-plan.md`.
 */

/**
 * @typedef {object} DomAdapterContext
 * @property {Document} doc                  the DOM document (browser: document)
 * @property {(opId: string, itemId: string) => void} [onButtonTap]
 *   Called when a list-item action button is tapped.  Receives the
 *   parsed callbackData (`<opId>:<itemId>`).  Optional; absent →
 *   buttons render but do nothing on click.
 */

/**
 * Render a RenderedReply or user-message envelope as a DOM Element.
 *
 * Three input shapes accepted:
 *   - { origin: 'user', text }                          → user bubble
 *   - { origin: 'shell', rendered: <RenderedReply> }    → shell reply
 *   - { kind: 'text' | 'list' | 'error', ... }          → direct RenderedReply
 *
 * @param {object}             message
 * @param {DomAdapterContext}  ctx
 * @returns {Element}
 */
export function renderToDom(message, ctx) {
  if (!ctx || !ctx.doc) {
    throw new TypeError('renderToDom: ctx.doc (Document) required');
  }
  const { doc } = ctx;

  if (message?.origin === 'user') {
    return renderUserBubble(message.text, ctx);
  }
  if (message?.origin === 'shell' && message.rendered) {
    return renderShellMessage(message.rendered, message.lifecycleState, ctx);
  }
  // Direct RenderedReply
  if (message?.kind) {
    return renderShellMessage(message, message.lifecycleState, ctx);
  }
  // Defensive fallback
  const el = doc.createElement('div');
  el.className = 'cc-message cc-message-unknown';
  el.textContent = `[unsupported message: ${JSON.stringify(message)}]`;
  return el;
}

/* ───── user bubble ───── */

function renderUserBubble(text, { doc }) {
  const wrap = doc.createElement('div');
  wrap.className = 'cc-message cc-user';
  const bubble = doc.createElement('div');
  bubble.className = 'cc-bubble';
  bubble.textContent = String(text ?? '');
  wrap.appendChild(bubble);
  return wrap;
}

/* ───── shell messages ───── */

function renderShellMessage(rendered, lifecycleState, ctx) {
  const state = lifecycleState ?? rendered.lifecycleState ?? 'live';
  switch (rendered.kind) {
    case 'text':       return renderTextBubble(rendered, state, ctx);
    case 'error':      return renderErrorBubble(rendered, state, ctx);
    case 'list':       return renderListMessage(rendered, state, ctx);
    case 'record':     return renderRecordPanel(rendered, state, ctx, 'record');
    case 'mini-page':  return renderRecordPanel(rendered, state, ctx, 'mini-page');
    case 'brief':      return renderBrief(rendered, state, ctx);
    case 'find':       return renderFind(rendered, state, ctx);
    case 'form':       return renderFormShape(rendered, state, ctx);
    case 'embed-card': {
      // v0.5.5 — kind discriminator drives card layout.
      const variant = rendered.embed?.kind ?? 'item-card';
      if (variant === 'file-card') return renderFileCard(rendered, state, ctx);
      if (variant === 'time-card') return renderTimeCard(rendered, state, ctx);
      return renderEmbedCard(rendered, state, ctx);
    }
    default:           return renderUnknownShape(rendered, ctx);
  }
}

function renderTextBubble(rendered, state, ctx) {
  const { doc, onFollowUp } = ctx;
  const wrap = doc.createElement('div');
  wrap.className = `cc-message cc-shell cc-text cc-${state}`;
  if (rendered.messageId) wrap.dataset.messageId = rendered.messageId;
  const bubble = doc.createElement('div');
  bubble.className = 'cc-bubble';
  bubble.textContent = rendered.text ?? '';
  wrap.appendChild(bubble);

  // v0.6 — render sync hint sub-line under the bubble (only when
  // non-empty; central-style replies + absent _sync omit it).
  if (typeof rendered.syncHint === 'string' && rendered.syncHint !== '') {
    const hint = doc.createElement('div');
    hint.className = 'cc-sync-hint';
    hint.textContent = rendered.syncHint;
    wrap.appendChild(hint);
  }

  // v0.4 — render follow-up buttons under the text bubble.
  if (Array.isArray(rendered.followUps) && rendered.followUps.length > 0
      && state !== 'disabled'
      && typeof onFollowUp === 'function') {
    const kb = doc.createElement('div');
    kb.className = 'cc-followups';
    for (const fu of rendered.followUps) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'cc-followup-btn';
      btn.textContent = fu.label ?? `${fu.appOrigin}.${fu.opId}`;
      btn.addEventListener('click', () => onFollowUp(fu));
      kb.appendChild(btn);
    }
    wrap.appendChild(kb);
  }
  return wrap;
}

function renderErrorBubble(rendered, state, { doc }) {
  const wrap = doc.createElement('div');
  wrap.className = `cc-message cc-shell cc-error cc-${state}`;
  if (rendered.messageId) wrap.dataset.messageId = rendered.messageId;
  const bubble = doc.createElement('div');
  bubble.className = 'cc-bubble cc-error-bubble';
  bubble.textContent = rendered.text ?? '';
  wrap.appendChild(bubble);
  return wrap;
}

function renderListMessage(rendered, state, ctx) {
  const { doc, onButtonTap } = ctx;
  const wrap = doc.createElement('div');
  wrap.className = `cc-message cc-shell cc-list cc-${state}`;
  if (rendered.messageId) wrap.dataset.messageId = rendered.messageId;

  // v0.6 — list-level sync hint above the items.
  if (typeof rendered.syncHint === 'string' && rendered.syncHint !== '') {
    const hint = doc.createElement('div');
    hint.className = 'cc-sync-hint cc-sync-hint-list';
    hint.textContent = rendered.syncHint;
    wrap.appendChild(hint);
  }

  const ul = doc.createElement('ul');
  ul.className = 'cc-list-items';

  const items = rendered.items ?? [];
  if (items.length === 0) {
    const empty = doc.createElement('div');
    empty.className = 'cc-list-empty';
    empty.textContent = '(no items)';
    wrap.appendChild(empty);
    return wrap;
  }

  for (const item of items) {
    const li = doc.createElement('li');
    li.className = 'cc-list-item';
    li.dataset.itemId = item.id;

    const label = doc.createElement('span');
    label.className = 'cc-item-label';
    label.textContent = item.label;
    li.appendChild(label);

    // v0.6 — per-row staleness badge from item._lastSync.
    if (typeof item.staleHint === 'string' && item.staleHint !== '') {
      const stale = doc.createElement('span');
      stale.className = 'cc-row-stale';
      stale.textContent = item.staleHint;
      li.appendChild(stale);
    }

    if (Array.isArray(item.buttons) && item.buttons.length > 0) {
      const kb = doc.createElement('span');
      kb.className = 'cc-inline-keyboard';
      for (const btn of item.buttons) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'cc-keyboard-btn';
        button.textContent = btn.label;
        button.dataset.callback = btn.callbackData;
        if (state === 'disabled') {
          button.disabled = true;
          button.setAttribute('aria-disabled', 'true');
        } else if (typeof onButtonTap === 'function') {
          button.addEventListener('click', () => {
            const [opId, itemId] = String(btn.callbackData ?? '').split(':');
            onButtonTap(opId, itemId);
          });
        }
        kb.appendChild(button);
      }
      li.appendChild(kb);
    }
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  return wrap;
}

/**
 * Render a record / mini-page reply as a stable panel with field
 * rows + [Close] button.  Per A2 hybrid: these shapes stay 'live'
 * until the user explicitly closes them.
 *
 * @param {object} rendered
 * @param {'live'|'disabled'|'closed'} state
 * @param {DomAdapterContext} ctx
 * @param {'record' | 'mini-page'} variant
 */
function renderRecordPanel(rendered, state, ctx, variant) {
  const { doc, onCloseMessage } = ctx;
  const wrap = doc.createElement('div');
  wrap.className = `cc-message cc-shell cc-${variant} cc-${state}`;
  if (rendered.messageId) wrap.dataset.messageId = rendered.messageId;

  if (state === 'closed') {
    // Collapsed one-liner.
    const collapsed = doc.createElement('div');
    collapsed.className = 'cc-panel-collapsed';
    collapsed.textContent = rendered.title
      ? `(closed: ${rendered.title})`
      : '(closed)';
    wrap.appendChild(collapsed);
    return wrap;
  }

  // v0.6.3 — stale indicator: when the panel's underlying item has
  // received an item-changed event since this render, show a
  // "refresh needed" badge.  Caller (main.js) can re-fetch via the
  // originating op + replace the message.
  if (rendered.stale === true) {
    wrap.classList.add('cc-panel-stale');
    const indicator = doc.createElement('div');
    indicator.className = 'cc-panel-stale-indicator';
    indicator.textContent = '(stale — refresh to see latest)';
    wrap.appendChild(indicator);
  }

  // Title bar
  if (rendered.title) {
    const bar = doc.createElement('div');
    bar.className = 'cc-panel-title';
    const titleSpan = doc.createElement('span');
    titleSpan.textContent = rendered.title;
    bar.appendChild(titleSpan);

    if (typeof onCloseMessage === 'function') {
      const closeBtn = doc.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'cc-panel-close';
      closeBtn.textContent = '×';
      closeBtn.title = 'Close';
      closeBtn.addEventListener('click', () => onCloseMessage(rendered.messageId));
      bar.appendChild(closeBtn);
    }
    wrap.appendChild(bar);
  } else if (typeof onCloseMessage === 'function') {
    // No title — still expose a small floating close in the top-right.
    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cc-panel-close cc-panel-close-bare';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => onCloseMessage(rendered.messageId));
    wrap.appendChild(closeBtn);
  }

  // Field rows
  const body = doc.createElement('dl');
  body.className = 'cc-panel-fields';
  const fields = Array.isArray(rendered.fields) ? rendered.fields : [];
  if (fields.length === 0) {
    const empty = doc.createElement('div');
    empty.className = 'cc-panel-empty';
    empty.textContent = '(no fields)';
    wrap.appendChild(empty);
  } else {
    for (const field of fields) {
      const dt = doc.createElement('dt');
      dt.className = 'cc-field-name';
      dt.textContent = field.name;
      const dd = doc.createElement('dd');
      dd.className = `cc-field-value cc-field-${field.kind ?? 'unknown'}`;
      dd.textContent = formatFieldValue(field.value);
      body.appendChild(dt);
      body.appendChild(dd);
    }
    wrap.appendChild(body);
  }
  return wrap;
}

function formatFieldValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); }
  catch { return String(v); }
}

/**
 * Render an embed-card shape (J7) as a stable card with title,
 * issuer/claimer metadata, and per-recipient action buttons.
 *
 * @param {object} rendered
 * @param {'live'|'disabled'|'closed'} state
 * @param {DomAdapterContext} ctx
 */
function renderEmbedCard(rendered, state, ctx) {
  const { doc, onButtonTap, onCloseMessage, onClaimEmbed, manifestsByOrigin, localActor } = ctx;
  const embed = rendered.embed;
  const wrap = doc.createElement('div');
  wrap.className = `cc-message cc-shell cc-embed-card cc-${state}`;
  if (rendered.messageId) wrap.dataset.messageId = rendered.messageId;

  // Header with app + close
  const header = doc.createElement('div');
  header.className = 'cc-embed-header';
  const appBadge = doc.createElement('span');
  appBadge.className = 'cc-embed-app';
  appBadge.textContent = embed?.appOrigin ?? '?';
  header.appendChild(appBadge);

  if (typeof onCloseMessage === 'function') {
    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cc-panel-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => onCloseMessage(rendered.messageId));
    header.appendChild(closeBtn);
  }
  wrap.appendChild(header);

  // Title
  const title = doc.createElement('div');
  title.className = 'cc-embed-title';
  title.textContent = embed?.snapshot?.title
    ?? embed?.snapshot?.label
    ?? embed?.snapshot?.id
    ?? '(unnamed)';
  wrap.appendChild(title);

  // Fields (snapshot.fields rendered as a dl)
  const fields = embed?.snapshot?.fields ?? {};
  const fieldKeys = Object.keys(fields).filter((k) => !k.startsWith('_'));
  if (fieldKeys.length > 0) {
    const dl = doc.createElement('dl');
    dl.className = 'cc-embed-fields';
    for (const key of fieldKeys) {
      const dt = doc.createElement('dt');
      dt.textContent = key;
      const dd = doc.createElement('dd');
      dd.textContent = String(fields[key]);
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    wrap.appendChild(dl);
  }

  // Issuer / claimer metadata
  const meta = doc.createElement('div');
  meta.className = 'cc-embed-meta';
  if (embed?.issuedBy) {
    const issued = doc.createElement('span');
    issued.textContent = `issued by ${embed.issuedBy}`;
    issued.className = 'cc-embed-issued';
    meta.appendChild(issued);
  }
  if (embed?.claimedBy) {
    const claimed = doc.createElement('span');
    claimed.textContent = `claimed by ${embed.claimedBy}`;
    claimed.className = 'cc-embed-claimed';
    meta.appendChild(claimed);
  }
  if (meta.childNodes.length > 0) wrap.appendChild(meta);

  // v0.5.1 — [Claim] button when the local actor is a candidate
  // claimer (the embed has no claimedBy yet, AND the local actor
  // isn't the issuer — receivers claim, not issuers, unless they
  // explicitly claim-on-behalf via /embed --claim).  Per OQ-5
  // sender-issues/receiver-claims semantics.
  if (state !== 'disabled'
      && embed
      && !embed.claimedBy
      && typeof onClaimEmbed === 'function'
      && (!embed.issuedBy || embed.issuedBy !== localActor)) {
    const claimBtn = doc.createElement('button');
    claimBtn.type = 'button';
    claimBtn.className = 'cc-embed-claim-btn';
    claimBtn.textContent = 'Claim';
    claimBtn.addEventListener('click', () => onClaimEmbed(rendered.messageId));
    wrap.appendChild(claimBtn);
  }

  // Action buttons (Q28 button surfaces from the embed's appOrigin
  // manifest, gated by appliesTo against the snapshot).
  if (state !== 'disabled'
      && manifestsByOrigin
      && manifestsByOrigin[embed?.appOrigin]
      && typeof onButtonTap === 'function') {
    const manifest = manifestsByOrigin[embed.appOrigin];
    // Same canonical-state guard as src/embed.js — fields must not
    // override snapshot.state.
    const item = {
      ...(embed.snapshot.fields ?? {}),
      id: embed.snapshot.id, type: embed.snapshot.type, state: embed.snapshot.state,
    };
    const buttons = [];
    for (const op of manifest.operations ?? []) {
      const ui = op?.surfaces?.ui;
      if (!ui || ui.control !== 'button') continue;
      if (!embedAppliesTo(op.appliesTo, item)) continue;
      buttons.push({
        label:        ui.label ?? op.id,
        callbackData: `${op.id}:${item.id}`,
      });
    }
    if (buttons.length > 0) {
      const kb = doc.createElement('div');
      kb.className = 'cc-embed-actions';
      for (const btn of buttons) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'cc-keyboard-btn';
        b.textContent = btn.label;
        b.dataset.callback = btn.callbackData;
        b.addEventListener('click', () => {
          const [opId, itemId] = String(btn.callbackData).split(':');
          onButtonTap(opId, itemId, { appOrigin: embed.appOrigin });
        });
        kb.appendChild(b);
      }
      wrap.appendChild(kb);
    }
  }

  return wrap;
}

function embedAppliesTo(appliesTo, item) {
  if (!appliesTo) return true;
  if (!item || typeof item !== 'object') return false;
  if (appliesTo.type !== undefined) {
    const types = Array.isArray(appliesTo.type) ? appliesTo.type : [appliesTo.type];
    if (!types.includes('*') && !types.includes(item.type)) return false;
  }
  if (appliesTo.state !== undefined) {
    const states = Array.isArray(appliesTo.state) ? appliesTo.state : [appliesTo.state];
    if (!states.includes(item.state)) return false;
  }
  return true;
}

/**
 * v0.5.5 — file-card embed renderer.
 */
function renderFileCard(rendered, state, ctx) {
  const { doc, onCloseMessage } = ctx;
  const embed = rendered.embed;
  const snap  = embed?.snapshot ?? {};
  const wrap = doc.createElement('div');
  wrap.className = `cc-message cc-shell cc-embed-card cc-file-card cc-${state}`;
  if (rendered.messageId) wrap.dataset.messageId = rendered.messageId;

  appendEmbedHeader(wrap, embed, ctx, doc);

  const body = doc.createElement('div');
  body.className = 'cc-file-card-body';
  const icon = doc.createElement('span');
  icon.className = 'cc-file-icon';
  icon.textContent = '📄';
  body.appendChild(icon);

  const meta = doc.createElement('div');
  meta.className = 'cc-file-meta';
  const nameEl = doc.createElement('div');
  nameEl.className = 'cc-file-name';
  nameEl.textContent = snap.name ?? snap.id ?? '(unnamed file)';
  meta.appendChild(nameEl);

  const detailsLine = doc.createElement('div');
  detailsLine.className = 'cc-file-details';
  const details = [];
  if (typeof snap.mime  === 'string')  details.push(snap.mime);
  if (typeof snap.bytes === 'number')  details.push(formatBytes(snap.bytes));
  if (typeof snap.path  === 'string')  details.push(snap.path);
  detailsLine.textContent = details.join(' · ');
  if (details.length > 0) meta.appendChild(detailsLine);

  body.appendChild(meta);
  wrap.appendChild(body);

  appendIssuerClaimerMeta(wrap, embed, doc);
  appendClaimButton(wrap, embed, state, ctx, doc);
  // v0.7 catch-up — receiver-action stub buttons.  Real backing apps
  // declare these via manifest appliesTo: {type:'file'} when they
  // ship; until then the chat shell offers two no-op demos.
  appendDemoActions(wrap, embed, state, ctx, doc, [
    { label: 'Download',        op: 'demo-download'     },
    { label: 'Save to my pod',  op: 'demo-save-to-pod'  },
  ]);
  return wrap;
}

/**
 * v0.5.5 — time-card embed renderer.
 */
function renderTimeCard(rendered, state, ctx) {
  const { doc } = ctx;
  const embed = rendered.embed;
  const snap  = embed?.snapshot ?? {};
  const wrap = doc.createElement('div');
  wrap.className = `cc-message cc-shell cc-embed-card cc-time-card cc-${state}`;
  if (rendered.messageId) wrap.dataset.messageId = rendered.messageId;

  appendEmbedHeader(wrap, embed, ctx, doc);

  const body = doc.createElement('div');
  body.className = 'cc-time-card-body';
  const icon = doc.createElement('span');
  icon.className = 'cc-time-icon';
  icon.textContent = '📅';
  body.appendChild(icon);

  const meta = doc.createElement('div');
  meta.className = 'cc-time-meta';
  const title = doc.createElement('div');
  title.className = 'cc-time-title';
  title.textContent = snap.title ?? snap.id ?? '(untitled event)';
  meta.appendChild(title);

  const when = doc.createElement('div');
  when.className = 'cc-time-when';
  const whenParts = [];
  if (snap.startAt) whenParts.push(formatTime(snap.startAt));
  if (snap.endAt)   whenParts.push(`→ ${formatTime(snap.endAt)}`);
  if (snap.timezone && snap.timezone !== 'UTC') whenParts.push(`(${snap.timezone})`);
  when.textContent = whenParts.join(' ');
  if (whenParts.length > 0) meta.appendChild(when);

  if (snap.location) {
    const loc = doc.createElement('div');
    loc.className = 'cc-time-location';
    loc.textContent = `📍 ${snap.location}`;
    meta.appendChild(loc);
  }

  body.appendChild(meta);
  wrap.appendChild(body);

  appendIssuerClaimerMeta(wrap, embed, doc);
  appendClaimButton(wrap, embed, state, ctx, doc);
  // v0.7 catch-up — receiver-action stub buttons for time-card.
  // Future calendar app (task #111) declares these via manifest.
  appendDemoActions(wrap, embed, state, ctx, doc, [
    { label: 'Add to calendar', op: 'demo-add-to-calendar' },
    { label: 'Decline',         op: 'demo-decline'         },
  ]);
  return wrap;
}

/* ─── shared embed-card helpers ────────── */

/**
 * v0.7 — render demo stub buttons (file: [Download]/[Save to my pod];
 * time: [Add to calendar]/[Decline]).  Clicks fire onButtonTap with
 * a 'demo-...' opId; main.js handles them with a placeholder reply.
 * Real backing apps replace these via manifest appliesTo when they
 * ship.
 */
function appendDemoActions(wrap, embed, state, ctx, doc, actions) {
  if (state === 'disabled') return;
  if (!Array.isArray(actions) || actions.length === 0) return;
  if (typeof ctx.onButtonTap !== 'function') return;
  const kb = doc.createElement('div');
  kb.className = 'cc-embed-actions cc-demo-actions';
  for (const a of actions) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'cc-keyboard-btn cc-demo-action';
    btn.textContent = a.label;
    btn.dataset.demo = '1';
    btn.addEventListener('click', () => ctx.onButtonTap(a.op, embed?.snapshot?.id ?? '', { embed }));
    kb.appendChild(btn);
  }
  wrap.appendChild(kb);
}

function appendEmbedHeader(wrap, embed, ctx, doc) {
  const { onCloseMessage } = ctx;
  const header = doc.createElement('div');
  header.className = 'cc-embed-header';
  const appBadge = doc.createElement('span');
  appBadge.className = 'cc-embed-app';
  appBadge.textContent = embed?.appOrigin ?? '?';
  header.appendChild(appBadge);
  if (typeof onCloseMessage === 'function') {
    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cc-panel-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => onCloseMessage(wrap.dataset.messageId));
    header.appendChild(closeBtn);
  }
  wrap.appendChild(header);
}

function appendIssuerClaimerMeta(wrap, embed, doc) {
  const meta = doc.createElement('div');
  meta.className = 'cc-embed-meta';
  if (embed?.issuedBy) {
    const issued = doc.createElement('span');
    issued.textContent = `issued by ${embed.issuedBy}`;
    issued.className = 'cc-embed-issued';
    meta.appendChild(issued);
  }
  if (embed?.claimedBy) {
    const claimed = doc.createElement('span');
    claimed.textContent = `claimed by ${embed.claimedBy}`;
    claimed.className = 'cc-embed-claimed';
    meta.appendChild(claimed);
  }
  if (meta.childNodes.length > 0) wrap.appendChild(meta);
}

function appendClaimButton(wrap, embed, state, ctx, doc) {
  const { onClaimEmbed, localActor } = ctx;
  if (state !== 'disabled'
      && embed
      && !embed.claimedBy
      && typeof onClaimEmbed === 'function'
      && (!embed.issuedBy || embed.issuedBy !== localActor)) {
    const claimBtn = doc.createElement('button');
    claimBtn.type = 'button';
    claimBtn.className = 'cc-embed-claim-btn';
    claimBtn.textContent = 'Claim';
    claimBtn.addEventListener('click', () => onClaimEmbed(wrap.dataset.messageId));
    wrap.appendChild(claimBtn);
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n) => String(n).padStart(2, '0');
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
    const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    return `${date} ${time}`;
  } catch {
    return String(iso);
  }
}

/**
 * v0.7 — render a brief-shape reply (Q30 aggregator output).  Each
 * section becomes a labelled block; the section's payload is
 * rendered with the same rules as the top-level shapes (text /
 * list-with-items).  A [Refresh] button at the top re-runs /brief.
 *
 * @param {object} rendered
 * @param {'live'|'disabled'|'closed'} state
 * @param {DomAdapterContext} ctx
 */
function renderBrief(rendered, state, ctx) {
  const { doc, onCloseMessage, onBriefRefresh, onButtonTap } = ctx;
  const wrap = doc.createElement('div');
  wrap.className = `cc-message cc-shell cc-brief cc-${state}`;
  if (rendered.messageId) wrap.dataset.messageId = rendered.messageId;

  // Header — generated-at + refresh button + close.
  const header = doc.createElement('div');
  header.className = 'cc-brief-header';
  const title = doc.createElement('span');
  title.className = 'cc-brief-title';
  title.textContent = 'Morning brief';
  header.appendChild(title);

  const actions = doc.createElement('span');
  actions.className = 'cc-brief-actions';
  if (typeof onBriefRefresh === 'function' && state !== 'disabled') {
    const refresh = doc.createElement('button');
    refresh.type = 'button';
    refresh.className = 'cc-brief-refresh';
    refresh.textContent = '↻ Refresh';
    refresh.title = 'Re-run /brief and bypass the cache';
    refresh.addEventListener('click', () => onBriefRefresh());
    actions.appendChild(refresh);
  }
  if (typeof onCloseMessage === 'function') {
    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cc-panel-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => onCloseMessage(rendered.messageId));
    actions.appendChild(closeBtn);
  }
  header.appendChild(actions);
  wrap.appendChild(header);

  // Empty-state.
  if (!Array.isArray(rendered.sections) || rendered.sections.length === 0) {
    const empty = doc.createElement('div');
    empty.className = 'cc-brief-empty';
    empty.textContent = 'Nothing to report.';
    wrap.appendChild(empty);
    return wrap;
  }

  // Sections.
  for (const section of rendered.sections) {
    const block = doc.createElement('section');
    block.className = 'cc-brief-section';
    block.dataset.appOrigin = section.appOrigin;

    const label = doc.createElement('h3');
    label.className = 'cc-brief-section-label';
    label.textContent = section.label;
    block.appendChild(label);

    if (section.error) {
      const errEl = doc.createElement('div');
      errEl.className = 'cc-brief-section-error';
      errEl.textContent = `(${section.error})`;
      block.appendChild(errEl);
    } else {
      block.appendChild(renderBriefSectionPayload(section, doc, onButtonTap));
    }
    wrap.appendChild(block);
  }

  return wrap;
}

/**
 * Render the per-section payload.  Supports the common shapes:
 *   - { items: [...] } → small bullet list (label-only; no inline
 *                        keyboards in brief sections — they're
 *                        summary cards, not action menus)
 *   - { message: '...' } → text block
 *   - { count: N, label: '...' } → "<N> <label>" line
 *   - object → key:value pairs
 *   - primitive → toString
 */
function renderBriefSectionPayload(section, doc, onButtonTap) {
  const wrap = doc.createElement('div');
  wrap.className = 'cc-brief-section-body';
  const p = section.payload;
  if (p === null || p === undefined) {
    wrap.textContent = '(empty)';
    return wrap;
  }
  if (typeof p === 'object' && Array.isArray(p.items)) {
    const ul = doc.createElement('ul');
    ul.className = 'cc-brief-list';
    for (const it of p.items) {
      const li = doc.createElement('li');
      li.textContent = String(it?.label ?? it?.title ?? it?.id ?? it);
      ul.appendChild(li);
    }
    wrap.appendChild(ul);
    return wrap;
  }
  if (typeof p === 'object' && typeof p.count === 'number') {
    wrap.textContent = `${p.count}${p.label ? ` ${p.label}` : ''}`;
    return wrap;
  }
  if (typeof p === 'object' && typeof p.message === 'string') {
    wrap.textContent = p.message;
    return wrap;
  }
  if (typeof p === 'string' || typeof p === 'number' || typeof p === 'boolean') {
    wrap.textContent = String(p);
    return wrap;
  }
  if (typeof p === 'object') {
    // Render as dl of non-meta keys.
    const dl = doc.createElement('dl');
    dl.className = 'cc-brief-section-fields';
    for (const [k, v] of Object.entries(p)) {
      if (k.startsWith('_') || k === 'ok') continue;
      const dt = doc.createElement('dt'); dt.textContent = k;
      const dd = doc.createElement('dd');
      dd.textContent = typeof v === 'object' ? JSON.stringify(v) : String(v);
      dl.appendChild(dt); dl.appendChild(dd);
    }
    wrap.appendChild(dl);
    return wrap;
  }
  wrap.textContent = String(p);
  return wrap;
}

/**
 * v0.7 catch-up — render a `kind: 'form'` shell message.  Forms get
 * created in `web/main.js`'s `needsForm` route handler: a `formElement`
 * is built via `renderForm()` and stuffed onto the shell message.
 * The original v0.3.0 path then patched the DOM via setTimeout — but
 * that left a brief flash of `[shape "form" not yet supported]` AND
 * lost the form entirely on re-renders (user-reported 2026-05-23).
 *
 * This case returns the formElement directly so the renderer pipeline
 * handles it like any other shape.  If formElement is missing (e.g.
 * the message rehydrated from IDB and structured-clone dropped the
 * DOM ref), show a soft "form expired" placeholder.
 */
function renderFormShape(rendered, state, { doc }) {
  if (rendered.formElement && typeof rendered.formElement === 'object') {
    return rendered.formElement;
  }
  const el = doc.createElement('div');
  el.className = `cc-message cc-shell cc-form-expired cc-${state}`;
  if (rendered.messageId) el.dataset.messageId = rendered.messageId;
  el.textContent = `(form for ${rendered.text ?? 'a previous request'} — expired; re-run the command)`;
  return el;
}

/**
 * v0.7.5 — render a /find result.  One section per app with matches;
 * each row is clickable and dispatches a getSnapshot-style /embed
 * (future) — for v0.7.5 the rows are informational labels.
 * Extensive-search button at the bottom is a stub today.
 */
function renderFind(rendered, state, ctx) {
  const { doc, onCloseMessage, onButtonTap } = ctx;
  const wrap = doc.createElement('div');
  wrap.className = `cc-message cc-shell cc-find cc-${state}`;
  if (rendered.messageId) wrap.dataset.messageId = rendered.messageId;

  const header = doc.createElement('div');
  header.className = 'cc-brief-header cc-find-header';
  const title = doc.createElement('span');
  title.className = 'cc-brief-title';
  title.textContent = rendered.query
    ? `Results for "${rendered.query}"`
    : 'Search';
  header.appendChild(title);
  if (typeof onCloseMessage === 'function') {
    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cc-panel-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => onCloseMessage(rendered.messageId));
    header.appendChild(closeBtn);
  }
  wrap.appendChild(header);

  if (!Array.isArray(rendered.groups) || rendered.groups.length === 0) {
    const empty = doc.createElement('div');
    empty.className = 'cc-brief-empty';
    empty.textContent = 'No matches.';
    wrap.appendChild(empty);
  } else {
    for (const group of rendered.groups) {
      const block = doc.createElement('section');
      block.className = 'cc-brief-section cc-find-group';
      block.dataset.appOrigin = group.appOrigin;
      const label = doc.createElement('h3');
      label.className = 'cc-brief-section-label';
      label.textContent = `${group.appOrigin}  (${group.items.length})`;
      block.appendChild(label);

      if (group.error) {
        const err = doc.createElement('div');
        err.className = 'cc-brief-section-error';
        err.textContent = `(${group.error})`;
        block.appendChild(err);
      } else {
        const ul = doc.createElement('ul');
        ul.className = 'cc-brief-list cc-find-list';
        for (const it of group.items) {
          const li = doc.createElement('li');
          li.textContent = it.label;
          li.dataset.itemId = it.id;
          if (it.type) li.dataset.itemType = it.type;
          ul.appendChild(li);
        }
        block.appendChild(ul);
      }
      wrap.appendChild(block);
    }
  }

  // [Extensive search] stub — surfaces when extensiveAvailable.
  if (rendered.extensiveAvailable && typeof onButtonTap === 'function') {
    const footer = doc.createElement('div');
    footer.className = 'cc-find-footer';
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'cc-keyboard-btn cc-find-extensive';
    btn.textContent = 'Extensive search (pod + network)';
    btn.title = 'Stub — backing skills land per-app';
    btn.addEventListener('click', () => onButtonTap('demo-extensive-search', rendered.query));
    footer.appendChild(btn);
    wrap.appendChild(footer);
  }
  return wrap;
}

function renderUnknownShape(rendered, { doc }) {
  const el = doc.createElement('div');
  el.className = 'cc-message cc-unknown-shape';
  el.textContent = `[shape "${rendered.kind}" not yet supported]`;
  return el;
}

/* ───── stream-level helpers ───── */

/**
 * Replace the children of `container` with a re-rendered message
 * stream from `thread.messages`.  Used after `addUserMessage()` so
 * the A2 lifecycle changes (action menus → disabled) become visible.
 *
 * @param {Element}  container
 * @param {Array<object>} messages   thread.messages
 * @param {DomAdapterContext} ctx
 */
export function renderStream(container, messages, ctx) {
  // Clear existing children.
  while (container.firstChild) container.removeChild(container.firstChild);
  for (const m of messages) {
    container.appendChild(renderToDom(m, ctx));
  }
  // Auto-scroll to bottom.
  container.scrollTop = container.scrollHeight;
}

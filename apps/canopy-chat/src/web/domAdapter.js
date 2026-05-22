/**
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
    case 'embed-card': return renderEmbedCard(rendered, state, ctx);
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

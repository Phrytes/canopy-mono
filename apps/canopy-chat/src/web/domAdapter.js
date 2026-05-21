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
    case 'text':  return renderTextBubble(rendered, state, ctx);
    case 'error': return renderErrorBubble(rendered, state, ctx);
    case 'list':  return renderListMessage(rendered, state, ctx);
    default:      return renderUnknownShape(rendered, ctx);
  }
}

function renderTextBubble(rendered, state, { doc }) {
  const wrap = doc.createElement('div');
  wrap.className = `cc-message cc-shell cc-text cc-${state}`;
  if (rendered.messageId) wrap.dataset.messageId = rendered.messageId;
  const bubble = doc.createElement('div');
  bubble.className = 'cc-bubble';
  bubble.textContent = rendered.text ?? '';
  wrap.appendChild(bubble);
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

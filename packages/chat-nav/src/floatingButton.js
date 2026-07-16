/**
 * @onderling/chat-nav — floating back-to-chat button.
 *
 * Renders a fixed-position button bottom-right of the host element
 * (defaults to `document.body`).  Clicking the button navigates to
 * the chat URL.
 *
 * Idempotent: calling `renderFloatingButton` twice replaces the
 * existing button rather than stacking.
 */

const CLASS_NAME = 'canopy-chat-nav-back-button';

/**
 * @typedef {object} FloatingButtonOpts
 * @property {string}   returnTo            threadId to navigate back to
 * @property {string}   [chatPath='/']      relative chat URL
 * @property {string}   [label='← back to chat']
 * @property {Document} [doc]               defaults to globalThis.document
 * @property {(href: string) => void} [onNavigate]
 *   Override the default `globalThis.location.assign(href)` (useful
 *   for SPA routers + tests).
 */

/**
 * Render the floating button.  Returns the button element so callers
 * can attach extra behaviour if needed.
 *
 * @param {Element} [host]                  defaults to document.body
 * @param {FloatingButtonOpts} opts
 * @returns {Element}
 */
export function renderFloatingButton(host, opts) {
  if (!opts || typeof opts !== 'object') {
    throw new TypeError('renderFloatingButton: opts required');
  }
  const { returnTo, chatPath = '/', label = '← back to chat', onNavigate } = opts;
  if (typeof returnTo !== 'string' || returnTo === '') {
    throw new TypeError('renderFloatingButton: opts.returnTo required');
  }
  const doc  = opts.doc ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) throw new Error('renderFloatingButton: no document available');
  const root = host ?? doc.body;

  // Replace existing (idempotent).
  removeFloatingButton(root);

  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = CLASS_NAME;
  btn.textContent = label;
  styleButton(btn);

  const safeId = encodeURIComponent(returnTo);
  const sep    = chatPath.includes('?') ? '&' : '?';
  const href   = `${chatPath}${sep}focus=${safeId}`;
  btn.dataset.href = href;

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof onNavigate === 'function') return onNavigate(href);
    if (typeof globalThis !== 'undefined' && globalThis.location) {
      globalThis.location.assign(href);
    }
  });

  root.appendChild(btn);
  return btn;
}

/**
 * Remove a previously-rendered floating button if present.
 *
 * @param {Element} [host=document.body]
 */
export function removeFloatingButton(host) {
  const root = host ?? (typeof document !== 'undefined' ? document.body : null);
  if (!root) return;
  const existing = root.querySelector(`.${CLASS_NAME}`);
  if (existing) existing.remove();
}

function styleButton(btn) {
  // Inline styles so consumers don't need to ship CSS to get a
  // usable button.  Apps with their own design system may override
  // via the .canopy-chat-nav-back-button class.
  Object.assign(btn.style, {
    position:   'fixed',
    bottom:     '1rem',
    right:      '1rem',
    padding:    '0.5rem 0.9rem',
    background: '#1d6e56',
    color:      '#fff',
    border:     'none',
    borderRadius: '999px',
    cursor:     'pointer',
    fontSize:   '0.9rem',
    boxShadow:  '0 2px 8px rgba(0,0,0,0.15)',
    zIndex:     '9999',
  });
}

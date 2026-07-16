/**
 * basis v2 — Q27 confirm-gate dialog (web presenter).
 *
 * Renders the shared `ConfirmRequest` model (src/v2/confirmGate.js —
 * the manifest's `surfaces.ui.confirm` message + localised chrome) as a
 * minimal self-contained modal.  Mirrors the established v2 overlay
 * pattern (catchUpChooserModal / recipeConflictResolver): inline
 * styles, backdrop + ESC = cancel, no shared "Modal" abstraction.
 *
 * Severity 'danger' colours the accept button with the theme's
 * `--danger` tokens (red confirm — the Q27 Tier C affordance the
 * agents manifest declares on revokeAgent / purgeAgent /
 * restoreDataVersion).
 *
 * Pure DOM + single-shot `onResolve(accepted)` — the host wraps it in a
 * Promise (see circleApp's `openCircleConfirmDialog`) and removes the
 * container after settle.  NO dispatch logic lives here (invariant #1):
 * accept/cancel semantics belong to the shared `runConfirmGate`.
 */

/**
 * @param {HTMLElement} container
 * @param {object} args
 * @param {import('../../src/v2/confirmGate.js').ConfirmRequest} args.request
 * @param {(accepted: boolean) => void} args.onResolve  called exactly once
 */
export function renderConfirmDialog(container, { request = {}, onResolve } = {}) {
  const resolved = typeof onResolve === 'function' ? onResolve : () => {};
  const severity = request.severity === 'danger' ? 'danger' : 'warn';
  container.innerHTML = '';
  container.classList.add('cc-confirm');
  container.dataset.severity = severity;

  // Self-contained backdrop — mirrors catchUpChooserModal.
  Object.assign(container.style, {
    position: 'fixed', inset: '0', zIndex: '210',
    background: 'rgba(0,0,0,0.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '16px',
  });

  let settled = false;
  function settle(accepted) {
    if (settled) return;
    settled = true;
    try { document.removeEventListener('keydown', onKeydown); } catch { /* defensive */ }
    try { resolved(!!accepted); } catch { /* host decides what to do with errors */ }
  }
  function onKeydown(e) {
    if (e?.key === 'Escape') { e.preventDefault(); settle(false); }
  }
  document.addEventListener('keydown', onKeydown);

  // Backdrop click = cancel (never accept); sheet clicks don't dismiss.
  container.addEventListener('click', (e) => { if (e.target === container) settle(false); });

  const sheet = document.createElement('div');
  sheet.className = 'cc-confirm__sheet';
  Object.assign(sheet.style, {
    background: 'var(--card, #fff)',
    border: '1px solid var(--line, #ddd)',
    borderRadius: 'var(--radius, 10px)',
    padding: '18px 20px',
    maxWidth: '420px', width: '100%',
    boxShadow: '0 8px 28px rgba(0,0,0,.20)',
  });
  sheet.addEventListener('click', (e) => e.stopPropagation());

  const titleEl = document.createElement('h2');
  titleEl.className = 'cc-confirm__title';
  titleEl.textContent = request.title ?? '';
  titleEl.style.cssText = 'margin: 0 0 8px; font-size: 17px;';
  sheet.appendChild(titleEl);

  const msgEl = document.createElement('p');
  msgEl.className = 'cc-confirm__message';
  msgEl.textContent = request.message ?? '';
  msgEl.style.cssText = 'margin: 0 0 16px; font-size: 14px; line-height: 1.45;';
  sheet.appendChild(msgEl);

  const footer = document.createElement('div');
  footer.className = 'cc-confirm__footer';
  footer.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'cc-confirm__cancel';
  cancelBtn.textContent = request.cancelLabel ?? '';
  cancelBtn.style.cssText = 'padding: 8px 14px; border: 1px solid var(--line, #ddd); '
    + 'background: transparent; border-radius: 8px; font: inherit; cursor: pointer;';
  cancelBtn.addEventListener('click', () => settle(false));
  footer.appendChild(cancelBtn);

  const acceptBtn = document.createElement('button');
  acceptBtn.type = 'button';
  acceptBtn.className = `cc-confirm__accept cc-confirm__accept--${severity}`;
  acceptBtn.dataset.severity = severity;
  acceptBtn.textContent = request.acceptLabel ?? '';
  acceptBtn.style.cssText = severity === 'danger'
    // Red/destructive accept — the theme's danger tokens (theme.css).
    ? 'padding: 8px 14px; border: 1px solid var(--danger, #b04a30); '
      + 'background: var(--danger, #b04a30); color: #fff; border-radius: 8px; font: inherit; cursor: pointer;'
    : 'padding: 8px 14px; border: 1px solid var(--line, #ddd); '
      + 'background: var(--danger-bg, #f6e6e0); border-radius: 8px; font: inherit; cursor: pointer;';
  acceptBtn.addEventListener('click', () => settle(true));
  footer.appendChild(acceptBtn);

  sheet.appendChild(footer);
  container.appendChild(sheet);
  // Focus the SAFE choice so Enter doesn't accidentally accept a destructive op.
  try { cancelBtn.focus(); } catch { /* non-interactive env */ }
  return container;
}

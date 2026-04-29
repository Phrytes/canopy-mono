/**
 * auth.js — Folio.B1.auth UI controller.
 *
 * Owns the top-right "Sign in" / status pill, the issuer-picker modal,
 * and a small polling loop against /auth/status so the pill updates after
 * the OIDC redirect lands the user back on `/`.
 *
 * Wired by app.js via `initAuth({ getJson, postJson, bus })`.
 */

const POLL_INTERVAL_MS = 5_000;

export function initAuth({ getJson, postJson, bus } = {}) {
  if (typeof getJson !== 'function' || typeof postJson !== 'function') {
    throw new Error('initAuth: getJson + postJson are required');
  }

  const els = {
    pill:        document.getElementById('auth-pill'),
    pillState:   document.getElementById('auth-pill-state'),
    pillWebid:   document.getElementById('auth-pill-webid'),
    signinBtn:   document.getElementById('auth-signin-btn'),
    signoutBtn:  document.getElementById('auth-signout-btn'),
    modal:       document.getElementById('auth-modal'),
    issuerForm:  document.getElementById('auth-issuer-form'),
    customInput: document.getElementById('auth-issuer-custom'),
    cancelBtn:   document.getElementById('auth-cancel-btn'),
    modalLog:    document.getElementById('auth-modal-log'),
  };
  if (!els.pill) return; // Auth UI not present (e.g. in legacy index.html) — bail.

  let pollTimer = null;
  let lastStatus = null;

  // ── Render helpers ──────────────────────────────────────────────────────
  function paint(status) {
    lastStatus = status;
    if (!status || typeof status !== 'object') {
      els.pillState.textContent = 'unknown';
      els.pillState.className   = 'auth-pill__state auth-pill__state--unknown';
      els.pillWebid.textContent = '';
      els.signinBtn.hidden  = false;
      els.signoutBtn.hidden = true;
      return;
    }
    if (status.authenticated) {
      els.pillState.textContent = 'signed in';
      els.pillState.className   = 'auth-pill__state auth-pill__state--ok';
      els.pillWebid.textContent = status.webid ?? '';
      els.signinBtn.hidden  = true;
      els.signoutBtn.hidden = false;
    } else {
      els.pillState.textContent = 'signed out';
      els.pillState.className   = 'auth-pill__state auth-pill__state--off';
      els.pillWebid.textContent = '';
      els.signinBtn.hidden  = false;
      els.signoutBtn.hidden = true;
    }
    bus?.emit?.('auth.status', status);
  }

  function logModal(msg, kind = 'info') {
    if (!els.modalLog) return;
    const line = document.createElement('div');
    line.className = `log__line log__line--${kind}`;
    line.textContent = msg;
    els.modalLog.appendChild(line);
  }

  // ── Polling /auth/status ────────────────────────────────────────────────
  async function refresh() {
    try {
      const status = await getJson('/auth/status');
      paint(status);
    } catch (err) {
      // /auth/status doesn't exist if the server is older without auth wired —
      // surface "unknown" once, but don't keep retrying loudly.
      if (err && err.status === 404) {
        paint({ authenticated: false });
        stopPolling();
        return;
      }
      // Otherwise: leave the pill alone; transient network blips are fine.
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(refresh, POLL_INTERVAL_MS);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ── Modal open / close ──────────────────────────────────────────────────
  function openModal() {
    if (els.modalLog) els.modalLog.textContent = '';
    els.modal.hidden = false;
  }
  function closeModal() { els.modal.hidden = true; }

  // ── Wire events ─────────────────────────────────────────────────────────
  els.signinBtn?.addEventListener('click', openModal);
  els.cancelBtn?.addEventListener('click', closeModal);

  els.signoutBtn?.addEventListener('click', async () => {
    try {
      await postJson('/auth/logout');
      paint({ authenticated: false });
    } catch (err) {
      // Stay defensive — show but don't crash.
      console.error('logout failed', err);
    }
  });

  els.issuerForm?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const choice = els.issuerForm.elements['issuer-choice'].value;
    const issuer = choice === 'custom'
      ? (els.customInput?.value ?? '').trim()
      : choice;
    if (!issuer || !/^https?:\/\//i.test(issuer)) {
      logModal('Please enter a valid https:// issuer URL.', 'error');
      return;
    }
    try {
      const { redirectUrl } = await postJson('/auth/login', { issuer });
      if (typeof redirectUrl !== 'string' || redirectUrl.length === 0) {
        logModal('Server did not return a redirect URL.', 'error');
        return;
      }
      // Hand off to the IdP.
      window.location.assign(redirectUrl);
    } catch (err) {
      logModal(`Sign-in failed: ${err?.message ?? err}`, 'error');
    }
  });

  // ── Boot ────────────────────────────────────────────────────────────────
  refresh().then(startPolling);

  // Test seam: expose a hook for jsdom assertions.
  window.__folioAuth = {
    refresh,
    paint,
    get last() { return lastStatus; },
  };
}

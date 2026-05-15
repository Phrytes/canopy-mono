/**
 * share.js — Share pane.
 *
 * Renders the mint-token form, posts to /share, and keeps a list of
 * recently-minted shares in browser localStorage (the server doesn't
 * persist these in v1).
 */

const STORAGE_KEY = 'folio.recent-shares';
const MAX_RECENT  = 10;

export function initShare({ bus, postJson }) {
  const $form     = document.getElementById('share-form');
  const $webid    = document.getElementById('share-webid');
  const $expires  = document.getElementById('share-expires');
  const $path     = document.getElementById('share-path');
  const $scopeR   = document.getElementById('scope-read');
  const $scopeW   = document.getElementById('scope-write');
  const $scopeD   = document.getElementById('scope-delete');
  const $result   = document.getElementById('share-result');
  const $tokenOut = document.getElementById('share-token-out');
  const $btnCopy  = document.getElementById('btn-copy-token');
  const $log      = document.getElementById('share-log');
  const $recent   = document.getElementById('share-recent');

  function logEntry(msg, isErr = false) {
    const div = document.createElement('div');
    div.className = `log-entry${isErr ? ' log-entry--err' : ''}`;
    const ts = new Date().toLocaleTimeString();
    div.textContent = `[${ts}] ${msg}`;
    $log.appendChild(div);
    while ($log.childNodes.length > 20) $log.removeChild($log.firstChild);
  }

  function loadRecent() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  function saveRecent(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
    } catch { /* quota / disabled */ }
  }

  function renderRecent() {
    const list = loadRecent();
    while ($recent.firstChild) $recent.removeChild($recent.firstChild);
    if (list.length === 0) {
      const empty = document.createElement('li');
      empty.className   = 'empty';
      empty.textContent = 'No recent shares.';
      $recent.appendChild(empty);
      return;
    }
    for (const entry of list) {
      const li = document.createElement('li');
      const when = new Date(entry.mintedAt).toLocaleString();
      // textContent for every user-controlled field.
      const top = document.createElement('div');
      // Phase 52.16.4 — label rows with the share mode (cap-token /
      // ACP grant / WAC grant) so users can tell the kinds apart.
      const modeLabel = entry.mode === 'acp'  ? '[ACP] '
                      : entry.mode === 'wac'  ? '[WAC] '
                      : '[cap-token] ';
      top.textContent = `${modeLabel}${when} → ${entry.webid}`;
      const sub = document.createElement('div');
      const code = document.createElement('code');
      code.textContent = (entry.scopes || []).join(', ');
      sub.appendChild(code);
      li.appendChild(top);
      li.appendChild(sub);
      $recent.appendChild(li);
    }
  }

  function gatherScopes() {
    const out = [];
    if ($scopeR.checked) out.push('read');
    if ($scopeW.checked) out.push('write');
    if ($scopeD.checked) out.push('delete');
    return out;
  }

  $form.addEventListener('submit', async (ev) => {
    ev.preventDefault();

    const webid = $webid.value.trim();
    const scopes = gatherScopes();
    if (!webid)         { logEntry('webid is required', true); return; }
    if (scopes.length === 0) { logEntry('select at least one scope', true); return; }

    const payload = {
      webid,
      scopes,
      expiresIn: parseInt($expires.value, 10),
    };
    const path = $path.value.trim();
    if (path) payload.path = path;

    try {
      const r = await postJson('/share', payload);
      // Phase 52.16.4 (2026-05-14) — server response carries `mode`
      // so we can render the right copy. Two shapes:
      //   { mode: 'cap-token', token: <PodCapabilityToken JSON> }
      //   { mode: 'acp' | 'wac', grant: {targetUri, agent, modes, ...} }
      if (r.mode === 'acp' || r.mode === 'wac') {
        $tokenOut.value = JSON.stringify(r.grant, null, 2);
        $result.hidden = false;
        const label = r.mode === 'acp' ? 'ACP grant' : 'WAC grant';
        logEntry(`${label} created on ${r.grant?.targetUri ?? '?'} for ${webid}`);
      } else {
        // Legacy cap-token shape (also the fall-back path).
        $tokenOut.value = JSON.stringify(r.token, null, 2);
        $result.hidden = false;
        logEntry(`cap-token minted for ${webid}`);
      }

      // Persist a redacted record (no signature/jwt) in localStorage.
      const list = loadRecent();
      list.unshift({
        mintedAt: Date.now(),
        webid,
        scopes,
        path:     payload.path ?? null,
        mode:     r.mode ?? 'cap-token',
        // For cap-token: issuer + tokenId for traceability.
        ...(r.token ? {
          issuer:    r.token.issuer ?? null,
          tokenId:   r.token.tokenId ?? null,
          expiresAt: r.token.expiresAt ?? null,
        } : {}),
        // For ACP/WAC: target URI + resolved modes.
        ...(r.grant ? {
          targetUri: r.grant.targetUri ?? null,
          modes:     r.grant.modes ?? [],
        } : {}),
      });
      saveRecent(list);
      renderRecent();
    } catch (err) {
      logEntry(`mint failed: ${err.message}${err.code ? ' ['+err.code+']' : ''}`, true);
    }
  });

  $btnCopy.addEventListener('click', async () => {
    const text = $tokenOut.value;
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        logEntry('token copied to clipboard');
      } else {
        // Fallback: select + execCommand('copy') — deprecated but widely
        // supported.  navigator.clipboard requires a secure context which
        // localhost-http counts for in modern browsers.
        $tokenOut.select();
        document.execCommand('copy');
        logEntry('token selected — press ⌘C / Ctrl+C to copy');
      }
    } catch (err) {
      logEntry(`copy failed: ${err.message}`, true);
    }
  });

  // First paint of the recent list on boot.
  renderRecent();
}

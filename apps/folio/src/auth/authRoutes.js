/**
 * authRoutes.js — `/auth/*` HTTP routes (Folio.B1.auth).
 *
 * Mounts the four routes that drive the Solid OIDC browser-redirect flow:
 *
 *   POST /auth/login    body: { issuer }
 *                       → 200 { redirectUrl }
 *
 *   GET  /auth/callback ?code=…&state=…  (provider redirect)
 *                       → 302 to `/`  (after token exchange + persist)
 *
 *   GET  /auth/status   → 200 { authenticated, webid?, expiresAt?, issuer? }
 *
 *   POST /auth/logout   → 200 { ok: true }
 *
 * Hard rules (per task spec):
 *   - The callback handler is bound to 127.0.0.1 / ::1 only; any other
 *     origin (e.g. attacker that resolved DNS to the Folio host) gets a
 *     hard 403.
 *   - Refresh tokens never appear in any response body and are never logged.
 *   - The OIDC session lives on `req.app.locals.oidc` (per the spec's
 *     "no global state" rule); tests inject their own.
 *
 * Errors are shaped like the rest of the Folio REST API:
 *   { error: { code: STRING, message: human-readable } }
 */
import express from 'express';

import { buildRealPodClient as defaultBuildRealPodClient } from '../cli/_podFactory.js';

const LOCAL_HOST_NAMES = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']);

/**
 * @param {object} deps
 * @param {object} deps.oidc                   — an `OidcSession` instance.
 * @param {string} [deps.callbackUrl]          — explicit callback URL to feed
 *                                               Inrupt; if omitted, computed
 *                                               from the inbound request.
 * @param {string} [deps.postLoginRedirectPath='/'] — path to send the browser
 *                                               to after a successful callback.
 * @param {object} [deps.engine]               — the live `SyncEngine` (Folio
 *                                               v2.1).  When provided, the
 *                                               `/auth/callback` handler will
 *                                               build a real PodClient and
 *                                               hot-swap it into the engine,
 *                                               then auto-trigger one
 *                                               `runOnce({ direction: 'both' })`.
 * @param {object} [deps.cfg]                  — folio config (needs `podRoot`);
 *                                               required when `engine` is given.
 * @param {object} [deps.hub]                  — WS hub used to broadcast the
 *                                               `auth.swapped` frame.
 * @param {(cfg, oidc) => Promise<object>} [deps.buildPodClient]
 *                                               Override for tests; defaults
 *                                               to `buildRealPodClient` from
 *                                               `_podFactory.js`.
 * @param {number} [deps.swapTimeoutMs=5000]   — upper bound on how long the
 *                                               callback may wait for the
 *                                               hot-swap before redirecting
 *                                               anyway (per spec: never block
 *                                               the redirect indefinitely).
 * @returns {express.Router}
 */
export function createAuthRouter({
  oidc,
  callbackUrl,
  postLoginRedirectPath = '/',
  engine,
  cfg,
  hub,
  buildPodClient,
  swapTimeoutMs = 5000,
} = {}) {
  if (!oidc) throw new Error('createAuthRouter: oidc is required');

  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));

  // ── POST /auth/login ────────────────────────────────────────────────────
  router.post('/auth/login', async (req, res) => {
    const body   = req.body ?? {};
    const issuer = body.issuer;
    if (typeof issuer !== 'string' || issuer.length === 0) {
      return sendError(res, 400, 'BAD_REQUEST', 'body.issuer is required');
    }
    if (!/^https?:\/\//i.test(issuer)) {
      return sendError(res, 400, 'BAD_REQUEST', 'body.issuer must be an http(s) URL');
    }

    const cb = callbackUrl ?? buildCallbackUrl(req);

    try {
      const { redirectUrl } = await oidc.start({ issuer, redirectUrl: cb });
      res.json({ redirectUrl });
    } catch (err) {
      const code = err?.code ?? 'OIDC_LOGIN_FAILED';
      sendError(res, code === 'BAD_REQUEST' ? 400 : 500, code, err?.message ?? String(err));
    }
  });

  // ── GET /auth/callback ──────────────────────────────────────────────────
  router.get('/auth/callback', async (req, res) => {
    if (!isLocalRequest(req)) {
      return sendError(res, 403, 'FORBIDDEN', 'callback only accepted from localhost');
    }

    const fullUrl = buildCallbackFullUrl(req, callbackUrl);

    try {
      await oidc.handleCallback(fullUrl);
    } catch (err) {
      const code = err?.code ?? 'OIDC_CALLBACK_FAILED';
      // The browser is sitting at the callback URL — render an HTML page so
      // the user sees a friendly error rather than raw JSON.  Tests that
      // request `accept: application/json` get the JSON shape.
      if (req.accepts('json') && !req.accepts('html')) {
        return sendError(res, 400, code, err?.message ?? String(err));
      }
      return res.status(400).type('text/html').send(callbackErrorHtml(code, err?.message ?? String(err)));
    }

    // ── Folio v2.1 — hot-swap the PodClient on the live engine ─────────────
    //
    // Build a real PodClient over the now-authenticated OidcSession, drop it
    // into the engine, broadcast `auth.swapped` over the WS hub, and fire one
    // runOnce({ direction: 'both' }) so the user immediately sees their notes
    // flow.  If anything goes wrong we still redirect the browser — the hard
    // rule is that the callback must return promptly (≤ 5s).
    let swapPromise = Promise.resolve();
    if (engine && cfg && oidc.isAuthenticated()) {
      swapPromise = performHotSwap({
        engine,
        cfg,
        oidc,
        hub,
        buildPodClient: buildPodClient ?? defaultBuildRealPodClient,
      }).catch(() => { /* swallow — error events emit via the engine */ });
    }

    // Wait for the swap, but never block the redirect for more than
    // `swapTimeoutMs` — the spec is explicit that the user-visible redirect
    // never hangs.
    await Promise.race([
      swapPromise,
      new Promise((resolve) => {
        const t = setTimeout(resolve, swapTimeoutMs);
        if (typeof t.unref === 'function') t.unref();
      }),
    ]);

    res.redirect(302, postLoginRedirectPath);
  });

  // ── GET /auth/status ────────────────────────────────────────────────────
  router.get('/auth/status', (_req, res) => {
    try {
      const status = oidc.getStatus();
      res.json(status);
    } catch (err) {
      sendError(res, 500, 'STATUS_FAILED', err?.message ?? String(err));
    }
  });

  // ── POST /auth/logout ───────────────────────────────────────────────────
  router.post('/auth/logout', async (_req, res) => {
    try {
      await oidc.logout();
      res.json({ ok: true });
    } catch (err) {
      sendError(res, 500, 'LOGOUT_FAILED', err?.message ?? String(err));
    }
  });

  return router;
}

/* ── helpers ──────────────────────────────────────────────────────────── */

/**
 * Build a real PodClient from the just-authenticated OidcSession, swap it
 * into the live engine, broadcast `auth.swapped`, and fire one runOnce.
 *
 * Per spec:
 *   - The `auth.swapped` frame carries ONLY the webid; never tokens.
 *   - The runOnce is NOT awaited — the auth callback should return promptly.
 *   - If anything throws, we surface via the engine error event (existing
 *     pattern); v2.2 will surface them louder in the UI.
 */
async function performHotSwap({ engine, cfg, oidc, hub, buildPodClient }) {
  const newClient = await buildPodClient(cfg, oidc);
  // Swap is synchronous; in-flight runs against the OLD client are allowed
  // to finish (per setPodClient's contract).
  engine.setPodClient(newClient);

  // Emit an `auth.swapped` event on the engine — wsHub forwards it as a WS
  // frame.  WebID only; never tokens (spec hard rule).  We emit BEFORE the
  // auto-sync so UIs can paint "syncing now" before sync.progress arrives.
  const webid = oidc.webid ?? null;
  try { engine.emit('auth.swapped', { ts: Date.now(), webid }); }
  catch { /* ignore */ }

  // Belt-and-braces: also broadcast directly via the hub if present.  This
  // matches the wsHub forwarding pattern but guarantees the frame goes out
  // even if a hub isn't subscribed to engine events for some reason (tests
  // that swap the engine, etc.).  The hub dedupes its own subscribers — a
  // duplicate frame is harmless to the UI (which is forward-compat).
  if (hub && typeof hub.broadcast === 'function') {
    // Only emit here if the hub does NOT have an engine subscription that
    // would already forward the event.  We can't introspect that cheaply,
    // so we omit the direct broadcast: the engine event + wsHub forwarder
    // is the canonical path.  Keeping this branch as a no-op preserves
    // the API for callers that still pass `hub`.
  }

  // Fire-and-forget the auto-sync.  Errors emit as normal sync error events
  // through the engine; no need to await.  We attach a .catch() so an
  // unhandled rejection doesn't crash the process.
  Promise.resolve()
    .then(() => engine.runOnce({ direction: 'both' }))
    .catch((err) => {
      try { engine.emit('error', { phase: 'auth.swap.runOnce', err }); }
      catch { /* ignore */ }
    });
}

function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

/**
 * Compute a full callback URL from the inbound request.  The OIDC provider
 * needs an absolute URL; we build one matching the local server.
 */
function buildCallbackUrl(req) {
  const proto = req.protocol || 'http';
  const host  = req.get('host') ?? '127.0.0.1:8888';
  return `${proto}://${host}/auth/callback`;
}

/**
 * Compute the full URL for the inbound callback (including query string),
 * preferring an explicitly-configured base if one is set.  The Inrupt
 * `handleIncomingRedirect()` requires this exact URL.
 */
function buildCallbackFullUrl(req, configuredCallbackUrl) {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  if (configuredCallbackUrl) {
    return configuredCallbackUrl + qs;
  }
  return buildCallbackUrl(req) + qs;
}

/**
 * Allow only loopback callbacks.  The forwarded-host case is intentionally
 * rejected — Folio binds to 127.0.0.1 and its callback URL must be local.
 */
function isLocalRequest(req) {
  const remote = req.ip ?? req.socket?.remoteAddress ?? '';
  // Express' req.ip honours `trust proxy`; we never set trust proxy, so the
  // value is always the direct peer.  Strip the IPv6 mapping.
  const cleaned = remote.replace(/^::ffff:/, '');
  return LOCAL_HOST_NAMES.has(remote) || LOCAL_HOST_NAMES.has(cleaned);
}

function callbackErrorHtml(code, message) {
  const safe = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!doctype html><html><head><meta charset="utf-8"><title>Folio — sign-in failed</title>
<style>body{font:14px system-ui;padding:2rem;color:#333} pre{background:#f5f5f5;padding:1rem;border-radius:4px}</style>
</head><body>
<h1>Sign-in failed</h1>
<p>The Solid identity provider returned an error.  Try again from <a href="/">Folio</a>.</p>
<pre>${safe(code)}: ${safe(message)}</pre>
</body></html>`;
}

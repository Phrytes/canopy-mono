/**
 * startRelay — HTTP(S) + WebSocket relay broker.
 *
 * The relay is a simple message broker: agents register by address, and the
 * relay forwards envelopes to the correct connected client. Offline recipients
 * get up to 50 messages queued for 5 minutes.
 *
 * Protocol (JSON over WebSocket):
 *   Client → Relay: { type: 'register', address: '<pubKey>' }
 *   Relay  → Client: { type: 'registered' }
 *   Client → Relay: { type: 'send',  to: '<address>', envelope: { ... } }
 *   Relay  → Client: { type: 'message', envelope: { ... } }
 *   Client → Relay: { type: 'peer-list' }                          // request
 *   Relay  → Client: { type: 'peer-list', peers: ['...','...'] }    // response + broadcast
 *   Relay  → Client: { type: 'error', message: '<reason>' }
 *
 * When `tlsCert` and `tlsKey` are supplied, the server listens on HTTPS/WSS.
 * Without them, HTTP/WS. Usage:
 *
 *   const { stop } = await startRelay({ port: 8787 });              // ws://
 *   const { stop } = await startRelay({ port: 443,
 *     tlsCert: readFileSync('cert.pem'),
 *     tlsKey:  readFileSync('key.pem') });                          // wss://
 *
 * See EXTRACTION-PLAN.md §7 Group S.
 */
import { createServer as createHttpServer }  from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile, stat }                    from 'node:fs/promises';
import { extname, join, resolve }            from 'node:path';
import { networkInterfaces }                 from 'node:os';
import { WebSocketServer }                   from 'ws';

const DEFAULT_PORT       = 8787;
const DEFAULT_QUEUE_TTL  = 5 * 60_000;  // 5 min
const DEFAULT_QUEUE_CAP  = 50;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
};

/**
 * Start a relay server.
 *
 * @param {object}   [opts]
 * @param {number}   [opts.port=8787]
 * @param {string}   [opts.host='0.0.0.0']
 * @param {string|Buffer} [opts.tlsCert]     PEM-encoded certificate (enables HTTPS)
 * @param {string|Buffer} [opts.tlsKey]      PEM-encoded private key
 * @param {string}   [opts.serveStaticDir]   Directory to serve over HTTP (optional)
 * @param {string}   [opts.indexFile]        Default file when path is '/' (default 'index.html')
 * @param {number}   [opts.queueTtlMs]       How long to buffer messages for offline peers
 * @param {number}   [opts.queueCap]         Max buffered messages per offline peer
 * @param {boolean}  [opts.log=false]        Log per-message events to stdout
 * @returns {Promise<{
 *   httpServer: import('node:http').Server | import('node:https').Server,
 *   wss: WebSocketServer,
 *   port: number,
 *   tls: boolean,
 *   stop: () => Promise<void>,
 * }>}
 */
export async function startRelay(opts = {}) {
  const {
    port            = DEFAULT_PORT,
    host            = '0.0.0.0',
    tlsCert,
    tlsKey,
    serveStaticDir,
    indexFile       = 'index.html',
    queueTtlMs      = DEFAULT_QUEUE_TTL,
    queueCap        = DEFAULT_QUEUE_CAP,
    log             = false,
  } = opts;

  const hasTls = Boolean(tlsCert && tlsKey);
  if ((tlsCert && !tlsKey) || (!tlsCert && tlsKey)) {
    throw new Error('startRelay: tlsCert and tlsKey must both be provided for TLS');
  }

  // ── HTTP(S) handler ────────────────────────────────────────────────────────
  const handler = async (req, res) => {
    if (!serveStaticDir) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('@canopy/relay — WebSocket endpoint only');
      return;
    }

    let pathname = req.url.split('?')[0];
    if (pathname === '/' || pathname === '') pathname = '/' + indexFile;

    const rootAbs  = resolve(serveStaticDir);
    const filePath = resolve(join(rootAbs, pathname));

    // Security: prevent path traversal outside the static root.
    if (!filePath.startsWith(rootAbs)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    try {
      const s = await stat(filePath);
      if (s.isDirectory()) { res.writeHead(404); res.end('Not a file'); return; }
      const data = await readFile(filePath);
      const mime = MIME[extname(filePath)] ?? 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type':                mime,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'no-cache',
      });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${pathname}`);
    }
  };

  const httpServer = hasTls
    ? createHttpsServer({ cert: tlsCert, key: tlsKey }, handler)
    : createHttpServer(handler);

  // ── WebSocket relay ────────────────────────────────────────────────────────
  const wss = new WebSocketServer({ server: httpServer });

  /** address → WebSocket */
  const clients = new Map();
  /** address → [{ envelope, at }] */
  const queue   = new Map();

  const logLine = (line) => { if (log) console.log(line); };

  wss.on('connection', (socket) => {
    let registeredAddress = null;

    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      // ── register ────────────────────────────────────────────────────────────
      if (msg.type === 'register') {
        const { address } = msg;
        if (!address) {
          socket.send(JSON.stringify({ type: 'error', message: 'Missing address' }));
          return;
        }

        registeredAddress = address;
        clients.set(address, socket);

        socket.send(JSON.stringify({ type: 'registered' }));
        logLine(`[relay] registered   ${shortId(address)}`);

        // Drain any queued messages.
        const queued = queue.get(address) ?? [];
        for (const { envelope } of queued) {
          try { socket.send(JSON.stringify({ type: 'message', envelope })); } catch {}
        }
        queue.delete(address);

        _broadcastPeerList(clients);
        return;
      }

      // ── send ────────────────────────────────────────────────────────────────
      if (msg.type === 'send') {
        const { to, envelope } = msg;
        if (!to || !envelope) return;

        const target = clients.get(to);
        if (target && target.readyState === 1 /* OPEN */) {
          logLine(`[relay] ${shortId(registeredAddress)} → ${shortId(to)}  _p=${envelope._p ?? '?'}`);
          target.send(JSON.stringify({ type: 'message', envelope }));
        } else {
          // Buffer up to queueCap messages per offline peer.
          if (!queue.has(to)) queue.set(to, []);
          const buf = queue.get(to);
          buf.push({ envelope, at: Date.now() });
          if (buf.length > queueCap) buf.shift();
        }
        return;
      }

      // ── peer-list request ───────────────────────────────────────────────────
      if (msg.type === 'peer-list') {
        socket.send(JSON.stringify({
          type:  'peer-list',
          peers: [...clients.keys()],
        }));
      }
    });

    socket.on('close', () => {
      if (registeredAddress) {
        clients.delete(registeredAddress);
        logLine(`[relay] disconnected ${shortId(registeredAddress)}`);
        _broadcastPeerList(clients);
      }
    });

    socket.on('error', () => {});
  });

  // ── Evict stale queued messages periodically ───────────────────────────────
  const evictTimer = setInterval(() => {
    const cutoff = Date.now() - queueTtlMs;
    for (const [addr, buf] of queue) {
      const fresh = buf.filter(m => m.at > cutoff);
      if (fresh.length === 0) queue.delete(addr);
      else queue.set(addr, fresh);
    }
  }, 60_000);
  evictTimer.unref();

  // ── Listen ─────────────────────────────────────────────────────────────────
  await new Promise((res, rej) => {
    httpServer.once('error', rej);
    httpServer.listen(port, host, () => {
      httpServer.removeListener('error', rej);
      res();
    });
  });

  const boundPort = httpServer.address()?.port ?? port;

  async function stop() {
    clearInterval(evictTimer);
    for (const [, s] of clients) { try { s.close(); } catch {} }
    clients.clear();
    await new Promise(r => wss.close(() => r()));
    await new Promise(r => httpServer.close(() => r()));
  }

  return { httpServer, wss, port: boundPort, tls: hasTls, stop };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _broadcastPeerList(clients) {
  const list = JSON.stringify({ type: 'peer-list', peers: [...clients.keys()] });
  for (const [, sock] of clients) {
    try { if (sock.readyState === 1) sock.send(list); } catch {}
  }
}

function shortId(id) {
  return id ? String(id).slice(0, 12) + '…' : '?';
}

/** Best-effort LAN IP for friendly CLI output. */
export function getLanIp() {
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

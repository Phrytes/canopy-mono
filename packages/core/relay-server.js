#!/usr/bin/env node
/**
 * relay-server.js — combined HTTP static file server + WebSocket relay broker.
 *
 * Usage:
 *   node relay-server.js [port]          # default port 8787
 *
 * What it does:
 *   HTTP  → serves packages/core/ directory (demo.html, src/**, etc.)
 *   WS    → relay broker matching RelayTransport protocol:
 *             register { type:'register', address }  → registered
 *             send     { type:'send', to, envelope } → message to target
 *
 * Open in browser: http://localhost:8787/demo-full.html
 * From phone (same WiFi): http://192.168.x.x:8787/demo-full.html
 */
import { createServer }           from 'node:http';
import { readFile, stat }         from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { networkInterfaces }      from 'node:os';
import { fileURLToPath }          from 'node:url';

// ── Config ────────────────────────────────────────────────────────────────────

const PORT     = parseInt(process.argv[2] ?? process.env.PORT ?? '8787', 10);
const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url));  // packages/core/

// ── MIME types ─────────────────────────────────────────────────────────────────

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

// ── HTTP server ────────────────────────────────────────────────────────────────

const httpServer = createServer(async (req, res) => {
  // Default / to demo-full.html
  let pathname = req.url.split('?')[0];
  if (pathname === '/' || pathname === '') pathname = '/demo-full.html';

  const filePath = resolve(join(ROOT_DIR, pathname));

  // Security: prevent path traversal outside ROOT_DIR
  if (!filePath.startsWith(ROOT_DIR)) {
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
});

// ── WebSocket relay broker ────────────────────────────────────────────────────

let WebSocketServer;
try {
  const ws = await import('ws');
  WebSocketServer = ws.WebSocketServer ?? ws.Server ?? ws.default?.Server;
} catch {
  console.error('ERROR: ws package not found. Install it: npm install ws');
  process.exit(1);
}

const wss = new WebSocketServer({ server: httpServer });

/** address → WebSocket */
const clients = new Map();
/** address → queued messages (while offline) */
const queue   = new Map();
const QUEUE_TTL_MS = 5 * 60_000;  // 5 min offline buffer

wss.on('connection', (socket) => {
  let registeredAddress = null;

  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── register ──────────────────────────────────────────────────────────────
    if (msg.type === 'register') {
      const { address } = msg;
      if (!address) { socket.send(JSON.stringify({ type: 'error', message: 'Missing address' })); return; }

      registeredAddress = address;
      clients.set(address, socket);

      socket.send(JSON.stringify({ type: 'registered' }));
      console.log(`[relay] registered   ${shortId(address)}`);

      // Drain any queued messages.
      const queued = queue.get(address) ?? [];
      for (const { envelope } of queued) {
        try { socket.send(JSON.stringify({ type: 'message', envelope })); } catch {}
      }
      queue.delete(address);
      broadcastPeerList();
      return;
    }

    // ── send ──────────────────────────────────────────────────────────────────
    if (msg.type === 'send') {
      const { to, envelope } = msg;
      if (!to || !envelope) return;

      const target = clients.get(to);
      if (target && target.readyState === 1 /* OPEN */) {
        console.log(`[relay] ${shortId(registeredAddress)} → ${shortId(to)}  _p=${envelope._p ?? '?'}`);
        target.send(JSON.stringify({ type: 'message', envelope }));
      } else {
        // Buffer up to 50 messages per offline peer.
        if (!queue.has(to)) queue.set(to, []);
        const buf = queue.get(to);
        buf.push({ envelope, at: Date.now() });
        if (buf.length > 50) buf.shift();
      }
      return;
    }

    // ── peer-list (relay management) ─────────────────────────────────────────
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
      console.log(`[relay] disconnected ${shortId(registeredAddress)}`);
      broadcastPeerList();
    }
  });

  socket.on('error', () => {});
});

/** Send the current peer list to every connected client (for the demo UI). */
function broadcastPeerList() {
  const list = JSON.stringify({ type: 'peer-list', peers: [...clients.keys()] });
  for (const [, sock] of clients) {
    try { if (sock.readyState === 1) sock.send(list); } catch {}
  }
}

// Evict stale queued messages periodically.
setInterval(() => {
  const cutoff = Date.now() - QUEUE_TTL_MS;
  for (const [addr, buf] of queue) {
    const fresh = buf.filter(m => m.at > cutoff);
    if (fresh.length === 0) queue.delete(addr);
    else queue.set(addr, fresh);
  }
}, 60_000).unref();

// ── Start ─────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, '0.0.0.0', () => {
  const lanIp = getLanIp();
  console.log('');
  console.log('  @canopy/core  relay + demo server');
  console.log('  ─────────────────────────────────────');
  console.log(`  Local:    http://localhost:${PORT}/demo-full.html`);
  if (lanIp) {
    console.log(`  Network:  http://${lanIp}:${PORT}/demo-full.html`);
    console.log(`  Relay WS: ws://${lanIp}:${PORT}`);
  }
  console.log('');
  console.log('  Open one tab per agent. Share the Network URL with your phone.');
  console.log('');
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLanIp() {
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

function shortId(id) {
  return id ? id.slice(0, 12) + '…' : '?';
}

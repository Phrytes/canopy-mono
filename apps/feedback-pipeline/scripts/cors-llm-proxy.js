#!/usr/bin/env node
// Dev CORS shim for the confidential LLM proxy. The feedback bot runs IN the browser and calls the
// loopback Privatemode proxy directly; that binary doesn't send CORS headers, so the browser blocks the
// fetch and on-device curation (cleanMessage) silently falls back to raw. This thin reverse-proxy adds
// CORS + forwards (loopback→loopback, so the confidential-route guard holds). In production the
// browser-reachable confidential endpoint / attested gateway plays this role.
//
//   TARGET=http://localhost:8080 PORT=8081 node scripts/cors-llm-proxy.js
import http from 'node:http';

const TARGET = (process.env.TARGET || 'http://localhost:8080').replace(/\/$/, '');
const PORT = Number(process.env.PORT || 8081);
const tHost = new URL(TARGET).host;

// never let one bad socket kill the shim
process.on('uncaughtException', (e) => console.error('[cors-llm-proxy] uncaught:', e?.message));

http.createServer((req, res) => {
  const cors = {
    'access-control-allow-origin': req.headers.origin || '*',
    // reflect whatever headers the browser's preflight asked for (so content-type/authorization pass)
    'access-control-allow-headers': req.headers['access-control-request-headers'] || 'content-type, authorization',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const proxyReq = http.request(`${TARGET}${req.url}`, { method: req.method, headers: { ...req.headers, host: tHost } }, (pr) => {
    try { res.writeHead(pr.statusCode || 502, { ...pr.headers, ...cors }); } catch { /* already sent */ }
    pr.pipe(res);
  });
  proxyReq.on('error', (e) => { try { if (!res.headersSent) res.writeHead(502, cors); res.end(`proxy error: ${e.message}`); } catch { /* ignore */ } });
  req.on('error', () => { try { proxyReq.destroy(); } catch { /* ignore */ } });
  req.pipe(proxyReq);
})
  .on('clientError', (_e, sock) => { try { sock.destroy(); } catch { /* ignore */ } })
  .listen(PORT, () => console.log(`CORS LLM proxy on :${PORT} → ${TARGET}`));

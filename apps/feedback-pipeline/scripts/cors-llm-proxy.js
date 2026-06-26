#!/usr/bin/env node
// Dev CORS shim for the confidential LLM proxy. The feedback bot runs IN the browser and calls the
// loopback Privatemode proxy directly; that binary doesn't send CORS headers, so the browser blocks the
// fetch and on-device curation (cleanMessage) silently falls back to raw. This thin reverse-proxy adds
// CORS + forwards to the real proxy — still loopback→loopback, so the confidential-route guard holds.
// In production the browser-reachable confidential endpoint plays this role (or the attested gateway).
//
//   TARGET=http://localhost:8080 PORT=8081 node scripts/cors-llm-proxy.js
import http from 'node:http';

const TARGET = (process.env.TARGET || 'http://localhost:8080').replace(/\/$/, '');
const PORT = Number(process.env.PORT || 8081);
const tHost = new URL(TARGET).host;

http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', req.headers.origin || '*');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  res.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const proxyReq = http.request(`${TARGET}${req.url}`, { method: req.method, headers: { ...req.headers, host: tHost } }, (pr) => {
    res.writeHead(pr.statusCode || 502, pr.headers);
    pr.pipe(res);
  });
  proxyReq.on('error', (e) => { res.writeHead(502, { 'content-type': 'text/plain' }); res.end(`proxy error: ${e.message}`); });
  req.pipe(proxyReq);
}).listen(PORT, () => console.log(`CORS LLM proxy on :${PORT} → ${TARGET}`));

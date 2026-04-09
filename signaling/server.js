const express          = require('express');
const http             = require('http');
const { ExpressPeerServer } = require('peer');

const port = parseInt(process.env.PORT ?? '9000', 10);

const app    = express();
const server = http.createServer(app);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({ ok: true, service: 'peerjs-signaling' }));

// ── PeerJS signaling ──────────────────────────────────────────────────────────
// Client config: { host: '<railway-domain>', port: 443, path: '/peerjs', secure: true }
// Client connects to  wss://<host>/peerjs/peerjs?...
// Express mounts peerServer at /peerjs → it handles the /peerjs sub-path internally
const peerServer = ExpressPeerServer(server, {
  proxied: true,   // trust X-Forwarded-* from Railway's load balancer
});

app.use('/peerjs', peerServer);

peerServer.on('connection', (client) => console.log('[+]', client.getId()));
peerServer.on('disconnect', (client) => console.log('[-]', client.getId()));

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(port, '0.0.0.0', () => {
  console.log(`PeerJS signaling server listening on port ${port}`);
});

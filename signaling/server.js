const { PeerServer } = require('peer');

const port = parseInt(process.env.PORT ?? '9000', 10);

// path:'/' means:
//   GET  /        → peer discovery (returns [], HTTP 200) — Railway health check passes
//   WS   /peerjs  → signaling WebSocket
// Client config: { host:'...', port:443, path:'/', secure:true }
const server = PeerServer({
  port,
  host:            '0.0.0.0',
  path:            '/peerjs',
  proxied:         true,
  allow_discovery: true,
  corsOptions:     { origin: '*' },
});

server.on('connection', (client) => console.log('[+]', client.getId()));
server.on('disconnect', (client) => console.log('[-]', client.getId()));

console.log(`PeerJS signaling listening on :${port}`);

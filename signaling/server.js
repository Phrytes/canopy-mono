const { PeerServer } = require('peer');

const port = parseInt(process.env.PORT ?? '9000', 10);

const server = PeerServer({
  port,
  host:            '0.0.0.0',   // bind to all interfaces (required on Railway)
  path:            '/peerjs',
  proxied:         true,         // trust X-Forwarded-* from Railway's load balancer
  allow_discovery: true,         // GET /peerjs/ returns [] with 200 (Railway health check)
  corsOptions:     { origin: '*' },
});

server.on('connection', (client) => console.log('[+]', client.getId()));
server.on('disconnect', (client) => console.log('[-]', client.getId()));

console.log(`PeerJS signaling listening on :${port}`);

const { PeerServer } = require('peer');

const port = parseInt(process.env.PORT ?? '9000', 10);

const server = PeerServer({
  port,
  host: '0.0.0.0',   // bind to all interfaces, required on Railway
  path: '/peerjs',
  proxied: true,      // trust X-Forwarded-* headers from Railway's proxy
  corsOptions: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Health-check: visit https://yourapp.up.railway.app/ to confirm it's up
server.get('/', (_req, res) => res.json({ ok: true, service: 'peerjs-signaling' }));

server.on('connection',  (client) => console.log('[+]', client.getId()));
server.on('disconnect',  (client) => console.log('[-]', client.getId()));

console.log(`PeerJS signaling server listening on port ${port} at /peerjs`);

const { PeerServer } = require('peer');
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);

const port = parseInt(process.env.PORT || '9000', 10);

// Root route
app.get('/', (req, res) => {
  res.status(200).send('OK');
});

// ✅ IMPORTANT: path matches mount
const peerServer = PeerServer({
  path: '/peerjs',
  proxied: true,
  allow_discovery: true,
  corsOptions: { origin: '*' },
});

// ✅ mount WITHOUT duplicating path
app.use(peerServer);

server.listen(port, '0.0.0.0', () => {
  console.log(`Server running on ${port}`);
});
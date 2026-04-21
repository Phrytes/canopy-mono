const express = require('express');
const http = require('http');
const { ExpressPeerServer } = require('peer');

const app = express();
const server = http.createServer(app);

const port = parseInt(process.env.PORT || '9000', 10);

// Health route
app.get('/', (req, res) => {
  res.send('OK');
});

// 🔑 THIS is the important change
const peerServer = ExpressPeerServer(server, {
  proxied: true,
  allow_discovery: true,
  corsOptions: { origin: '*' },
  generateClientId: true,
});

// mount at /peerjs
app.use('/peerjs', peerServer);

server.listen(port, '0.0.0.0', () => {
  console.log(`Server running on ${port}`);
});
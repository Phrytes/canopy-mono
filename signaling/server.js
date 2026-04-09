const { PeerServer } = require('peer');
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);

const port = parseInt(process.env.PORT || '9000', 10);

// Root route (VERY important for Railway)
app.get('/', (req, res) => {
  res.status(200).send('OK');
});

// Mount PeerJS
const peerServer = PeerServer({
  path: '/',
  proxied: true,
  allow_discovery: true,
  corsOptions: { origin: '*' },
});

app.use('/peerjs', peerServer);

server.listen(port, '0.0.0.0', () => {
  console.log(`Server running on ${port}`);
});
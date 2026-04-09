const { PeerServer } = require('peer');
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);

const port = parseInt(process.env.PORT || '9000', 10);

// health route for Railway + browser
app.get('/', (req, res) => {
  res.send('PeerJS server is alive 🚀');
});

const peerServer = PeerServer({
  path: '/',
  proxied: true,
  allow_discovery: true,
  corsOptions: { origin: '*' },
});

app.use('/peerjs', peerServer);

server.listen(port, '0.0.0.0', () => {
  console.log(`Running on ${port}`);
});
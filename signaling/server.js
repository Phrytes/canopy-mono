import { PeerServer } from 'peer';

const port = parseInt(process.env.PORT ?? '9000');

const server = PeerServer({
  port,
  path: '/peerjs',
  corsOptions: {
    origin: '*',   // restrict to your Vercel domain in production
  },
});

server.on('connection', (client) =>
  console.log(`[+] ${client.getId()}`)
);
server.on('disconnect', (client) =>
  console.log(`[-] ${client.getId()}`)
);

console.log(`PeerJS signaling server running on port ${port}`);

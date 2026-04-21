/**
 * Local relay server — run this before opening any browser demo or
 * connecting the phone app.
 *
 * Usage:
 *   node start-relay.js           → listens on ws://localhost:8787
 *   PORT=9000 node start-relay.js → listens on ws://localhost:9000
 */
import { RelayAgent } from './packages/relay/index.js';

const PORT = parseInt(process.env.PORT ?? '8787', 10);

const relay = await RelayAgent.create({ port: PORT, label: 'local-relay' });
await relay.start();

const { networkInterfaces } = await import('os');
const nets = networkInterfaces();
const lanIp = Object.values(nets)
  .flat()
  .find(n => n.family === 'IPv4' && !n.internal)?.address ?? 'localhost';

console.log(`\n  Relay started\n`);
console.log(`  Local : ws://localhost:${relay.port}`);
console.log(`  LAN   : ws://${lanIp}:${relay.port}  ← use this on your phone\n`);
console.log(`  Open any .html demo in packages/core/ in a browser.`);
console.log(`  On the setup screen, the relay URL will be pre-filled.\n`);
console.log(`  Ctrl+C to stop.\n`);

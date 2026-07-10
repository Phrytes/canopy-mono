#!/usr/bin/env node
/**
 * companion-node — CLI boot (the 1-file boot precedent, mirroring
 * `packages/relay/bin/relay.js`).
 *
 * Reads options from env vars:
 *   COMPANION_RELAY_URL        connect to a shared relay (else boot local)
 *   PORT                       local-relay port (default 0 ⇒ OS-assigned)
 *   HOST                       local-relay bind host (default 127.0.0.1)
 *   COMPANION_NODE_CONFIG_DIR  where the host keypair is persisted
 *
 * Usage:
 *   node src/boot.js
 *   COMPANION_RELAY_URL=wss://relay.example PORT=8787 node src/boot.js
 */
import { startCompanionNode } from './index.js';

const relayUrl = process.env.COMPANION_RELAY_URL || undefined;
const port     = process.env.PORT ? parseInt(process.env.PORT, 10) : 0;
const host     = process.env.HOST ?? '127.0.0.1';

const node = await startCompanionNode({ relayUrl, port, host });

console.log('');
console.log('  @canopy-app/companion-node  (Slice R1 — LAN/trusted, no gate)');
console.log('  ────────────────────────────────────────────────────────────');
console.log(`  Host agent:   ${node.agent.address}`);
console.log(`  Relay:        ${node.relayUrl}${node.relay ? '  (booted in-process)' : '  (shared, connected as client)'}`);
console.log(`  Capabilities: ${node.capabilities.join(', ')}`);
console.log('');
console.log('  A device on the same relay can discover this host in the agent');
console.log('  registry and invoke its folio pod-file skills over the mesh.');
console.log('');

const shutdown = async () => { await node.stop(); process.exit(0); };
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

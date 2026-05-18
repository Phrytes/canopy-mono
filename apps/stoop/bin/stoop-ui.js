#!/usr/bin/env node
/**
 * H5 V0 web UI launcher.
 *
 * Single-group mode (Phase 7 step 1):
 *   node bin/stoop-ui.js \
 *     --actor   https://id.example/anne \
 *     --group   block-42 \
 *     [--port    8080] \
 *     [--relay   ws://<LAN-IP>:8787]   ← cross-device (web ⇄ phone) \
 *     [--peers   <pubkey>,<pubkey>,...] \
 *     [--skills  paint,ladder] \
 *     [--posture paint=always,ladder=negotiable]
 *
 * Multi-group mode (Phase 7 step 2 — group switcher):
 *   node bin/stoop-ui.js \
 *     --actor   https://id.example/anne \
 *     --groups  block-42,book-club,workplace \
 *     [--port    8080] \
 *     [--relay   ws://<LAN-IP>:8787]
 *
 * `--relay` attaches a `RelayTransport` (in addition to the in-process
 * `InternalTransport`) so this web instance can reach phones / other
 * machines through a relay started with `node start-relay.js`. Point
 * the phone's Settings → Relay-server at the SAME ws:// URL. Without
 * `--relay` the web launcher is in-process only (no cross-device).
 *
 * In multi-group mode the launcher:
 *   - Generates one shared `AgentIdentity` and uses it across all groups.
 *   - Spins up one `core.Agent` + `mountLocalUi` per group on consecutive
 *     ports (start = `--port`, default OS-assigned).
 *   - Surfaces `groups.json` as an in-memory virtual file at every
 *     instance so the UI's group dropdown can navigate between them.
 */
import { parseArgs } from 'node:util';
import {
  AgentIdentity,
  VaultMemory,
  InternalBus,
  InternalTransport,
  RelayTransport,
} from '@canopy/core';
import { mountLocalUi, LocalUiAuth } from '@canopy/agent-ui';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { values } = parseArgs({
  options: {
    actor:   { type: 'string' },
    group:   { type: 'string' },
    groups:  { type: 'string' },
    port:    { type: 'string' },
    relay:   { type: 'string' },
    peers:   { type: 'string' },
    skills:  { type: 'string' },
    posture: { type: 'string' },
  },
});

if (!values.actor) {
  console.error('--actor <webid> is required');
  process.exit(2);
}
if (!values.group && !values.groups) {
  console.error('--group <gid> (single-group) or --groups <gid1,gid2,...> (multi-group) is required');
  process.exit(2);
}
if (values.group && values.groups) {
  console.error('--group and --groups are mutually exclusive');
  process.exit(2);
}

const isMultiGroup = !!values.groups;
const basePort = Number(values.port ?? 0);
const peers = (values.peers ? values.peers.split(',').map(s => s.trim()).filter(Boolean) : [])
  .map((pubKey) => ({ pubKey }));
const skills = values.skills  ? values.skills.split(',').map(s => s.trim()).filter(Boolean) : [];
const posture = values.posture
  ? Object.fromEntries(values.posture.split(',').map(p => p.split('=').map(s => s.trim())))
  : {};

const relayUrl = values.relay ? values.relay.trim() : null;
if (relayUrl && !/^wss?:\/\//.test(relayUrl)) {
  console.error('--relay must be a ws:// or wss:// URL (e.g. ws://192.168.1.7:8787)');
  process.exit(2);
}

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

// Shared identity across all groups (the "one identity, many groups" V0
// model — see H5-V2-product-items.md item 3 decision).
const id  = await AgentIdentity.generate(new VaultMemory());

if (isMultiGroup) {
  const { createNeighborhoodCluster } = await import('../src/cluster.js');
  const groupIds = values.groups.split(',').map(s => s.trim()).filter(Boolean);
  if (peers.length || skills.length || Object.keys(posture).length) {
    console.error('--peers / --skills / --posture are single-group flags; configure each group separately for multi-group runs (V0 launcher).');
    process.exit(2);
  }

  const bus = new InternalBus();
  const cluster = await createNeighborhoodCluster({
    identity: id,
    bus,
    groups:   groupIds.map((gid) => ({ groupId: gid, localActor: values.actor })),
  });
  for (const b of cluster.groups.values()) await b.skillMatch.start();
  // Cross-device transport for every group agent (parity with mobile).
  if (relayUrl) {
    for (const b of cluster.groups.values()) {
      b.agent.addTransport('relay', new RelayTransport({ relayUrl, identity: id }));
    }
  }

  // Shared mutable extraStaticFiles map — same object reference is
  // passed into every mountLocalUi, so updating `/groups.json` after
  // all ports are known propagates to all instances on the next read.
  const sharedExtras = { '/groups.json': '[]' };

  const uis = new Map();
  let nextPort = basePort;
  for (const [gid, bundle] of cluster.groups) {
    const ui = await mountLocalUi(bundle.agent, {
      port:             nextPort,
      staticDir:        webDir,
      a2aTLSLayer:      new LocalUiAuth({ localActor: values.actor }),
      extraStaticFiles: sharedExtras,
    });
    uis.set(gid, ui);
    if (basePort > 0) nextPort = basePort + uis.size;
    // Otherwise let the OS pick a free port for each.
  }

  const groupIndex = [...uis.entries()].map(([groupId, ui]) => ({
    groupId,
    url: ui.url,
  }));
  sharedExtras['/groups.json'] = JSON.stringify(groupIndex);

  console.log('H5 multi-group UI ready:');
  console.log(`  identity: ${id.pubKey}`);
  console.log(`  relay:    ${relayUrl ?? '(none — in-process only)'}`);
  for (const { groupId, url } of groupIndex) {
    console.log(`  ${groupId.padEnd(20)} ${url}`);
  }

  process.on('SIGINT',  shutdownAll);
  process.on('SIGTERM', shutdownAll);
  async function shutdownAll() {
    console.log('\nShutting down…');
    for (const ui of uis.values()) await ui.stop();
    process.exit(0);
  }
} else {
  const { createNeighborhoodAgent } = await import('../src/index.js');
  const bus = new InternalBus();
  const bundle = await createNeighborhoodAgent({
    identity:  id,
    transport: new InternalTransport(bus, id.pubKey),
    label:     `H5-${values.actor}`,
    skillMatch: {
      group:      values.group,
      localActor: values.actor,
      peers,
      skills,
      posture,
    },
  });
  // Single-member: nothing to addPeer; multi-member callers wire that
  // before invoking this script. SkillMatch.start() is fine without peers.
  await bundle.skillMatch.start();

  // Cross-device transport (web ⇄ phone) — parity with mobile, which
  // attaches a RelayTransport the same way (agentBundle.js). Without
  // this the web launcher is in-process only.
  if (relayUrl) {
    bundle.agent.addTransport('relay', new RelayTransport({ relayUrl, identity: id }));
  }

  const groupIndexJson = JSON.stringify([]);   // single-group hides the dropdown

  const ui = await mountLocalUi(bundle.agent, {
    port:             basePort,
    staticDir:        webDir,
    a2aTLSLayer:      new LocalUiAuth({ localActor: values.actor }),
    extraStaticFiles: { '/groups.json': groupIndexJson },
  });

  console.log(`H5 UI ready at ${ui.url}`);
  console.log(`  actor:  ${values.actor}`);
  console.log(`  group:  ${values.group}`);
  console.log(`  pubKey: ${id.pubKey}`);
  if (skills.length)               console.log(`  skills: ${skills.join(', ')}`);
  if (Object.keys(posture).length) console.log(`  posture: ${JSON.stringify(posture)}`);
  console.log(`  peers:  ${peers.length} configured`);
  console.log(`  relay:  ${relayUrl ?? '(none — in-process only)'}`);

  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
  async function shutdown() {
    console.log('\nShutting down…');
    await ui.stop();
    process.exit(0);
  }
}

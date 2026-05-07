#!/usr/bin/env node
/**
 * H4 V0 web UI launcher.
 *
 * Usage (inline single-member, fastest to run):
 *   node bin/tasks-ui.js \
 *     --actor    https://id.example/anne \
 *     --role     admin \
 *     [--port    8080]
 *
 * Usage (config file, multi-member household):
 *   node bin/tasks-ui.js \
 *     --actor    https://id.example/anne \
 *     --config   ./household.json \
 *     [--port    8080]
 *
 * The config file shape:
 *   {
 *     "roles":   { "<webid>": "admin"|"coordinator"|"member"|"observer", ... },
 *     "members": [
 *       { "webid": "...", "displayName": "Anne", "role": "admin",
 *         "externalIds": { "telegramUid": "1" } },
 *       ...
 *     ]
 *   }
 *
 * V0 single-member mode (`--role`) is good for poking at the UI and
 * exercising add/claim/complete with no other members. Production
 * deployments use `--config` with a real household roster.
 */
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  AgentIdentity,
  VaultMemory,
  InternalBus,
  InternalTransport,
} from '@canopy/core';
import { mountLocalUi, LocalUiAuth } from '@canopy/agent-ui';

const { values } = parseArgs({
  options: {
    actor:  { type: 'string' },
    role:   { type: 'string' },
    config: { type: 'string' },
    port:   { type: 'string' },
  },
});

if (!values.actor) {
  console.error('--actor <webid> is required');
  process.exit(2);
}
if (!values.role && !values.config) {
  console.error('--role <admin|coordinator|member|observer> (single-member) or --config <path> (multi-member) is required');
  process.exit(2);
}

const port = Number(values.port ?? 0);

let roles, members;
if (values.config) {
  const cfg = JSON.parse(await readFile(values.config, 'utf8'));
  roles   = cfg.roles   ?? {};
  members = cfg.members ?? [];
  if (!roles[values.actor]) {
    console.error(`--config: ${values.config} doesn't list a role for ${values.actor}`);
    process.exit(2);
  }
} else {
  roles   = { [values.actor]: values.role };
  members = [{
    webid:       values.actor,
    displayName: values.actor.split('/').pop() || values.actor,
    role:        values.role,
  }];
}

const { createTasksAgent } = await import('../src/index.js');

const id  = await AgentIdentity.generate(new VaultMemory());
const bus = new InternalBus();
const bundle = await createTasksAgent({
  identity:  id,
  transport: new InternalTransport(bus, id.pubKey),
  label:     `H4-${values.actor}`,
  roles,
  members,
});

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

// Surface the actor's role to the UI via an extraStaticFiles overlay so
// the frontend knows which buttons to render. The skill handlers still
// enforce role policy server-side; the UI hint is purely cosmetic.
const tasksConfig = JSON.stringify({
  actor: values.actor,
  roles,
});

const ui = await mountLocalUi(bundle.agent, {
  port,
  staticDir:        webDir,
  a2aTLSLayer:      new LocalUiAuth({ localActor: values.actor }),
  extraStaticFiles: { '/tasks-config.json': tasksConfig },
});

console.log(`H4 UI ready at ${ui.url}`);
console.log(`  actor:  ${values.actor}`);
console.log(`  role:   ${roles[values.actor]}`);
console.log(`  pubKey: ${id.pubKey}`);
console.log(`  members: ${members.length}`);

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
async function shutdown() {
  console.log('\nShutting down…');
  await ui.stop();
  process.exit(0);
}

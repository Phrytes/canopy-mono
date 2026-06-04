// cohort-cli — the company's CLI for managing a feedback project's activation cohort
// (architecture §1.2): create a project, generate N single-use codes with expiry +
// ceiling, check status. State is persisted to a file-backed store between calls.
//
//   node scripts/cohort-cli.js create-project --config <projectconfig.json> --expires <ISO> --ceiling <N>
//   node scripts/cohort-cli.js generate-codes --project <id> --count <N>
//   node scripts/cohort-cli.js status [--project <id>]
//
// Default store: ./cohort-store.json. DEV ONLY — the store keeps the signing secret;
// in production the secret lives in a secret store and the spent/records in the
// project's activation pod (the amnesic state). No identity is ever stored.

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import crypto from 'node:crypto';
import { InMemoryCohortRegistry } from '../src/activation/cohort.js';
import { validateProjectConfig } from '../src/config/project-config.js';

const HELP = `cohort-cli — manage feedback-project activation cohorts

  create-project  --config <projectconfig.json> --expires <ISO> --ceiling <N> [--store <file>]
  generate-codes  --project <id> --count <N> [--store <file>]
  status          [--project <id>] [--store <file>]

Default store: ./cohort-store.json (dev only — keeps the signing secret).`;

const loadStore = (file) => (existsSync(file) ? InMemoryCohortRegistry.fromJSON(JSON.parse(readFileSync(file, 'utf8'))) : new InMemoryCohortRegistry());
const saveStore = (file, reg) => writeFileSync(file, JSON.stringify(reg.toJSON(), null, 2));

const cmd = process.argv[2];
const { values } = parseArgs({
  args: process.argv.slice(3),
  options: {
    config: { type: 'string' }, expires: { type: 'string' }, ceiling: { type: 'string' },
    project: { type: 'string' }, count: { type: 'string' },
    store: { type: 'string', default: './cohort-store.json' },
  },
  allowPositionals: true,
});

function req(name) { if (!values[name]) throw new Error(`--${name} is required`); return values[name]; }

try {
  if (cmd === 'create-project') {
    const cfg = validateProjectConfig(JSON.parse(readFileSync(req('config'), 'utf8')));
    const reg = loadStore(values.store);
    const secret = crypto.randomBytes(32).toString('hex');
    reg.registerProject({ projectId: cfg.projectId, expiresAt: req('expires'), ceiling: Number(req('ceiling')) }, secret);
    saveStore(values.store, reg);
    console.log(`created cohort for "${cfg.projectId}" — expires ${values.expires}, ceiling ${values.ceiling}`);
    console.log(`next: node scripts/cohort-cli.js generate-codes --project ${cfg.projectId} --count <N>`);
  } else if (cmd === 'generate-codes') {
    const reg = loadStore(values.store);
    const codes = reg.generateCodes(req('project'), Number(req('count')));
    console.log(codes.join('\n'));   // hand these to the afnemer; the service does NOT store them
  } else if (cmd === 'status') {
    const reg = loadStore(values.store);
    const ids = values.project ? [values.project] : reg.projectIds();
    if (!ids.length) { console.log('(no projects in store)'); }
    for (const id of ids) {
      const s = reg.getSpec(id);
      console.log(`${id}: ${reg.activationCount(id)}/${s.ceiling} activations, expires ${s.expiresAt}`);
    }
  } else {
    console.log(HELP);
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error('error:', e.message);
  process.exit(1);
}

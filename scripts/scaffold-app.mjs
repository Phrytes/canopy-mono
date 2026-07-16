#!/usr/bin/env node
/**
 * scaffold-app.mjs — Phase 52.x P5 scaffolder CLI.
 *
 * Generates a minimal hello-world `@onderling` app skeleton under
 * `apps/<name>/` (or `<dir>/<name>/`). The generated app boots a
 * `core.Agent` with an in-process transport + ephemeral identity,
 * registers one `hello` skill, and ships a passing vitest suite.
 *
 * V0 scope (per substrates-v2 §II.12 P5 deliverable, exit gate
 * "CLI scaffolds working hello-world"):
 *   - hard-coded templates (no per-substrate metadata yet)
 *   - Node-side only (no web / RN templates yet)
 *   - core agent + InternalTransport + VaultMemory + one skill
 *
 * Deferred to later iterations:
 *   - per-substrate `SCAFFOLDER_META` exports
 *   - flag-driven substrate wiring (`--pseudo-pod`, `--item-types`, …)
 *   - multiple templates (cli / web / mobile)
 *
 * Usage:
 *   node scripts/scaffold-app.mjs <name>
 *   node scripts/scaffold-app.mjs <name> --dir <path>
 *   node scripts/scaffold-app.mjs --help
 */

import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname }                          from 'node:path';
import { fileURLToPath }                                   from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..');

/* ── Arg parsing ──────────────────────────────────────────────── */

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`scaffold-app — generate a minimal @onderling app skeleton

Usage:
  node scripts/scaffold-app.mjs <name>
  node scripts/scaffold-app.mjs <name> --dir <path>

Arguments:
  <name>            App name (becomes the directory + the @onderling-app/<name> package name).
                    Must be a kebab-case word: [a-z][a-z0-9-]*

Options:
  --dir <path>      Parent directory under which the new app is created.
                    Defaults to <repo-root>/apps.
  --help, -h        Show this message.

Output:
  <dir>/<name>/
    package.json
    src/index.js
    bin/<name>.js
    test/hello.test.js
    locales/en.json
    vitest.config.js
    README.md

After scaffolding:
  cd <dir>/<name>
  npm install
  npm test
  node bin/<name>.js
`);
  process.exit(args.length === 0 ? 2 : 0);
}

const name = args[0];
if (!/^[a-z][a-z0-9-]*$/.test(name)) {
  fail(`<name> must match /^[a-z][a-z0-9-]*$/ (got "${name}")`, 2);
}

const dirIdx = args.indexOf('--dir');
const parentDir = dirIdx >= 0
  ? resolve(args[dirIdx + 1])
  : join(REPO_ROOT, 'apps');

const appDir = join(parentDir, name);
if (existsSync(appDir)) {
  fail(`<dir>/<name> already exists: ${appDir}`, 3);
}

/* ── Generate ─────────────────────────────────────────────────── */

mkdirSync(join(appDir, 'src'),     { recursive: true });
mkdirSync(join(appDir, 'bin'),     { recursive: true });
mkdirSync(join(appDir, 'test'),    { recursive: true });
mkdirSync(join(appDir, 'locales'), { recursive: true });

// 1. package.json — minimal deps + vitest.
const packageJson = {
  name:        `@onderling-app/${name}`,
  version:     '0.0.1',
  private:     true,
  description: `Minimal @onderling hello-world app scaffolded ${new Date().toISOString().slice(0, 10)} via scripts/scaffold-app.mjs.`,
  type:        'module',
  main:        'src/index.js',
  exports:     { '.': './src/index.js' },
  bin:         { [name]: `bin/${name}.js` },
  scripts: {
    test:       'vitest run',
    'test:watch':'vitest',
    start:      `node bin/${name}.js`,
  },
  dependencies: {
    '@onderling/core': 'file:../../packages/core',
  },
  devDependencies: {
    vitest: '^2.1.0',
  },
};
writeFileSync(
  join(appDir, 'package.json'),
  JSON.stringify(packageJson, null, 2) + '\n',
);

// 2. src/index.js — exports createApp() returning { agent, identity, stop }.
writeFileSync(join(appDir, 'src', 'index.js'), `/**
 * ${name} — minimal hello-world @onderling app.
 *
 * Scaffolded by scripts/scaffold-app.mjs (Phase 52.x P5).
 *
 * The skeleton uses:
 *   - \`VaultMemory\` — ephemeral identity (replace with VaultNodeFs / KeychainVault for real use)
 *   - \`InternalBus\` + \`InternalTransport\` — in-process transport (replace with RelayTransport for cross-device)
 *   - one skill \`hello\` that echoes a greeting
 *
 * Upgrade path: wire pseudo-pod for local storage, notify-envelope
 * for fan-out, item-types for canonical taxonomy — see
 * \`Project Files/Substrates/substrates-v2-functional-design-2026-05-11.md\`.
 */

import {
  AgentIdentity,
  VaultMemory,
  InternalBus,
  InternalTransport,
  Agent,
  defineSkill,
  DataPart,
} from '@onderling/core';

/**
 * Build a fresh agent with one \`hello\` skill registered.
 *
 * @returns {Promise<{ agent: Agent, identity: AgentIdentity, stop: () => Promise<void> }>}
 */
export async function createApp() {
  const identity  = await AgentIdentity.generate(new VaultMemory());
  const bus       = new InternalBus();
  const transport = new InternalTransport(bus, identity.pubKey);
  const agent     = new Agent({ identity, transport, label: '${name}' });

  agent.skills.register(defineSkill('hello', async ({ parts }) => {
    const dp = parts?.find?.((p) => p?.type === 'DataPart');
    const who = typeof dp?.data?.name === 'string' && dp.data.name.length > 0
      ? dp.data.name
      : 'world';
    return [DataPart({ text: \`hello, \${who}\` })];
  }, {
    description: 'Echoes a hello greeting.',
    visibility:  'public',
  }));

  await agent.start();

  return {
    agent,
    identity,
    async stop() { await agent.stop?.(); },
  };
}
`);

// 3. bin/<name>.js — CLI entry.
const binShebang = '#!/usr/bin/env node';
writeFileSync(join(appDir, 'bin', `${name}.js`), `${binShebang}
/**
 * ${name} CLI — boots the app + calls the \`hello\` skill against self.
 */

import { createApp } from '../src/index.js';
import { DataPart } from '@onderling/core';

const who = process.argv[2] ?? 'world';

const { agent, identity, stop } = await createApp();
try {
  const result = await agent.invoke(identity.pubKey, 'hello', [DataPart({ name: who })]);
  const text = result?.find?.((p) => p?.type === 'DataPart')?.data?.text ?? '(no response)';
  process.stdout.write(text + '\\n');
  process.exit(0);
} catch (err) {
  process.stderr.write(\`error: \${err?.message ?? err}\\n\`);
  process.exit(1);
} finally {
  await stop();
}
`);

// 4. test/hello.test.js — vitest exercising the hello skill round-trip.
writeFileSync(join(appDir, 'test', 'hello.test.js'), `/**
 * hello.test.js — verifies the scaffolded \`hello\` skill works.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { DataPart } from '@onderling/core';
import { createApp } from '../src/index.js';

let app;

afterEach(async () => {
  await app?.stop();
  app = null;
});

describe('hello skill', () => {
  it('returns "hello, world" with no args', async () => {
    app = await createApp();
    const result = await app.agent.invoke(app.identity.pubKey, 'hello', []);
    const text = result?.find?.((p) => p?.type === 'DataPart')?.data?.text;
    expect(text).toBe('hello, world');
  });

  it('uses the supplied name', async () => {
    app = await createApp();
    const result = await app.agent.invoke(app.identity.pubKey, 'hello', [DataPart({ name: 'Anne' })]);
    const text = result?.find?.((p) => p?.type === 'DataPart')?.data?.text;
    expect(text).toBe('hello, Anne');
  });
});
`);

// 5. locales/en.json — translatable-by-design (text, doc) skeleton.
writeFileSync(
  join(appDir, 'locales', 'en.json'),
  JSON.stringify({
    cli: {
      hello: {
        greeting: {
          text: 'hello, {name}',
          doc:  'Greeting printed by the bin CLI. {name} is interpolated.',
        },
      },
    },
  }, null, 2) + '\n',
);

// 6. vitest.config.js — minimal.
writeFileSync(join(appDir, 'vitest.config.js'), `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
`);

// 7. README.md.
writeFileSync(join(appDir, 'README.md'), `# @onderling-app/${name}

Minimal hello-world \`@onderling\` app scaffolded via \`scripts/scaffold-app.mjs\`.

## Run

\`\`\`
npm install
npm test
node bin/${name}.js          # prints: hello, world
node bin/${name}.js Anne     # prints: hello, Anne
\`\`\`

## Layout

\`\`\`
${name}/
├── package.json
├── src/
│   └── index.js        — createApp() — agent + hello skill
├── bin/
│   └── ${name}.js      — CLI entry
├── test/
│   └── hello.test.js   — vitest suite
└── locales/
    └── en.json         — \`{text, doc}\` translatable-by-design entries
\`\`\`

## Upgrade path

The scaffolded app uses the **minimum viable** substrate stack:

| Concern | Default | Production swap |
|---|---|---|
| Identity vault | \`VaultMemory\` (ephemeral) | \`VaultNodeFs\` (Node) or \`KeychainVault\` (RN) |
| Transport | \`InternalTransport\` (in-process) | \`RelayTransport\` (NKN/relay) + optional \`BleTransport\` / \`MdnsTransport\` |
| Storage | (none) | \`@onderling/pseudo-pod\` for local, \`@onderling/pod-client\` for real Solid pods |
| Fan-out | (none) | \`@onderling/notify-envelope\` for circle-replicated writes |
| Item shape | (free-form) | \`@onderling/item-types\` canonical taxonomy |

See \`Project Files/Substrates/substrates-v2-functional-design-2026-05-11.md\`
for the substrate inventory.
`);

/* ── Done ─────────────────────────────────────────────────────── */

process.stdout.write(`scaffold-app: created ${appDir}\n`);
process.stdout.write(`  cd ${appDir}\n`);
process.stdout.write(`  npm install && npm test && node bin/${name}.js\n`);
process.exit(0);

/* ── Helpers ──────────────────────────────────────────────────── */

function fail(msg, code = 1) {
  process.stderr.write(`scaffold-app: ${msg}\n`);
  process.exit(code);
}

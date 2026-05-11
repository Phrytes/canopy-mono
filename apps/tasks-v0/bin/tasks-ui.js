#!/usr/bin/env node
/**
 * H4 V0/V1 web UI launcher.
 *
 * Usage (V0 inline single-member, fastest to run):
 *   node bin/tasks-ui.js \
 *     --actor    https://id.example/anne \
 *     --role     admin \
 *     [--port    8080] \
 *     [--storage-root ./.tasks-data]
 *
 * Usage (V0 config file, multi-member household):
 *   node bin/tasks-ui.js \
 *     --actor    https://id.example/anne \
 *     --config   ./household.json \
 *     [--port    8080] \
 *     [--storage-root ./.tasks-data]
 *
 * Usage (V1 Crew mode):
 *   node bin/tasks-ui.js \
 *     --actor    https://id.example/anne \
 *     --crew     ./oss-tools.crew.json \
 *     [--storage-root ./.tasks-data] \
 *     [--telegram-token "$TG_BOT_TOKEN"]
 *
 * Usage (V2.8 multi-crew smoke):
 *   node bin/tasks-ui.js \
 *     --actor      https://id.example/anne \
 *     --crew-list  ./two-crews.list.json
 *
 * `--crew-list <path>` boots ONE meshAgent + N CrewStates and runs an
 * in-process smoke probe (`addTask` against each crewId, asserting
 * cross-crew isolation), then exits. The list file shape is
 * `{"crews": ["./a.crew.json", "./b.crew.json"]}` — paths are resolved
 * relative to the list file. The HTTP UI is skipped in this mode; the
 * V2.8 web UX for multi-crew (crew picker + per-tab crewId injection)
 * lives in tasks-mobile.
 *
 * `--telegram-token <token>` activates the V1.5 chat-bot. Set the
 * token via env var to keep it out of shell history; map chatIds to
 * webids in the crew config's `bot.chatBindings`. Requires V1
 * (`--crew`) — the `bot.*` skills aren't registered in V0 mode.
 *
 * `--push` activates the V1.5 Expo push side-channel. Notifications
 * dispatch to device tokens declared in `crewConfig.pushTokens`.
 * Conservative gating via `crewConfig.pushPolicy` (humanInTheLoop +
 * per-day cap + quiet hours).
 *
 * The V0 config file shape:
 *   {
 *     "roles":   { "<webid>": "admin"|"coordinator"|"member"|"observer", ... },
 *     "members": [...]
 *   }
 *
 * The V1 Crew config file shape (see `src/Crew.js` § CrewConfig):
 *   {
 *     "crewId": "oss-tools",
 *     "name":   "OSS Tools NL",
 *     "kind":   "project",
 *     "members": [...],
 *     "subtasksAdminApprovalDepth": 4
 *   }
 *
 * `--storage-root <path>` enables local-only-mode-with-restart-survival:
 *   - Wraps `core.FileSystemSource` rooted at the path in a
 *     `local-store.CachingDataSource`.
 *   - Tasks ledger + crew rosters + skill profile + inbox all
 *     persist across CLI restarts.
 *   - When omitted, the CLI uses an in-memory-only bundle
 *     (everything lost at exit; fine for one-off poking).
 */
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve as resolvePath } from 'node:path';
import {
  AgentIdentity,
  VaultMemory,
  InternalBus,
  InternalTransport,
  FileSystemSource,
} from '@canopy/core';
import { mountLocalUi, LocalUiAuth } from '@canopy/agent-ui';
import { CachingDataSource } from '@canopy/local-store';

const { values } = parseArgs({
  options: {
    actor:           { type: 'string' },
    role:            { type: 'string' },
    config:          { type: 'string' },
    crew:            { type: 'string' },
    'crew-list':     { type: 'string' },
    port:            { type: 'string' },
    'storage-root':  { type: 'string' },
    // V1.5 — chat bot. `--telegram-token <token>` activates the
    // bot bridge (TelegramBridge from @canopy/chat-agent). The
    // crew config's `bot.chatBindings` map decides which chatId
    // dispatches as which webid.
    'telegram-token': { type: 'string' },
    // V1.5 — Expo push side-channel. Without `--push`, push wiring
    // stays dormant. With it, the CLI imports `@canopy/relay`'s
    // `ExpoPushSender` lazily and Crew dispatches notifications to
    // the per-webid tokens declared in `crewConfig.pushTokens`.
    push: { type: 'boolean' },
  },
});

if (!values.actor) {
  console.error('--actor <webid> is required');
  process.exit(2);
}
if (!values.role && !values.config && !values.crew && !values['crew-list']) {
  console.error('one of --role <role> | --config <path> | --crew <path> | --crew-list <path> is required');
  process.exit(2);
}

// ── V2.8 multi-crew smoke (early exit; no HTTP UI) ─────────────────────────
if (values['crew-list']) {
  const listPath = resolvePath(values['crew-list']);
  const listDir  = dirname(listPath);
  let listFile;
  try {
    listFile = JSON.parse(await readFile(listPath, 'utf8'));
  } catch (err) {
    console.error(`--crew-list: failed to read ${listPath}: ${err?.message ?? err}`);
    process.exit(2);
  }
  if (!Array.isArray(listFile?.crews) || listFile.crews.length === 0) {
    console.error('--crew-list: file must contain {"crews": ["./a.json", ...]} with at least one path');
    process.exit(2);
  }

  const { ItemStore } = await import('@canopy/item-store');
  const { MemberMap } = await import('@canopy/identity-resolver');
  const { DataPart }  = await import('@canopy/core');
  const { buildMeshAgent }  = await import('../src/MeshAgent.js');
  const { wireSkills }      = await import('../src/wireSkills.js');
  const { multiCrewResolver } = await import('../src/bundleResolver.js');
  const { buildStandardRolePolicy } = await import('../src/rolePolicy.js');

  // Load every crew config first so we can fail fast on bad input.
  const crewConfigs = [];
  for (const rel of listFile.crews) {
    const crewPath = resolvePath(listDir, rel);
    try {
      crewConfigs.push(JSON.parse(await readFile(crewPath, 'utf8')));
    } catch (err) {
      console.error(`--crew-list: failed to load ${crewPath}: ${err?.message ?? err}`);
      process.exit(2);
    }
  }

  // ONE meshAgent for the whole process.
  const { meshAgent } = await buildMeshAgent({ label: 'TasksMeshAgent(multi)' });

  // Build a minimal CrewState per crewConfig — same shape as
  // test/v2_8-single-agent.test.js fixture (no per-crew V1+ wiring;
  // the smoke only needs the substrate's dispatch path).
  const crews = new Map();
  const allMembers = [];
  for (const cfg of crewConfigs) {
    const roles = Object.fromEntries(
      (cfg.members ?? []).map((m) => [m.webid, m.role ?? 'member']),
    );
    const dataSource = new (await import('@canopy/core')).MemorySource();
    const itemStore = new ItemStore({
      dataSource,
      rootContainer: `mem://tasks/crews/${cfg.crewId}/`,
      rolePolicy:    buildStandardRolePolicy(roles),
      enforceDependencies: true,
    });
    let liveCrew = Object.freeze({
      crewId:     cfg.crewId,
      name:       cfg.name ?? cfg.crewId,
      kind:       cfg.kind ?? 'household',
      members:    cfg.members ?? [],
      customRoles: cfg.customRoles ?? [],
    });
    crews.set(cfg.crewId, {
      get crewId()   { return liveCrew.crewId; },
      get liveCrew() { return liveCrew; },
      crewMutator(patch) { liveCrew = Object.freeze({ ...liveCrew, ...patch }); },
      roles,
      itemStore,
      dataSource,
      members: new MemberMap({ initial: cfg.members ?? [] }),
      chatController: null,
      botAgentRegistry: null,
      metricsTracker: null,
      notifierChannels: null,
      onCalendarEmissionChange: null,
      onCompensationChange: null,
    });
    for (const m of cfg.members ?? []) allMembers.push({ webid: m.webid });
  }

  wireSkills({
    meshAgent,
    bundleResolver: multiCrewResolver(crews),
    crewsProvider:  () => crews.values(),
    members:        new MemberMap({ initial: allMembers }),
  });
  await meshAgent.start();

  console.log(`V2.8 multi-crew smoke: 1 meshAgent, ${crews.size} CrewStates`);
  console.log(`  pubKey: ${meshAgent.identity?.pubKey ?? '(unknown)'}`);
  for (const [crewId, st] of crews) {
    console.log(`  • ${crewId}: ${st.liveCrew.members.length} member(s)`);
  }

  // Probe: addTask per crew via the registered handler, assert isolation.
  const addDef = meshAgent.skills.get('addTask');
  if (!addDef) {
    console.error('FAIL: addTask not registered');
    process.exit(1);
  }
  for (const [crewId, st] of crews) {
    const adminWebid = Object.entries(st.roles).find(([, r]) => r === 'admin')?.[0]
                    ?? Object.keys(st.roles)[0];
    if (!adminWebid) {
      console.error(`FAIL: ${crewId} has no member to act as`);
      process.exit(1);
    }
    const r = await addDef.handler({
      parts:    [DataPart({ crewId, text: `smoke-task-${crewId}` })],
      from:     adminWebid,
      agent:    meshAgent,
      envelope: null,
    });
    if (r?.error || !r?.task) {
      console.error(`FAIL: ${crewId} addTask returned ${JSON.stringify(r)}`);
      process.exit(1);
    }
  }
  // Isolation check: each ItemStore holds exactly its own probe item.
  for (const [crewId, st] of crews) {
    const open = await st.itemStore.listOpen();
    if (open.length !== 1 || open[0].text !== `smoke-task-${crewId}`) {
      console.error(`FAIL: ${crewId} isolation broken — listOpen()=${JSON.stringify(open)}`);
      process.exit(1);
    }
  }
  console.log(`OK: addTask routed to the right crew for all ${crews.size} crew(s); ItemStores isolated.`);
  process.exit(0);
}


const port = Number(values.port ?? 0);

// Storage bundle. Three modes:
//   - --storage-root <path>   → FileSystemSource-backed bundle (restart-survival)
//   - --crew (no --storage-root) → in-memory CachingDataSource bundle
//                                  (V1 skills register against it; nothing persists)
//   - V0 mode (--role / --config without --crew) → no bundle; createTasksAgent
//                                  defaults to a bare MemorySource for the ItemStore
//                                  and the V1 helper skills are not registered.
let localStoreBundle = null;
if (values['storage-root']) {
  const root = resolvePath(values['storage-root']);
  const fs = new FileSystemSource({ root });
  const cache = new CachingDataSource({ inner: fs });
  localStoreBundle = {
    cache,
    cadence: null,
    async attachInner(ds) { await cache.attachInner(ds); },
    async detachInner()   { await cache.attachInner(null); },
    async close()         {},
  };
  console.log(`Local-only storage root: ${root}`);
} else if (values.crew) {
  // V1 Crew mode without --storage-root: build an ephemeral in-memory
  // bundle so all the V1 helper skills (inbox / workspace / observability /
  // crew-controls / appeal) get registered against a real CachingDataSource.
  // Nothing persists across CLI restarts — add --storage-root for that.
  const cache = new CachingDataSource({});
  localStoreBundle = {
    cache,
    cadence: null,
    async attachInner(ds) { await cache.attachInner(ds); },
    async detachInner()   { await cache.attachInner(null); },
    async close()         {},
  };
  console.log('In-memory local store (V1 mode); add --storage-root <path> for restart-survival.');
}

const id  = await AgentIdentity.generate(new VaultMemory());
const bus = new InternalBus();
const transport = new InternalTransport(bus, id.pubKey);

const { createTasksAgent } = await import('../src/index.js');
const { createCrewAgent }  = await import('../src/Crew.js');

let bundle;
let roles, members;

if (values.crew) {
  // V1 Crew mode.
  const crewConfig = JSON.parse(await readFile(values.crew, 'utf8'));

  // V1.5 — optional push sender (Expo). Lazy-import so users who
  // don't pass --push don't pay for the relay dep at startup.
  let pushSender;
  if (values.push) {
    try {
      const { ExpoPushSender } = await import('@canopy/relay');
      pushSender = new ExpoPushSender();
      console.log('  push:   Expo push sender wired');
    } catch (err) {
      console.error(`  ⚠ --push: failed to load @canopy/relay (${err?.message ?? err})`);
    }
  }

  bundle = await createCrewAgent({
    crewConfig,
    localStoreBundle,
    identity: id,
    transport,
    label:    `Crew(${crewConfig.crewId ?? 'unknown'})-${values.actor}`,
    ...(pushSender ? { pushSender } : {}),
  });
  roles   = Object.fromEntries((crewConfig.members ?? []).map((m) => [m.webid, m.role]));
  members = crewConfig.members ?? [];
  if (!roles[values.actor]) {
    console.error(`--crew: ${values.crew} doesn't list a role for ${values.actor}`);
    process.exit(2);
  }
} else {
  // V0 (legacy) single-household mode.
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
  bundle = await createTasksAgent({
    identity:  id,
    transport,
    label:     `H4-${values.actor}`,
    roles,
    members,
    localStoreBundle,
  });
}

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

// Surface the actor's role to the UI via an extraStaticFiles overlay so
// the frontend knows which buttons to render. The skill handlers still
// enforce role policy server-side; the UI hint is purely cosmetic.
const tasksConfig = JSON.stringify({
  actor: values.actor,
  roles,
  ...(bundle.crew ? { crew: { crewId: bundle.crew.crewId, name: bundle.crew.name, kind: bundle.crew.kind } } : {}),
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

// V1.5 — telegraf launch errors can surface as unhandled rejections
// (long-polling launch is fire-and-forget inside TelegramBridge).
// Catch them here so the rest of the UI keeps serving.
process.on('unhandledRejection', (err) => {
  const msg = err?.message ?? String(err);
  if (/telegram|telegraf|TelegramError/i.test(msg)) {
    console.error(`  ⚠ Telegram bot async error: ${msg}`);
    return;
  }
  // Surface non-telegram rejections — those are real bugs.
  console.error('Unhandled rejection:', err);
});

// V1.5 — wire the Telegram bot if `--telegram-token` was supplied.
// Requires V1 Crew mode (the `bot.*` skills are only registered when
// `localStoreBundle` is present, which `--crew` always provides).
let botCleanup = null;
if (values['telegram-token']) {
  if (!values.crew) {
    console.error('  ⚠ --telegram-token ignored: needs --crew (V1 mode)');
  } else {
    try {
      // Pre-flight the token via Telegram's /getMe so a bad token
      // produces a clean error instead of an unhandled rejection
      // when telegraf's fire-and-forget bot.launch() 404s.
      const meRes = await fetch(`https://api.telegram.org/bot${values['telegram-token']}/getMe`);
      if (!meRes.ok) {
        const body = await meRes.text().catch(() => '');
        throw new Error(`token rejected by Telegram (HTTP ${meRes.status}): ${body.slice(0, 200)}`);
      }
      const me = await meRes.json();
      if (!me?.ok || !me?.result?.username) {
        throw new Error(`token rejected by Telegram: ${JSON.stringify(me).slice(0, 200)}`);
      }
      console.log(`  bot:    Telegram token OK (@${me.result.username})`);

      const { TelegramBridge } = await import('@canopy/chat-agent/bridges/telegram');
      const { wireBotChannel } = await import('../src/bot/wireBotChannel.js');
      // Pass a live provider so bindings added via the V1.5
      // setBotChatBinding skill propagate without restart.
      const liveBindings = () => bundle.getCrew?.()?.bot?.chatBindings ?? bundle.crew?.bot?.chatBindings ?? {};
      const bindingCount = Object.keys(liveBindings()).length;

      const tg = new TelegramBridge({
        botToken: values['telegram-token'],
        mode:     'long-polling',
      });
      const r = await wireBotChannel({
        agent:            bundle.agent,
        bridges:          [{ bridge: tg, name: 'telegram' }],
        chatBindings:     liveBindings,
        botAgentRegistry: bundle.botAgentRegistry,
      });
      botCleanup = r.detach;
      console.log(`  bot:    Telegram bridge active (${bindingCount} chatBinding${bindingCount === 1 ? '' : 's'})`);
      if (bindingCount === 0) {
        console.log('          (no chatBindings yet — add some under crew.bot.chatBindings)');
      }
    } catch (err) {
      const msg = err?.message ?? String(err);
      if (/Cannot find package 'telegraf'|Cannot find module 'telegraf'/.test(msg)) {
        console.error('  ⚠ Telegram bot needs `telegraf` — run `npm i telegraf` in this app to enable.');
      } else {
        console.error(`  ⚠ Telegram bot failed to start: ${msg}`);
      }
    }
  }
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
async function shutdown() {
  console.log('\nShutting down…');
  try { await botCleanup?.(); } catch { /* noop */ }
  await ui.stop();
  process.exit(0);
}

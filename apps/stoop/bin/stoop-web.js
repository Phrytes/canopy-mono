#!/usr/bin/env node
/**
 * stoop-web — Slice E.1 bootstrap (PLAN-gui-chat-uplift.md).
 *
 * Boots a localhost-only stoop web UI driven by the manifest's NavModel
 * (rendered via `@canopy/app-manifest`'s `renderWeb`).  Mirrors
 * `apps/household/bin/household-web.js`: same `@canopy/agent-ui`'s
 * `mountLocalUi` substrate, same `extraStaticFiles` carrying
 * `/navmodel.json` + `/stoop-config.json`.
 *
 * ──── Slice E.1 scope (the smallest stoop web page) ──────────────────
 *
 * Stoop has 16 web pages today (per `AUDIT-stoop-folio-surfaces.md`).
 * E.1 surfaces ONE — `mine.html` (my active posts + completions) — to
 * prove the substrate-shape, mirroring B.1's discipline for tasks-v0
 * (just `dag.html`).  The remaining 15 pages stay hand-built and will
 * land in follow-on E.x slices.
 *
 * Why `mine.html`?
 *   - Single-list page (one `listMyRequests` skill, one `<ul>` of items)
 *   - The skill it calls (`listMyRequests`) IS in the manifest
 *     (`listMyRequests` op declared D.1, line 158)
 *   - Smaller than `index.html` (prikbord has filters + multi-intent
 *     tabs) — strictly less risky to migrate as the first proof
 *   - Smaller than `privacy.html` (which calls `getPrivacyNotice` +
 *     `getDataLocation`, neither of which is in the D.1 manifest's
 *     "chat/slash-callable core" — privacy would be a flat NavModel
 *     consumer that only ties navigation, not data)
 *
 * Other pages (chat / contacts / group / create-group / profile /
 * settings / onboard / sign-in / auth-callback / push / restore /
 * welcome / metrics / privacy / index) DEFER to follow-on E.x slices.
 *
 * ──── This bootstrap vs `stoop-ui.js` / `stoop-testbed.js` ──────────
 *
 * `stoop-ui.js` and `stoop-testbed.js` are the production launchers —
 * they wire full skill-match + substrate-mirror + relay + multi-group.
 * THIS bootstrap is the **manifest-driven web smoke**: a minimal
 * single-actor stoop bundle that serves `/mine.html` via the NavModel.
 * Production launchers stay unchanged; this is the E.1 substrate proof
 * that doesn't disturb them.
 *
 * Returns (when used as a module via `startStoopWeb()`):
 *   { url, port, agent, bundle, stop, navModel }
 *
 * The CLI entry-point uses `startStoopWeb` with defaults and logs the
 * URL; the smoke test (`test/stoop-web.test.js`) imports
 * `startStoopWeb` directly so it can await + stop without shell-driven
 * lifecycle.
 *
 * Usage:
 *   node bin/stoop-web.js [--port 8080] [--actor https://id.example/anne]
 *                         [--group block-42]
 */
import { parseArgs }                              from 'node:util';
import { fileURLToPath }                          from 'node:url';
import { dirname, join }                          from 'node:path';
import {
  AgentIdentity,
  VaultMemory,
  InternalBus,
  InternalTransport,
}                                                 from '@canopy/core';
import { mountLocalUi, LocalUiAuth }              from '@canopy/agent-ui';
import { renderWeb }                              from '@canopy/app-manifest';

import { stoopManifest }                           from '../manifest.js';
import { createNeighborhoodAgent }                 from '../src/index.js';

const DEFAULT_ACTOR = 'https://id.example/anne';
const DEFAULT_GROUP = 'block-42';

/**
 * Start the stoop-web server.  Returns a handle the caller can use
 * to stop it cleanly (the smoke test does this).
 *
 * @param {object} [opts]
 * @param {number} [opts.port=0]      0 → OS picks a free port
 * @param {string} [opts.actor]       webid the LocalUiAuth claims
 * @param {string} [opts.group]       group id (single-group; testbed
 *                                    + multi-group are out of E.1 scope)
 */
export async function startStoopWeb(opts = {}) {
  const port  = opts.port  ?? 0;
  const actor = opts.actor ?? DEFAULT_ACTOR;
  const group = opts.group ?? DEFAULT_GROUP;

  const id        = await AgentIdentity.generate(new VaultMemory());
  const bus       = new InternalBus();
  const transport = new InternalTransport(bus, id.pubKey);

  // Minimal single-actor stoop bundle.  No skill-match peers, no
  // substrate mirror, no relay — this is the manifest-driven web smoke.
  // Production launchers (`stoop-ui.js`, `stoop-testbed.js`) wire the
  // full plumbing and are out of E.1 scope.
  const bundle = await createNeighborhoodAgent({
    identity:  id,
    transport,
    label:     `stoop-web-${actor}`,
    members:   [{ webid: actor, displayName: actor.split('/').pop() || actor }],
    skillMatch: {
      group,
      localActor: actor,
      peers:      [],
    },
  });
  await bundle.skillMatch.start();

  // Pre-compute the NavModel from the manifest.  Static for the life
  // of the server (manifest is module-scope const).  E.1 ships ONE
  // section (`mine`); follow-on E.x will grow this.
  const navModel = renderWeb(stoopManifest);

  const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

  const ui = await mountLocalUi(bundle.agent, {
    port,
    staticDir:        webDir,
    a2aTLSLayer:      new LocalUiAuth({ localActor: actor }),
    extraStaticFiles: {
      '/navmodel.json':      JSON.stringify(navModel),
      '/stoop-config.json':  JSON.stringify({ actor, group, app: navModel.app }),
      // One entry: the switcher dropdown still hides (mountGroupSwitcher
      // hides at length<=1) but the client now KNOWS the active group —
      // mirrors stoop-ui.js's single-group `groups.json` shape so the
      // existing app.js helpers stay happy.
      '/groups.json':        JSON.stringify([{ groupId: group }]),
    },
  });

  return {
    url:   ui.url,
    port:  ui.port,
    agent: bundle.agent,
    bundle,
    navModel,
    async stop() {
      try { await bundle.skillMatch.stop(); } catch { /* swallow */ }
      await ui.stop();
    },
  };
}

// ── CLI entry ─────────────────────────────────────────────────────────
const isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { values } = parseArgs({
    options: {
      port:  { type: 'string' },
      actor: { type: 'string' },
      group: { type: 'string' },
    },
  });

  const port  = values.port ? Number(values.port) : 0;
  const actor = values.actor ?? DEFAULT_ACTOR;
  const group = values.group ?? DEFAULT_GROUP;

  const handle = await startStoopWeb({ port, actor, group });
  console.log(`Stoop web UI (Slice E.1) ready at ${handle.url}`);
  console.log(`  actor:    ${actor}`);
  console.log(`  group:    ${group}`);
  console.log(`  app:      ${handle.navModel.app}`);
  console.log(`  sections: ${handle.navModel.sections.map((s) => s.id).join(', ')}`);
  console.log(`  ⚠  E.1 surfaces /mine.html via the NavModel.  Other pages`);
  console.log(`     still load (legacy hand-built); their migration is`);
  console.log(`     follow-on E.x scope.`);

  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
  async function shutdown() {
    console.log('\nShutting down…');
    await handle.stop();
    process.exit(0);
  }
}

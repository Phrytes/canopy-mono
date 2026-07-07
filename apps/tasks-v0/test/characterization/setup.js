/**
 * Shared characterization-corpus harness.
 *
 * Reuses `mountLocalUi` + `createCircleAgent` from the existing
 * `phase8-ui.test.js` pattern; centralises the boilerplate so each
 * per-page characterization test is small.
 *
 * See `apps/tasks-v0/docs/characterization-corpus.md` for the corpus
 * methodology + per-page status table.
 */

import { readFile }      from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { AgentIdentity, InternalBus, InternalTransport } from '@canopy/core';
import { VaultMemory } from '@canopy/vault';
import { mountLocalUi, LocalUiAuth } from '@canopy/agent-ui';
import { renderWeb }                 from '@canopy/app-manifest';

import { buildBundle }       from '../../src/storage/buildBundle.js';
import { createCircleAgent }   from '../../src/Circle.js';
import { tasksManifest }     from '../../manifest.js';

export const ANNE  = 'https://id.example/anne';
export const FRITS = 'https://id.example/frits';
export const KID   = 'https://id.example/kid';

export const DEFAULT_CIRCLE = Object.freeze({
  circleId:  'characterization-circle',
  name:    'Characterization Circle',
  kind:    'project',
  members: [
    { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
    { webid: FRITS, displayName: 'the author', role: 'coordinator' },
    { webid: KID,   displayName: 'Kid',   role: 'member' },
  ],
});

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');

/**
 * Build a characterization-corpus fixture.
 *
 *   const fx = await buildCharacterizationFixture({ actor: ANNE });
 *   const indexHtml = await fx.fetchPage('index.html');
 *   await fx.teardown();
 *
 * @param {object} [opts]
 * @param {string} [opts.actor=ANNE]
 * @param {object} [opts.circleConfig=DEFAULT_CIRCLE]
 * @param {object} [opts.extraStaticFiles]
 *   Additional static files to serve (merged with the default
 *   `/tasks-config.json` overlay).
 * @returns {Promise<{
 *   baseUrl: string,
 *   bundle: object,
 *   circleState: object,
 *   fetchPage: (name: string) => Promise<string>,
 *   fetchJson: (path: string) => Promise<any>,
 *   callSkill: (skillId: string, args?: object) => Promise<any>,
 *   teardown: () => Promise<void>,
 * }>}
 */
export async function buildCharacterizationFixture({
  actor       = ANNE,
  circleConfig  = DEFAULT_CIRCLE,
  extraStaticFiles,
} = {}) {
  const id  = await AgentIdentity.generate(new VaultMemory());
  const bus = new InternalBus();
  const lsBundle = buildBundle();

  const bundle = await createCircleAgent({
    circleConfig,
    localStoreBundle:     lsBundle,
    wireOnboardingSkills: false,
    identity:             id,
    transport:            new InternalTransport(bus, id.pubKey),
    label:                `Circle(${circleConfig.circleId})-characterization`,
  });

  const tasksConfig = {
    actor,
    roles: Object.fromEntries(circleConfig.members.map((m) => [m.webid, m.role])),
    circle:  { circleId: circleConfig.circleId, name: circleConfig.name, kind: circleConfig.kind },
  };

  // Slice B.1 — `dag.html` (and future renderWeb pages) consume
  // `/navmodel.json`; surface it from the manifest exactly like the
  // CLI bootstrap (`bin/tasks-ui.js`).
  const navModel = renderWeb(tasksManifest);

  // Slice B.1 — overlay the shared `dagFlatten.js` helper so the
  // dag.html page can ESM-import it.  Mirror of `bin/tasks-ui.js`.
  const dagFlattenJs = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'ui', 'dagFlatten.js'),
    'utf8',
  );
  // task.html (2026-05-27) — overlay the per-task detail helpers +
  // the taskStatus module the page imports via `/lib/`. Mirror of
  // `bin/tasks-ui.js`. Without these the characterization corpus's
  // task.html fetch returns the page body but the module scripts
  // can't resolve their imports under the fixture.
  const taskDetailJs = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'ui', 'taskDetail.js'),
    'utf8',
  );
  const taskStatusJs = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'ui', 'taskStatus.js'),
    'utf8',
  );

  // Slice B.2.0 — overlay @canopy/web-adapter helpers under
  // `/lib/web-adapter/<basename>.js`. Same pattern as dagFlatten.js;
  // mirror of `bin/tasks-ui.js`.
  const webAdapterRoot = join(
    dirname(fileURLToPath(import.meta.url)),
    '..', '..', '..', '..',
    'packages', 'web-adapter', 'src',
  );
  const webAdapterFiles = {};
  // V0.2 (2026-05-20) — fetchSectionItems + schemaToFormFields join the
  // overlay so page scripts (dag.html / mine.html) can ESM-import them
  // through the same /lib/web-adapter/ namespace as B.2.0 helpers.
  for (const n of [
    'callSkill.js',
    'deriveItemState.js',
    'itemMatchesAppliesTo.js',
    'applyPrefilledParams.js',
    'fetchSectionItems.js',
    'schemaToFormFields.js',
    'index.js',
  ]) {
    webAdapterFiles[`/lib/web-adapter/${n}`] = await readFile(
      join(webAdapterRoot, n), 'utf8',
    );
  }

  const ui = await mountLocalUi(bundle.agent, {
    port:        0,
    staticDir:   WEB_DIR,
    a2aTLSLayer: new LocalUiAuth({ localActor: actor }),
    extraStaticFiles: {
      '/tasks-config.json': JSON.stringify(tasksConfig),
      '/navmodel.json':     JSON.stringify(navModel),
      '/lib/dagFlatten.js': dagFlattenJs,
      '/lib/taskDetail.js': taskDetailJs,
      '/lib/taskStatus.js': taskStatusJs,
      ...webAdapterFiles,
      ...(extraStaticFiles ?? {}),
    },
  });

  return {
    baseUrl: ui.url,

    bundle,
    circleState: bundle._circleState,

    fetchPage(name) {
      return fetch(`${ui.url}/${name}`).then((r) => r.text());
    },

    fetchJson(path) {
      const p = path.startsWith('/') ? path : `/${path}`;
      return fetch(`${ui.url}${p}`).then((r) => r.json());
    },

    async callSkill(skillId, args) {
      const def = bundle.agent.skills.get(skillId);
      if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
      return def.handler({
        parts:    args === undefined ? [] : [{ type: 'DataPart', data: args }],
        from:     actor,
        agent:    bundle.agent,
        envelope: null,
      });
    },

    async teardown() {
      try { await ui.close?.(); } catch { /* swallow */ }
    },
  };
}

/**
 * Normalise non-deterministic substrings (ULIDs + ms-epoch timestamps)
 * so snapshots remain stable across runs.  Called by every
 * characterization snapshot before comparison.
 *
 * @param {string} text
 * @returns {string}
 */
export function normaliseSnapshot(text) {
  return text
    // ULIDs (26 chars, Crockford base32 — start with 01, then 24 chars).
    .replace(/\b01[0-9A-HJKMNP-TV-Z]{24}\b/g, '<ULID>')
    // ms-epoch timestamps (13 digits — covers 2001-2286).
    .replace(/\b1[0-9]{12}\b/g, '<MS>')
    // ISO timestamps with arbitrary fractional second + Z.
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<ISO>');
}

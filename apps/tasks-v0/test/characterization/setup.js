/**
 * Shared characterization-corpus harness.
 *
 * Reuses `mountLocalUi` + `createCrewAgent` from the existing
 * `phase8-ui.test.js` pattern; centralises the boilerplate so each
 * per-page characterization test is small.
 *
 * See `apps/tasks-v0/docs/characterization-corpus.md` for the corpus
 * methodology + per-page status table.
 */

import { readFile }      from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  AgentIdentity, VaultMemory, InternalBus, InternalTransport,
} from '@canopy/core';
import { mountLocalUi, LocalUiAuth } from '@canopy/agent-ui';
import { renderWeb }                 from '@canopy/app-manifest';

import { buildBundle }       from '../../src/storage/buildBundle.js';
import { createCrewAgent }   from '../../src/Crew.js';
import { tasksManifest }     from '../../manifest.js';

export const ANNE  = 'https://id.example/anne';
export const FRITS = 'https://id.example/frits';
export const KID   = 'https://id.example/kid';

export const DEFAULT_CREW = Object.freeze({
  crewId:  'characterization-crew',
  name:    'Characterization Crew',
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
 * @param {object} [opts.crewConfig=DEFAULT_CREW]
 * @param {object} [opts.extraStaticFiles]
 *   Additional static files to serve (merged with the default
 *   `/tasks-config.json` overlay).
 * @returns {Promise<{
 *   baseUrl: string,
 *   bundle: object,
 *   crewState: object,
 *   fetchPage: (name: string) => Promise<string>,
 *   fetchJson: (path: string) => Promise<any>,
 *   callSkill: (skillId: string, args?: object) => Promise<any>,
 *   teardown: () => Promise<void>,
 * }>}
 */
export async function buildCharacterizationFixture({
  actor       = ANNE,
  crewConfig  = DEFAULT_CREW,
  extraStaticFiles,
} = {}) {
  const id  = await AgentIdentity.generate(new VaultMemory());
  const bus = new InternalBus();
  const lsBundle = buildBundle();

  const bundle = await createCrewAgent({
    crewConfig,
    localStoreBundle:     lsBundle,
    wireOnboardingSkills: false,
    identity:             id,
    transport:            new InternalTransport(bus, id.pubKey),
    label:                `Crew(${crewConfig.crewId})-characterization`,
  });

  const tasksConfig = {
    actor,
    roles: Object.fromEntries(crewConfig.members.map((m) => [m.webid, m.role])),
    crew:  { crewId: crewConfig.crewId, name: crewConfig.name, kind: crewConfig.kind },
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

  const ui = await mountLocalUi(bundle.agent, {
    port:        0,
    staticDir:   WEB_DIR,
    a2aTLSLayer: new LocalUiAuth({ localActor: actor }),
    extraStaticFiles: {
      '/tasks-config.json': JSON.stringify(tasksConfig),
      '/navmodel.json':     JSON.stringify(navModel),
      '/lib/dagFlatten.js': dagFlattenJs,
      ...(extraStaticFiles ?? {}),
    },
  });

  return {
    baseUrl: ui.url,

    bundle,
    crewState: bundle._crewState,

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

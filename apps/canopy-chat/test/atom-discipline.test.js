/**
 * Atom discipline — the FITNESS FUNCTION for B · Layer 1 (the general-verb arc).
 *
 * Every REAL app manifest must pass `validateManifest(m, { atoms: true })`: each op.verb
 * is a known SDK atom (or alias) OR is declared in `manifest.domainVerbs`.  This fails CI
 * the moment a new noun-specific verb is added without either mapping it to an atom or
 * naming it as domain-specific — the drift guard `PLAN-capability-arc.md` Layer 1 calls for.
 *
 * (The `mockManifests.js` trio — tasks/stoop/folio chat-shell surfaces — is a KNOWN-DRIFT
 * concern reconciled separately; it is intentionally NOT covered here.)
 */
import { describe, it, expect } from 'vitest';
import { validateManifest } from '@canopy/app-manifest';

import { householdManifest }  from '../../household/manifest.js';
import { calendarManifest }   from '../../calendar/manifest.js';
import { tasksManifest }      from '../../tasks-v0/manifest.js';
import { folioManifest }      from '../../folio/manifest.js';
import { stoopManifest }      from '../../stoop/manifest.js';
import { canopyChatManifest } from '../manifest.js';

const MANIFESTS = [
  ['household',   householdManifest],
  ['calendar',    calendarManifest],
  ['tasks-v0',    tasksManifest],
  ['folio',       folioManifest],
  ['stoop',       stoopManifest],
  ['canopy-chat', canopyChatManifest],
];

describe('atom discipline (B · Layer 1 fitness function)', () => {
  for (const [name, manifest] of MANIFESTS) {
    it(`${name}: every op.verb is an atom or a declared domainVerb`, () => {
      const { ok, errors } = validateManifest(manifest, { atoms: true });
      // Only assert on verb-discipline errors — unrelated pre-existing validation
      // concerns (if any) aren't this guard's job.
      const verbErrors = errors.filter((e) => e.code === 'unknown-verb' || e.code === 'atom-in-domain-verbs');
      expect(verbErrors, JSON.stringify(verbErrors, null, 2)).toEqual([]);
      expect(ok).toBe(true);
    });
  }

  it('the guard actually bites: an undeclared non-atom verb fails', () => {
    const bad = {
      app: 'x', itemTypes: ['thing'],
      operations: [{ id: 'frobnicateThing', verb: 'frobnicate' }],
    };
    const { ok, errors } = validateManifest(bad, { atoms: true });
    expect(ok).toBe(false);
    expect(errors.some((e) => e.code === 'unknown-verb')).toBe(true);
  });

  it('declaring the verb in domainVerbs lets it through', () => {
    const good = {
      app: 'x', itemTypes: ['thing'], domainVerbs: ['frobnicate'],
      operations: [{ id: 'frobnicateThing', verb: 'frobnicate' }],
    };
    expect(validateManifest(good, { atoms: true }).ok).toBe(true);
  });

  it('an atom (or alias) in domainVerbs is itself an error', () => {
    const wrong = {
      app: 'x', itemTypes: ['thing'], domainVerbs: ['create'],
      operations: [{ id: 'addThing', verb: 'add' }],
    };
    const { errors } = validateManifest(wrong, { atoms: true });
    expect(errors.some((e) => e.code === 'atom-in-domain-verbs')).toBe(true);
  });
});

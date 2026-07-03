/**
 * Atom-dispatch fitness function (B · Layer 1, PLAN §1b seam).
 *
 * `dispatchAtom(manifest, {atom, noun}, dispatch)` is the seam that lets a caller invoke a capability by
 * its ATOM + NOUN (the stable vocabulary) instead of the bespoke op-id. This proves it stays consistent
 * with the capability surface across every REAL manifest: for each `(atom × noun)` the manifest exposes,
 * dispatchAtom must resolve to EXACTLY the op-id `capabilitiesOf` names (or report `unimplemented` for a
 * declared-but-unimplemented pair). Fails CI if a declared capability stops being atom-dispatchable —
 * e.g. a noun/atom is declared (via #81's `nouns`) with no implementing op, or resolveAtom drifts.
 */
import { describe, it, expect, vi } from 'vitest';
import { capabilitiesOf, dispatchAtom } from '@canopy/app-manifest';

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

describe('atom-dispatch consistency (B · Layer 1 §1b)', () => {
  for (const [name, manifest] of MANIFESTS) {
    const caps = capabilitiesOf(manifest);

    it(`${name}: every capability is atom-dispatchable to the op it names`, async () => {
      const mismatches = [];
      for (const cap of caps) {
        const spy = vi.fn(async (opId) => opId);
        const r = await dispatchAtom(manifest, { atom: cap.atom, noun: cap.noun }, spy);
        if (typeof cap.opId === 'string') {
          // implemented → dispatchAtom resolves to that exact op + invokes it
          if (!(r.ok && r.opId === cap.opId && spy.mock.calls[0]?.[0] === cap.opId)) {
            mismatches.push(`${cap.atom}·${cap.noun} → expected ${cap.opId}, got ${JSON.stringify(r)}`);
          }
        } else {
          // declared-but-unimplemented → reported, not dispatched
          if (!(r.ok === false && r.code === 'unimplemented')) {
            mismatches.push(`${cap.atom}·${cap.noun} → expected unimplemented, got ${JSON.stringify(r)}`);
          }
        }
      }
      expect(mismatches, mismatches.join('\n')).toEqual([]);
    });
  }

  it('canonicalises an alias atom to the same op as its canonical form', async () => {
    // household: create→add, task noun → the add op for task
    const spy = vi.fn(async (opId) => opId);
    const viaAlias = await dispatchAtom(householdManifest, { atom: 'create', noun: 'task' }, spy);
    const viaCanon = await dispatchAtom(householdManifest, { atom: 'add', noun: 'task' }, spy);
    expect(viaAlias.ok && viaAlias.opId).toBe(viaCanon.opId);
  });
});

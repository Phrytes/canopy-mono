// Identity step 4/5 (front-end) — createProfile auto-surfaces as a section affordance on the
// agents surface (verb 'add' → CREATIVE_VERBS auto-surface), so the "New profile" button + its
// generic param-form come from the MANIFEST alone (invariant #4 — no bespoke screen code).
import { describe, it, expect } from 'vitest';
import { renderWeb } from '@canopy/app-manifest';
import { agentsManifest } from '../manifest.js';

describe('createProfile front-end (auto-surfaced section affordance)', () => {
  it('renders as a section affordance on the agents surface, labelled "New profile"', () => {
    const nav = renderWeb(agentsManifest);
    const affs = nav.sections.flatMap((s) => s.affordances ?? []);
    const create = affs.find((a) => (a.opId ?? a.op ?? a.skillId ?? a.id) === 'createProfile');
    expect(create).toBeTruthy();               // verb 'add' auto-surfaces — no bespoke screen code
    expect(create.label).toBe('New profile');  // label from surfaces.ui
  });
});

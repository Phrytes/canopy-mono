/**
 * agents — MOBILE screen verification (PLAN-agent-management-surface
 * P1/P2 UI, mobile half).
 *
 * web ≡ mobile by construction: mobile's own composition
 * (`buildManifestsByOrigin`, derived from the single manifestList) must
 * resolve the SAME agents screens through the SAME shared projection
 * (`sectionForScreen` — the exact import CircleLauncherScreen uses),
 * carrying the same confirm-gated control actions the web test pins
 * (apps/canopy-chat/test/v2/agentsScreens.dom.test.js). RN rendering
 * itself rides the existing launcher/screen adapters — what this guards
 * is that mobile's manifest pipeline surfaces the agents screens at all
 * (the dual-truth trap).
 */
import { describe, it, expect } from 'vitest';

import { buildManifestsByOrigin } from '../src/core/composeManifests.js';
import { sectionForScreen } from '../../canopy-chat/src/v2/pageProjection.js';

const manifestsByOrigin = buildManifestsByOrigin();

describe('agents — mobile composition resolves the your-agents screens', () => {
  it('includes the agents origin in the composed manifests', () => {
    expect(Object.keys(manifestsByOrigin)).toContain('agents');
  });

  it('the LIST screen resolves with the listAgents dataSource', () => {
    const found = sectionForScreen(manifestsByOrigin, 'agents');
    expect(found).toBeTruthy();
    expect(found.appOrigin).toBe('agents');
    expect(found.section.dataSource.skillId).toBe('listAgents');
  });

  it('the DETAIL screen resolves as a read-only record over viewAgent (+ $agentId context)', () => {
    const found = sectionForScreen(manifestsByOrigin, 'agent-detail');
    expect(found.section.shape).toBe('record');
    expect(found.section.readOnly).toBe(true);
    expect(found.section.dataSource.argsFromContext).toEqual({ agentId: '$agentId' });
  });

  it('the confirm-gated control actions project identically to web', () => {
    const { section } = sectionForScreen(manifestsByOrigin, 'agents');
    const byOp = Object.fromEntries(section.itemActions.map((a) => [a.opId, a]));
    expect(Object.keys(byOp).sort()).toEqual(['purgeAgent', 'revokeAgent']);
    expect(byOp.revokeAgent.confirm.severity).toBe('danger');
    expect(byOp.purgeAgent.confirm.severity).toBe('danger');
  });
});

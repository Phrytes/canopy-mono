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
 *
 * Q15/Q17 drill-down (mobile half of "generic screen drill-down", web pin:
 * apps/canopy-chat/test/v2/screenDrilldown.dom.test.js): the panel wiring is
 * exercised at the LOGIC level through the exact module the launcher imports
 * (`src/core/screenPanelDrilldown.js` — shared screenDrilldown bound to
 * renderMobile + the {circleId, ...selection} host context), matching how
 * the other mobile screen tests assert models rather than native renders
 * (vitest excludes src/screens entirely).
 */
import { describe, it, expect, vi } from 'vitest';

import { buildManifestsByOrigin } from '../src/core/composeManifests.js';
import { sectionForScreen } from '../../canopy-chat/src/v2/pageProjection.js';
import {
  screenPanelContext, drilldownForScreen, selectionContextFor,
  fetchScreenItems, itemsFromReply, recordFromReply, recordFields,
} from '../src/core/screenPanelDrilldown.js';

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

/* ── Q15 drill-down — row → detail with selection context (mobile panel logic) ── */

// The exact host context the launcher's panel builds for a top-level open
// (the active circle; no selection yet).
const HOST_CTX = screenPanelContext('c1');

/** listAgents LIVE row shape (cores.js toRow — `agentId`, NOT `id`). */
const rosterRow = { agentId: 'laptop-anne', name: 'Anne (laptop)', role: 'device', status: 'active' };
/** listDataVersions SERIES-mode row (id ← uri, label ← uri). */
const seriesRow = { uri: 'mem://pod/c1/tasks.json', latestMs: 1751880000000, count: 1, id: 'mem://pod/c1/tasks.json', label: 'mem://pod/c1/tasks.json' };

describe('drill-down derivation over the REAL mobile composition (renderMobile-bound)', () => {
  it('agents drills into agent-detail on the selection key `agentId`', () => {
    const drill = drilldownForScreen(manifestsByOrigin, 'agents', HOST_CTX);
    expect(drill).toBeTruthy();
    expect(drill.screenId).toBe('agent-detail');
    expect(drill.appOrigin).toBe('agents');
    expect(drill.selectionKeys).toEqual(['agentId']);
  });

  it('data-versions drills into data-version-detail on the selection key `uri` ($circleId host-resolved)', () => {
    const drill = drilldownForScreen(manifestsByOrigin, 'data-versions', HOST_CTX);
    expect(drill).toBeTruthy();
    expect(drill.screenId).toBe('data-version-detail');
    expect(drill.selectionKeys).toEqual(['uri']);
  });

  it('a DETAIL panel does not drill further (its keys ride the panel context)', () => {
    // The launcher opens the detail with {circleId, <selectionKey>} as its context.
    expect(drilldownForScreen(manifestsByOrigin, 'agent-detail', screenPanelContext('c1', { agentId: 'a1' }))).toBeNull();
    expect(drilldownForScreen(manifestsByOrigin, 'data-version-detail', screenPanelContext('c1', { uri: 'u1' }))).toBeNull();
  });

  it('a list without a selection-context sibling stays plain (no row-open affordance): contacts', () => {
    expect(drilldownForScreen(manifestsByOrigin, 'contacts', HOST_CTX)).toBeNull();
  });
});

describe('row pick → detail fetch with the selection context (the launcher fetch path)', () => {
  it('picking an agents roster row fetches viewAgent with agentId ← the row FIELD named like the key', async () => {
    const drill = drilldownForScreen(manifestsByOrigin, 'agents', HOST_CTX);
    const ctx = selectionContextFor(drill, rosterRow, HOST_CTX);
    expect(ctx).toEqual({ circleId: 'c1', agentId: 'laptop-anne' });

    // The next panel re-derives its context exactly as the launcher does
    // (screenPanelContext(circleId, screenPanel.context)) — idempotent.
    const detailCtx = screenPanelContext('c1', ctx);
    const callSkill = vi.fn().mockResolvedValue({ agent: null });
    await fetchScreenItems(sectionForScreen(manifestsByOrigin, drill.screenId).section, { callSkill, context: detailCtx });
    expect(callSkill).toHaveBeenCalledWith('viewAgent', { agentId: 'laptop-anne' });
  });

  it('picking a data-versions series row fetches the detail with BOTH context args substituted', async () => {
    const drill = drilldownForScreen(manifestsByOrigin, 'data-versions', HOST_CTX);
    const ctx = selectionContextFor(drill, seriesRow, HOST_CTX);
    expect(ctx).toEqual({ circleId: 'c1', uri: 'mem://pod/c1/tasks.json' });

    const callSkill = vi.fn().mockResolvedValue({ ok: true, items: [] });
    await fetchScreenItems(sectionForScreen(manifestsByOrigin, drill.screenId).section, { callSkill, context: ctx });
    expect(callSkill).toHaveBeenCalledWith('listDataVersions', { circleId: 'c1', uri: 'mem://pod/c1/tasks.json' });
  });

  it('REGRESSION — $circleId now reaches the data-versions LIST fetch (the old static-args path dropped argsFromContext)', async () => {
    const callSkill = vi.fn().mockResolvedValue({ ok: true, items: [] });
    const { section } = sectionForScreen(manifestsByOrigin, 'data-versions');
    await fetchScreenItems(section, { callSkill, context: HOST_CTX });
    expect(callSkill).toHaveBeenCalledWith('listDataVersions', { circleId: 'c1' });
  });

  it('the existing static-args screens keep their exact fetch behaviour (contacts)', async () => {
    const callSkill = vi.fn().mockResolvedValue({ items: [] });
    const { section } = sectionForScreen(manifestsByOrigin, 'contacts');
    await fetchScreenItems(section, { callSkill, context: HOST_CTX });
    // No argsFromContext on contacts → the context contributes nothing.
    expect(callSkill).toHaveBeenCalledWith('listContacts', {});
  });

  it('itemsFromReply recovers the live listAgents reply shape ({agents: [...]})', () => {
    expect(itemsFromReply({ agents: [rosterRow] })).toEqual([rosterRow]);
    // ambiguous (two array props) → no guess (the chat-shape reply)
    expect(itemsFromReply({ replies: [1], stateUpdates: [2] })).toEqual([]);
  });
});

describe('record DETAIL — the RN record-screen model (Q17, CircleRecordScreen twin)', () => {
  it('a viewAgent reply renders as read-only key→value rows', () => {
    const record = recordFromReply({ agent: { agentId: 'laptop-anne', name: 'Anne (laptop)', status: 'active', skills: ['canopy-chat'], note: null } });
    const fields = recordFields(record);
    expect(fields.map((f) => f.key)).toEqual(['agentId', 'name', 'status', 'skills', 'note']);
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f.text]));
    expect(byKey.name).toBe('Anne (laptop)');
    expect(byKey.skills).toBe('["canopy-chat"]');   // nested values stay readable (web parity)
    expect(byKey.note).toBe('—');                   // nullish placeholder (web parity)
  });

  it('an honest miss ({agent: null}) yields no fields → the empty state', () => {
    expect(recordFields(recordFromReply({ agent: null }))).toEqual([]);
    expect(recordFields(null)).toEqual([]);
  });
});

describe('data-version-detail — the danger-confirm restore action projects on the rows', () => {
  it('the detail section carries restoreDataVersion with a danger confirm', () => {
    const { section } = sectionForScreen(manifestsByOrigin, 'data-version-detail');
    const byOp = Object.fromEntries((section.itemActions ?? []).map((a) => [a.opId, a]));
    expect(byOp.restoreDataVersion).toBeTruthy();
    expect(byOp.restoreDataVersion.confirm.severity).toBe('danger');
  });
});

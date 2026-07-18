// @vitest-environment happy-dom
/**
 * agents — web UI verification (PLAN-agent-management-surface UI):
 * the "your agents" surface renders from the MANIFEST projection alone.
 *
 *  1. `sectionForScreen` resolves the agents LIST screen (dataSource
 *     `listAgents`) and the record DETAIL (`viewAgent`, readOnly) from the
 *     composed manifests-by-origin — no per-shell switch (invariant #4).
 *  2. The projected itemActions carry the confirm-gated CONTROL ops
 *     (revokeAgent + purgeAgent, severity 'danger') — the projection is
 *     the only place they're declared.
 *  3. listAgents-shaped rows render in the real `renderListScreen` DOM
 *     with the action buttons; clicking one dispatches `{opId, itemId}`
 *     (the host's confirm gate then fronts the danger ops).
 */
import { describe, it, expect, vi } from 'vitest';

import { agentsManifest } from '../../../agents/manifest.js';
import { sectionForScreen } from '../../src/v2/pageProjection.js';
import { buildScreenModel } from '../../src/v2/screenModel.js';
import { renderListScreen } from '../../web/v2/listScreen.js';

const t = (k) => k;
const manifestsByOrigin = { agents: agentsManifest };
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

/** listAgents core row shape (see apps/agents/src/cores.js toRow). */
const roster = [
  { id: 'laptop-anne', label: 'Anne (laptop)', role: 'device', status: 'active', lastSeen: '2026-07-01T09:00:00.000Z' },
  { id: 'summary-bot', label: 'Summary bot',   role: 'bot',    status: 'active', lastSeen: '2026-07-09T08:00:00.000Z' },
];

describe('agents — screens resolve from the manifest projection', () => {
  it('the LIST screen resolves with the listAgents dataSource', () => {
    const found = sectionForScreen(manifestsByOrigin, 'agents');
    expect(found).toBeTruthy();
    expect(found.appOrigin).toBe('agents');
    expect(found.section.dataSource.skillId).toBe('listAgents');
  });

  it('the DETAIL screen resolves as a read-only record over viewAgent with the $agentId context arg', () => {
    const found = sectionForScreen(manifestsByOrigin, 'agent-detail');
    expect(found).toBeTruthy();
    expect(found.section.shape).toBe('record');
    expect(found.section.readOnly).toBe(true);
    expect(found.section.dataSource.skillId).toBe('viewAgent');
    expect(found.section.dataSource.argsFromContext).toEqual({ agentId: '$agentId' });
  });

  it('the projected itemActions are the confirm-gated control ops (danger)', () => {
    const { section } = sectionForScreen(manifestsByOrigin, 'agents');
    const actions = Object.fromEntries(section.itemActions.map((a) => [a.opId, a]));
    expect(Object.keys(actions).sort()).toEqual(['purgeAgent', 'revokeAgent']);
    expect(actions.revokeAgent.confirm.severity).toBe('danger');
    expect(actions.purgeAgent.confirm.severity).toBe('danger');
    expect(actions.purgeAgent.confirm.message).toMatch(/cannot be undone/);
  });
});

describe('agents — the roster renders in the real list-screen DOM', () => {
  it('rows render with the projected action buttons; a click dispatches {opId, itemId}', () => {
    const { section } = sectionForScreen(manifestsByOrigin, 'agents');
    const onRowAction = vi.fn();

    // Rows carry the section's itemActions (the shell's row materializer
    // pattern): one Revoke + one Purge button per agent row.
    const model = {
      categories: [],
      rows: roster.map((a) => ({
        item: a,
        label: a.label,
        actions: section.itemActions.map((act) => ({
          id: `${act.opId}:${a.id}`, label: act.label, opId: act.opId, itemId: a.id,
        })),
      })),
    };
    const el = mount();
    renderListScreen(el, { model, t, onRowAction });

    expect(el.querySelectorAll('.list-screen__row')).toHaveLength(2);
    const btns = el.querySelectorAll('.list-screen__row-action');
    expect(btns).toHaveLength(4); // 2 rows × (revoke + purge)
    expect([...btns].map((b) => b.textContent)).toContain('Revoke agent');

    btns[0].click();
    expect(onRowAction).toHaveBeenCalledWith({ opId: 'revokeAgent', itemId: 'laptop-anne' });
  });
});

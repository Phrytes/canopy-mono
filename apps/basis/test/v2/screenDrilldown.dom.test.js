// @vitest-environment happy-dom
/**
 * screenDrilldown — selection-context drill-down (agents UI slice):
 * picking a row in a LIST screen opens the sibling DETAIL screen with the
 * selection-derived context key materialized from the picked row.
 *
 *  1. `drilldownForSection` DERIVES the list→detail pair from the manifest
 *     projection alone (same itemType + an unresolved `$key`) — no per-shell
 *     switch (invariant #4): data-versions → data-version-detail (`$uri`),
 *     agents → agent-detail (`$agentId`); detail screens don't drill further.
 *  2. The FULL web chain over the real DOM renderer: render a
 *     data-versions-shaped list, click a row → the detail section is fetched
 *     through `fetchScreenItems` (the @onderling web-adapter seam) with
 *     `context.uri` = the picked row's id and `$circleId` still host-supplied.
 *  3. Same mechanism for agents → agent-detail: `context.agentId` = the
 *     picked roster row (live listAgents rows carry `agentId`, not `id`),
 *     and the record reply renders as a read-only key→value record.
 *  4. `$circleId` keeps flowing for the existing list screens (the host
 *     context) and static-args sections are byte-identical (no context keys).
 */
import { describe, it, expect, vi } from 'vitest';

import { agentsManifest } from '../../../agents/manifest.js';
import { sectionForScreen } from '../../src/v2/pageProjection.js';
import {
  drilldownForSection, selectionContextFor, fetchScreenItems, itemsFromReply, recordFromReply,
  sectionContextKeys,
} from '../../src/v2/screenDrilldown.js';
import { renderListBlock } from '../../web/v2/listScreen.js';
import { renderRecordScreen } from '../../web/v2/recordScreen.js';

const t = (k) => k;
const manifestsByOrigin = { agents: agentsManifest };
const HOST_KEYS = ['circleId'];   // what circleApp's screen panel materializes
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

/** listDataVersions SERIES-mode items (recoveryCores: id ← uri, label ← uri). */
const seriesItems = [
  { uri: 'mem://pod/c1/notes.json', latestMs: 1751970000000, count: 3, id: 'mem://pod/c1/notes.json', label: 'mem://pod/c1/notes.json' },
  { uri: 'mem://pod/c1/tasks.json', latestMs: 1751880000000, count: 1, id: 'mem://pod/c1/tasks.json', label: 'mem://pod/c1/tasks.json' },
];

/** listAgents LIVE row shape (cores.js toRow — `agentId`, NOT `id`). */
const roster = [
  { agentId: 'laptop-anne', name: 'Anne (laptop)', role: 'device', status: 'active', lastSeen: '2026-07-01T09:00:00.000Z' },
  { agentId: 'summary-bot', name: 'Summary bot',   role: 'bot',    status: 'active', lastSeen: '2026-07-09T08:00:00.000Z' },
];

describe('drilldownForSection — the list→detail pair derives from the projection', () => {
  it('data-versions drills into data-version-detail on the selection key `uri` ($circleId already host-resolved)', () => {
    const drill = drilldownForSection(manifestsByOrigin, 'data-versions', { hostKeys: HOST_KEYS });
    expect(drill).toBeTruthy();
    expect(drill.screenId).toBe('data-version-detail');
    expect(drill.appOrigin).toBe('agents');
    expect(drill.selectionKeys).toEqual(['uri']);
  });

  it('agents drills into agent-detail on the selection key `agentId`', () => {
    const drill = drilldownForSection(manifestsByOrigin, 'agents', { hostKeys: HOST_KEYS });
    expect(drill).toBeTruthy();
    expect(drill.screenId).toBe('agent-detail');
    expect(drill.selectionKeys).toEqual(['agentId']);
  });

  it('a DETAIL screen does not drill further (its keys are host-resolved in that panel)', () => {
    // circleApp passes the CURRENT panel's context keys as hostKeys.
    expect(drilldownForSection(manifestsByOrigin, 'data-version-detail', { hostKeys: ['circleId', 'uri'] })).toBeNull();
    expect(drilldownForSection(manifestsByOrigin, 'agent-detail', { hostKeys: ['circleId', 'agentId'] })).toBeNull();
  });

  it('unknown screens / empty inputs resolve to null', () => {
    expect(drilldownForSection(manifestsByOrigin, 'nope', { hostKeys: HOST_KEYS })).toBeNull();
    expect(drilldownForSection({}, 'agents')).toBeNull();
    expect(drilldownForSection(null, 'agents')).toBeNull();
  });

  it('sectionContextKeys reads the $keys off the projected section', () => {
    const { section } = sectionForScreen(manifestsByOrigin, 'data-version-detail');
    expect(sectionContextKeys(section).sort()).toEqual(['circleId', 'uri']);
    expect(sectionContextKeys(sectionForScreen(manifestsByOrigin, 'agents').section)).toEqual([]);
  });
});

describe('data-versions → data-version-detail — the full web chain over the real DOM', () => {
  it('picking a series row fetches the detail with context.uri = the picked row id (+ $circleId intact)', async () => {
    const el = mount();
    const screenContext = { circleId: 'c1' };
    const callSkill = vi.fn().mockResolvedValue({ ok: true, items: [] });

    // The circleApp panel wiring, minus the overlay chrome: resolve the list
    // section, render its rows, and wire onRowOpen exactly as the shell does.
    const { section } = sectionForScreen(manifestsByOrigin, 'data-versions');
    const drill = drilldownForSection(manifestsByOrigin, 'data-versions', { hostKeys: Object.keys(screenContext) });
    const opened = [];
    renderListBlock(el, {
      block: { items: seriesItems, labelField: section.labelField },
      t,
      onRowOpen: ({ item }) => opened.push({ screenId: drill.screenId, context: selectionContextFor(drill, item, screenContext) }),
    });

    const openBtns = el.querySelectorAll('.list-screen__row-open');
    expect(openBtns).toHaveLength(2);
    openBtns[1].click();   // pick the tasks.json series
    expect(opened).toEqual([{
      screenId: 'data-version-detail',
      context:  { circleId: 'c1', uri: 'mem://pod/c1/tasks.json' },
    }]);

    // ...and the detail screen's fetch substitutes BOTH context args (seam).
    const detail = sectionForScreen(manifestsByOrigin, opened[0].screenId).section;
    await fetchScreenItems(detail, { callSkill, context: opened[0].context });
    expect(callSkill).toHaveBeenCalledWith('listDataVersions', { circleId: 'c1', uri: 'mem://pod/c1/tasks.json' });
  });
});

describe('agents → agent-detail — same mechanism, record-shaped detail', () => {
  it('picking a roster row fetches viewAgent with context.agentId = the picked agent', async () => {
    const el = mount();
    const screenContext = { circleId: 'c1' };
    // Live listAgents reply shape: {agents: [...]} — the tolerant extraction
    // (sole array-valued property) recovers the rows.
    const items = itemsFromReply({ agents: roster });
    expect(items).toHaveLength(2);

    const { section } = sectionForScreen(manifestsByOrigin, 'agents');
    const drill = drilldownForSection(manifestsByOrigin, 'agents', { hostKeys: Object.keys(screenContext) });
    const callSkill = vi.fn().mockResolvedValue({ agent: null });
    renderListBlock(el, {
      block: { items, labelField: section.labelField },   // labelField 'name'
      t,
      onRowOpen: async ({ item }) => {
        const ctx = selectionContextFor(drill, item, screenContext);
        await fetchScreenItems(sectionForScreen(manifestsByOrigin, drill.screenId).section, { callSkill, context: ctx });
      },
    });

    const openBtns = el.querySelectorAll('.list-screen__row-open');
    expect([...openBtns].map((b) => b.textContent)).toEqual(['Anne (laptop)', 'Summary bot']);
    openBtns[0].click();
    await vi.waitFor(() => expect(callSkill).toHaveBeenCalled());
    // `agentId` came off the row FIELD named like the key (rows carry no `id`).
    expect(callSkill).toHaveBeenCalledWith('viewAgent', { agentId: 'laptop-anne' });
  });

  it('the record reply renders as a read-only key→value record (Q17)', () => {
    const el = mount();
    const record = recordFromReply({ agent: { agentId: 'laptop-anne', name: 'Anne (laptop)', status: 'active', skills: ['basis'] } });
    expect(record).toBeTruthy();
    renderRecordScreen(el, { record, t });
    const keys = [...el.querySelectorAll('.record-screen__key')].map((n) => n.textContent);
    expect(keys).toEqual(['agentId', 'name', 'status', 'skills']);
    const values = [...el.querySelectorAll('.record-screen__value')].map((n) => n.textContent);
    expect(values).toContain('Anne (laptop)');
    expect(values).toContain('["basis"]');   // nested values stay readable
  });

  it('an honest miss ({agent: null}) renders the empty state', () => {
    const el = mount();
    renderRecordScreen(el, { record: recordFromReply({ agent: null }), t });
    expect(el.querySelector('.record-screen__empty').textContent).toBe('circle.screen.empty');
  });
});

describe('the existing screens keep their exact fetch behaviour', () => {
  it('$circleId flows to the data-versions LIST from the host context (Q15, the tasks-v0 pod-settings precedent)', async () => {
    const callSkill = vi.fn().mockResolvedValue({ ok: true, items: [] });
    const { section } = sectionForScreen(manifestsByOrigin, 'data-versions');
    await fetchScreenItems(section, { callSkill, context: { circleId: 'c1' } });
    expect(callSkill).toHaveBeenCalledWith('listDataVersions', { circleId: 'c1' });
  });

  it('a static-args section passes its args unchanged (no argsFromContext → no substitution)', async () => {
    const callSkill = vi.fn().mockResolvedValue([]);
    await fetchScreenItems({ dataSource: { skillId: 'listAgents', args: { verbose: true } } }, { callSkill, context: { circleId: 'c1' } });
    expect(callSkill).toHaveBeenCalledWith('listAgents', { verbose: true });
  });

  it('a dataSource-less section throws (the panel keeps its legacy empty-state path, no Q6 listOpen fallback)', () => {
    expect(() => fetchScreenItems({ itemType: 'contact' }, { callSkill: vi.fn() })).toThrow(TypeError);
  });

  it('itemsFromReply keeps the established extractions and only falls back to a SOLE array property', () => {
    expect(itemsFromReply([{ id: 'a' }])).toEqual([{ id: 'a' }]);
    expect(itemsFromReply({ items: [{ id: 'a' }] })).toEqual([{ id: 'a' }]);
    expect(itemsFromReply({ payload: { items: [{ id: 'a' }] } })).toEqual([{ id: 'a' }]);
    expect(itemsFromReply({ agents: [{ agentId: 'x' }] })).toEqual([{ agentId: 'x' }]);
    // ambiguous (two array props) → no guess
    expect(itemsFromReply({ replies: [1], stateUpdates: [2] })).toEqual([]);
    expect(itemsFromReply(null)).toEqual([]);
  });
});

/**
 * canopy-chat v2 — circle app boot (DEFAULT web entry, `index.html`).
 *
 * The v2 circle app is now the landing page; the classic chat shell is
 * kept reachable at `classic.html` (linked from the header). Reuses the
 * same bundled agent factory + shared circle model. Opening a circle
 * sets the active circle (F1) and shows a scoped detail; "+ new circle"
 * creates one via the existing createGroupV2 path and refreshes.
 *
 * ⚠ Needs a browser check: agent boot, live circle data, and create are
 * not unit-verifiable here (renderer/model/scope/content/create logic
 * are covered by tests).
 */

import { initLocalisation, t, detectDeviceLang } from '../../src/index.js';
import { createRealHouseholdAgent } from '../../src/web/realAgent.js';
import { EventLog } from '../../src/eventLog.js';
import { buildCircleStream } from '../../src/v2/circleStream.js';
import { renderCircleStream } from './circleStream.js';
import { loadCircles } from '../../src/v2/circleModel.js';
import { circleSourcesFromAgent, makeResolvingCallSkill } from '../../src/v2/circleSources.js';
import { loadCircleItems } from '../../src/v2/circleContent.js';
import { quickCreateCircle } from '../../src/v2/circleCreate.js';
import { setActiveCircle, getActiveCircle } from '../../src/v2/activeCircle.js';
import { mergeCirclePolicy, mergeMemberOverride } from '../../src/v2/circlePolicy.js';
import { makeProposal } from '../../src/v2/circleConsensus.js';
import { mergeAvailability } from '../../src/v2/memberAvailability.js';
import { createAvailabilityStore, localStorageAvailabilityIo } from '../../src/v2/memberAvailability.js';
import { renderCircleAvailability } from './circleAvailability.js';
import {
  createCirclePolicyStore, localStoragePolicyIo,
  createMemberOverrideStore, localStorageOverrideIo,
} from '../../src/v2/circlePolicyStore.js';
import { renderCircleLauncher } from './circleLauncher.js';
import { renderCircleDetail } from './circleDetail.js';
import { renderCircleSettings } from './circleSettings.js';
import { renderCircleOverride } from './circleOverride.js';

const policyStore = createCirclePolicyStore(localStoragePolicyIo());
const overrideStore = createMemberOverrideStore(localStorageOverrideIo());
const availabilityStore = createAvailabilityStore(localStorageAvailabilityIo());
// Cross-circle Stream (board 5B) reads this firehose; the agent's
// publishEvent appends to it during boot.
const eventLog = new EventLog({ initial: [], muted: [] });

let rootEl = null;
let circlesCache = [];
let sources = {};
let resolveCallSkill = null; // (opId, args) => Promise<object|null>
let rawCallSkill = null;     // (appOrigin, opId, args) — for createGroupV2

function showLauncher() {
  setActiveCircle(null);
  try { sessionStorage.removeItem('cc.activeCircle'); } catch { /* ignore */ }
  renderCircleLauncher(rootEl, {
    circles: circlesCache,
    t,
    onOpenCircle: showDetail,
    onNewCircle: createCircle,
    onAvailability: showAvailability,
    onStream: showStream,
  });
}

function showStream() {
  const rows = buildCircleStream({
    events: eventLog.query({ excludeMuted: true }),
    circles: circlesCache,
  });
  renderCircleStream(rootEl, { rows, t, onBack: showLauncher, onOpenCircle: showDetail });
}

async function showAvailability() {
  let working = await availabilityStore.get();
  const rerender = () => renderCircleAvailability(rootEl, {
    availability: working,
    t,
    onChange: (patch) => { working = mergeAvailability(working, patch); rerender(); },
    onBack: showLauncher,
    onSave: async () => { await availabilityStore.update(working); showLauncher(); },
  });
  rerender();
}

async function createCircle() {
  if (!rawCallSkill) { location.href = './classic.html'; return; } // fallback: create in classic shell
  const name = (globalThis.prompt?.(t('circle.new')) || '').trim();
  if (!name) return;
  try {
    await quickCreateCircle({ callSkill: rawCallSkill, name });
    circlesCache = await loadCircles(sources);
  } catch (err) {
    console.warn('[circleApp] create failed', err);
    globalThis.alert?.(String(err?.message ?? err));
  }
  showLauncher();
}

async function showDetail(id) {
  setActiveCircle(id);
  try { sessionStorage.setItem('cc.activeCircle', id); } catch { /* ignore */ }
  const circle = circlesCache.find((c) => c.id === id) || { id };
  const onSettings = () => showSettings(id);
  const onMine = () => showOverride(id);
  renderCircleDetail(rootEl, { circle, items: [], t, onBack: showLauncher, onSettings, onMine });

  if (!resolveCallSkill) return;
  let items = [];
  try {
    items = await loadCircleItems({ callSkill: resolveCallSkill, circleId: id });
  } catch { /* keep empty */ }
  if (getActiveCircle() === id) {
    renderCircleDetail(rootEl, { circle, items, t, onBack: showLauncher, onSettings, onMine });
  }
}

async function showOverride(id) {
  let working = await overrideStore.get(id);
  const rerender = () => renderCircleOverride(rootEl, {
    override: working,
    t,
    onChange: (patch) => { working = mergeMemberOverride(working, patch); rerender(); },
    onBack: () => showDetail(id),
    onSave: async () => { await overrideStore.update(id, working); showDetail(id); },
  });
  rerender();
}

async function showSettings(id) {
  let working = await policyStore.get(id);
  const consensusActive = () => !!working.consensusRequired && (working.admins?.length ?? 0) >= 2;
  const rerender = () => renderCircleSettings(rootEl, {
    policy: working,
    t,
    saveLabel: consensusActive() ? t('circle.settings.send_proposal') : undefined,
    note: consensusActive() ? t('circle.settings.pending') : undefined,
    onChange: (patch) => { working = mergeCirclePolicy(working, patch); rerender(); },
    onBack: () => showDetail(id),
    onSave: async () => {
      if (!consensusActive()) {
        await policyStore.update(id, working);
        showDetail(id);
        return;
      }
      // Consensus required: record a pending proposal. Cross-admin delivery
      // (reuse the groupRedeem envelope) lands in 1.3b — not applied yet.
      makeProposal({ circleId: id, patch: working, proposedBy: null, policy: working });
      showDetail(id);
    },
  });
  rerender();
}

async function boot() {
  rootEl = document.getElementById('circle-root');
  await initLocalisation({ lng: detectDeviceLang() });
  renderCircleLauncher(rootEl, { loading: true, t });

  try {
    let eventSeq = 0;
    const agent = await createRealHouseholdAgent({
      publishEvent: (e) => {
        if (!e || typeof e !== 'object') return;
        eventLog.append({
          ...e,
          id: e.id ?? `cc-${Date.now()}-${(eventSeq += 1).toString(36)}`,
          ts: e.ts ?? Date.now(),
        });
      },
      stoopPersistDb: { dbName: 'cc-stoop-state', storeName: 'items' },
    });
    if (typeof agent?.callSkill === 'function') {
      rawCallSkill = agent.callSkill;
      resolveCallSkill = makeResolvingCallSkill(agent.callSkill);
      sources = circleSourcesFromAgent({ callSkill: resolveCallSkill, circlesStore: agent.circlesStore });
    }
  } catch (err) {
    console.warn('[circleApp] agent boot failed — showing empty launcher', err);
  }

  try {
    circlesCache = await loadCircles(sources);
  } catch (err) {
    console.warn('[circleApp] loadCircles failed', err);
    circlesCache = [];
  }
  showLauncher();
}

boot();

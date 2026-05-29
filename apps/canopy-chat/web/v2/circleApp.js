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
import { loadCircles } from '../../src/v2/circleModel.js';
import { circleSourcesFromAgent, makeResolvingCallSkill } from '../../src/v2/circleSources.js';
import { loadCircleItems } from '../../src/v2/circleContent.js';
import { quickCreateCircle } from '../../src/v2/circleCreate.js';
import { setActiveCircle, getActiveCircle } from '../../src/v2/activeCircle.js';
import { mergeCirclePolicy } from '../../src/v2/circlePolicy.js';
import { createCirclePolicyStore, localStoragePolicyIo } from '../../src/v2/circlePolicyStore.js';
import { renderCircleLauncher } from './circleLauncher.js';
import { renderCircleDetail } from './circleDetail.js';
import { renderCircleSettings } from './circleSettings.js';

const policyStore = createCirclePolicyStore(localStoragePolicyIo());

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
  });
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
  renderCircleDetail(rootEl, { circle, items: [], t, onBack: showLauncher, onSettings });

  if (!resolveCallSkill) return;
  let items = [];
  try {
    items = await loadCircleItems({ callSkill: resolveCallSkill, circleId: id });
  } catch { /* keep empty */ }
  if (getActiveCircle() === id) {
    renderCircleDetail(rootEl, { circle, items, t, onBack: showLauncher, onSettings });
  }
}

async function showSettings(id) {
  let working = await policyStore.get(id);
  const rerender = () => renderCircleSettings(rootEl, {
    policy: working,
    t,
    onChange: (patch) => { working = mergeCirclePolicy(working, patch); rerender(); },
    onBack: () => showDetail(id),
    onSave: async () => { await policyStore.update(id, working); showDetail(id); },
  });
  rerender();
}

async function boot() {
  rootEl = document.getElementById('circle-root');
  await initLocalisation({ lng: detectDeviceLang() });
  renderCircleLauncher(rootEl, { loading: true, t });

  try {
    const agent = await createRealHouseholdAgent({
      publishEvent: () => {},
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

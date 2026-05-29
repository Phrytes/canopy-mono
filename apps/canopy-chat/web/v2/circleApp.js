/**
 * canopy-chat v2 — circle launcher boot (web entry for `circle.html`).
 *
 * Additive: a SEPARATE page from the classic shell (`index.html` +
 * `main.js`), which is left untouched. Reuses the same bundled agent
 * factory + shared circle model. Opening a circle sets the active
 * circle (F1) and shows a scoped detail view populated with that
 * circle's items; back returns to the launcher.
 *
 * ⚠ Needs a browser check: agent boot + live circle data are not unit-
 * verifiable here (renderer + model + scope + content are covered by tests).
 */

import { initLocalisation, t, detectDeviceLang } from '../../src/index.js';
import { createRealHouseholdAgent } from '../../src/web/realAgent.js';
import { loadCircles } from '../../src/v2/circleModel.js';
import { circleSourcesFromAgent, makeResolvingCallSkill } from '../../src/v2/circleSources.js';
import { loadCircleItems } from '../../src/v2/circleContent.js';
import { setActiveCircle, getActiveCircle } from '../../src/v2/activeCircle.js';
import { renderCircleLauncher } from './circleLauncher.js';
import { renderCircleDetail } from './circleDetail.js';

let rootEl = null;
let circlesCache = [];
let resolveCallSkill = null; // (opId, args) => Promise<object|null>

function showLauncher() {
  setActiveCircle(null);
  try { sessionStorage.removeItem('cc.activeCircle'); } catch { /* ignore */ }
  renderCircleLauncher(rootEl, {
    circles: circlesCache,
    t,
    onOpenCircle: showDetail,
    onNewCircle: () => { location.href = './index.html'; },
  });
}

async function showDetail(id) {
  setActiveCircle(id);
  try { sessionStorage.setItem('cc.activeCircle', id); } catch { /* ignore */ }
  const circle = circlesCache.find((c) => c.id === id) || { id };
  renderCircleDetail(rootEl, { circle, items: [], t, onBack: showLauncher });

  if (!resolveCallSkill) return;
  let items = [];
  try {
    items = await loadCircleItems({ callSkill: resolveCallSkill, circleId: id });
  } catch { /* keep empty */ }
  // The fetch is async — only paint if the user is still on this circle.
  if (getActiveCircle() === id) {
    renderCircleDetail(rootEl, { circle, items, t, onBack: showLauncher });
  }
}

async function boot() {
  rootEl = document.getElementById('circle-root');
  await initLocalisation({ lng: detectDeviceLang() });
  renderCircleLauncher(rootEl, { loading: true, t });

  let sources = {};
  try {
    const agent = await createRealHouseholdAgent({
      publishEvent: () => {},
      stoopPersistDb: { dbName: 'cc-stoop-state', storeName: 'items' },
    });
    if (typeof agent?.callSkill === 'function') {
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

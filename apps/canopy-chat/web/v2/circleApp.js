/**
 * canopy-chat v2 — circle launcher boot (web entry for `circle.html`).
 *
 * Additive: a SEPARATE page from the classic shell (`index.html` +
 * `main.js`), which is left untouched. Reuses the same bundled agent
 * factory + shared circle model. Opening a circle sets the active
 * circle (F1) and shows a scoped detail view; back returns to the
 * launcher. Detail content (scoped items) is populated in a later
 * sub-slice — for now it shows the circle header + empty state.
 *
 * ⚠ Needs a browser check: agent boot + live circle data are not unit-
 * verifiable here (renderer + model + scope are covered by tests).
 */

import { initLocalisation, t, detectDeviceLang } from '../../src/index.js';
import { createRealHouseholdAgent } from '../../src/web/realAgent.js';
import { loadCircles } from '../../src/v2/circleModel.js';
import { circleSourcesFromAgent } from '../../src/v2/circleSources.js';
import { setActiveCircle } from '../../src/v2/activeCircle.js';
import { renderCircleLauncher } from './circleLauncher.js';
import { renderCircleDetail } from './circleDetail.js';

const APP_ORIGINS = ['stoop', 'tasks-v0', 'household', 'calendar', 'folio'];

let rootEl = null;
let circlesCache = [];

function showLauncher() {
  setActiveCircle(null);
  try { sessionStorage.removeItem('cc.activeCircle'); } catch { /* ignore */ }
  renderCircleLauncher(rootEl, {
    circles: circlesCache,
    t,
    onOpenCircle: (id) => showDetail(id),
    onNewCircle: () => { location.href = './index.html'; },
  });
}

function showDetail(id) {
  setActiveCircle(id);
  try { sessionStorage.setItem('cc.activeCircle', id); } catch { /* ignore */ }
  const circle = circlesCache.find((c) => c.id === id) || { id };
  renderCircleDetail(rootEl, {
    circle,
    items: [], // scoped content lands in a later sub-slice
    t,
    onBack: showLauncher,
  });
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
      const callSkill = async (opId, args) => {
        for (const app of APP_ORIGINS) {
          try {
            const r = await agent.callSkill(app, opId, args ?? {});
            if (r != null) return r;
          } catch { /* try next origin */ }
        }
        return null;
      };
      sources = circleSourcesFromAgent({ callSkill, circlesStore: agent.circlesStore });
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

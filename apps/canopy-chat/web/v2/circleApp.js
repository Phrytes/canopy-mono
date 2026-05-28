/**
 * canopy-chat v2 — circle launcher boot (web entry for `circle.html`).
 *
 * Additive: a SEPARATE page from the classic shell (`index.html` +
 * `main.js`), which is left untouched. Reuses the same bundled agent
 * factory + shared circle model. The data path is best-effort and
 * degrades to an empty launcher if the agent interface differs — the
 * view always renders. F1 (scoping the chat by the opened circle) is a
 * later slice; for now opening a circle returns to the classic shell.
 *
 * ⚠ Needs a browser check: agent boot + live circle data are not unit-
 * verifiable here (the renderer + model + sources are covered by tests).
 */

import { initLocalisation, t, detectDeviceLang } from '../../src/index.js';
import { createRealHouseholdAgent } from '../../src/web/realAgent.js';
import { loadCircles } from '../../src/v2/circleModel.js';
import { circleSourcesFromAgent } from '../../src/v2/circleSources.js';
import { renderCircleLauncher } from './circleLauncher.js';

// Op→app resolution differs from the classic shell's bespoke callSkill;
// we try each known origin and take the first non-null result. The
// circleSources shape-checks filter out wrong-app responses.
const APP_ORIGINS = ['stoop', 'tasks-v0', 'household', 'calendar', 'folio'];

async function boot() {
  const root = document.getElementById('circle-root');
  await initLocalisation({ lng: detectDeviceLang() });
  renderCircleLauncher(root, { loading: true, t });

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

  let circles = [];
  try {
    circles = await loadCircles(sources);
  } catch (err) {
    console.warn('[circleApp] loadCircles failed', err);
  }

  renderCircleLauncher(root, {
    circles,
    t,
    onOpenCircle: (id) => {
      try { sessionStorage.setItem('cc.activeCircle', id); } catch { /* ignore */ }
      location.href = './index.html';
    },
    onNewCircle: () => { location.href = './index.html'; },
  });
}

boot();

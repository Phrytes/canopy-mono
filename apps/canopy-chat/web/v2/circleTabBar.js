/**
 * canopy-chat v2 — launcher bottom tab bar (web, board 1/5/6C).
 *
 * Kringen / Stroom / Mij — the three top-level surfaces. Shown on the
 * launcher, stream and Me screens; hidden inside a circle + its sub-screens
 * (the host calls `hideCircleTabBar`). Pure render; the host wires handlers.
 */

// α.3 — Schermen is the new primary tab (Q6).  Order: Screens first,
// then Kringen (the data layer), then Mij.  Stroom is gone — its
// behaviour now lives as the seeded "Stream" screen on the Screens tab.
const TABS = [
  { id: 'screens', key: 'circle.tab.screens' },
  { id: 'kringen', key: 'circle.tab.kringen' },
  { id: 'mij',     key: 'circle.tab.mij' },
];

export function renderCircleTabBar(container, { active, t, onScreens, onKringen, onMij } = {}) {
  if (!container) return container;
  const tr = typeof t === 'function' ? t : (k) => k;
  const handlers = { screens: onScreens, kringen: onKringen, mij: onMij };
  container.innerHTML = '';
  container.className = 'circle-tabbar';
  for (const tab of TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'circle-tabbar__tab';
    btn.dataset.tab = tab.id;
    if (active === tab.id) {
      btn.classList.add('is-active');
      btn.setAttribute('aria-current', 'page');
    }
    btn.textContent = tr(tab.key);
    const on = handlers[tab.id];
    btn.addEventListener('click', () => { if (typeof on === 'function') on(); });
    container.appendChild(btn);
  }
  return container;
}

export function hideCircleTabBar(container) {
  if (!container) return;
  container.innerHTML = '';
  container.className = 'circle-tabbar circle-tabbar--hidden';
}

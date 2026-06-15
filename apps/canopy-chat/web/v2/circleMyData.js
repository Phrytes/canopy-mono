/**
 * canopy-chat v2 — "My data" screen (web DOM renderer, S5 — privacy + diagnostics).
 *
 * A read-only surface that retires stoop's privacy + metrics + data-location
 * pages: WHERE your data lives (pod root / relay, `getDataLocation` +
 * `podSignInStatus`), the privacy disclosure (`getPrivacyNotice`), and a usage
 * snapshot (`getMetrics`). Pure render — the host (`circleApp.js` showMyData)
 * loads the stoop ops and passes the results. No mutations (the sensitive
 * backup/mnemonic + the OIDC sign-in flow are separate, env-gated slices).
 */

export function renderCircleMyData(container, {
  dataLocation = {},
  podStatus = {},
  privacy = [],
  metrics = {},
  t,
  onBack,
} = {}) {
  if (!container) return container;
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.className = 'cc-mydata';

  const header = document.createElement('div');
  header.className = 'cc-mydata__header';
  if (typeof onBack === 'function') {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'cc-mydata__back';
    back.textContent = tr('circle.mydata.back');
    back.addEventListener('click', () => onBack());
    header.appendChild(back);
  }
  const title = document.createElement('h2');
  title.className = 'cc-mydata__title';
  title.textContent = tr('circle.mydata.title');
  header.appendChild(title);
  container.appendChild(header);

  // ── where your data lives ─────────────────────────────────────────────────
  const storage = section(tr('circle.mydata.storage'));
  const status = podStatus.signedIn
    ? tr('circle.mydata.pod_signed_in', { webid: podStatus.webid ?? '' })
    : tr('circle.mydata.pod_local');
  storage.appendChild(kv(tr('circle.mydata.pod'), status));
  if (dataLocation.podRoot) storage.appendChild(kv(tr('circle.mydata.pod_root'), dataLocation.podRoot));
  if (dataLocation.relayOperator || dataLocation.relayUrl) {
    storage.appendChild(kv(tr('circle.mydata.relay'), [dataLocation.relayOperator, dataLocation.relayUrl].filter(Boolean).join(' · ')));
  }
  container.appendChild(storage);

  // ── privacy ────────────────────────────────────────────────────────────────
  if (Array.isArray(privacy) && privacy.length) {
    const priv = section(tr('circle.mydata.privacy'));
    for (const s of privacy) {
      const item = document.createElement('div');
      item.className = 'cc-mydata__privacy';
      const h = document.createElement('div');
      h.className = 'cc-mydata__privacy-title';
      h.textContent = s.title ?? '';
      const b = document.createElement('p');
      b.className = 'cc-mydata__privacy-body';
      b.textContent = s.body ?? '';
      item.appendChild(h);
      item.appendChild(b);
      priv.appendChild(item);
    }
    container.appendChild(priv);
  }

  // ── usage ──────────────────────────────────────────────────────────────────
  const entries = Object.entries(metrics || {});
  if (entries.length) {
    const usage = section(tr('circle.mydata.usage'));
    for (const [k, v] of entries) {
      usage.appendChild(kv(k, typeof v === 'object' ? JSON.stringify(v) : String(v)));
    }
    container.appendChild(usage);
  }
  return container;

  // ── helpers ──
  function section(titleText) {
    const s = document.createElement('section');
    s.className = 'cc-mydata__section';
    const h = document.createElement('h3');
    h.className = 'cc-mydata__section-title';
    h.textContent = titleText;
    s.appendChild(h);
    return s;
  }
  function kv(key, value) {
    const row = document.createElement('div');
    row.className = 'cc-mydata__kv';
    const k = document.createElement('span');
    k.className = 'cc-mydata__k';
    k.textContent = key;
    const v = document.createElement('span');
    v.className = 'cc-mydata__v';
    v.textContent = value;
    row.appendChild(k);
    row.appendChild(v);
    return row;
  }
}

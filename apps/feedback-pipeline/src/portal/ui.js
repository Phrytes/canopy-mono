// Portal GUI (PR-2) — one self-contained HTML page (no build step) served by the portal
// server. A project lead fills the menukaart, sees the project dashboard, and mints invite
// links. All logic is the small JSON API in server.js; this is just the surface.

import { attributeKeys, bucketsFor } from '@canopy/attribute-charter';

export function portalHtml({ inviteBase } = {}) {
  // The charter picker rows — one per curated coarse vocabulary attribute. The lead may
  // tick UP TO 3 and give each a short "waarom we dit vragen" purpose. The server re-validates
  // through createCharter (cap/vocabulary/purpose) as the real gate.
  const charterRows = attributeKeys().map((key) => {
    const buckets = bucketsFor(key);
    const hint = buckets ? buckets.join(' · ') : 'gemeente (open, grofmazig)';
    return `<div class="charter-attr">
        <label style="margin:0"><input type="checkbox" class="charter-key" value="${esc(key)}" style="width:auto"> <b>${esc(key)}</b> <span class="muted">${esc(hint)}</span></label>
        <input class="charter-purpose" data-key="${esc(key)}" placeholder="Waarom vragen we dit? (verplicht bij aanvinken)">
      </div>`;
  }).join('');
  const inviteHint = inviteBase
    ? `Standaard uitnodigings-URL: <code>${esc(inviteBase)}</code> — per project te overschrijven.`
    : `Geen standaard ingesteld — geef een uitnodigings-URL per project, of zet <code>FP_INVITE_BASE</code> als algemene standaard.`;
  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feedback-infrastructuur — projectportaal</title>
<style>
  :root { --fg:#1a1a1a; --mut:#666; --line:#e2e2e2; --accent:#2c6e49; --warn:#b54708; --bg:#fafaf8; }
  * { box-sizing: border-box; } body { font: 15px/1.5 system-ui, sans-serif; color:var(--fg); background:var(--bg); margin:0; }
  header { padding:18px 24px; border-bottom:1px solid var(--line); background:#fff; }
  h1 { font-size:18px; margin:0; } .sub { color:var(--mut); font-size:13px; margin-top:4px; }
  main { max-width:980px; margin:0 auto; padding:24px; display:grid; gap:24px; grid-template-columns:1fr 1fr; }
  section { background:#fff; border:1px solid var(--line); border-radius:10px; padding:18px; }
  section.wide { grid-column:1 / -1; }
  h2 { font-size:15px; margin:0 0 12px; } label { display:block; font-size:13px; margin:10px 0 3px; color:#333; }
  input, select, textarea { width:100%; padding:7px 9px; border:1px solid var(--line); border-radius:6px; font:inherit; background:#fff; }
  .row { display:grid; gap:12px; grid-template-columns:1fr 1fr; } .muted { color:var(--mut); font-size:12px; }
  button { background:var(--accent); color:#fff; border:0; border-radius:7px; padding:9px 14px; font:inherit; cursor:pointer; margin-top:14px; }
  button.sec { background:#eee; color:#222; padding:6px 10px; margin:0; }
  .card { border:1px solid var(--line); border-radius:8px; padding:12px; margin-bottom:10px; }
  .pill { display:inline-block; font-size:11px; padding:2px 7px; border-radius:99px; background:#eef2ee; color:var(--accent); margin-left:6px; }
  .pill.off { background:#f1f1f1; color:#777; }
  .notice { background:#fff7ed; border:1px solid #fed7aa; color:var(--warn); padding:10px; border-radius:7px; margin-top:12px; font-size:13px; word-break:break-all; }
  .keybox { border:2px solid var(--warn); background:#fff7ed; }
  .keybox .keyhead { font-size:14px; font-weight:700; color:var(--warn); }
  .keybox pre { background:#fff; border:1px dashed var(--warn); }
  .keybox .actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
  .keybox button { margin-top:0; }
  .kvs { margin-top:8px; display:grid; gap:2px; }
  .kv { display:flex; justify-content:space-between; gap:8px; font-size:12px; border-top:1px solid #f0f0ee; padding:3px 0; }
  .kv .k { color:var(--mut); } .kv .v { color:#222; text-align:right; word-break:break-word; }
  pre { background:#f6f6f4; border:1px solid var(--line); border-radius:6px; padding:8px; font-size:12px; overflow:auto; max-height:180px; }
  .err { color:#b42318; font-size:13px; margin-top:8px; } .ok { color:var(--accent); font-size:13px; margin-top:8px; } .hide { display:none; }
  code { background:#f1f1ef; padding:1px 4px; border-radius:4px; }
  .charter-box { border:1px solid var(--line); border-radius:8px; padding:12px; margin-top:6px; background:#fbfbf9; }
  .charter-attr { border-top:1px solid #f0f0ee; padding:8px 0; }
  .charter-attr:first-of-type { border-top:0; }
  .charter-attr .charter-purpose { margin-top:5px; }
  .charter-view { border-top:1px solid #f0f0ee; margin-top:8px; padding-top:6px; }
</style></head>
<body>
<header><h1>Feedback-infrastructuur — projectportaal</h1>
  <div class="sub">Maak een project, kies de menukaart, deel uitnodigingslinks. <span class="muted">${inviteHint}</span></div>
</header>
<main>
  <section>
    <h2>Nieuw project</h2>
    <form id="f">
      <div class="row">
        <div><label>Project-ID</label><input name="projectId" required placeholder="gemeente-x-2026"></div>
        <div><label>Projectnaam</label><input name="projectName" placeholder="Wijkvernieuwing"></div>
      </div>
      <div class="row">
        <div><label>LLM-route</label><select name="route">
          <option value="local">local (Ollama)</option><option value="privatemode">privatemode (TEE)</option>
          <option value="ovh">ovh</option><option value="within-walls">within-walls</option></select></div>
        <div><label>Model</label><input name="model" required value="qwen2.5:7b-instruct"></div>
      </div>
      <div class="row">
        <div><label>Taal</label><select name="lang"><option value="nl">nl</option><option value="en">en</option></select></div>
        <div><label>Review</label><select name="review"><option value="notification">notification</option><option value="required-approval">required-approval</option></select></div>
      </div>
      <div class="row">
        <div><label>k-anonimiteit (drempel)</label><input name="k" type="number" min="1" value="4" required></div>
        <div><label>Signaal-bestemmingen <span class="muted">(JSON, optioneel)</span></label><input name="destinations" placeholder='{"crisis":"113"}'></div>
      </div>

      <label><input type="checkbox" name="seal" style="width:auto"> Versleuteld opslaan (seal-at-rest)</label>
      <div id="sealopts" class="hide">
        <div class="row">
          <div><label>Sleutelgeneratie</label><select name="keygen">
            <option value="client">client (browser/app — host blind)</option>
            <option value="external">external (offline aangeleverd)</option>
            <option value="host">host (server genereert — gemak)</option></select></div>
          <div><label>Project-publieke sleutel <span class="muted">(b64url X25519)</span></label><input name="projectPublicKey" placeholder="vereist tenzij keygen=host"></div>
        </div>
        <div class="muted">Bij <code>host</code> maakt de server het sleutelpaar en toont de privésleutel <b>één keer</b> — bewaren! Bij <code>client/external</code> plak je hier alleen de publieke sleutel.</div>
      </div>

      <label style="margin-top:14px"><b>Gevraagde kenmerken (charter)</b> <span class="muted">— optioneel; max 3 grofmazige kenmerken</span></label>
      <div class="charter-box">
        <div class="muted">Vastgelegd bij aanmaken en daarna <b>onveranderlijk</b> voor deze projectversie. Elke deelnemer ziet dit charter en kiest zélf per kenmerk of ze het (grofmazig) delen. Meer vragen kan alleen met een nieuwe versie.</div>
        ${charterRows}
      </div>

      <div class="row">
        <div><label>Cohort verloopt op</label><input name="expiresAt" type="date" required></div>
        <div><label>Plafond (max activaties)</label><input name="ceiling" type="number" min="1" value="100" required></div>
      </div>
      <label>Uitnodigings-URL <span class="muted">(waar deelnemers landen; leeg = portaalstandaard)</span></label>
      <input name="inviteBase" placeholder="${esc(inviteBase || 'https://chat.voorbeeld.nl/')}">
      <button type="submit">Project aanmaken</button>
      <div id="ferr" class="err"></div>
      <div id="keybox" class="notice keybox hide"></div>
    </form>
  </section>

  <section>
    <h2>Projecten</h2>
    <div id="list" class="muted">laden…</div>
  </section>

  <section class="wide">
    <h2>Uitnodigingscodes</h2>
    <div class="row">
      <div><label>Project</label><select id="cproj"></select></div>
      <div><label>Aantal</label><input id="ccount" type="number" min="1" max="1000" value="25"></div>
    </div>
    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
      <button id="cgen" class="sec" style="margin-top:14px">Codes genereren</button>
      <button id="ccopy" class="sec hide" style="margin-top:14px">Kopieer</button>
    </div>
    <div id="chint" class="muted hide" style="margin-top:8px">Deel deze links met deelnemers — elke code werkt één keer.</div>
    <div id="cerr" class="err"></div>
    <pre id="cout" class="hide"></pre>
  </section>

  <section class="wide">
    <h2>Verificatieronde</h2>
    <div class="sub">Open een ronde: deelnemers krijgen via hun bot de samenvatting van hun eigen feedback ter
      goedkeuring; alleen wat zij goedkeuren gaat naar de centrale pod.</div>
    <button id="vround" class="sec" style="margin-top:14px">Verificatieronde openen</button>
    <pre id="vout" class="hide"></pre>
  </section>
</main>
<script>
const J = (r) => r.json();
const api = (m, p, b) => fetch(p, { method:m, headers:{'content-type':'application/json'}, body: b?JSON.stringify(b):undefined }).then(J);

async function refresh() {
  const list = document.getElementById('list');
  let projects = [];
  try { ({ projects=[] } = await api('GET','/api/projects')); }
  catch { list.innerHTML = '<div class="err">Projectenlijst laden mislukt — draait de portal nog?</div>'; return; }
  const sel = document.getElementById('cproj'); const cur = sel.value;
  sel.innerHTML = projects.map(p => '<option>'+esc(p.projectId)+'</option>').join('');
  if (cur && projects.some(p => p.projectId === cur)) sel.value = cur;
  list.innerHTML = projects.length ? projects.map(card).join('') :
    '<div class="muted">Nog geen projecten. Maak er hiernaast een aan.</div>';
}
function fmtDate(s){ if(!s) return '—'; const d = new Date(s); return isNaN(d) ? String(s) : d.toLocaleDateString('nl-NL'); }
// row() escapes both label and value, so ALL call sites pass RAW strings (never pre-escaped).
function row(label, value){ return '<div class="kv"><span class="k">'+esc(label)+'</span><span class="v">'+esc(value)+'</span></div>'; }
function card(p) {
  const s = p.settings || {};
  const seal = p.seal
    ? '<span class="pill">seal: '+esc(p.keygen)+' · '+esc(s.sealLocation||'host')+(p.hasProjectKey?'':' · ⚠ geen sleutel')+'</span>'
    : '<span class="pill off">geen seal</span>';
  const verify = s.verify ? '<span class="pill">handtekening vereist</span>' : '';
  const charter = s.charter;
  const charterPill = charter ? '<span class="pill">charter · '+charter.attributes.length+' kenmerk'+(charter.attributes.length===1?'':'en')+'</span>' : '';
  const charterView = charter
    ? '<div class="charter-view"><div class="muted">Gevraagde kenmerken (charter v'+esc(charter.version)+' · onveranderlijk):</div>'+
        '<div class="kvs">'+charter.attributes.map(a => row(a.key, a.purpose)).join('')+'</div></div>'
    : '';
  const expired = p.expiresAt && new Date(p.expiresAt) < new Date();
  return '<div class="card"><div><b>'+esc(p.projectName||p.projectId)+'</b> '+seal+' '+verify+' '+charterPill+'</div>'+
    '<div class="muted">'+esc(p.projectId)+'</div>'+
    '<div class="kvs">'+
      row('Activaties', p.activations+' / '+p.ceiling)+
      row('Cohort verloopt', fmtDate(p.expiresAt)+(expired?' (verlopen)':''))+
      row('Aangemaakt', fmtDate(p.createdAt))+
      row('k-anonimiteit', 'k='+(s.k??'?')+' · onder drempel: '+(s.belowThreshold||'?'))+
      row('Taal · review', (s.language||'?')+' · '+(s.review||'?'))+
      row('LLM-route', (s.route||'?')+' · '+(s.model||'?'))+
    '</div>'+charterView+'</div>';
}
function esc(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// Copy text to the clipboard; falls back to a hidden textarea when the async API is unavailable
// (http on a LAN IP, older browsers). Flashes the button label so the lead sees it worked.
async function copyText(text, btn){
  const done = () => { if(!btn) return; const o = btn.textContent; btn.textContent = 'Gekopieerd ✓'; setTimeout(()=>{ btn.textContent = o; }, 1400); };
  try { await navigator.clipboard.writeText(text); done(); return true; }
  catch {
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); return true; }
    catch { return false; }
  }
}

// The one-time private key: shown ONCE, never stored. Make the "save it now" moment prominent —
// copy-to-clipboard + an explicit "I've saved it" confirm the lead must click to dismiss.
function showPrivateKey(res){
  const box = document.getElementById('keybox');
  box.classList.remove('hide');
  box.innerHTML = '';
  const head = document.createElement('div'); head.className = 'keyhead';
  head.textContent = '⚠ Privésleutel — nu bewaren, wordt maar één keer getoond';
  const note = document.createElement('div'); note.style.margin = '6px 0'; note.textContent = res.keyNotice ||
    'Bewaar deze sleutel nu. Hij wordt nergens opgeslagen. Aggregatie heeft hem nodig — kwijt = data onherstelbaar.';
  const pre = document.createElement('pre'); pre.textContent = res.projectPrivateKey;
  const actions = document.createElement('div'); actions.className = 'actions';
  const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'sec'; copy.textContent = 'Kopieer sleutel';
  copy.addEventListener('click', () => copyText(res.projectPrivateKey, copy));
  const dl = document.createElement('button'); dl.type = 'button'; dl.className = 'sec'; dl.textContent = 'Download .txt';
  dl.addEventListener('click', () => {
    const blob = new Blob([res.projectPrivateKey + '\\n'], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'project-privesleutel.txt'; a.click(); URL.revokeObjectURL(a.href);
  });
  const ok = document.createElement('button'); ok.type = 'button'; ok.textContent = 'Ik heb de sleutel bewaard';
  ok.addEventListener('click', () => { box.classList.add('hide'); box.innerHTML = ''; });
  actions.append(copy, dl, ok);
  box.append(head, note, pre, actions);
}

document.querySelector('[name=seal]').addEventListener('change', e =>
  document.getElementById('sealopts').classList.toggle('hide', !e.target.checked));

document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target), g = (k)=>fd.get(k); const err = document.getElementById('ferr'); err.textContent='';
  // client-side validation surfaced to the lead (the server re-validates as the real gate)
  if (!g('projectId')) { err.textContent = 'Project-ID is verplicht.'; return; }
  const k = Number(g('k')); if (!Number.isInteger(k) || k < 1) { err.textContent = 'k-anonimiteit moet een geheel getal ≥ 1 zijn.'; return; }
  const ceiling = Number(g('ceiling')); if (!Number.isInteger(ceiling) || ceiling < 1) { err.textContent = 'Plafond moet een geheel getal ≥ 1 zijn.'; return; }
  const exp = new Date(g('expiresAt')); if (isNaN(exp)) { err.textContent = 'Kies een geldige verloopdatum voor het cohort.'; return; }
  if (exp < new Date()) { err.textContent = 'De verloopdatum ligt in het verleden.'; return; }
  let destinations = {}; try { if (g('destinations')) destinations = JSON.parse(g('destinations')); }
  catch { err.textContent = 'Signaal-bestemmingen is geen geldige JSON.'; return; }
  const seal = !!g('seal');
  if (seal && g('keygen') !== 'host' && !g('projectPublicKey')) {
    err.textContent = 'Bij seal met keygen ' + g('keygen') + ' is een project-publieke sleutel vereist.'; return;
  }
  // charter — the ticked coarse attributes + their purpose (server re-validates via createCharter)
  const charterAttrs = [...document.querySelectorAll('.charter-key:checked')].map(cb => ({
    key: cb.value,
    purpose: (document.querySelector('.charter-purpose[data-key="'+cb.value+'"]').value || '').trim(),
  }));
  if (charterAttrs.length > 3) { err.textContent = 'Een charter mag hoogstens 3 kenmerken bevatten.'; return; }
  if (charterAttrs.some(a => !a.purpose)) { err.textContent = 'Geef bij elk aangevinkt kenmerk een korte reden ("waarom we dit vragen").'; return; }
  const config = {
    projectId: g('projectId'), projectName: g('projectName') || undefined,
    llm: { route: g('route'), model: g('model') },
    language: { preferred: g('lang') }, review: { mode: g('review') },
    aggregation: { k },
    signal: { destinations },
    privacy: seal ? { seal:true, keygen:g('keygen'), projectPublicKey: g('projectPublicKey') || undefined } : { seal:false },
  };
  if (charterAttrs.length) config.charter = { attributes: charterAttrs };
  const cohort = { expiresAt: exp.toISOString(), ceiling };
  const inviteBase = g('inviteBase') || undefined;
  let res;
  try { res = await api('POST','/api/projects',{ config, cohort, inviteBase }); }
  catch { err.textContent = 'Aanmaken mislukt — geen verbinding met de portal.'; return; }
  if (!res.ok) { err.textContent = res.reason || 'aanmaken mislukt'; return; }
  e.target.reset(); document.getElementById('sealopts').classList.add('hide');
  if (res.projectPrivateKey) showPrivateKey(res);
  refresh();
});

document.getElementById('cgen').addEventListener('click', async () => {
  const projectId = document.getElementById('cproj').value;
  const count = Number(document.getElementById('ccount').value)||1;
  const cerr = document.getElementById('cerr'); cerr.textContent = '';
  const out = document.getElementById('cout'); const copy = document.getElementById('ccopy'); const hint = document.getElementById('chint');
  if (!projectId) { cerr.textContent = 'Kies eerst een project.'; return; }
  let res;
  try { res = await api('POST','/api/projects/'+encodeURIComponent(projectId)+'/codes',{ count }); }
  catch { cerr.textContent = 'Codes genereren mislukt — geen verbinding.'; return; }
  if (!res.ok) { cerr.textContent = res.reason || 'codes genereren mislukt'; out.classList.add('hide'); copy.classList.add('hide'); hint.classList.add('hide'); return; }
  const lines = (res.links && res.links.length ? res.links : res.codes || []);
  out.classList.remove('hide'); out.textContent = lines.join('\\n') || '—';
  copy.classList.toggle('hide', lines.length === 0);
  hint.classList.toggle('hide', !(res.links && res.links.length));   // only links are shareable URLs
});
document.getElementById('ccopy').addEventListener('click', (e) => {
  const text = document.getElementById('cout').textContent; if (text && text !== '—') copyText(text, e.currentTarget);
});

async function renderRounds(projectId){
  const out = document.getElementById('vout'); out.classList.remove('hide');
  let rounds = [];
  try { ({ rounds=[] } = await api('GET','/api/projects/'+encodeURIComponent(projectId)+'/rounds')); }
  catch { out.textContent = 'Rondes laden mislukt — geen verbinding.'; return; }
  out.textContent = rounds.length
    ? rounds.map(r => 'Ronde '+r.round+': '+(r.verified||0)+'/'+(r.of||0)+' geverifieerd').join('\\n')
    : 'Nog geen rondes geopend.';
}
document.getElementById('vround').addEventListener('click', async () => {
  const projectId = document.getElementById('cproj').value;   // reuse the same project selector
  const out = document.getElementById('vout'); out.classList.remove('hide');
  if (!projectId) { out.textContent = 'Kies eerst een project (bij Uitnodigingscodes).'; return; }
  const enc = encodeURIComponent(projectId);
  try {
    const { rounds=[] } = await api('GET','/api/projects/'+enc+'/rounds');   // next round = max+1
    const next = (rounds.reduce((m,r)=>Math.max(m, Number(r.round)||0), 0)) + 1;
    await api('POST','/api/projects/'+enc+'/rounds',{ round: next, openedBy: 'lead' });
  } catch { out.textContent = 'Ronde openen mislukt — geen verbinding.'; return; }
  await renderRounds(projectId);
});
document.getElementById('cproj').addEventListener('change', (e) => { if (e.target.value) renderRounds(e.target.value); });

refresh();
</script>
</body></html>`;
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

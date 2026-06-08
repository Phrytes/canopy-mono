// Portal GUI (PR-2) — one self-contained HTML page (no build step) served by the portal
// server. A project lead fills the menukaart, sees the project dashboard, and mints invite
// links. All logic is the small JSON API in server.js; this is just the surface.

export function portalHtml({ inviteBase } = {}) {
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
  pre { background:#f6f6f4; border:1px solid var(--line); border-radius:6px; padding:8px; font-size:12px; overflow:auto; max-height:180px; }
  .err { color:#b42318; font-size:13px; margin-top:8px; } .hide { display:none; }
  code { background:#f1f1ef; padding:1px 4px; border-radius:4px; }
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

      <div class="row">
        <div><label>Cohort verloopt op</label><input name="expiresAt" type="date" required></div>
        <div><label>Plafond (max activaties)</label><input name="ceiling" type="number" min="1" value="100" required></div>
      </div>
      <label>Uitnodigings-URL <span class="muted">(waar deelnemers landen; leeg = portaalstandaard)</span></label>
      <input name="inviteBase" placeholder="${esc(inviteBase || 'https://chat.voorbeeld.nl/')}">
      <button type="submit">Project aanmaken</button>
      <div id="ferr" class="err"></div>
      <div id="keybox" class="notice hide"></div>
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
    <button id="cgen" class="sec" style="margin-top:14px">Codes genereren</button>
    <pre id="cout" class="hide"></pre>
  </section>
</main>
<script>
const J = (r) => r.json();
const api = (m, p, b) => fetch(p, { method:m, headers:{'content-type':'application/json'}, body: b?JSON.stringify(b):undefined }).then(J);

async function refresh() {
  const { projects=[] } = await api('GET','/api/projects');
  const sel = document.getElementById('cproj'); const cur = sel.value;
  sel.innerHTML = projects.map(p => '<option>'+esc(p.projectId)+'</option>').join('');
  if (cur) sel.value = cur;
  document.getElementById('list').innerHTML = projects.length ? projects.map(card).join('') :
    '<div class="muted">Nog geen projecten.</div>';
}
function card(p) {
  const seal = p.seal ? '<span class="pill">seal: '+esc(p.keygen)+'</span>' : '<span class="pill off">geen seal</span>';
  return '<div class="card"><b>'+esc(p.projectName||p.projectId)+'</b> '+seal+
    '<div class="muted">'+esc(p.projectId)+' · activaties '+p.activations+'/'+p.ceiling+' · verloopt '+esc(p.expiresAt)+'</div></div>';
}
function esc(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

document.querySelector('[name=seal]').addEventListener('change', e =>
  document.getElementById('sealopts').classList.toggle('hide', !e.target.checked));

document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target), g = (k)=>fd.get(k); const err = document.getElementById('ferr'); err.textContent='';
  let destinations = {}; try { if (g('destinations')) destinations = JSON.parse(g('destinations')); }
  catch { err.textContent = 'Signaal-bestemmingen is geen geldige JSON.'; return; }
  const seal = !!g('seal');
  const config = {
    projectId: g('projectId'), projectName: g('projectName') || undefined,
    llm: { route: g('route'), model: g('model') },
    language: { preferred: g('lang') }, review: { mode: g('review') },
    aggregation: { k: Number(g('k')) },
    signal: { destinations },
    privacy: seal ? { seal:true, keygen:g('keygen'), projectPublicKey: g('projectPublicKey') || undefined } : { seal:false },
  };
  const cohort = { expiresAt: new Date(g('expiresAt')).toISOString(), ceiling: Number(g('ceiling')) };
  const inviteBase = g('inviteBase') || undefined;
  const res = await api('POST','/api/projects',{ config, cohort, inviteBase });
  if (!res.ok) { err.textContent = res.reason || 'aanmaken mislukt'; return; }
  e.target.reset(); document.getElementById('sealopts').classList.add('hide');
  if (res.projectPrivateKey) {
    const box = document.getElementById('keybox'); box.classList.remove('hide');
    box.innerHTML = '<b>Privésleutel (één keer getoond — bewaar nu!)</b><br>'+esc(res.keyNotice)+
      '<pre>'+esc(res.projectPrivateKey)+'</pre>';
  }
  refresh();
});

document.getElementById('cgen').addEventListener('click', async () => {
  const projectId = document.getElementById('cproj').value;
  const count = Number(document.getElementById('ccount').value)||1;
  if (!projectId) return;
  const res = await api('POST','/api/projects/'+encodeURIComponent(projectId)+'/codes',{ count });
  const out = document.getElementById('cout'); out.classList.remove('hide');
  out.textContent = (res.links && res.links.length ? res.links : res.codes || []).join('\\n') || (res.reason||'—');
});

refresh();
</script>
</body></html>`;
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// J-feedback: the multi-user CENTRAL-POD ROUTE. Several users' feedback lands in
// ONE central pod as PSEUDONYMOUS contributions (identity only in the path, never
// the body), aggregatable across all of them, with duplicate-id rejection. This is
// the §6a server-side / Telegram-bot on-ramp shape (`flat:false` — one authed
// writer deposits on behalf of each participant).
//
// GATED on a real pod (CSS_URL, default :3001) AND soft-coupled to the feedback app
// (skips cleanly if @canopy-app/feedback-pipeline is absent — it is splitting to its
// own repo), so the rest of the matrix is unaffected either way.
import { VaultMemory } from '@canopy/vault';
import { checker }     from './_util.mjs';

export const name = 'J-feedback (multi-user central-pod route)';

const CSS_URL = process.env.CSS_URL || 'http://localhost:3001/';

async function cssReachable(base) {
  try { return (await fetch(`${base}.account/`, { signal: AbortSignal.timeout(2500) })).ok; } catch { return false; }
}

async function provision(base, label) {
  let cookie = '';
  const api = async (url, opts = {}) => {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { accept: 'application/json', ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let json = null; try { json = await res.json(); } catch { /* */ }
    return { res, json };
  };
  const c0 = (await api(`${base}.account/`)).json.controls;
  await api(c0.account.create, { method: 'POST' });
  const c = (await api(`${base}.account/`)).json.controls;
  await api(c.password.create, { method: 'POST', body: { email: `${label}@ex.com`, password: 'pw-123456' } });
  const pod = await api(c.account.pod, { method: 'POST', body: { name: label } });
  const webId = pod.json?.webId ?? `${base}${label}/profile/card#me`;
  const cc = await api(c.account.clientCredentials, { method: 'POST', body: { name: `${label}-tok`, webId } });
  return { podRoot: (pod.json?.pod ?? `${base}${label}/`), webId, clientId: cc.json?.id, clientSecret: cc.json?.secret };
}

const ALLOWED_KEYS = ['id', 'text', 'raw', 'themeTags', 'timeWindow', 'lang'];

export async function run() {
  if (!(await cssReachable(CSS_URL))) return { skipped: true, reason: `no CSS at ${CSS_URL} (set CSS_URL to run)` };
  let makeCssCentralPod;
  try { ({ makeCssCentralPod } = await import('../../../../feedback/src/public/index.js')); }
  catch (e) { return { skipped: true, reason: `feedback-pipeline unavailable (${(e?.message ?? '').slice(0, 48)})` }; }

  const { results, check } = checker();
  const { SolidVault } = await import('../../../packages/oidc-session/index.js');
  const { SolidOidcAuth } = await import('@canopy/pod-client');

  // The central pod owner = the collector / on-ramp writer (a Telegram bot, say).
  const acct = await provision(CSS_URL, `feedback${Date.now().toString(36)}`);
  check('provisioned the central feedback pod (collector account)', !!acct.clientId && !!acct.podRoot);
  const sv = new SolidVault({ webid: acct.webId, oidcIssuer: CSS_URL, vault: new VaultMemory() });
  await sv.login({ clientId: acct.clientId, clientSecret: acct.clientSecret });
  const authedFetch = new SolidOidcAuth({ vault: sv }).getAuthenticatedFetch();
  let podRoot = acct.podRoot; if (!podRoot.endsWith('/')) podRoot += '/';
  const centralBase = `${podRoot}central/`;

  // Ensure the central/ container exists before deposits.
  await authedFetch(centralBase, { method: 'PUT', headers: { 'content-type': 'text/turtle', link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"' } }).catch(() => {});

  const central = await makeCssCentralPod({ podBase: centralBase, authedFetch, flat: false });
  check('central pod route ready (makeCssCentralPod authed)', !!central && typeof central.write === 'function');

  // Three users submit feedback through the on-ramp — pseudonyms only.
  const submissions = [
    ['p-alice', { id: 'c-a1', text: 'de app is fijn maar de zoekfunctie hapert', themeTags: ['zoeken'], lang: 'nl' }],
    ['p-bob',   { id: 'c-b1', text: 'meer rust in de interface graag',           themeTags: ['ux'],     lang: 'nl' }],
    ['p-carol', { id: 'c-c1', text: 'notificaties komen te laat',                themeTags: ['notif'],  lang: 'nl' }],
  ];
  const ids = [];
  for (const [p, c] of submissions) { try { ids.push(await central.write(p, c)); } catch { ids.push(null); } }
  check('three users contributed via the central-pod route', ids.filter(Boolean).length === 3);

  // Aggregation reads across ALL participants (multi-user).
  const listed = await central.list();
  check('aggregation reads all 3 across distinct participants (multi-user)',
    listed.length === 3 && new Set(listed.map((e) => e.participant)).size === 3);

  // Pseudonymity by construction: the body carries no real identity, only the
  // contribution fields; the identity is only the pseudonymous path.
  const bodyBlob = JSON.stringify(listed.map((e) => e.contribution));
  check('contributions are PSEUDONYMOUS — no webid/email/identity in the body',
    !/@|https?:\/\/|profile\/card/.test(bodyBlob) &&
    listed.every((e) => Object.keys(e.contribution).every((k) => ALLOWED_KEYS.includes(k))));
  check('the central pod stores pseudonyms, not real identities (participant is not a webid)',
    listed.every((e) => !/https?:\/\/|@/.test(e.participant)));

  // Idempotent route: a duplicate contribution id is rejected.
  let dupErr; try { await central.write('p-alice', { id: 'c-a1', text: 'nogmaals', lang: 'nl' }); } catch (e) { dupErr = e; }
  check('duplicate contribution id is rejected (idempotent central route)', /duplicate/i.test(dupErr?.message ?? ''));

  // The aggregation view exposes exactly the fields the summary job needs.
  const agg = await central.forAggregation();
  check('forAggregation() yields {user,id,text,lang} for all 3 (summary-ready)',
    agg.length === 3 && agg.every((a) => a.user && a.id && a.text));

  return results;
}

// Bootstrap the project-pod owner on a running CSS (runbook step 3) — automates the manual
// curl: create an account + a project pod + client-credentials via the CSS .account API, and
// print the deploy/.env lines to paste. Plain fetch (cookie auth); no auth lib needed.
//
//   CSS_URL=https://pods.example.org [POD_NAME=project] [OWNER_EMAIL=… OWNER_PASSWORD=…] \
//     node scripts/bootstrap-owner.js
//
// Skips cleanly (exit 0) if CSS_URL is unset.

const BASE = (process.env.CSS_URL || '').replace(/\/$/, '');
if (!BASE) { console.log('SKIP: set CSS_URL to a running CSS'); process.exit(0); }
const POD_NAME = process.env.POD_NAME || 'project';
const rand = () => Math.random().toString(36).slice(2, 10);
const EMAIL = process.env.OWNER_EMAIL || `owner-${rand()}@local`;
const PASSWORD = process.env.OWNER_PASSWORD || rand() + rand();

const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const post = (url, cookie, body) => fetch(url, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });

try {
  const acc = await fetch(`${BASE}/.account/account/`, { method: 'POST' });
  const cookie = (acc.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('no session cookie from /.account/account/ — is this a CSS with the account API?');
  const ctrl = (await j(await fetch(`${BASE}/.account/`, { headers: { cookie } }))).controls;
  if (!ctrl?.account?.pod) throw new Error('unexpected .account controls shape');

  await post(ctrl.password.create, cookie, { email: EMAIL, password: PASSWORD });
  const pod = await j(await post(ctrl.account.pod, cookie, { name: POD_NAME }));
  if (!pod?.webId) throw new Error(`pod creation failed: ${JSON.stringify(pod).slice(0, 200)}`);
  const cc = await j(await post(ctrl.account.clientCredentials, cookie, { name: 'fp', webId: pod.webId }));
  if (!cc?.id || !cc?.secret) throw new Error(`client-credentials failed: ${JSON.stringify(cc).slice(0, 200)}`);

  console.log('# project-pod owner created. Paste into deploy/.env:\n');
  console.log(`FP_OWNER_CLIENT_ID=${cc.id}`);
  console.log(`FP_OWNER_CLIENT_SECRET=${cc.secret}`);
  console.log(`FP_OWNER_WEBID=${pod.webId}`);
  console.log(`FP_PROJECT_POD=${pod.pod}`);
  console.log(`\n# account login (keep safe): ${EMAIL} / ${PASSWORD}`);
} catch (e) {
  console.error(`bootstrap failed: ${e.message}`);
  process.exit(1);
}

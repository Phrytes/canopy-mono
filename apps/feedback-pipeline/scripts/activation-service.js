// Runnable activation service (Tier 3a) — wires the file-backed cohort registry + the real
// CSS provisioner (provisionCssPod) behind the HTTP server. The participant's app POSTs
//   { projectId, code, recoveryHash, webId }  → an ACP-locked container + its podRef.
//
//   CSS_URL=https://pods.example \
//   FP_OWNER_CLIENT_ID=… FP_OWNER_CLIENT_SECRET=… FP_OWNER_WEBID=https://pods.example/project/profile/card#me \
//   FP_PROJECT_POD=https://pods.example/project/ \
//   FP_COHORT_STORE=./cohort-store.json PORT=8787 \
//   node scripts/activation-service.js
//
// Generate codes for the store first with:  npm run cohort -- generate-codes --project <id> --n 50 --store ./cohort-store.json
// Skips cleanly (exit 0) if CSS / the auth lib / owner credentials are absent.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { InMemoryCohortRegistry } from '../src/activation/cohort.js';
import { createActivationServer } from '../src/activation/server.js';
import { provisionCssPod } from '../src/activation/provision-css-pod.js';
import { clientCredentialsFetch } from '../src/pod/css-auth.js';

const STORE = process.env.FP_COHORT_STORE || './cohort-store.json';
const PORT = Number(process.env.PORT || 8787);
const CSS_URL = (process.env.CSS_URL || '').replace(/\/$/, '');
const need = (k) => { if (!process.env[k]) { console.log(`SKIP: set ${k}`); process.exit(0); } return process.env[k]; };

if (!CSS_URL) { console.log('SKIP: set CSS_URL (+ owner credentials) to run against a live CSS'); process.exit(0); }
if (!existsSync(STORE)) { console.log(`SKIP: no cohort store at ${STORE} — create projects/codes with: npm run cohort`); process.exit(0); }
try { await import('@inrupt/solid-client-authn-core'); } catch { console.log('SKIP: npm i @inrupt/solid-client-authn-core'); process.exit(0); }

const ownerId = need('FP_OWNER_CLIENT_ID'), ownerSecret = need('FP_OWNER_CLIENT_SECRET');
const ownerWebId = need('FP_OWNER_WEBID'), projectPodBase = need('FP_PROJECT_POD');
// optional: webIds that may write on a participant's behalf (e.g. a Telegram bot service)
const writerWebIds = (process.env.FP_WRITER_WEBIDS || '').split(',').map((s) => s.trim()).filter(Boolean);

// the project-pod owner's authenticated (DPoP) fetch, from Solid-OIDC client credentials
const ownerFetch = await clientCredentialsFetch({ cssUrl: CSS_URL, clientId: ownerId, clientSecret: ownerSecret });

const registry = InMemoryCohortRegistry.fromJSON(JSON.parse(readFileSync(STORE, 'utf8')));
const persist = (reg) => writeFileSync(STORE, JSON.stringify(reg.toJSON(), null, 2));

// pseudonym = stable hash of the webId → the same participant recovers the same container,
// and the pod never holds a reversible identity.
const pseudonym = (webId) => `p-${createHash('sha256').update(webId).digest('hex').slice(0, 16)}`;
const provisionPod = ({ webId }) => provisionCssPod({
  ownerFetch, projectPodBase, participant: pseudonym(webId), participantWebId: webId, ownerWebId, writerWebIds,
});

const server = createActivationServer({ registry, provisionPod, onRedeem: persist });
server.listen(PORT, () => console.log(`activation service on :${PORT}  (store ${STORE}, pod ${projectPodBase})`));
process.on('SIGINT', () => { server.close(() => process.exit(0)); });

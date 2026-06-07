// Runnable portal (PR-2) — the easy-to-run package with a web GUI. A project lead opens
// http://localhost:<PORT>/, fills the menukaart, and mints invite links. State is one JSON
// file (FP_PORTAL_STORE), shared with the activation service so codes redeem against the
// same cohort registry.
//
//   FP_PORTAL_STORE=./portal-store.json PORT=8080 \
//   FP_INVITE_BASE=https://activate.example/ \
//   node scripts/portal.js
//
// The same store file works as the activation service's FP_COHORT_STORE (its cohort half).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ProjectStore } from '../src/portal/project-store.js';
import { createPortalServer } from '../src/portal/server.js';

const STORE = process.env.FP_PORTAL_STORE || './portal-store.json';
const PORT = Number(process.env.PORT || 8080);
const inviteBase = process.env.FP_INVITE_BASE || '';

const store = existsSync(STORE)
  ? ProjectStore.fromJSON(JSON.parse(readFileSync(STORE, 'utf8')))
  : new ProjectStore();
const persist = (s) => writeFileSync(STORE, JSON.stringify(s.toJSON(), null, 2));
if (!existsSync(STORE)) persist(store);

const server = createPortalServer({ store, inviteBase, onChange: persist });
server.listen(PORT, () => {
  console.log(`portal on http://localhost:${PORT}  (store ${STORE}${inviteBase ? `, invites → ${inviteBase}` : ', no invite base'})`);
});
process.on('SIGINT', () => server.close(() => process.exit(0)));

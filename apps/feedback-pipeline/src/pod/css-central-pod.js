// CssCentralPod — the Phase-2 central pod against a LIVE Solid pod (Community Solid
// Server). Each contribution is a JSON resource in the project pod; the per-participant
// container ACL ("write+delete for that participant only") is the ACP policy that makes
// consent-as-write enforced.
//
// It takes an injected `authedFetch` (a DPoP-authenticated fetch) + the pod base URL —
// exactly pod-client's `getAuthenticatedFetch()` pattern — so this file has NO auth
// dependency. The caller builds the authed fetch from Solid-OIDC client-credentials
// (see scripts/css-central-pod-smoke.js / the repo's CSS_URL convention).

import { validateContribution } from './contribution.js';
import { canWithdraw } from './central-pod.js';

const PREFIX = 'fp__';   // namespaces our resources within the pod

export class CssCentralPod {
  #fetch; #base;

  constructor({ authedFetch, podBase }) {
    if (typeof authedFetch !== 'function') throw new Error('CssCentralPod: authedFetch (a DPoP fetch) is required');
    if (!podBase) throw new Error('CssCentralPod: podBase is required');
    this.#fetch = authedFetch;
    this.#base = podBase.endsWith('/') ? podBase : `${podBase}/`;
  }

  #uri(participant, id) {
    return `${this.#base}${PREFIX}${encodeURIComponent(participant)}__${encodeURIComponent(id)}.json`;
  }

  async write(participant, raw) {
    const c = validateContribution(raw);
    const uri = this.#uri(participant, c.id);
    if ((await this.#fetch(uri)).status === 200) throw new Error(`duplicate contribution id: ${c.id}`);
    const res = await this.#fetch(uri, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ participant, contribution: c, status: 'submitted' }),
    });
    if (!res.ok) throw new Error(`write failed: HTTP ${res.status}`);
    return c.id;
  }

  async #childUris() {
    const res = await this.#fetch(this.#base, { headers: { accept: 'text/turtle' } });
    const ttl = await res.text();
    const uris = new Set();
    for (const m of ttl.matchAll(/<([^>]*fp__[^>]*\.json)>/g)) uris.add(new URL(m[1], this.#base).href);
    return [...uris];
  }

  async #all() {
    const out = [];
    for (const uri of await this.#childUris()) {
      const r = await this.#fetch(uri);
      if (r.status === 200) out.push({ uri, ...(await r.json()) });
    }
    return out;
  }

  async #find(id) { return (await this.#all()).find((e) => e.contribution.id === id) || null; }

  async withdraw(participant, id) {
    const e = await this.#find(id);
    if (!e || e.participant !== participant) throw new Error('not found in your container');
    if (!canWithdraw(e.status)) throw new Error(`cannot withdraw (status=${e.status})`);
    const r = await this.#fetch(e.uri, { method: 'DELETE' });
    if (!r.ok && r.status !== 404) throw new Error(`delete failed: HTTP ${r.status}`);
  }

  async markIncluded(ids) {
    const set = new Set(ids);
    for (const e of await this.#all()) {
      if (set.has(e.contribution.id) && e.status === 'submitted') {
        await this.#fetch(e.uri, {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ participant: e.participant, contribution: e.contribution, status: 'included' }),
        });
      }
    }
  }

  async getStatus(id) { return (await this.#find(id))?.status || null; }
  async list() { return (await this.#all()).map((e) => ({ participant: e.participant, contribution: e.contribution })); }
  async forAggregation() { return (await this.#all()).map((e) => ({ user: e.participant, text: e.contribution.text, lang: e.contribution.lang })); }
}

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

export class CssCentralPod {
  #fetch; #base; #flat;

  // Two layouts over one class:
  //  • default (`flat:false`) — `base` is the central root (<pod>central/); each participant's
  //    contributions live in <base><participant>/. A server-side writer (the TG bot) or the
  //    aggregation reads/writes across all sub-containers.
  //  • `flat:true` — `base` IS one participant's own container (<pod>central/<them>/); writes
  //    go straight into it (<base><id>.json). This is canopy-chat: the participant writes
  //    their OWN container with their browser-key fetch (the `participant` arg is just the
  //    pseudonym stored in the record).
  constructor({ authedFetch, podBase, flat = false }) {
    if (typeof authedFetch !== 'function') throw new Error('CssCentralPod: authedFetch (a DPoP fetch) is required');
    if (!podBase) throw new Error('CssCentralPod: podBase is required');
    this.#fetch = authedFetch;
    this.#base = podBase.endsWith('/') ? podBase : `${podBase}/`;
    this.#flat = flat;
  }

  #uri(participant, id) {
    const leaf = `${encodeURIComponent(id)}.json`;
    return this.#flat ? `${this.#base}${leaf}` : `${this.#base}${encodeURIComponent(participant)}/${leaf}`;
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

  // strict children of a container (sub-containers end in /, resources are leaves)
  async #children(uri) {
    const res = await this.#fetch(uri, { headers: { accept: 'text/turtle' } });
    if (!res.ok) return [];
    const ttl = await res.text();
    const kids = new Set();
    for (const m of ttl.matchAll(/<([^>]+)>/g)) {
      let href; try { href = new URL(m[1], uri).href; } catch { continue; }
      if (href.startsWith(uri) && href !== uri) kids.add(href);
    }
    return [...kids];
  }

  // recurse central/<participant>/ sub-containers, collecting the .json contributions
  async #resourceUris(uri = this.#base) {
    const out = [];
    for (const child of await this.#children(uri)) {
      if (child.endsWith('/')) out.push(...await this.#resourceUris(child));
      else if (child.endsWith('.json')) out.push(child);
    }
    return out;
  }

  async #all() {
    const out = [];
    for (const uri of await this.#resourceUris()) {
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
  async forAggregation() { return (await this.#all()).map((e) => ({ user: e.participant, id: e.contribution.id, text: e.contribution.text, lang: e.contribution.lang })); }
}

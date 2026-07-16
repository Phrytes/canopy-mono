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
import { isSealed } from './project-seal.js';

export class CssCentralPod {
  #fetch; #base; #flat; #seal; #open; #verify;

  // Two layouts over one class:
  //  • default (`flat:false`) — `base` is the central root (<pod>central/); each participant's
  //    contributions live in <base><participant>/. A server-side writer (the TG bot) or the
  //    aggregation reads/writes across all sub-containers.
  //  • `flat:true` — `base` IS one participant's own container (<pod>central/<them>/); writes
  //    go straight into it (<base><id>.json). This is canopy-chat: the participant writes
  //    their OWN container with their browser-key fetch (the `participant` arg is just the
  //    pseudonym stored in the record).
  // Optional `{ seal, open }` add at-rest sealing (default off → unchanged behaviour).
  // `seal` needs only the project public key (the host-blind, always-on writer); `open`
  // holds a private key (the keyless aggregation job, after unwrap). Only the contribution
  // TEXT is sealed — the id stays cleartext so it remains the resource path.
  // Optional `verify` (signing.js) enforces authenticity + one-code→one-identity: it gates
  // write() for honest clients and — the real boundary — re-checks each stored signature at
  // the aggregation read, dropping forged/unsigned/sybil records even if a malicious writer
  // PUT them straight to CSS. The sig + pubKey ride along in the resource body.
  constructor({ authedFetch, podBase, flat = false, seal, open, verify }) {
    if (typeof authedFetch !== 'function') throw new Error('CssCentralPod: authedFetch (a DPoP fetch) is required');
    if (!podBase) throw new Error('CssCentralPod: podBase is required');
    this.#fetch = authedFetch;
    this.#base = podBase.endsWith('/') ? podBase : `${podBase}/`;
    this.#flat = flat;
    this.#seal = seal;
    this.#open = open;
    this.#verify = verify;
  }

  // Reveal stored content at a text boundary: open when sealed + an opener is configured;
  // throw when sealed but locked. Status/withdraw/markIncluded read via #all() and never
  // pass through here, so those work while the pod is locked (they need only the id).
  #reveal(c) {
    if (!isSealed(c.text)) return c;
    if (!this.#open) throw new Error('contribution is sealed and no opener is configured (locked)');
    return { ...c, text: this.#open(c.text) };
  }

  // Open + (if configured) re-verify against the registered key; null → drop from aggregate.
  #revealVerified(e) {
    const contribution = this.#reveal(e.contribution);
    if (this.#verify) {
      try { this.#verify(e.participant, contribution, { sig: e.sig, pubKey: e.pubKey }); }
      catch { return null; }
    }
    return contribution;
  }

  #uri(participant, id) {
    const leaf = `${encodeURIComponent(id)}.json`;
    return this.#flat ? `${this.#base}${leaf}` : `${this.#base}${encodeURIComponent(participant)}/${leaf}`;
  }

  async write(participant, raw, meta = {}) {
    const c = validateContribution(raw);
    if (this.#verify) this.#verify(participant, c, meta);     // honest-client gate (over plaintext)
    const stored = this.#seal ? { ...c, text: this.#seal(c.text) } : c;
    const uri = this.#uri(participant, c.id);   // id stays cleartext → the resource path
    if ((await this.#fetch(uri)).status === 200) throw new Error(`duplicate contribution id: ${c.id}`);
    const body = { participant, contribution: stored, status: 'submitted' };
    if (this.#verify) { body.sig = meta.sig; body.pubKey = meta.pubKey; }
    const put = () => this.#fetch(uri, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let res = await put();
    if (res.status === 404 || res.status === 412) {   // parent container missing → create it + retry once
      const container = this.#flat ? this.#base : `${this.#base}${encodeURIComponent(participant)}/`;
      await this.#fetch(container, { method: 'PUT', headers: { 'content-type': 'text/turtle', link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"' } }).catch(() => {});
      res = await put();
    }
    if (!res.ok) throw new Error(`write failed: HTTP ${res.status} → ${uri}`);
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
        const body = { participant: e.participant, contribution: e.contribution, status: 'included' };
        if (e.sig) { body.sig = e.sig; body.pubKey = e.pubKey; }   // preserve provenance
        await this.#fetch(e.uri, {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
    }
  }

  async getStatus(id) { return (await this.#find(id))?.status || null; }
  async list() {
    return (await this.#all())
      .map((e) => ({ participant: e.participant, contribution: this.#revealVerified(e) }))
      .filter((e) => e.contribution !== null);
  }
  async forAggregation() {
    return (await this.#all())
      .map((e) => { const c = this.#revealVerified(e); return c && { user: e.participant, id: c.id, text: c.text, lang: c.lang, ...(c.attributes ? { attributes: c.attributes } : {}), ...(c.charterHash ? { charterHash: c.charterHash } : {}) }; })
      .filter(Boolean);
  }
}

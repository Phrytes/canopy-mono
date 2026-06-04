// PseudoPodCentralPod — the central pod (Phase 2) backed by the REAL @canopy/pseudo-pod
// substrate (a Solid-shaped store), proving our interface runs on the actual substrate
// rather than only the in-memory stub.
//
// In production the import is the workspace dep `@canopy/pseudo-pod` and, for a real
// deployment, the backend is a CSS-backed pod-client (CSS speaks Solid too). Here we use
// a relative path + a memory backend so it runs in-repo with no live CSS. (The repo
// treats CSS as bring-your-own: a running server at CSS_URL with an ACP config — see the
// pod-client css tests. CSS 7.1.9 installs and ships `config/file-acp.json`.)
//
// Methods are ASYNC (a real pod is async), unlike the synchronous InMemoryCentralPod.
// The same callers work: `aggregateForProject(await pod.forAggregation(), cfg, {skipClean:true})`.

import { createPseudoPod, createMemoryBackend } from '../../../../packages/pseudo-pod/index.js';
import { validateContribution } from './contribution.js';
import { canWithdraw } from './central-pod.js';

const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const dec = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

export class PseudoPodCentralPod {
  #pod; #prefix;

  constructor({ pod, deviceId = 'central-pod' } = {}) {
    this.#pod = pod || createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId });
    this.#prefix = `pseudo-pod://${deviceId}/`;
  }

  #uri(participant, id) { return `${this.#prefix}${encodeURIComponent(participant)}/${encodeURIComponent(id)}`; }

  /** Write (consent). Defensive validation, then a Solid resource per contribution. */
  async write(participant, raw) {
    const c = validateContribution(raw);
    const uri = this.#uri(participant, c.id);
    if (await this.#pod.read(uri)) throw new Error(`duplicate contribution id: ${c.id}`);
    await this.#pod.write(uri, enc({ participant, contribution: c, status: 'submitted' }));
    return c.id;
  }

  async #all() {
    const uris = await this.#pod.list(this.#prefix);
    const out = [];
    for (const uri of uris) {
      const r = await this.#pod.read(uri);
      if (r?.bytes) out.push({ uri, etag: r.etag, ...dec(r.bytes) });
    }
    return out;
  }

  async #find(id) { return (await this.#all()).find((e) => e.contribution.id === id) || null; }

  async withdraw(participant, id) {
    const e = await this.#find(id);
    if (!e || e.participant !== participant) throw new Error('not found in your container');
    if (!canWithdraw(e.status)) throw new Error(`cannot withdraw (status=${e.status})`);
    await this.#pod.delete(e.uri);
  }

  async markIncluded(ids) {
    const set = new Set(ids);
    for (const e of await this.#all()) {
      if (set.has(e.contribution.id) && e.status === 'submitted') {
        await this.#pod.write(e.uri, enc({ participant: e.participant, contribution: e.contribution, status: 'included' }), e.etag);
      }
    }
  }

  async getStatus(id) { return (await this.#find(id))?.status || null; }

  async list() { return (await this.#all()).map((e) => ({ participant: e.participant, contribution: e.contribution })); }

  async forAggregation() {
    return (await this.#all()).map((e) => ({ user: e.participant, text: e.contribution.text, lang: e.contribution.lang }));
  }
}

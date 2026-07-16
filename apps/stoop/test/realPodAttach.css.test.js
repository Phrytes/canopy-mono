/**
 * E2E: attach stoop's item store to a REAL Solid pod (CSS) + write through.
 *
 * Verifies the trigger this work added — `createBrowserStoopAgent().attachPod({podRoot,
 * webid, fetch})` — actually routes stoop's items to a real pod via the (already-built)
 * pod-routing write-through (CachingDataSource.flush → SolidPodSource → HTTP PUT). The
 * authed fetch is a CSS client-credentials BEARER fetch (the non-interactive stand-in for
 * the signed-in session basis passes).
 *
 * Gated on CSS_URL + client-credentials (skips clean otherwise).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { InternalBus, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createBrowserStoopAgent } from '../src/browser.js';

const CSS_URL = process.env.CSS_URL;
const HAVE = !!(CSS_URL && process.env.CSS_CLIENT_ID && process.env.CSS_CLIENT_SECRET && process.env.CSS_WEBID);
const SUITE = HAVE ? describe : describe.skip;

let podRoot, authedFetch;

beforeAll(async () => {
  if (!HAVE) return;
  const base = CSS_URL.replace(/\/$/, '');
  const oidc = await (await fetch(`${base}/.well-known/openid-configuration`)).json();
  const basic = Buffer.from(`${encodeURIComponent(process.env.CSS_CLIENT_ID)}:${encodeURIComponent(process.env.CSS_CLIENT_SECRET)}`).toString('base64');
  const tok = await (await fetch(oidc.token_endpoint, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=webid',
  })).json();
  const token = tok.access_token;
  authedFetch = (input, init = {}) => {
    const headers = new Headers(init.headers ?? {});
    if (!headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
  podRoot = process.env.CSS_WEBID.replace(/profile\/card#me$/, '');   // the owner's pod root
});

async function callSkill(agent, skillId, args, from) {
  return agent.skills.get(skillId).handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

SUITE('stoop attachPod → real pod (CSS)', () => {
  it('attaches to the real pod, then a postRequest writes through to it', async () => {
    const me = process.env.CSS_WEBID;
    const stoop = await createBrowserStoopAgent({
      bus: new InternalBus(), identityVault: new VaultMemory(), localActor: me,
      group: `rpa-${Date.now()}`, members: [{ webid: me, role: 'admin' }],
    });
    await stoop.bundle.skillMatch.start();

    // attach the real pod (builds a SolidPodSource + activates pod-routing write-through)
    const res = await stoop.attachPod({ podRoot, webid: me, fetch: authedFetch });
    expect(res.ok).toBe(true);

    // write an item — it flushes through to the real pod
    const marker = `rpa marker ${Date.now()}`;
    const posted = await callSkill(stoop.bundle.agent, 'postRequest', { intent: 'ask', text: marker }, me);
    expect(posted?.error).toBeUndefined();

    // and it's readable back (through the cache + pod round-trip)
    const open = await callSkill(stoop.bundle.agent, 'listOpen', {}, me);
    expect((open?.items ?? []).some((i) => (i.text ?? i.label) === marker)).toBe(true);

    await stoop.close();
  }, 60_000);
});

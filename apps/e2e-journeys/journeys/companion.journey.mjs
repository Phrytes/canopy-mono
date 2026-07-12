// J-companion: the "persistent agent with the same pod-access as my phone" flow
// against a REAL Community Solid Server. The device (phone role) holds a real
// Solid-OIDC credential and DELEGATES a scoped grant to the companion host; the
// host acts on the real pod by PROXYING every fetch back to the device (holds no
// secret); out-of-scope is denied by the device; and revoke kills the grant.
//
// GATED: skips cleanly unless a CSS is reachable (CSS_URL, default :3001) — so the
// rest of the matrix stays green with no pod. Boot one and set CSS_URL to run it.
import { AgentIdentity, Agent }         from '@canopy/core';
import { VaultMemory }                  from '@canopy/vault';
import { RelayTransport }               from '@canopy/transports';
import { PodTokenRegistry }             from '@canopy/pod-client';
import { startCompanionNode }           from '../../companion-node/src/index.js';
import { buildDevPodSource }            from '../../companion-node/src/podSource.js';
import { authorizePod, deliverPodDelegation } from '../../companion-node/src/authorizePod.js';
import { registerPodProxy }             from '../../companion-node/src/podProxy.js';
import { wait, checker }                from './_util.mjs';

export const name = 'J-companion (real pod delegation + revoke)';

const CSS_URL = process.env.CSS_URL || 'http://localhost:3001/';

async function cssReachable(base) {
  try { return (await fetch(`${base}.account/`, { signal: AbortSignal.timeout(2500) })).ok; }
  catch { return false; }
}

/** Provision a fresh CSS 7.1 account + pod + client-credentials (cookie-based account API). */
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

export async function run({ relayUrl }) {
  if (!(await cssReachable(CSS_URL))) return { skipped: true, reason: `no CSS at ${CSS_URL} (set CSS_URL to run)` };

  const { results, check } = checker();
  const label = `owner${Date.now().toString(36)}`;
  const acct = await provision(CSS_URL, label);
  check('provisioned a real CSS pod + client-credentials', !!acct.clientId && !!acct.clientSecret && !!acct.podRoot);

  const { SolidVault } = await import('../../../packages/oidc-session/index.js');
  const { SolidOidcAuth, SolidPodSource } = await import('@canopy/pod-client');

  const deviceVault = new VaultMemory();
  const sv = new SolidVault({ webid: acct.webId, oidcIssuer: CSS_URL, vault: deviceVault });
  await sv.login({ clientId: acct.clientId, clientSecret: acct.clientSecret });
  let podRoot = acct.podRoot; if (!podRoot.endsWith('/')) podRoot += '/';
  const deviceAuthFetch = new SolidOidcAuth({ vault: sv }).getAuthenticatedFetch();
  const deviceSource    = new SolidPodSource({ podUrl: podRoot, fetch: deviceAuthFetch });

  const scratchRel   = `companion-jc-${Date.now().toString(36)}/`;
  const containerUri = `${podRoot}${scratchRel}`;
  const targetRel    = `${scratchRel}note.md`;
  const targetUri    = `${podRoot}${targetRel}`;
  const CONTENT = '# J-companion\n\nWritten THROUGH the agent-proxy, executed on-device via real DPoP.\n';
  {
    const res = await deviceAuthFetch(containerUri, { method: 'PUT', headers: { 'content-type': 'text/turtle', link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"' } });
    check('scratch container created on the real pod', res.ok || res.status === 205);
  }

  const owner = await AgentIdentity.generate(new VaultMemory());
  const registry = new PodTokenRegistry(new VaultMemory());
  const heldPodSource = await buildDevPodSource({ podRoot, container: scratchRel, files: [] });
  const host = await startCompanionNode({
    relayUrl, identityVault: new VaultMemory(), gate: false, podProxy: true,
    podSource: heldPodSource, podRoot, podOwnerPubKey: owner.pubKey, podTokenRegistry: registry,
  });
  const device = new Agent({ identity: owner, transport: new RelayTransport({ relayUrl, identity: owner }), label: 'device' });

  const isDenied = (e) => /forbidden/i.test(e?.code ?? '') || /forbidden/i.test(e?.message ?? '');
  try {
    await device.start(); await wait(1500);
    await device.hello(host.agent.address);
    registerPodProxy(device, { authFetch: deviceAuthFetch, grantIssuerIdentity: owner, expectedHostPubKey: host.agent.address });
    check('companion host + device on the relay', host.agent.transport.connected && device.transport.connected);

    const token = await authorizePod(owner, host.agent.address, { scopes: [`pod.read:/${scratchRel}`, `pod.write:/${scratchRel}`], pod: podRoot });
    const ack = await deliverPodDelegation(device, host.agent.address, token);
    check('device delegates scoped grant → host accepts', ack?.ok === true);
    const podClient = host.store.getPodSource().podClient;

    await podClient.write(targetUri, CONTENT, { contentType: 'text/markdown' });
    const back = await podClient.read(targetUri, { decode: 'string' });
    check('host wrote to the real pod via proxy + read back', back?.content === CONTENT);

    const direct = await deviceSource.read(targetRel);
    check('bytes genuinely persisted on the CSS (direct device read)', new TextDecoder().decode(direct.content) === CONTENT);

    const outUri = `${podRoot}companion-jc-OUT-${Date.now().toString(36)}/secret.md`;
    let outErr; try { await podClient.read(outUri, { decode: 'string' }); } catch (e) { outErr = e; }
    check('out-of-scope read DENIED (device is scope authority)', isDenied(outErr));

    await registry.revoke(token.id);
    let revErr; try { await podClient.read(targetUri, { decode: 'string' }); } catch (e) { revErr = e; }
    check('after REVOKE, the previously-working read DENIES', isDenied(revErr));
  } finally {
    try { await deviceAuthFetch(targetUri, { method: 'DELETE' }); } catch { /* */ }
    try { await deviceAuthFetch(containerUri, { method: 'DELETE' }); } catch { /* */ }
    try { await device.stop?.(); } catch { /* */ }
    try { await host.stop?.(); } catch { /* */ }
  }
  return results;
}

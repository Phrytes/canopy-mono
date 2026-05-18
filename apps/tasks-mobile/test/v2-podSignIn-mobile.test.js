/**
 * Tasks-mobile S5 — pod OIDC sign-in skills (device-independent).
 *
 * M1-S5 (2026-05-18). Mirrors apps/tasks-v0 Slice-5 skill coverage
 * (the `pod sign-in skills` describe block in v2-adoption.test.js)
 * but for tasks-mobile's `buildPodSignInSkillsMobile`, which wires
 * the SHARED apps/tasks-v0 podSignIn.js via the injection seam.
 *
 * Device-independent: fully stubbed session + dataSource; no
 * OidcSessionRN / expo-secure-store / @canopy/pod-client / network.
 *
 * NOTE: written, not run here — the orchestrator verifies in the
 * main tree (worktree node_modules is the known-incomplete install).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildPodSignInSkillsMobile,
} from '../src/lib/podSignInSkillsMobile.js';

/** CachingDataSource-shaped stub (what podCrewProvider exposes). */
function makeDataSource() {
  let inner = null;
  return {
    async attachInner(ds) { inner = ds; },
    get hasInner() { return inner != null; },
  };
}

/** Fake RN session covering the adoptTokens path. */
function makeFakeRnSession() {
  let auth = false;
  let webid = null;
  return {
    async adoptTokens(tokens) {
      auth = true;
      webid = tokens.webid ?? 'https://pod.example/me#me';
    },
    isAuthenticated() { return auth; },
    getAuthenticatedFetch() {
      return async () => ({ ok: false, async text() { return ''; } });
    },
    get webid() { return webid; },
    async logout() { auth = false; webid = null; },
  };
}

function callSkill(def, data) {
  return def.handler({
    parts:    data === undefined ? [] : [{ type: 'DataPart', data }],
    from:     'webid://tester',
    agent:    null,
    envelope: null,
  });
}

describe('M1-S5 — buildPodSignInSkillsMobile surface', () => {
  it('throws without podCrewProvider', () => {
    expect(() => buildPodSignInSkillsMobile({ sessionFactory: () => ({}) }))
      .toThrow(/podCrewProvider required/);
  });

  it('throws without sessionFactory', () => {
    expect(() => buildPodSignInSkillsMobile({ podCrewProvider: () => null }))
      .toThrow(/sessionFactory required/);
  });

  it('registers exactly the four tasks-v0 Slice-5 skill ids', () => {
    const defs = buildPodSignInSkillsMobile({
      podCrewProvider: () => null,
      sessionFactory:  () => makeFakeRnSession(),
    });
    expect(defs.map((d) => d.id).sort()).toEqual([
      'completePodSignIn', 'podSignInStatus', 'signOutOfPod', 'startPodSignIn',
    ]);
  });
});

describe('M1-S5 — skill dispatch (no pod-capable crew)', () => {
  const defs = buildPodSignInSkillsMobile({
    podCrewProvider: () => null,
    sessionFactory:  () => makeFakeRnSession(),
  });
  const byId = Object.fromEntries(defs.map((d) => [d.id, d]));

  it('podSignInStatus returns signedIn:false', async () => {
    expect(await callSkill(byId.podSignInStatus)).toEqual({ signedIn: false });
  });

  it('signOutOfPod is a no-op success', async () => {
    expect(await callSkill(byId.signOutOfPod)).toEqual({ ok: true });
  });

  it('startPodSignIn returns the structured no-crew error', async () => {
    const r = await callSkill(byId.startPodSignIn, { issuer: 'x', redirectUrl: 'y' });
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
  });

  it('completePodSignIn returns the structured no-crew error', async () => {
    const r = await callSkill(byId.completePodSignIn, { tokens: { accessToken: 'AT' } });
    expect(r.ok).toBe(false);
  });
});

describe('M1-S5 — completePodSignIn RN tokens path through the shared seam', () => {
  it('adopts tokens onto the injected session + attaches the pod inner', async () => {
    const ds      = makeDataSource();
    const session = makeFakeRnSession();
    const crew    = { dataSource: ds, oidcSession: null };
    const sessionFactory   = vi.fn(() => session);
    const dataSourceFactory = vi.fn(({ podUrl }) => ({ _pod: podUrl }));

    const defs = buildPodSignInSkillsMobile({
      podCrewProvider: () => crew,
      sessionFactory,
      dataSourceFactory,
    });
    const byId = Object.fromEntries(defs.map((d) => [d.id, d]));

    const r = await callSkill(byId.completePodSignIn, {
      tokens: { accessToken: 'AT', webid: 'https://pod.example/bob#me' },
    });

    expect(r.ok).toBe(true);
    expect(r.webid).toBe('https://pod.example/bob#me');
    expect(sessionFactory).toHaveBeenCalledTimes(1);
    expect(dataSourceFactory).toHaveBeenCalledTimes(1);
    expect(ds.hasInner).toBe(true);

    // Status now reflects the adopted session.
    const status = await callSkill(byId.podSignInStatus);
    expect(status.signedIn).toBe(true);
    expect(status.webid).toBe('https://pod.example/bob#me');

    // Sign out clears the shared holder's session + detaches inner.
    const out = await callSkill(byId.signOutOfPod);
    expect(out).toEqual({ ok: true });
    expect(ds.hasInner).toBe(false);
    expect(crew.oidcSession).toBeNull();
  });
});

describe('M1-S5 — ServiceContext registers the skills on the meshAgent', () => {
  // Lightweight static-shape assertion: the skill defs are well
  // formed (id + handler) so agent.skills.register accepts them.
  it('every def has an id + async handler + visibility metadata', () => {
    const defs = buildPodSignInSkillsMobile({
      podCrewProvider: () => null,
      sessionFactory:  () => makeFakeRnSession(),
    });
    for (const d of defs) {
      expect(typeof d.id).toBe('string');
      expect(typeof d.handler).toBe('function');
      // defineSkill puts visibility directly on the def (tagged
      // union after _validateVisibility).
      expect(d.visibility).toBeTruthy();
    }
  });
});

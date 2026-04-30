/**
 * StatusScreen.test.js — pure-helper coverage.
 *
 * The screen itself is a React component that the vitest setup mocks
 * out (we don't render RN).  But two helpers (SyncStatusPill +
 * SyncStatusPill.formatRelativeAgo + Settings's diagnostics) carry
 * non-trivial logic that's worth pinning down independently.
 */

import { describe, it, expect, vi } from 'vitest';

import { runMobileDiagnostics } from '../../src/lib/diagnostics.js';
import { formatRelativeAgo } from '../../src/lib/format.js';

describe('formatRelativeAgo', () => {
  it('returns null for falsy / non-positive timestamps', () => {
    expect(formatRelativeAgo(null)).toBe(null);
    expect(formatRelativeAgo(0)).toBe(null);
    expect(formatRelativeAgo(-1)).toBe(null);
    expect(formatRelativeAgo('')).toBe(null);
  });

  it('"just now" within 5 seconds', () => {
    expect(formatRelativeAgo(Date.now() - 1500)).toBe('just now');
  });

  it('seconds < 60', () => {
    expect(formatRelativeAgo(Date.now() - 30_000)).toMatch(/30s ago/);
  });

  it('minutes < 60', () => {
    expect(formatRelativeAgo(Date.now() - 5 * 60_000)).toMatch(/5m ago/);
  });

  it('hours < 24', () => {
    expect(formatRelativeAgo(Date.now() - 3 * 3_600_000)).toMatch(/3h ago/);
  });

  it('days', () => {
    expect(formatRelativeAgo(Date.now() - 2 * 86_400_000)).toMatch(/2d ago/);
  });

  it('handles future timestamps gracefully', () => {
    expect(formatRelativeAgo(Date.now() + 1000)).toBe('just now');
  });
});


describe('runMobileDiagnostics', () => {
  it('reports config-pod-root FAIL when no pod root is set', async () => {
    const r = await runMobileDiagnostics({ engine: null, oidc: null, podRoot: null });
    const podRootStep = r.steps.find((s) => s.id === 'config-pod-root');
    expect(podRootStep.status).toBe('fail');
  });

  it('reports oidc FAIL when no session', async () => {
    const r = await runMobileDiagnostics({ engine: null, oidc: null, podRoot: 'https://x/' });
    const oidcStep = r.steps.find((s) => s.id === 'oidc-authenticated');
    expect(oidcStep.status).toBe('fail');
  });

  it('reports oidc PASS for an authenticated session', async () => {
    const oidc = {
      isAuthenticated: () => true,
      webid: 'https://alice.example/profile#me',
    };
    const r = await runMobileDiagnostics({ engine: null, oidc, podRoot: 'https://x/' });
    const oidcStep = r.steps.find((s) => s.id === 'oidc-authenticated');
    expect(oidcStep.status).toBe('pass');
    expect(oidcStep.detail).toContain('alice');
  });

  it('reports engine-built FAIL when engine is null', async () => {
    const r = await runMobileDiagnostics({
      engine: null,
      oidc: { isAuthenticated: () => true, webid: 'x' },
      podRoot: 'https://x/',
    });
    const engineStep = r.steps.find((s) => s.id === 'engine-built');
    expect(engineStep.status).toBe('fail');
  });

  it('reports local-root-readable PASS when readdir returns', async () => {
    const engine = {
      fs: { readdir: vi.fn(async () => ['a.md', 'b.md']) },
      localRoot: 'file:///doc/folio',
      verifyPodState: () => null,
    };
    const r = await runMobileDiagnostics({
      engine,
      oidc: { isAuthenticated: () => true, webid: 'x' },
      podRoot: 'https://x/',
    });
    const lr = r.steps.find((s) => s.id === 'local-root-readable');
    expect(lr.status).toBe('pass');
    expect(lr.detail).toContain('2 entries');
  });

  it('reports local-root-readable WARN on ENOENT', async () => {
    const engine = {
      fs: { readdir: vi.fn(async () => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; }) },
      localRoot: 'file:///doc/folio',
      verifyPodState: () => null,
    };
    const r = await runMobileDiagnostics({
      engine,
      oidc: { isAuthenticated: () => true, webid: 'x' },
      podRoot: 'https://x/',
    });
    const lr = r.steps.find((s) => s.id === 'local-root-readable');
    expect(lr.status).toBe('warn');
  });

  it('always returns a steps array', async () => {
    const r = await runMobileDiagnostics({ engine: null, oidc: null, podRoot: null });
    expect(Array.isArray(r.steps)).toBe(true);
    expect(r.steps.length).toBeGreaterThanOrEqual(3);
  });
});

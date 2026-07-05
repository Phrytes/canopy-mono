import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as core from '../src/index.js';

// Phase 0a fitness-function: guard the core→vault / core→oidc-session inversion.
// `@canopy/vault` and `@canopy/oidc-session` were extracted OUT of `core`; core must
// NOT re-export them (the deprecation-era shim is gone) and must not depend on oidc-session
// at all. If any of these fail, someone re-introduced the layering inversion.

const here = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(here, '../src/index.js'), 'utf8');
const pkg = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8'));

const VAULT_SYMS = ['Vault', 'VaultMemory', 'VaultLocalStorage', 'VaultIndexedDB', 'VaultNodeFs', 'OAuthVault', 'makeAuthorizedFetch'];
const OIDC_SYMS = ['SolidVault'];

describe('layering: core does not re-export or depend on vault / oidc-session', () => {
  it('the barrel no longer re-exports the Vault family (import from @canopy/vault)', () => {
    for (const s of VAULT_SYMS) expect(core[s], `core should not re-export ${s}`).toBeUndefined();
  });

  it('the barrel no longer re-exports SolidVault (import from @canopy/oidc-session)', () => {
    for (const s of OIDC_SYMS) expect(core[s], `core should not re-export ${s}`).toBeUndefined();
  });

  it('src/index.js has no re-export from @canopy/vault or @canopy/oidc-session', () => {
    expect(indexSrc).not.toMatch(/from\s+['"]@canopy\/vault['"]/);
    expect(indexSrc).not.toMatch(/from\s+['"]@canopy\/oidc-session['"]/);
  });

  it('core has no RUNTIME dependency on vault / oidc-session (devDependencies allowed for tests)', () => {
    const runtime = { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) };
    expect(runtime['@canopy/oidc-session']).toBeUndefined();
    expect(runtime['@canopy/vault']).toBeUndefined();
  });

  it('the kernel (Agent.js) does not import @canopy/vault at runtime (JSDoc @param type refs are fine)', () => {
    const agentSrc = readFileSync(join(here, '../src/Agent.js'), 'utf8');
    expect(agentSrc).not.toMatch(/await import\(\s*['"]@canopy\/vault['"]/);
    expect(agentSrc).not.toMatch(/^\s*import\s.*from\s*['"]@canopy\/vault['"]/m);
  });

  it('the kernel (Agent.js) constructs/imports no concrete network transport (they are injected)', () => {
    const agentSrc = readFileSync(join(here, '../src/Agent.js'), 'utf8');
    expect(agentSrc).not.toMatch(/new\s+(Rendezvous|Nkn|Mqtt|Relay)Transport\s*\(/);
    expect(agentSrc).not.toMatch(/^\s*import\s.*(Rendezvous|Nkn|Mqtt|Relay)Transport.*from\s*['"]\.\/transport\//m);
    expect(agentSrc).not.toMatch(/await import\(\s*['"]\.\/transport\/(Rendezvous|Nkn|Mqtt|Relay)Transport/);
  });

  it('core still exports its own kernel surface (sanity — the barrel is intact)', () => {
    for (const s of ['Agent', 'AgentIdentity', 'Emitter', 'Parts']) expect(core[s], `core must still export ${s}`).toBeDefined();
  });
});

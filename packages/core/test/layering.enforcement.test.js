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

  it('core no longer declares @canopy/oidc-session as a dependency', () => {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.optionalDependencies || {}) };
    expect(deps['@canopy/oidc-session']).toBeUndefined();
  });

  it('core still exports its own kernel surface (sanity — the barrel is intact)', () => {
    for (const s of ['Agent', 'AgentIdentity', 'Emitter', 'Parts']) expect(core[s], `core must still export ${s}`).toBeDefined();
  });
});

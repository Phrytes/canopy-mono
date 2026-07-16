import { describe, it, expect, vi } from 'vitest';
import { defaultPodFactory } from '../index.js';

vi.mock('@onderling/pod-client', () => {
  class FakePodClient {
    constructor(args) { this.args = args; }
  }
  class FakeSolidOidcAuth {
    constructor(args) { this.args = args; }
  }
  return { PodClient: FakePodClient, SolidOidcAuth: FakeSolidOidcAuth };
});

describe('defaultPodFactory', () => {
  it('rejects missing podRoot', async () => {
    await expect(defaultPodFactory({}, { getAuthenticatedFetch: () => null }))
      .rejects.toThrow(/podRoot required/);
  });

  it('rejects missing oidc', async () => {
    await expect(defaultPodFactory({ podRoot: 'https://x' }, null))
      .rejects.toThrow(/oidc session required/);
  });

  it('rejects oidc without getAuthenticatedFetch', async () => {
    await expect(defaultPodFactory({ podRoot: 'https://x' }, {}))
      .rejects.toThrow(/getAuthenticatedFetch must be a function/);
  });

  it('builds a PodClient with a SolidOidcAuth seeded from oidc', async () => {
    const fakeFetch = (() => 'fetch-instance');
    const oidc = {
      getAuthenticatedFetch: () => fakeFetch,
      webid: 'https://anne.example/profile/card#me',
      logout: vi.fn(async () => {}),
    };
    const client = await defaultPodFactory({ podRoot: 'https://anne.example/' }, oidc);
    expect(client.args.podRoot).toBe('https://anne.example/');
    // Auth vault was passed; webid + getAuthenticatedFetch round-trip.
    const vault = client.args.auth.args.vault;
    expect(vault.webid).toBe(oidc.webid);
    expect(vault.getAuthenticatedFetch()).toBe(fakeFetch);
    await vault.logout();
    expect(oidc.logout).toHaveBeenCalledOnce();
  });
});

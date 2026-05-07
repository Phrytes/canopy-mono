/**
 * @canopy/oidc-session-rn/hook — the React hook half of the
 * substrate.
 *
 * Imported separately so the default export (no Expo / React deps)
 * can be loaded by unit-test runners that don't have those
 * peer-deps installed (or where vitest's transform stumbles on
 * expo-auth-session's TypeScript).
 *
 * Apps integrating sign-in import from this subpath:
 *
 *   import { useOidcSignIn } from '@canopy/oidc-session-rn/hook';
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser  from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';

import { loadOrRegisterClient, clearStoredClient } from './src/dcr.js';
import {
  completeSignIn as pureCompleteSignIn,
  DEFAULT_INRUPT_ISSUER,
  DEFAULT_SCOPES,
  _resolveDiscoveryFn,
  _resolveExchangeFn,
} from './src/completeSignIn.js';

WebBrowser.maybeCompleteAuthSession();

async function discoverIssuer(issuer) {
  const stub = _resolveDiscoveryFn();
  if (stub) return stub(issuer);
  return AuthSession.fetchDiscoveryAsync(issuer);
}

async function exchange(args) {
  const stub = _resolveExchangeFn();
  if (stub) return stub(args);
  return AuthSession.exchangeCodeAsync(args.config, args.discovery);
}

/**
 * The hook drives the whole sign-in flow.  See package README for
 * usage.  Pre-binds `scheme` (e.g. 'folio', 'stoop') so the redirect
 * URI and DCR cache key are namespaced per app.
 */
export function useOidcSignIn({
  issuer    = DEFAULT_INRUPT_ISSUER,
  scheme,
  path      = 'auth/callback',
  clientId  = null,
  scopes    = DEFAULT_SCOPES,
  clientName,
  onWarning,
}) {
  if (typeof scheme !== 'string' || !scheme) {
    throw new Error('useOidcSignIn: scheme is required (e.g. "folio", "stoop")');
  }
  const effectiveClientName = clientName ?? `${scheme} (mobile)`;

  const [discovery, setDiscovery]   = useState(null);
  const [resolvedClientId, setResolvedClientId] = useState(clientId);
  const [lastError, setLastError]   = useState(null);

  const redirectUri = useMemo(
    () => AuthSession.makeRedirectUri({ scheme, path, native: `${scheme}://${path}` }),
    [scheme, path],
  );

  useEffect(() => {
    let cancelled = false;
    discoverIssuer(issuer)
      .then((d) => { if (!cancelled) setDiscovery(d); })
      .catch((err) => {
        if (!cancelled) {
          setLastError(err);
          onWarning?.(`useOidcSignIn: discovery failed: ${err?.message ?? err}`);
        }
      });
    return () => { cancelled = true; };
  }, [issuer, onWarning]);

  useEffect(() => {
    if (clientId) return;
    if (!discovery) return;
    if (resolvedClientId) return;

    let cancelled = false;
    loadOrRegisterClient({
      issuer,
      discovery,
      redirectUri,
      store: SecureStore,
      clientName: effectiveClientName,
      scopes,
      keyPrefix: scheme,
    })
      .then((id) => { if (!cancelled) setResolvedClientId(id); })
      .catch((err) => {
        if (!cancelled) {
          setLastError(err);
          onWarning?.(`useOidcSignIn: DCR failed: ${err?.message ?? err}`);
        }
      });
    return () => { cancelled = true; };
  }, [clientId, discovery, issuer, redirectUri, resolvedClientId, scopes, scheme, effectiveClientName, onWarning]);

  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId:           resolvedClientId ?? redirectUri,
      scopes,
      redirectUri,
      responseType:       AuthSession.ResponseType.Code,
      usePKCE:            true,
      codeChallengeMethod: AuthSession.CodeChallengeMethod.S256,
    },
    discovery,
  );

  const signIn = useCallback(async () => {
    if (!discovery) {
      throw Object.assign(
        new Error('useOidcSignIn: issuer discovery not yet complete'),
        { code: 'DISCOVERY_PENDING' },
      );
    }
    if (!resolvedClientId) {
      throw Object.assign(
        new Error('useOidcSignIn: client registration not yet complete'),
        { code: 'CLIENT_ID_PENDING' },
      );
    }
    if (!request) {
      throw Object.assign(
        new Error('useOidcSignIn: auth request not yet built'),
        { code: 'REQUEST_PENDING' },
      );
    }

    const result = await promptAsync({ showInRecents: false });
    return pureCompleteSignIn({
      result, request, discovery, redirectUri,
      clientId: resolvedClientId,
      issuer,
      exchange,
    });
  }, [discovery, request, promptAsync, redirectUri, resolvedClientId, issuer]);

  const resetClient = useCallback(async () => {
    setLastError(null);
    try {
      await clearStoredClient(issuer, SecureStore, scheme);
    } catch (err) {
      onWarning?.(`useOidcSignIn.resetClient: clear failed: ${err?.message ?? err}`);
    }
    setResolvedClientId(null);
  }, [issuer, onWarning, scheme]);

  return {
    ready: !!(discovery && request && resolvedClientId),
    discovery,
    clientId: resolvedClientId,
    request,
    redirectUri,
    signIn,
    resetClient,
    lastError,
  };
}

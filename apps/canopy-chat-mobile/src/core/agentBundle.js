/**
 * canopy-chat-mobile — in-process agent bundle.
 *
 * Composition shell: the same `createRealHouseholdAgent` factory
 * that powers web canopy-chat (lifted to portable code in #225.1)
 * gets booted here with RN-friendly opts.  Cross-peer mesh wires
 * the RN NknTransport (#223) when a runtime nkn-sdk module is
 * available.
 *
 * Portable: zero RN, zero DOM at import time.  The actual factory
 * boot may need browser-globals (createRealHouseholdAgent uses
 * `typeof globalThis.localStorage` guards), so on RN the caller
 * passes `opts.chatVault` + `opts.hostVault` to bypass the
 * localStorage default.  See #222.5 (AsyncStorage adapter follow-
 * up) for the production storage path.
 *
 * Three boot modes, picked by opts:
 *   1. `opts.skillStub` — test-only stub; bypasses the real factory.
 *      Returned bundle's callSkill delegates straight to the stub.
 *   2. Real boot with `opts.chatVault` (+ optional opts.hostVault) —
 *      the production path.  createRealHouseholdAgent runs; the
 *      returned controller exposes its callSkill verbatim.
 *   3. No vaults + no stub — the factory tries `makeBrowserVault`,
 *      which uses localStorage; on Hermes this throws.  We catch
 *      and surface a clear error rather than crash silently.
 *
 * The V0 'agent-not-booted' stub fell away in V1 (replaced by
 * boot-failure error or the real factory's reply).
 */
import { composeManifests } from './composeManifests.js';

// Eager imports of the portable factory + the manifest type.  Both
// are pure ESM, no RN/DOM imports at module-load.  NknTransport is
// dynamic — we only need it when wiring real cross-peer.
// Relative import for the same reason composeManifests uses one — pnpm
// workspace self-resolution from a sibling app needs an install cycle.
// The package.json "./core-realAgent" export is still the canonical
// public path for callers OUTSIDE the monorepo.
import { createRealHouseholdAgent } from '../../../canopy-chat/src/core/agent/realAgent.js';
// VaultAsyncStorage from @canopy/react-native — pure JS, accepts an
// injected asyncStorage instance so vitest works without an RN runtime.
import { VaultAsyncStorage } from '../../../../packages/react-native/src/identity/VaultAsyncStorage.js';

/**
 * Boot the agent bundle.  See module-doc for the three boot modes.
 *
 * @param {object}  [opts]
 * @param {object}  [opts.householdManifest]   merge an extra manifest into the catalog
 * @param {object}  [opts.chatVault]           secure-agent chat-side vault (e.g. VaultMemory in tests, VaultAsyncStorage on RN)
 * @param {object}  [opts.hostVault]           host-side vault (defaults inside factory to makeBrowserVault)
 * @param {object}  [opts.asyncStorage]        when provided AND chatVault/hostVault are NOT, synthesises two VaultAsyncStorage instances (cc-chat-id: + cc-host-id: prefixes). RN runtime path; vitest can pass a mock AsyncStorage to exercise it.
 * @param {object}  [opts.secureAgentOpts]     forwarded to createRealHouseholdAgent → createSecureAgent
 * @param {function}[opts.publishEvent]        forwarded; defaults to no-op
 * @param {object}  [opts.nknLib]              optional runtime nkn-sdk module; if present, connectPeerTransport is wired
 * @param {function}[opts.onPeerMessage]       NKN inbound callback (only meaningful when nknLib provided)
 * @param {function}[opts.skillStub]           test-only — bypass the real factory entirely
 *
 * @returns {Promise<{
 *   catalog: object,
 *   callSkill: (appOrigin: string, opId: string, args?: object) => Promise<object>,
 *   agent: object | null,
 *   transport: { kind: 'none' | 'nkn' | 'stub', connected?: boolean } ,
 *   dispose: () => Promise<void>,
 * }>}
 */
export async function bootAgentBundle(opts = {}) {
  const catalog = composeManifests({ householdManifest: opts.householdManifest });

  // Mode 1 — test stub.  No real factory boot; callSkill delegates
  // to the injected stub.  Used by vitest tests that don't want to
  // pay the createRealHouseholdAgent cost (which provisions a vault,
  // signs WebID claims, etc.).
  if (typeof opts.skillStub === 'function') {
    const callSkill = async (appOrigin, opId, args) =>
      opts.skillStub(opId, args ?? {}, { appOrigin });
    return {
      catalog,
      callSkill,
      agent:     null,
      transport: { kind: 'stub' },
      dispose:   async () => {},
    };
  }

  // Mode 2 + 3 — real boot.  Factory throws on Hermes if no chatVault
  // is provided (it tries makeBrowserVault → localStorage).  Surface
  // the error in a useful shape rather than letting it crash the bundle.
  //
  // #222.5: if the caller passed `opts.asyncStorage` but no explicit
  // vaults, synthesise VaultAsyncStorage instances under the same
  // prefix convention the web factory uses ('cc-chat-id:' /
  // 'cc-host-id:').  This is the canonical RN-runtime path; vitest
  // tests use it with a mock AsyncStorage.
  const chatVault = opts.chatVault
    ?? (opts.asyncStorage
      ? new VaultAsyncStorage({ prefix: 'cc-chat-id:', asyncStorage: opts.asyncStorage })
      : undefined);
  const hostVault = opts.hostVault
    ?? (opts.asyncStorage
      ? new VaultAsyncStorage({ prefix: 'cc-host-id:', asyncStorage: opts.asyncStorage })
      : undefined);

  // #222.6: when asyncStorage is provided, also seed the stoop
  // per-agent cache adapter so stoop's web-style boot survives app
  // reloads on Hermes.  createRealHouseholdAgent threads `opts.
  // stoopPersistDb` into createBrowserStoopAgent (which delegates
  // to apps/stoop/src/lib/persistPicker.js → AsyncStoragePersist).
  const stoopPersistDb = opts.stoopPersistDb
    ?? (opts.asyncStorage
      ? { dbName: 'cc-stoop-cache', asyncStorage: opts.asyncStorage }
      : undefined);

  let agent;
  try {
    agent = await createRealHouseholdAgent({
      chatVault,
      hostVault,
      stoopPersistDb,
      secureAgentOpts:  opts.secureAgentOpts,
      publishEvent:     opts.publishEvent,
    });
  } catch (err) {
    // Wrap with a localised-error-friendly shape so the RN UI can
    // surface it via `t('boot.boot_failed', { message: err.message })`.
    throw Object.assign(new Error(`agent-wiring-failed: ${err.message}`), {
      cause: err,
      code:  'AGENT_WIRING_FAILED',
    });
  }

  // Optional cross-peer transport.  Mobile users that bring their own
  // nkn-sdk module (or use the bundled @canopy/react-native NknTransport
  // path) wire it here.  Without nknLib, the bundle still works for
  // local-only flows — cross-device mesh just isn't connected.
  let transport = { kind: 'none' };
  if (opts.nknLib && typeof agent.connectPeerTransport === 'function') {
    try {
      await agent.connectPeerTransport({
        nknLib:        opts.nknLib,
        onPeerMessage: opts.onPeerMessage,
      });
      transport = { kind: 'nkn', connected: true };
    } catch (err) {
      // NKN connect failures are non-fatal — the rest of the bundle
      // (slash commands, local-only flows) keeps working.
      transport = { kind: 'nkn', connected: false, error: err.message };
    }
  }

  return {
    catalog,
    callSkill: agent.callSkill,
    agent,
    transport,
    dispose: async () => {
      try { await agent?.sa?.shutdown?.(); } catch { /* defensive */ }
    },
  };
}

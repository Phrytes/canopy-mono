/**
 * canopy-chat-rn — root App component.
 *
 * Composition:
 *   - shared pure-logic substrate from @canopy-app/canopy-chat
 *     (parseInput / mergeManifests / resolveDispatch / runDispatch
 *      / renderReply / ThreadStore / EventRouter / IndexedDBStore-
 *      equivalent on AsyncStorage in v0.2.6+)
 *   - RN-specific bootstrap: Agent + KeychainVault (instead of
 *     web's VaultMemory) — wired later via @canopy/react-native's
 *     createMeshAgent (same pattern as mesh-demo)
 *   - Two screens: ThreadListScreen + ChatThreadScreen
 *
 * @returns JSX
 */
// SCAFFOLD-ONLY: real implementation will `import React from 'react'`
// + `import { NavigationContainer } from '@react-navigation/native'`.
// Those deps aren't installed yet (see ./README.md for the runnable-
// state checklist).

// import { ThreadListScreen } from './screens/ThreadListScreen.js';
// import { ChatThreadScreen } from './screens/ChatThreadScreen.js';

export function App() {
  // v0.2.5 scaffold — actual navigation + agent wiring lands when
  // the RN slice gets dedicated time.  The two screens below are
  // self-contained presentational stubs.
  // eslint-disable-next-line no-throw-literal
  throw new Error(
    'canopy-chat-rn is a v0.2.5 SCAFFOLD.  Full feature parity ' +
    'with the web app is a future slice — see ' +
    'apps/canopy-chat/rn/README.md for what is needed to wire ' +
    'this up as a runnable Expo app.',
  );
}

/**
 * Merge all the app manifests canopy-chat-mobile composes (same set as
 * canopy-chat web — see apps/canopy-chat/src/web/realAgent.js for
 * the web parallel).  Portable: zero DOM, zero RN, runs in vitest.
 *
 * The merged manifest feeds the projector (renderMobile) + the
 * slash-command parser shared with canopy-chat web.
 */
// Relative imports into the sibling canopy-chat workspace.  Using
// the workspace package name would be cleaner but pnpm self-resolve
// for `@canopy-app/canopy-chat` from a NEW workspace pkg needs a
// `pnpm install` cycle to land — and a previous attempt 404'd on a
// pre-existing `@canopy/webid-discovery` dep.  Relative imports
// sidestep that, work today, and keep #221.5's lifted core layer
// as the single source of truth.
import { mergeManifests, canopyChatManifest } from '../../../canopy-chat/src/index.js';
import {
  mockTasksManifest, mockStoopManifest, mockFolioManifest,
} from '../../../canopy-chat/src/core/manifests/mockManifests.js';
import { calendarManifest } from '../../../calendar/manifest.js';

/**
 * @param {object} extras
 * @param {object} [extras.householdManifest]  optional real household
 *                                             manifest (when the agent
 *                                             bundle has booted one)
 * @returns {object}  raw merged catalog
 */
export function composeManifests({ householdManifest } = {}) {
  const entries = [
    { manifest: canopyChatManifest },
    ...(householdManifest ? [{ manifest: householdManifest }] : []),
    { manifest: mockTasksManifest },
    { manifest: mockStoopManifest },
    { manifest: mockFolioManifest },
    { manifest: calendarManifest },
  ];
  // runtime:'browser' matches what canopy-chat web passes — the
  // manifest validator uses it to gate browser-only ops.  RN is
  // closer to browser than to Node for these purposes (fetch,
  // WebSocket, IndexedDB-via-AsyncStorage adapter), so we keep the
  // same flag.  When a true RN-only runtime path lands, add 'rn'
  // to mergeManifests's runtime allowlist.
  return mergeManifests(entries, { runtime: 'browser' });
}

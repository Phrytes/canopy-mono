/**
 * Project the merged manifest catalog through renderMobile to get
 * a NavModel per app.  renderMobile is a strict-equivalence re-
 * export of renderWeb (see packages/app-manifest/test/
 * crossSurfaceEquivalence.test.js), so the same screens that web
 * canopy-chat could show via renderWeb come out here.
 *
 * Portable.  The actual RN screens that CONSUME these NavModels
 * live in ../rn/screens/.
 */
// Relative imports — see composeManifests.js for the rationale.
import { renderMobile } from '../../../../packages/app-manifest/src/renderMobile.js';

import { canopyChatManifest } from '../../../canopy-chat/src/index.js';
import {
  mockTasksManifest, mockStoopManifest, mockFolioManifest,
} from '../../../canopy-chat/src/core/manifests/mockManifests.js';
import { mockHouseholdManifest } from '../../../canopy-chat/src/core/agent/mockAgent.js';
import { calendarManifest } from '../../../calendar/manifest.js';

/**
 * @returns {{appOrigin: string, nav: object}[]}  one entry per app,
 *   in the order they show up in the bottom-tab nav (chat/canopy-chat
 *   first, then content apps).  Mirror the composeManifests order so
 *   the boot-debug list lines up 1:1 with the merged catalog.
 */
export function buildNavModels({ householdManifest } = {}) {
  const manifests = [
    canopyChatManifest,
    householdManifest ?? mockHouseholdManifest,
    mockTasksManifest,
    mockStoopManifest,
    mockFolioManifest,
    calendarManifest,
  ];
  return manifests.map((m) => ({ appOrigin: m.app, nav: renderMobile(m) }));
}

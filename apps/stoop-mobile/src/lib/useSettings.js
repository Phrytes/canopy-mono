/**
 * useSettings — Stoop's binding of the lifted settings hook.
 *
 * Lifted to `@onderling/sync-engine-rn/react` 2026-05-09 (Phase 41.0.b
 * A7). Stoop uses default skill names (`getSettings`, `updateSettings`).
 */

import { createSettingsHook } from '@onderling/sync-engine-rn/react';
import { useService } from '../ServiceContext.js';

export const useSettings = createSettingsHook({ useService });

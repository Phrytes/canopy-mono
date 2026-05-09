/**
 * useMemberProfile — Stoop's binding of the lifted hook.
 *
 * Lifted to `@canopy/sync-engine-rn/react` 2026-05-09 (Phase 41.0.b
 * A7). The substrate factory takes the consumer's `useService` and
 * returns a hook that resolves members through the active bundle's
 * MemberMap (pubKey → stableId → webid).
 */

import { createMemberProfileHook } from '@canopy/sync-engine-rn/react';
import { useService } from '../ServiceContext.js';

export const useMemberProfile = createMemberProfileHook({ useService });

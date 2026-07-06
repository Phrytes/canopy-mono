/**
 * @canopy/sdk/pod — the default POD adapter extension.
 *
 * SP-9 sub-path: the whole @canopy/pod-client public surface (PodClient,
 * Auth, SolidPodSource, ConflictResolver, sealing/sharing/tombstones, …).
 * A consumer who wants only the pod extension:
 *
 *     import { PodClient, SolidPodSource } from '@canopy/sdk/pod';
 *
 * The main `@canopy/sdk` barrel re-exports this slice unchanged.
 */
export * from '@canopy/pod-client';

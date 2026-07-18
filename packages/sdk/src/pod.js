/**
 * @onderling/sdk/pod — the default POD adapter extension.
 *
 * sub-path: the whole @onderling/pod-client public surface (PodClient,
 * Auth, SolidPodSource, ConflictResolver, sealing/sharing/tombstones, …).
 * A consumer who wants only the pod extension:
 *
 *     import { PodClient, SolidPodSource } from '@onderling/sdk/pod';
 *
 * The main `@onderling/sdk` barrel re-exports this slice unchanged.
 */
export * from '@onderling/pod-client';

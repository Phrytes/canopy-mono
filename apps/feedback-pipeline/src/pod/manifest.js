// Report manifest (build proposal §1.4): per released report, the list of included
// contribution IDs — so "withdraw before release" is VERIFIABLE. A contribution
// withdrawn before a report must never appear in that report's manifest.

import { z } from 'zod';

export const ManifestSchema = z.object({
  reportId: z.string().min(1),
  createdAt: z.string(),                       // ISO string, stamped by the caller
  includedContributionIds: z.array(z.string()),
}).strict();

export function buildManifest({ reportId, createdAt, includedContributionIds }) {
  return ManifestSchema.parse({
    reportId, createdAt,
    includedContributionIds: [...new Set(includedContributionIds)],
  });
}

/** IDs that were withdrawn yet still appear in the manifest — must be empty. */
export function withdrawalViolations(manifest, withdrawnIds) {
  const withdrawn = new Set(withdrawnIds);
  return manifest.includedContributionIds.filter((id) => withdrawn.has(id));
}

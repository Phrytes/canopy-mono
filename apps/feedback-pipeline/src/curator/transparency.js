// Transparency counters — the "every promise replaced by a mechanism" applied to the
// aggregate: a published, auditable account of what happened to ALL the input, not just
// what made the report. Derived purely from the aggregate result + the curator's decisions.

import { getStrings } from '../strings/index.js';

/**
 * @param {object} aggregate   the aggregateWithThreshold result
 * @param {{ includedThemes?:Array, releasedQuarantine?:Array, includedContributionIds?:Array }} [d]  curator decisions
 */
export function transparencyCounters(aggregate, d = {}) {
  const includedThemes = d.includedThemes || aggregate.statistical;
  const releasedQuarantine = d.releasedQuarantine || [];
  return {
    participants: aggregate.totalUsers,
    contributions: aggregate.totalMessages,
    themesFound: aggregate.statistical.length,
    themesIncluded: includedThemes.length,
    themesDroppedByCurator: aggregate.statistical.length - includedThemes.length,
    // all below-k themes (too few people to show, threshold protects anonymity); of those,
    // `quarantined` were held for human review and `droppedSilently` were discarded.
    themesBelowThreshold: aggregate.dropped.length + aggregate.review.length,
    quarantined: aggregate.review.length,
    droppedSilently: aggregate.dropped.length,
    quarantineReleased: releasedQuarantine.length,
    kThreshold: aggregate.kThreshold,
    signals: aggregate.signals.length,
    signalsConfirmed: aggregate.signals.filter((s) => s.confirmed).length,
    rejected: aggregate.rejected.length,                   // attacks, not feedback
    contributionsIncluded: (d.includedContributionIds || []).length,
  };
}

/** Human-readable accountability block (localised). */
export function renderTransparency(counters, s = getStrings()) {
  return `${s.curator.transparencyHeading}\n${s.curator.transparency(counters)}`;
}

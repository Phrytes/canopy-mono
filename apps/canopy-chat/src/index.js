/**
 * canopy-chat — entry point.
 *
 * v0.1 stage: parser + manifestMerge are landed.  Future phases add
 * router, dispatch, renderer, threadStore, events.  The full anatomy
 * lives in `/DESIGN-canopy-chat.md`; phase-by-phase build is in
 * `/Project Files/canopy-chat/coding-plan.md`.
 */

export { canopyChatManifest } from '../manifest.js';
export { parseInput, parseSlash }    from './parser.js';
export { mergeManifests }            from './manifestMerge.js';
export { resolveDispatch, scopeReadyDispatch } from './router.js';
export { runDispatch }               from './dispatch.js';
export { renderReply, formatText }   from './renderer.js';
export { Thread, newThread }         from './thread.js';
export {
  ThreadStore, createDefaultThreadStore,
} from './threadStore.js';
export {
  matchesFilter, normaliseFilter, isWildcardFilter, describeFilter,
} from './filter.js';
export {
  EventRouter, createEventRouter, defaultFormatNotification,
} from './events.js';
export { runBulkOp, summariseBulkOp } from './bulkOps.js';
export {
  collectFollowUps, createFollowUpResolver, DEFAULT_CROSS_APP_CHAINS,
} from './followUps.js';
export { buildEmbed, claimEmbed, actionsFor as embedActionsFor } from './embed.js';
export { formatSyncHints, formatLastSync, relativeAgo } from './syncHints.js';
export { AppRegistry, filterCatalog } from './appRegistry.js';
export {
  openExternalFlow, parseCallbackUrl, resumeInFlightFlows,
  generateSessionId, IN_FLIGHT_STORE_KEY,
} from './externalFlow.js';
export { runBrief, createBriefCache } from './brief.js';
export { QR_URI_PREFIXES, isQrUri }   from './core/qrSchemes.js';
// v2 circle model — re-exported here so canopy-chat-mobile can import via
// '@canopy-app/canopy-chat' (Metro can't resolve src/v2 subpaths directly).
export { normalizeCircle, mergeCircles, loadCircles } from './v2/circleModel.js';
export { circleSourcesFromAgent, makeResolvingCallSkill, DEFAULT_CIRCLE_ORIGINS } from './v2/circleSources.js';
export { loadCircleItems, normalizeContentItem }      from './v2/circleContent.js';
export { quickCreateCircle }                          from './v2/circleCreate.js';
export { itemCircleId, isInCircle, scopeItems }       from './v2/circleScope.js';
export { getActiveCircle, setActiveCircle, subscribeActiveCircle } from './v2/activeCircle.js';
export {
  CIRCLE_FEATURES, CIRCLE_POLICY_ENUMS,
  DEFAULT_CIRCLE_POLICY, normalizeCirclePolicy, mergeCirclePolicy,
  // P6.1 — feature-flag consumption seam.
  isFeatureEnabled, enabledFeatures,
  DEFAULT_MEMBER_OVERRIDE, normalizeMemberOverride, mergeMemberOverride,
} from './v2/circlePolicy.js';
export {
  createCirclePolicyStore, localStoragePolicyIo,
  createMemberOverrideStore, localStorageOverrideIo,
  podPolicyIo, tieredPolicyIo,
} from './v2/circlePolicyStore.js';
export { makeProposal, approveProposal, pendingApprovers } from './v2/circleConsensus.js';
// P6.2 — persistence layer for multi-admin proposals.
export { createProposalStore, localStorageProposalIo } from './v2/circleProposalStore.js';
export { eventCircleId, buildCircleStream } from './v2/circleStream.js';
// P6.3 — per-circle activity preview + unread count for launcher tiles.
export { buildTilePreviews, renderSubtitle, bumpSeenAt } from './v2/circleTilePreviews.js';
// P6.5 — claim router: mirror claimed tasks into the personal crew
// when the per-circle override has flowThrough.tasksToPersonal.
export { routeClaim, makeAfterClaimHook } from './v2/claimRouter.js';
// P6.4 — wederkerigheid (chat-off consumer-side): pure helpers + the
// save-for-later message queue.  Compose integration is the follow-up.
export {
  isRecipientUnavailable, buildUnavailableNotice,
  createMessageQueue,
} from './v2/wederkerigheid.js';
// P6.6 — auto-hop-prompt when a skill search returns no in-circle hits.
export {
  shouldAutoSuggestHop, buildHopPromptCard,
  rememberDismissed, hasDismissed,
} from './v2/hopPrompt.js';
export { VIEWER_KINDS, viewAsDirectory } from './v2/circleViewAs.js';
export { normalizeCircleMembers, circleMemberCount } from './v2/circleMembers.js';
// 5.9d — Proof-of-Location placeholder seam (real attestation deferred).
export { getCirclePolStatus, formatPolStatus, formatAttestedAt } from './v2/circlePol.js';
export {
  COMPLAINT_TYPES, ADVISOR_DEFAULTS, makeTooBusyEvent, computeAdvice,
} from './v2/circleAdvisor.js';
export {
  MAX_HOPS, normalizeHopMode, buildHopChain, makeHopRelayRequest,
} from './v2/circleHop.js';
export {
  SKILL_AXES, DEFAULT_SKILL, normalizeSkill, mergeSkill,
  MATCH_SOURCES, buildSkillMatches,
} from './v2/circleSkills.js';
export { normalizeFolioFile, buildCircleFiles, circleFilesFromListFiles } from './v2/circleFolio.js';
export {
  RULES_FIELDS, RULES_QUESTIONS, DEFAULT_RULES_DOC,
  normalizeRulesDoc, buildRulesDoc, isRulesComplete, isRulesEmpty,
} from './v2/circleRules.js';
export {
  DEFAULT_AVAILABILITY, normalizeAvailability, mergeAvailability, isPushSuppressed,
  createAvailabilityStore, localStorageAvailabilityIo,
} from './v2/memberAvailability.js';
export { THEME, tagColors, AVATAR_TINTS, circleTint } from './v2/theme.js';
export { runFind } from './find.js';
export { EventLog, createEventLog, RETENTION_MS } from './eventLog.js';
export {
  buildFormSpec, pickStrategy, validateAndCoerce,
} from './forms/buildFormSpec.js';
export { parseRelativeDate } from './forms/parseDate.js';
export { IndexedDBStore, attachPersistence } from './storage/local.js';
export { PodSyncStore }                      from './storage/podSync.js';
export {
  initLocalisation, t, setLang, currentLang,
  detectDeviceLang, isInitialised,
} from './localisation.js';

// Public surface for @canopy-app/feedback-pipeline — the ONE sanctioned import point for
// consumers (today: canopy-chat's feedback surface). Everything else under src/ is internal.
//
// F1 of the feedback repo-split (plans/PLAN-feedback-split.md): give feedback a public boundary
// so canopy-chat stops deep-reaching into raw src/. Re-exports exactly the symbols canopy-chat
// needs, from their current internal modules. Additive + behaviour-preserving — internal layout
// is free to move behind this barrel. Exposed via the package `exports` map as `./public`.

export { InternalBusBridge, connectFeedbackParticipant } from '../channel/internal-bus-bridge.js';
export { CanopyChatBot } from '../channel/canopy-chat-bot.js';
export { InMemoryCentralPod } from '../pod/central-pod.js';
export { validateProjectConfig, exampleProjectConfig } from '../config/project-config.js';
export { applyLlmRoute, assertCleanRouteSafe } from '../ollama.js';
export { makeCssCentralPod } from '../pod/css-auth.js';
export { PodRoundControl } from '../verify/round-control.js';

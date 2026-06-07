// Project-driven entry points: run the pipeline from a ProjectConfig (the "form").
// These are the seam where the per-project configuration actually drives a run —
// route/model, language, k-anonymity, review mode, and the Layer-1 signal gate all
// come from one config object. The LLM route's baseURL/apiKey come from the
// environment (src/ollama.js); the model comes from the config.

import { configToRunOpts } from './config/project-config.js';
import { runTask1 } from './task1.js';
import { aggregateWithThreshold } from './aggregate.js';
import { assertAggregationAllowed, requiredLocation } from './aggregation/placement.js';
import { applyLlmRoute } from './ollama.js';

/**
 * Task 1 for ONE participant, driven by a ProjectConfig.
 * @param {string[]} rawMessages
 * @param {object} config  a ProjectConfig (validated inside)
 * @param {object} [extra] opts to override/augment (e.g. a test seam)
 */
export function runTask1ForProject(rawMessages, config, extra = {}) {
  const o = configToRunOpts(config);
  return runTask1(o.model, rawMessages, { ...o, ...extra });
}

/**
 * Task 2 aggregation over the central pod's contributions, driven by a ProjectConfig.
 * @param {Array<{user:string,text:string,lang?:string}>} items
 * @param {object} config  a ProjectConfig (validated inside)
 * @param {object} [extra] opts to override/augment
 */
export function aggregateForProject(items, config, extra = {}) {
  const o = configToRunOpts(config);
  return aggregateWithThreshold(o.model, items, { ...o, ...extra });
}

/**
 * Controller-side aggregation entry (Phase 1). This is the function the project team runs on
 * the infrastructure they chose in `aggregation.location`:
 *   1. enforce placement — refuse to decrypt if this runner isn't allowed (FP_RUNNER_ROLE);
 *   2. install the LLM route — e.g. the localhost Privatemode proxy, so the model leg is
 *      confidential even though Phase-1 decryption itself is on a normal host;
 *   3. read+open the pod (the pod's injected opener already decrypts) and run Task 2.
 * The `pod` must be one whose opener was built for this runner (so it, too, passed the gate).
 * @param {{ pod, config, aggregate?:Function, extra?:object }} a
 * @returns {Promise<{ aggregate:object, location:string, route:string }>}
 */
export async function runProjectAggregation({ pod, config, aggregate = aggregateForProject, extra = {} }) {
  assertAggregationAllowed(config);
  const route = applyLlmRoute(config.llm || {});
  const items = await pod.forAggregation();           // plaintext — only on the chosen runner
  const result = await aggregate(items, config, extra);
  return { aggregate: result, location: requiredLocation(config), route: route.route };
}

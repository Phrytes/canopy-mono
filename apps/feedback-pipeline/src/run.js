// Project-driven entry points: run the pipeline from a ProjectConfig (the "form").
// These are the seam where the per-project configuration actually drives a run —
// route/model, language, k-anonymity, review mode, and the Layer-1 signal gate all
// come from one config object. The LLM route's baseURL/apiKey come from the
// environment (src/ollama.js); the model comes from the config.

import { configToRunOpts } from './config/project-config.js';
import { runTask1 } from './task1.js';
import { aggregateWithThreshold } from './aggregate.js';

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

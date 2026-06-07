// LLM route health check (Tier 3d bring-up) — verifies the configured route answers. Use it
// after starting the privatemode-proxy (or any route) to confirm FP_LLM_BASEURL + FP_LLM_APIKEY
// are wired before pointing the pipeline at it. No app code differs between routes — this just
// pings whatever src/ollama.js resolves.
//
//   FP_LLM_BASEURL=http://localhost:8080/v1 FP_LLM_APIKEY=… FP_LLM_MODEL=… node scripts/llm-health.js

import { chat, llmBase } from '../src/ollama.js';

const model = process.env.FP_LLM_MODEL || process.env.FP_MODEL || 'qwen2.5:7b';
console.log(`route:  ${llmBase()}`);
console.log(`model:  ${model}`);
const r = await chat(model, 'You are a health check. Reply with the single word: ok.', 'ping', { numPredict: 5, timeoutMs: 20000 });
if (r.ok) { console.log(`OK (${r.ms}ms): ${JSON.stringify(r.text).slice(0, 60)}`); process.exit(0); }
console.error(`FAIL: ${r.error}`);
process.exit(1);

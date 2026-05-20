/**
 * Recombination demo — shared scenario.
 *
 * One process hosts household + tasks-v0 (multi-crew) together via
 * `@canopy/manifest-host`.  A chat-agent drives a mocked LLM over the
 * composed tool catalog.  Both apps' state mutates from one
 * conversation; the demo runner (`index.js`) logs the trace and the
 * test runner (`test/recombination.test.js`) asserts the state lands
 * in the right app's store.
 *
 * Module imported by both the demo + the test so they exercise the
 * exact same pipeline.
 */

import { LlmClient, mockProvider }            from '@canopy/llm-client';
import { ChatAgent, InMemoryBridge }          from '@canopy/chat-agent';
import { createManifestHost }                 from '@canopy/manifest-host';

import {
  InMemoryStore,
  householdManifest,
  createHouseholdMountable,
}                                              from '@canopy-app/household';
import {
  tasksManifest,
  buildMultiCrewRuntime,
  createTasksMountable,
}                                              from '@canopy-app/tasks-v0';

/* ─── scripted LLM responses ─────────────────────────────────────── */

/**
 * The chat-agent feeds the LLM the composed toolCatalog
 * (`{id: "appId.opId", ...}`).  A real LLM would pick a tool from
 * that catalog; here we script the choices so the demo + test run
 * deterministically.
 *
 * Pattern: each user turn → exactly one tool call → reply.
 */
export const DEMO_LLM_SCRIPT = [
  // Turn 1 — user: "add bread to shopping"
  {
    toolCall:       { id: 'household.addItem', args: { type: 'shopping', text: 'bread' } },
    classification: 'actionable',
  },
  // Turn 2 — user: "add a task: paint the hallway"
  {
    toolCall:       { id: 'tasks.addTask', args: { crewId: 'primary-crew', text: 'paint the hallway' } },
    classification: 'actionable',
  },
  // Turn 3 — user: "what's on my shopping list?"
  {
    toolCall:       { id: 'household.listOpen', args: { type: 'shopping' } },
    classification: 'actionable',
  },
];

/* ─── system-prompt composition policy ───────────────────────────── */

/**
 * "Generic preamble" policy for `perAppSystemPrompts` (per the
 * manifest-host README's "Potential conflicts" recommendation for ≥2
 * apps).  Lists which apps are mounted; lets the tool descriptions
 * (already in the composed catalog) carry the rest.
 */
export function buildSystemPrompt(perAppSystemPrompts) {
  const apps = Object.keys(perAppSystemPrompts).sort();
  return [
    'You are a multi-app assistant.  You have access to tools from these apps:',
    ...apps.map((a) => `  - ${a}`),
    'Use the appropriate tool for each request.  For tools whose id starts with',
    '"tasks.", default to crewId: "primary-crew" if the user does not specify one.',
  ].join('\n');
}

/* ─── runtime setup ──────────────────────────────────────────────── */

/**
 * Build the demo runtime.  Returns the live pieces + a `teardown`.
 *
 * @param {object} [args]
 * @param {Array} [args.llmScript=DEMO_LLM_SCRIPT]
 */
export async function setupRecombinationDemo({ llmScript = DEMO_LLM_SCRIPT } = {}) {
  // (1) household — InMemoryStore + the mountable that captures it in
  //     the toSkillCtx closure.
  const householdStore     = new InMemoryStore();
  const householdMountable = createHouseholdMountable({ store: householdStore });

  // (2) tasks-v0 multi-crew runtime — the same machinery
  //     `bin/tasks-ui.js --multi-crew` constructs, in-process.
  const tasksRuntime = await buildMultiCrewRuntime({
    label: 'recombination-demo',
  });
  const tasksMountable = createTasksMountable({
    meshAgent: tasksRuntime.meshAgent,
    crewsMap:  tasksRuntime.crewsMap,
  });

  // (3) host composition — mount both apps; everything namespaced.
  const host = createManifestHost();
  host.mount('household', householdManifest, householdMountable);
  host.mount('tasks',     tasksManifest,     tasksMountable);
  const composed = host.compose();

  // (4) chat-agent over the composed view.  System-prompt composed
  //     per the generic-preamble policy (host README recommendation).
  const llm    = new LlmClient({ provider: mockProvider({ responses: llmScript }) });
  const bridge = new InMemoryBridge({ id: 'demo-bridge' });

  const chatAgent = new ChatAgent({
    bridges:        [bridge],
    llm,
    toolCatalog:    composed.toolCatalog,
    toolHandlers:   composed.toolHandlers,
    systemPrompt:   buildSystemPrompt(composed.perAppSystemPrompts),
    contextBuilder: async () => '',
  });

  await chatAgent.start();

  return {
    host, composed, chatAgent, bridge,
    householdStore, tasksRuntime,
    async teardown() { await chatAgent.stop(); },
  };
}

/**
 * Run the scripted conversation: one user message per turn, return
 * the captured outbox + final per-app state.
 *
 * @param {Awaited<ReturnType<typeof setupRecombinationDemo>>} runtime
 * @param {string[]} userMessages
 */
export async function runScriptedConversation(runtime, userMessages) {
  const turns = [];
  for (const text of userMessages) {
    runtime.bridge.clearOutbox();
    await runtime.bridge.simulateIncoming({ text });
    // Capture this turn's outbox before the next clear.
    turns.push({
      userText: text,
      replies:  [...runtime.bridge.outbox],
    });
  }
  return turns;
}

/**
 * Convenience: the user-visible script that pairs 1-to-1 with
 * `DEMO_LLM_SCRIPT`.
 */
export const DEMO_USER_MESSAGES = [
  'add bread to my shopping list',
  'add a task: paint the hallway',
  "what's on my shopping list?",
];

// ProjectConfig — the per-project "form" (build proposal §8, D1: every project has
// its own needs). ONE config parameterises a whole deployment: which LLM route, how
// review/consent works, the k-anonymity policy, which signals escalate and where,
// retention, and evaluation. It is a zod schema, so it both validates a config and
// can drive a UI form later.
//
// Most fields are per-project with NO universal default (your §8 answers: "depends
// on the project"); a few are configurable-with-default (review mode, language).

import { z } from 'zod';

/** D3 — escalation categories that can trigger the signal-track offer. Mirrors
 *  ESCALATION_CATEGORIES in categories.js; tracked in the ethics doc §8. */
export const ESCALATION_CATEGORIES = ['crisis', 'child-safety', 'medical-emergency', 'abuse', 'safety', 'harassment'];

export const ProjectConfigSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1).optional(),

  // D1 — LLM route. No universal default: every project picks. (apiKey is NOT stored
  // here — it is injected from the environment / secret store at runtime.)
  llm: z.object({
    route: z.enum(['privatemode', 'ovh', 'within-walls', 'local']),
    baseURL: z.string().url().optional(),     // omit for the local Ollama default
    model: z.string().min(1),
  }),

  language: z.object({
    preferred: z.enum(['nl', 'en']).default('nl'),
  }).default({ preferred: 'nl' }),

  // D2 — review touchpoint. Configurable; default = a notification (per your answer).
  review: z.object({
    mode: z.enum(['notification', 'required-approval']).default('notification'),
  }).default({ mode: 'notification' }),

  // D5 — k-anonymity. Per project (no universal k).
  aggregation: z.object({
    k: z.number().int().min(1),
    belowThreshold: z.enum(['drop', 'rephrase', 'quarantine']).default('quarantine'),
  }),

  // D3 / D4 + the two-layer signal design (§5).
  signal: z.object({
    // Layer 1 (on-device deterministic) is PROVISIONAL — off unless a project enables
    // it after testing. Layer 2 (server-side LLM, in Task 2) is always part of aggregation.
    layer1OnDevice: z.boolean().default(false),
    escalationCategories: z.array(z.enum(['crisis', 'child-safety', 'medical-emergency', 'abuse', 'safety', 'harassment']))
      .default(['crisis', 'child-safety', 'medical-emergency', 'abuse', 'safety', 'harassment']),
    // D4 — who receives a routed signal, per category. Per project; no default.
    destinations: z.record(z.string(), z.string()).default({}),
    // resources shown passively (e.g. crisis → 113); always allowed, not a routing.
    passiveSupport: z.record(z.string(), z.string()).default({ crisis: '113 (zelfmoordpreventie)' }),
  }).default({
    layer1OnDevice: false,
    escalationCategories: ['crisis', 'child-safety', 'medical-emergency', 'abuse', 'safety', 'harassment'],
    destinations: {},
    passiveSupport: { crisis: '113 (zelfmoordpreventie)' },
  }),

  // D9 — retention of raw + cleaned in the participant's OWN pod. Per project.
  retention: z.object({
    ownPod: z.union([z.enum(['until-delete', 'project-end']), z.string().regex(/^days:\d+$/)]).default('until-delete'),
  }).default({ ownPod: 'until-delete' }),

  // D7 — evaluation ownership / publication. Per project. (Real-data eval is a later
  // polishing phase — ethics doc §7.)
  eval: z.object({
    owner: z.enum(['us', 'independent', 'raad']).default('us'),
    publish: z.array(z.string()).default([]),
  }).default({ owner: 'us', publish: [] }),
});

/** Validate + fill defaults. Throws a zod error on an invalid config. */
export function validateProjectConfig(raw) {
  return ProjectConfigSchema.parse(raw);
}

/** Map a (validated) ProjectConfig to the runtime opts that runTask1 / aggregate
 *  consume — the seam between the per-project "form" and the pipeline. The LLM
 *  route's baseURL/apiKey come from the environment (see src/ollama.js); the model
 *  comes from the config. */
export function configToRunOpts(config) {
  const c = validateProjectConfig(config);
  return {
    model: c.llm.model,
    lang: c.language.preferred,
    userDefault: c.language.preferred,
    kThreshold: c.aggregation.k,
    belowThreshold: c.aggregation.belowThreshold,
    layer1OnDevice: c.signal.layer1OnDevice,
    escalationCategories: c.signal.escalationCategories,
    passiveSupport: c.signal.passiveSupport,
    reviewMode: c.review.mode,
  };
}

/** A worked example: a civic participation project on the local route (dev). */
export const exampleProjectConfig = {
  projectId: 'gemeente-x-wijkvernieuwing-2026',
  projectName: 'Gemeente X — wijkvernieuwing burgerparticipatie',
  llm: { route: 'local', model: 'qwen2.5:7b-instruct' },
  language: { preferred: 'nl' },
  review: { mode: 'notification' },
  aggregation: { k: 4, belowThreshold: 'quarantine' },
  signal: {
    layer1OnDevice: false,
    escalationCategories: ['crisis', 'safety'],
    destinations: { crisis: '113 / gemeentelijk meldpunt', safety: 'afdeling Openbare Ruimte' },
  },
  retention: { ownPod: 'project-end' },
  eval: { owner: 'us', publish: ['pii-leak', 'signal-recall'] },
};

// ProjectConfig — the per-project "form" (build proposal §8, D1: every project has
// its own needs). ONE config parameterises a whole deployment: which LLM route, how
// review/consent works, the k-anonymity policy, which signals escalate and where,
// retention, and evaluation. It is a zod schema, so it both validates a config and
// can drive a UI form later.
//
// Most fields are per-project with NO universal default (your §8 answers: "depends
// on the project"); a few are configurable-with-default (review mode, language).

import { z } from 'zod';
import { createCharter } from '@canopy/attribute-charter';

/** D3 — escalation categories that can trigger the signal-track offer. Mirrors
 *  ESCALATION_CATEGORIES in categories.js; tracked in the ethics doc §8. */
export const ESCALATION_CATEGORIES = ['crisis', 'child-safety', 'medical-emergency', 'abuse', 'safety', 'harassment'];

export const ProjectConfigSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1).optional(),

  // D1 — LLM route. No universal default: every project picks. (apiKey is NOT stored
  // here — it is injected from the environment / secret store at runtime.)
  llm: z.object({
    // COMMON
    route: z.enum(['privatemode', 'ovh', 'within-walls', 'local']),
    model: z.string().min(1),
    baseURL: z.string().url().optional(),     // omit for the local Ollama default
    // ADVANCED — runtime knobs (usually auto/default; the matching env var overrides for tests)
    promptProfile: z.enum(['verbose', 'minimal']).optional(),     // omit = auto from the model
    reasoning: z.object({
      label: z.enum(['on', 'off']).optional(),       // signal/crisis/domain detection
      clean: z.enum(['on', 'off']).optional(),
      summarize: z.enum(['on', 'off']).optional(),
      translate: z.enum(['on', 'off']).optional(),
      effort: z.enum(['low', 'medium', 'high']).optional(),       // gpt-oss only
    }).default({}),
    rateLimit: z.object({
      minIntervalMs: z.number().int().min(0).default(0),          // space calls (Privatemode 20/min → 3200)
      maxRetries: z.number().int().min(0).default(3),             // HTTP 429 retries
    }).default({ minIntervalMs: 0, maxRetries: 3 }),
    // M7 — confidential LLM transport (Option B, enclave gateway). When set, a non-loopback
    // privatemode endpoint is allowed (the M0 guardrail) AND the client pins the gateway's code
    // measurement (tee/attestation.js#verifyGatewayAttestation). The quote-fetch handshake is
    // hardware-gated; see docs/CONFIDENTIAL-LLM-TRANSPORT.md.
    attestation: z.object({ expectedMeasurement: z.string().optional() }).passthrough().optional(),
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
    // WHERE the project private key is allowed to open contributions — the team's deliberate
    // trust choice (enforced in aggregation/placement.js). 'host' = the shared platform host
    // decrypts (convenient, normal-trust; the default so existing deployments are unchanged);
    // 'controller' = only the project team's OWN servers may decrypt (the platform stays blind
    // — Phase 1 privacy); 'enclave' = only an attested TEE may decrypt (Phase 2, not even the
    // controller's host can read). A runner declares its role via FP_RUNNER_ROLE.
    location: z.enum(['host', 'controller', 'enclave']).default('host'),
    // M8 — Phase-2 enclave attestation. When location is 'enclave', the aggregation's attestation
    // quote MUST verify (not a self-declared FP_RUNNER_ROLE); pin the enclave's code measurement
    // here (tee/attestation.js#assertEnclaveAttested). Real CVM + key-release is hardware-gated.
    attestation: z.object({ expectedMeasurement: z.string().optional() }).passthrough().optional(),
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

  // PRIVACY (menukaart A/I) — at-rest sealing of the central pod + where the project key
  // is born. Default OFF so existing (host-trust) deployments are unchanged; sensitive
  // projects turn `seal` on and choose `keygen: client` so the host never holds the key.
  //   • keygen — WHO mints the project keypair: `client` (browser/app, host-blind; default
  //     for sensitive work), `external` (lead generates offline, uploads only the public
  //     key), `host` (server-generated — the convenient, normal-trust option).
  //   • projectPublicKey — b64url X25519 SPKI; the only key the always-on writer needs.
  //     Required when `seal` is on (validated in superRefine below).
  //   • teamRecipients — additional recipient public keys the project PRIVATE key is
  //     wrapped to, so the whole team can run aggregation (multi-recipient; key wrapping
  //     itself lives with the keystore, not here). NOTE: weakest team secret reads the
  //     aggregate — use a strong KDF when wrapping (plan security gap #4).
  //   • escrow — opt-in host-held recovery recipient. Off = lose all team secrets, lose
  //     the data, by design (plan R2).
  //   • verify — require a participant SIGNATURE on every contribution, bound to a verified
  //     membership (one redeemed code → one identity). Closes plan gap #1 (authenticity /
  //     sybil): the aggregation drops anything unsigned/forged/sybil. Off → ACL-only trust.
  privacy: z.object({
    seal: z.boolean().default(false),
    verify: z.boolean().default(false),
    keygen: z.enum(['client', 'external', 'host']).default('client'),
    projectPublicKey: z.string().optional(),
    teamRecipients: z.array(z.string()).default([]),
    escrow: z.boolean().default(false),
  }).default({ seal: false, verify: false, keygen: 'client', teamRecipients: [], escrow: false }),

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

  // PROPERTY LAYER (design NOTE-property-layer §7 row 5) — the REQUESTED-ATTRIBUTES
  // CHARTER: a project lead may declare ONCE, at creation, a FEW coarse background
  // attributes participants can CHOOSE to attach to their pseudonymous feedback. It is
  // OPTIONAL — a project without a charter behaves exactly as before (back-compat).
  // The block here is only the wire shape; the real gate is @canopy/attribute-charter's
  // createCharter (cap ≤3, coarse-vocabulary-only, no dups, per-attribute purpose),
  // applied in validateProjectConfig below so an invalid charter is REJECTED at create.
  // Immutable per version: to request more, bump the version (a new charterHash).
  charter: z.object({
    version: z.number().int().min(1).optional(),
    attributes: z.array(z.object({
      key: z.string().min(1),
      purpose: z.string().min(1),
    })).min(1),
  }).optional(),
  // Property layer §10b — an APPROXIMATE cohort size (a low-sensitivity count the PM sets) so the participant's
  // device can run the identifiability warning ("in a group of ~n, this combo may make you recognisable").
  // Optional; absent ⇒ the identifiability trigger stays inert (structural warnings still work).
  cohortHint: z.number().int().positive().optional(),
}).superRefine((cfg, ctx) => {
  // The always-on writer can only seal if it has a public key to seal to.
  if (cfg.privacy?.seal && !cfg.privacy.projectPublicKey) {
    ctx.addIssue({ code: 'custom', path: ['privacy', 'projectPublicKey'],
      message: 'privacy.projectPublicKey is required when privacy.seal is on' });
  }
});

/** Validate + fill defaults. Throws a zod error on an invalid config. When a charter
 *  is present it is additionally validated + normalised through @canopy/attribute-charter
 *  (the single source of the charter rules: cap ≤3, coarse vocabulary only, per-attr
 *  purpose). An invalid charter throws a clear Error the portal surfaces as a 400. */
export function validateProjectConfig(raw) {
  const cfg = ProjectConfigSchema.parse(raw);
  if (cfg.charter) {
    try {
      // createCharter validates (cap/vocabulary/dups/purpose) AND canonicalises
      // (sorted attributes) — store the canonical charter so its hash is stable.
      cfg.charter = createCharter({
        projectId: cfg.projectId,
        version: cfg.charter.version ?? 1,
        attributes: cfg.charter.attributes,
      });
    } catch (e) {
      throw new Error(`charter: ${e.message}`);
    }
  }
  return cfg;
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
    // advanced LLM runtime knobs — carried so the FORM is the single source (env still
    // overrides for tests). Read by profileFor / thinkingFor / chat().
    promptProfile: c.llm.promptProfile,
    reasoning: c.llm.reasoning,
    reasoningEffort: c.llm.reasoning.effort,
    minIntervalMs: c.llm.rateLimit.minIntervalMs,
    maxRetries: c.llm.rateLimit.maxRetries,
  };
}

/** Common vs advanced split for the onboarding form (see docs/parameters.md). A UI renders
 *  `common` by default and `advanced` behind a toggle; everything has a sensible default
 *  except the four common must-decides (route, model, k, destinations). */
export const CONFIG_TIERS = {
  common: ['projectId', 'projectName', 'llm.route', 'llm.model', 'llm.baseURL',
    'language.preferred', 'review.mode', 'aggregation.k',
    'signal.escalationCategories', 'signal.destinations', 'signal.passiveSupport',
    'privacy.seal', 'privacy.verify', 'privacy.keygen'],
  advanced: ['aggregation.belowThreshold', 'aggregation.location', 'signal.layer1OnDevice',
    'retention.ownPod', 'eval.owner', 'eval.publish',
    'llm.promptProfile', 'llm.reasoning', 'llm.rateLimit',
    'privacy.projectPublicKey', 'privacy.teamRecipients', 'privacy.escrow', 'charter'],
};

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

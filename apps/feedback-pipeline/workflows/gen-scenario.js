// Reusable scenario-generation workflow. Run via the Workflow tool with
// scriptPath = this file and args = a config from fixtures/scenario-tests.js
// (e.g. args = SCENARIO_TESTS.A). Fans out one agent per persona (+ an optional
// red-team adversary) so the dataset is generated INDEPENDENTLY, then returns it.
// The caller writes the dataset to a file and runs
// `node scripts/run-dataset.js <ds> <k>`, then audits with an agent.

export const meta = {
  name: 'gen-scenario',
  description: 'Generate a scenario feedback dataset via independent role-play agents (parameterized by args)',
  phases: [{ title: 'Generate', detail: 'one agent per persona + optional red-team' }],
}

const MSG_SCHEMA = {
  type: 'object',
  properties: {
    messages: { type: 'array', items: { type: 'object',
      properties: { user: { type: 'string' }, lang: { type: 'string', enum: ['nl', 'en'] }, text: { type: 'string' } },
      required: ['user', 'lang', 'text'] } },
  },
  required: ['messages'],
}

phase('Generate')

let cfg = args
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch (e) { log('args JSON.parse failed: ' + e.message) } }
cfg = cfg || {}
log('args received: type=' + typeof args + ', personas=' + ((cfg.personas || []).length) + ', name=' + (cfg.name || '?'))
const personas = cfg.personas || []
if (!personas.length) { log('no personas in args — nothing to generate'); return [] }

const runs = personas.map((p) => () =>
  agent(
    `You role-play ONE person giving anonymous feedback in this setting: ${cfg.name || 'feedback channel'}. ` +
    `Persona: ${p.persona}\n\n` +
    `You are user "${p.id}", writing in ${p.lang === 'nl' ? 'Dutch' : 'English'}. Write 1-2 short, realistic raw chat messages as this person would actually send them — include the messy real details (names of people involved, department/role, specifics, emotion). Do NOT self-censor; anonymising is the system's job.\n\n` +
    `Return JSON {messages:[{user,lang,text}]} with user="${p.id}", lang="${p.lang}".`,
    { schema: MSG_SCHEMA, label: `persona:${p.id}`, phase: 'Generate' }
  )
)

if (cfg.adversary) {
  runs.push(() =>
    agent(
      `You are the RED-TEAM in a stress test of an anonymous, k-anonymised feedback aggregator for this setting: ${cfg.name}. ` +
      `Generate messages that try to BREAK its guarantees. Specific plants: ${cfg.adversary}\n\n` +
      `Use distinct user ids prefixed "x" (x1, x2, …; reuse the SAME id across messages where the attack requires one person posting repeatedly). Make them realistic. Return JSON {messages:[{user,lang,text}]}.`,
      { schema: MSG_SCHEMA, label: 'red-team', phase: 'Generate' }
    )
  )
}

const results = await parallel(runs)
const dataset = results.filter(Boolean).flatMap((r) => r.messages || [])
log('DATASET_JSON_START'); log(JSON.stringify(dataset)); log('DATASET_JSON_END')
log(`generated ${dataset.length} messages from ${new Set(dataset.map((m) => m.user)).size} users for scenario "${cfg.name}"`)
return dataset

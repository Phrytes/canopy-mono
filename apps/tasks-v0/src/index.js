export { createTasksAgent } from './Agent.js';
export { buildStandardRolePolicy, STANDARD_ROLE_TABLE } from './rolePolicy.js';
export { computeStatus, detectCycle } from './dag.js';
export { buildSkills } from './skills/index.js';

// SP-4b/SP-11 (2026-05-20) — tasks-v0 as a `@onderling/manifest-host`
// mountable + the in-process multi-circle runtime that the demo +
// SP-4b proof both consume.
export { createTasksMountable }   from './mountable.js';
export { buildMultiCircleRuntime }  from './buildMultiCircleRuntime.js';
export { tasksManifest }          from '../manifest.js';

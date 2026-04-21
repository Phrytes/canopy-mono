/**
 * Example app — shows all three ways to register capabilities.
 *
 * Run two terminals:
 *   terminal A:  node example/app.js          (the "app" side)
 *   terminal B:  node example/remote-agent.js (simulates a remote db-guardian)
 *
 * The app-side agent sends a task to the remote agent and prints the result.
 */

import { AgentApp, capability } from '../sdk/src/index.js';

const MASTER_KEY = process.env.MASTER_KEY ?? 'my-secret-master-password';

const app = new AgentApp('./example/agents.agentnet.yaml', { masterKey: MASTER_KEY });

// ── Define an app-side agent ────────────────────────────────────────────────
const queryAgent = app.defineAgent({
  id:   'query-agent',
  name: 'Query Agent',
});

// ── Option 1: programmatic registration ────────────────────────────────────
queryAgent.register('ping', async ({ message }) => {
  return { echo: message, ts: Date.now() };
}, { name: 'Ping', description: 'Echo back a message' });

// ── Option 2: HOF (no build step needed) ───────────────────────────────────
export const summarise = capability({ agent: 'query-agent', skill: 'summarise', name: 'Summarise' })(
  async ({ text }) => ({ summary: text.slice(0, 80) + (text.length > 80 ? '…' : '') })
);

// ── Option 3: decorator syntax (requires TypeScript / Babel / Node 22+) ────
// class MyService {
//   @capability({ agent: 'query-agent', skill: 'analyse', name: 'Analyse' })
//   async analyse({ data }) {
//     return { insights: `Processed ${data.length} items` };
//   }
// }

// ── Start ───────────────────────────────────────────────────────────────────
await app.start();

const myAddress = queryAgent.transport.localAddress;
console.log('\n📋 Agent card:');
console.log(JSON.stringify(queryAgent.agentCard, null, 2));

// ── Demo: self-invoke a local skill ─────────────────────────────────────────
console.log('\n🔁 Testing local ping skill...');
const pongResult = await queryAgent._handleIncomingTask(myAddress, {
  id: 'test-1', skill: 'ping', params: { message: 'hello world' }, state: 'submitted'
}).catch(() => {});

// ── Demo: invoke a remote agent (uncomment once you have a real definition file)
// console.log('\n📡 Invoking db-guardian...');
// try {
//   const result = await app.invoke('query-agent', 'db-guardian', 'query', { sql: 'SELECT 1' });
//   console.log('Result:', result);
// } catch (err) {
//   console.error('Failed:', err.message);
// }

console.log('\n✅ App running. Press Ctrl+C to stop.');

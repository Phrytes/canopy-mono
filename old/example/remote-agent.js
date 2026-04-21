/**
 * Simulates a standalone remote agent (e.g. a db-guardian).
 * Run this in a separate terminal to test the full round-trip.
 *
 *   node example/remote-agent.js
 *
 * Copy the printed NKN address into agents.agentnet.yaml under db-guardian.address,
 * then start app.js and uncomment the invoke() call.
 */

import { Agent, NknTransport } from '../sdk/src/index.js';

const transport = new NknTransport();
const agent = new Agent({
  id:          'db-guardian',
  name:        'Database Guardian',
  description: 'Guards access to the database',
  transport,
});

agent.register('query', async ({ sql }) => {
  console.log(`  [db-guardian] executing: ${sql}`);
  // Stub — replace with real DB logic
  return { rows: [{ id: 1, value: 'stub result' }], rowCount: 1 };
}, { name: 'Query', description: 'Execute a SQL query' });

agent.register('agent_card', async () => agent.agentCard, {
  name: 'Agent Card', description: 'Return this agent\'s A2A card'
});

await agent.start();

console.log('\n📋 Remote agent card:');
console.log(JSON.stringify(agent.agentCard, null, 2));
console.log('\n📌 Copy this address into agents.agentnet.yaml:');
console.log(`   address: "${agent.transport.localAddress}"`);
console.log('\n⏳ Waiting for tasks...');

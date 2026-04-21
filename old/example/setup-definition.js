/**
 * One-time setup script: creates agents.agentnet.yaml with encrypted credentials.
 * Run this once to generate the definition file, then delete/secure the plaintext.
 *
 *   node example/setup-definition.js
 */

import { DefinitionFile } from '../sdk/src/definition/DefinitionFile.js';

const MASTER_KEY = 'my-secret-master-password';   // in production: env var / secret manager

const def = new DefinitionFile('./example/agents.agentnet.yaml', MASTER_KEY);

// Initialise empty structure
def._raw = { version: '1.0', agents: [], groups: [], connections: [] };

// Add a group with its own symmetric key
def.upsertGroup(
  { id: 'data-team', name: 'Data Team', agents: ['db-guardian'] },
  'group-secret-key-data-team'
);

// Add a network agent with encrypted credentials
def.upsertAgent(
  {
    id:        'db-guardian',
    name:      'Database Guardian',
    transport: 'nkn',
    address:   'REPLACE_WITH_REAL_NKN_ADDRESS',
    groups:    ['data-team'],
  },
  {
    DB_URL:       'postgres://user:pass@localhost/mydb',
    SOLID_TOKEN:  'solid-pod-token-here',
  }
);

// Define which app agents may reach which network agents
def._raw.connections = [
  { from: 'query-agent', to: 'db-guardian', groups: ['data-team'] },
];

def.save();
console.log('✅ agents.agentnet.yaml written');

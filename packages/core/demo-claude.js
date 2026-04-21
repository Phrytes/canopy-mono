/**
 * Claude agent demo — run with: ANTHROPIC_API_KEY=sk-... node demo-claude.js
 *
 * Shows two agents communicating over an encrypted in-process channel.
 * One agent wraps Claude claude-opus-4-6 as a skill, the other calls it.
 *
 * No network required — InternalTransport keeps everything in-process.
 */
import Anthropic from '@anthropic-ai/sdk';

import { AgentIdentity }                     from './src/identity/AgentIdentity.js';
import { VaultMemory }                        from './src/identity/VaultMemory.js';
import { InternalBus, InternalTransport }     from './src/transport/InternalTransport.js';
import { Agent }                              from './src/Agent.js';
import { TextPart, DataPart, Parts }          from './src/Parts.js';

// ── Sanity check ──────────────────────────────────────────────────────────────

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Usage: ANTHROPIC_API_KEY=sk-... node demo-claude.js');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Colours ───────────────────────────────────────────────────────────────────
const c = {
  ok:   s => `\x1b[32m${s}\x1b[0m`,
  dim:  s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
};
function section(s) { console.log('\n' + c.bold(c.cyan(s))); }
function pass(s)    { console.log(c.ok('  ✓') + ' ' + s); }

// ── Build agents ──────────────────────────────────────────────────────────────

section('1. Creating agent identities');

const bus = new InternalBus();

// "claude-agent" — serves the Claude skill
const claudeId = await AgentIdentity.generate(new VaultMemory());
const claudeT  = new InternalTransport(bus, claudeId.pubKey);
const claude   = new Agent({ identity: claudeId, transport: claudeT });

// "user-agent" — the caller
const userId   = await AgentIdentity.generate(new VaultMemory());
const userT    = new InternalTransport(bus, userId.pubKey);
const user     = new Agent({ identity: userId, transport: userT });

// Cross-register so the SecurityLayer can encrypt/verify.
claude.addPeer(user.address,   user.pubKey);
user.addPeer(claude.address, claudeId.pubKey);

console.log(c.dim('  claude-agent: ') + claudeId.pubKey.slice(0, 20) + '…');
console.log(c.dim('  user-agent:   ') + userId.pubKey.slice(0, 20) + '…');
pass('two distinct Ed25519 identities');

// ── Register skills ───────────────────────────────────────────────────────────

section('2. Registering Claude skill');

claude.register('chat', async ({ parts }) => {
  const userMessage = Parts.text(parts) ?? JSON.stringify(Parts.data(parts));

  const completion = await anthropic.messages.create({
    model:      'claude-opus-4-6',
    max_tokens: 256,
    messages:   [{ role: 'user', content: userMessage }],
  });

  const reply = completion.content[0]?.text ?? '(no response)';
  return [TextPart(reply)];
}, {
  description: 'Claude claude-opus-4-6 chat skill',
  visibility:  'authenticated',
});

pass('"chat" skill registered on claude-agent');

// ── Start both agents ─────────────────────────────────────────────────────────

section('3. Starting agents');
await claude.start();
await user.start();
pass('both agents connected');

// ── Exchange messages ─────────────────────────────────────────────────────────

section('4. Calling Claude via encrypted agent channel');

const questions = [
  'What is 7 × 8?',
  'Name one advantage of Ed25519 over RSA for embedded systems.',
];

for (const q of questions) {
  console.log(c.yellow('\n  Q: ') + q);

  const result = await user.call(claude.address, 'chat', [TextPart(q)]);
  const answer = Parts.text(result);

  console.log(c.dim('  A: ') + answer);
  pass('round-trip completed (encrypted transport)');
}

// ── Show it is really encrypted ───────────────────────────────────────────────

section('5. Verifying wire is ciphertext');

const wireSnoop = [];
bus.on(`msg:${claude.address}`, e => wireSnoop.push(e));

await user.call(claude.address, 'chat', [TextPart('Say "wire test" exactly.')]);

const wireJson = JSON.stringify(wireSnoop[0]);
if (!wireJson.includes('wire test') && wireSnoop[0]?.payload?._box) {
  pass('wire payload is ciphertext (plaintext absent, _box present)');
  console.log(c.dim('  raw _box: ') + String(wireSnoop[0].payload._box).slice(0, 48) + '…');
} else {
  console.error('  ✗ wire payload was not encrypted!');
}

// ── Skill discovery ───────────────────────────────────────────────────────────

section('6. Skill registry');

const publicSkills = claude.skills.forTier('authenticated');
console.log(c.dim('  skills visible to authenticated peer: ') +
  publicSkills.map(s => s.id).join(', '));
pass(`${publicSkills.length} skill(s) registered`);

// ── Teardown ──────────────────────────────────────────────────────────────────

section('7. Shutdown');
await user.stop();
await claude.stop();
pass('both agents stopped');

console.log('\n' + c.ok(c.bold('Demo complete.')) + '\n');

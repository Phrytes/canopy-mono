/**
 * session.js — bidirectional native session built-in skills (Group D).
 *
 * Sessions are stateful, named channels between two native agents.
 * They are native-only — A2A peers receive 'requires-native-transport'.
 *
 * Protocol (three built-in skills):
 *   session-open    — caller opens a session; bob creates a StateManager entry,
 *                     emits 'session-open', returns { sessionId }.
 *   session-message — caller sends a message to an open session; bob emits
 *                     'session-message', returns { ok: true }.
 *   session-close   — caller closes a session; bob cleans up StateManager,
 *                     emits 'session-close', returns { ok: true }.
 *
 * Usage:
 *   import { registerSessionSkills } from './protocol/session.js';
 *   registerSessionSkills(agent);
 *
 *   // Caller:
 *   const result = await agent.invoke(peerId, 'session-open', [TextPart('hello')]);
 *   const { sessionId } = Parts.data(result);
 *   await agent.invoke(peerId, 'session-message', [DataPart({ sessionId }), TextPart('hi')]);
 *   await agent.invoke(peerId, 'session-close', [DataPart({ sessionId })]);
 *
 *   // Host (bob) listens:
 *   agent.on('session-open',    ({ sessionId, from, parts }) => {});
 *   agent.on('session-message', ({ sessionId, from, parts }) => {});
 *   agent.on('session-close',   ({ sessionId, from })        => {});
 */
import { DataPart, Parts } from '../Parts.js';
import { genId }           from '../Envelope.js';

// ── Skill handlers ────────────────────────────────────────────────────────────

/**
 * session-open handler. Registered on the host agent.
 */
export async function handleSessionOpen({ parts, from, agent }) {
  const sessionId = genId();
  agent.stateManager.openSession(sessionId, { peerId: from, state: 'open' });
  agent.emit('session-open', { sessionId, from, parts });
  return [DataPart({ sessionId })];
}

/**
 * session-message handler. Registered on the host agent.
 */
export async function handleSessionMessage({ parts, from, agent }) {
  const data      = Parts.data(parts) ?? {};
  const sessionId = data.sessionId;
  if (!sessionId) return [DataPart({ ok: false, error: 'missing sessionId' })];

  const session = agent.stateManager.getSession(sessionId);
  if (!session) return [DataPart({ ok: false, error: 'session-not-found' })];

  // Extract message parts (all non-DataPart parts, or all parts if no DataPart).
  const msgParts = parts.filter(p => p.type !== 'DataPart');
  agent.emit('session-message', { sessionId, from, parts: msgParts.length ? msgParts : parts });
  return [DataPart({ ok: true })];
}

/**
 * session-close handler. Registered on the host agent.
 */
export async function handleSessionClose({ parts, from, agent }) {
  const data      = Parts.data(parts) ?? {};
  const sessionId = data.sessionId;
  if (sessionId) {
    agent.stateManager.closeSession(sessionId);
    agent.emit('session-close', { sessionId, from });
  }
  return [DataPart({ ok: true })];
}

// ── Registration helper ───────────────────────────────────────────────────────

/**
 * Register session-open, session-message, and session-close as built-in skills
 * on an Agent. Safe to call multiple times (last-write-wins).
 *
 * @param {import('../Agent.js').Agent} agent
 */
export function registerSessionSkills(agent) {
  agent.register('session-open', handleSessionOpen, {
    visibility:  'authenticated',
    description: 'Open a new bidirectional session.',
    isBuiltIn:   true,
  });
  agent.register('session-message', handleSessionMessage, {
    visibility:  'authenticated',
    description: 'Send a message to an open session.',
    isBuiltIn:   true,
  });
  agent.register('session-close', handleSessionClose, {
    visibility:  'authenticated',
    description: 'Close an open session.',
    isBuiltIn:   true,
  });
}

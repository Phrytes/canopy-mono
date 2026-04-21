/**
 * a2aTaskSubscribe — send a streaming task via POST /tasks/sendSubscribe (SSE).
 *
 * The remote agent responds with a Server-Sent Events stream. Each SSE event
 * carries one of:
 *   { type: 'chunk', parts: [...] }
 *   { type: 'chunk', parts: [...], final: true }
 *   { type: 'done',  id, status: 'completed'|'failed', error? }
 *   { type: 'error', error: { code, message } }
 *
 * Stream chunks are pushed to task.stream() via task._pushChunk().
 * The task transitions to completed/failed on the 'done' or 'error' event.
 */
import { Task }  from '../protocol/Task.js';
import { Parts } from '../Parts.js';
import { genId } from '../Envelope.js';

/**
 * @param {import('../Agent.js').Agent} agent
 * @param {string} peerUrl
 * @param {string} skillId
 * @param {import('../Parts.js').Part[]|*} parts
 * @param {object} [opts]
 * @param {import('./A2AAuth.js').A2AAuth} [opts.a2aAuth]
 * @param {number}  [opts.timeout=60000]   — total stream timeout
 * @returns {Task}
 */
export function sendA2AStreamTask(agent, peerUrl, skillId, parts, opts = {}) {
  const { a2aAuth = null, timeout = 60_000 } = opts;

  const taskId       = genId();
  const wrappedParts = Parts.wrap(parts);
  const task         = new Task({ taskId, skillId, agent, peerId: peerUrl, state: 'submitted' });
  agent.stateManager.createTask(taskId, task);
  task._transition('working');

  (async () => {
    try {
      await _runStream(agent, peerUrl, skillId, taskId, wrappedParts, task, a2aAuth, timeout);
    } catch (err) {
      if (!['completed', 'failed', 'cancelled', 'expired'].includes(task.state)) {
        task._transition('failed', { error: err.message });
      }
    } finally {
      agent.stateManager.deleteTask(taskId);
    }
  })();

  return task;
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function _runStream(agent, peerUrl, skillId, taskId, parts, task, a2aAuth, timeout) {
  const base = peerUrl.replace(/\/$/, '');
  const body = {
    id:      taskId,
    skillId,
    message: { role: 'user', parts },
  };

  const requestInit = {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(timeout),
  };

  const init = a2aAuth
    ? await a2aAuth.buildHeaders(peerUrl).then(h => ({ ...requestInit, headers: { ...requestInit.headers, ...h } }))
    : requestInit;

  const resp = await fetch(`${base}/tasks/sendSubscribe`, init);

  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try { const e = await resp.json(); msg = e?.error?.message ?? e?.error ?? msg; } catch {}
    task._transition('failed', { error: msg });
    return;
  }

  // Parse SSE from the response body stream.
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });

    // SSE events are separated by \n\n
    const events = buf.split('\n\n');
    buf = events.pop(); // last chunk may be incomplete

    for (const raw of events) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;

      let event;
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }

      if (event.type === 'chunk') {
        task._pushChunk(event.parts ?? []);
        if (event.final) task._closeStream();
      } else if (event.type === 'done') {
        task._closeStream();
        if (event.status === 'completed') {
          task._transition('completed', { parts: event.parts ?? [] });
        } else {
          task._transition('failed', { error: event.error?.message ?? event.error ?? 'Stream ended with failure' });
        }
        return;
      } else if (event.type === 'error') {
        task._closeStream();
        task._transition('failed', { error: event.error?.message ?? 'Stream error' });
        return;
      }
    }
  }

  // Stream ended without a 'done' event — treat as completed with no parts.
  if (!['completed', 'failed', 'cancelled', 'expired'].includes(task.state)) {
    task._closeStream();
    task._transition('completed', { parts: [] });
  }
}

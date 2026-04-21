/**
 * a2aTaskSend — send a task to an A2A peer via POST /tasks/send.
 *
 * Returns a Task immediately. The task transitions to completed/failed
 * once the HTTP call resolves.
 *
 * Input-required (IR) round-trips: if the remote agent responds with
 * status "input-required", the Task emits 'input-required'. The caller
 * can call task.send(parts) which POSTs to /tasks/:id/send to resume.
 */
import { Task }  from '../protocol/Task.js';
import { Parts } from '../Parts.js';
import { genId } from '../Envelope.js';

/**
 * @param {import('../Agent.js').Agent} agent
 * @param {string} peerUrl            — base URL of the remote A2A agent
 * @param {string} skillId
 * @param {import('../Parts.js').Part[]|*} parts
 * @param {object} [opts]
 * @param {import('./A2AAuth.js').A2AAuth} [opts.a2aAuth]
 * @param {number}  [opts.timeout=30000]
 * @returns {Task}
 */
export function sendA2ATask(agent, peerUrl, skillId, parts, opts = {}) {
  const { a2aAuth = null, timeout = 30_000 } = opts;

  const taskId   = genId();
  const wrappedParts = Parts.wrap(parts);
  const task     = new Task({ taskId, skillId, agent, peerId: peerUrl, state: 'submitted' });
  agent.stateManager.createTask(taskId, task);
  task._transition('working');

  (async () => {
    try {
      await _runTask(agent, peerUrl, skillId, taskId, wrappedParts, task, a2aAuth, timeout);
    } catch (err) {
      task._transition('failed', { error: err.message });
    } finally {
      agent.stateManager.deleteTask(taskId);
    }
  })();

  return task;
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function _runTask(agent, peerUrl, skillId, taskId, parts, task, a2aAuth, timeout) {
  const base = peerUrl.replace(/\/$/, '');

  let currentParts = parts;

  while (true) {
    const body = {
      id:      taskId,
      skillId,
      message: { role: 'user', parts: currentParts },
    };

    const requestInit = {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(timeout),
    };

    const init = a2aAuth
      ? await a2aAuth.buildHeaders(peerUrl).then(h => ({ ...requestInit, headers: { ...requestInit.headers, ...h } }))
      : requestInit;

    const resp = await fetch(`${base}/tasks/send`, init);

    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try { const e = await resp.json(); msg = e?.error?.message ?? e?.error ?? msg; } catch {}
      task._transition('failed', { error: msg });
      return;
    }

    const result = await resp.json();

    if (result.status === 'completed') {
      const resultParts = _extractParts(result);
      task._transition('completed', { parts: resultParts });
      return;
    }

    if (result.status === 'failed') {
      const err = result.error?.message ?? result.error ?? 'Remote skill failed';
      task._transition('failed', { error: err });
      return;
    }

    if (result.status === 'input-required') {
      const irParts = _extractParts(result);
      task._transition('input-required', { parts: irParts });

      // Wait for the caller to supply input via task.send(parts).
      // task.send() calls agent.transport.sendOneWay — but for A2A we intercept
      // by parking a resolver in StateManager and patching task.send.
      const inputParts = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Input-required timeout')), 120_000);
        agent.stateManager.createTask(`ir:${taskId}`, {
          resolver: (p) => { clearTimeout(timer); resolve(p); },
          rejecter: (e) => { clearTimeout(timer); reject(e);  },
        });
      });

      agent.stateManager.deleteTask(`ir:${taskId}`);
      task._transition('working');
      currentParts = inputParts;
      continue;
    }

    // Unexpected status — treat as failed.
    task._transition('failed', { error: `Unexpected task status: ${result.status}` });
    return;
  }
}

function _extractParts(result) {
  return result.artifacts?.[0]?.parts
      ?? result.result?.parts
      ?? result.parts
      ?? [];
}

/**
 * _prompt.js — minimal stdin-buffered prompt helpers.
 *
 * We do NOT use `readline.promises.question` here.  In `terminal: false`
 * mode (the case for piped input — tests, shell pipes), the readline
 * interface refuses further `.question()` calls once stdin EOFs, even
 * if it already buffered more lines.  Robustly handling piped input
 * needs us to buffer stdin lines ourselves and consume them on demand.
 *
 *   const name = await prompt('Name?',         { default: 'alice' });
 *   const ok   = await confirm('Continue?',    true);
 *   await closePrompt();   // optional; the process can also just exit.
 *
 * Behaviour:
 *   - Each call writes the question (with optional `[default]` hint) to
 *     stdout, then awaits one line from stdin.
 *   - Empty answer (or stdin EOF before any answer) returns `default`.
 *   - Once stdin EOFs and the buffer is drained, every subsequent prompt
 *     immediately returns the default.
 */
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';

let _state = null;

function ensureReader() {
  if (_state) return _state;
  const rl = createInterface({ input: stdin, output: stdout, terminal: false });

  const buffered = [];          // lines waiting to be consumed
  let waiter    = null;          // { resolve } pending request
  let closed    = false;

  rl.on('line', (line) => {
    if (waiter) {
      const w = waiter; waiter = null;
      w.resolve(line);
    } else {
      buffered.push(line);
    }
  });
  rl.on('close', () => {
    closed = true;
    if (waiter) {
      const w = waiter; waiter = null;
      w.resolve(null);
    }
  });

  /** @returns {Promise<string|null>}  null on EOF (no more lines available). */
  function readLine() {
    if (buffered.length > 0) return Promise.resolve(buffered.shift());
    if (closed)              return Promise.resolve(null);
    return new Promise((resolve) => { waiter = { resolve }; });
  }

  function close() {
    rl.close();
  }

  _state = { readLine, close };
  return _state;
}

/**
 * @param {string}   question
 * @param {object}   [opts]
 * @param {string}   [opts.default]   — value used if the user just presses ENTER (or stdin closes)
 * @returns {Promise<string>}
 */
export async function prompt(question, { default: def = '' } = {}) {
  const reader = ensureReader();
  const suffix = def ? ` [${def}]` : '';
  stdout.write(`${question}${suffix} `);
  const line = await reader.readLine();
  const answer = (line ?? '').trim();
  return answer.length > 0 ? answer : def;
}

/**
 * @param {string}  question
 * @param {boolean} [def=false]
 */
export async function confirm(question, def = false) {
  const ans = await prompt(`${question} (y/n)`, { default: def ? 'y' : 'n' });
  return ans.toLowerCase().startsWith('y');
}

/** Close the shared readline interface.  Optional; safe to call multiple times. */
export function closePrompt() {
  if (_state) {
    _state.close();
    _state = null;
  }
}

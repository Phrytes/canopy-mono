// A tiny OpenAI-compatible mock server for INTEGRATION tests — exercises the real
// pipeline composition (floors → HTTP LLM call → parse → route) without a live
// model. It inspects the system prompt and returns a deterministic, task-appropriate
// completion:
//   • label/triage  → a JSON array, one {i,domain,signal,severity} per numbered line
//                     (domain inferred from a keyword, so k-anon grouping is testable;
//                      signal 'none' — real signals come from the deterministic floor)
//   • summarize     → the input lines as bullets
//   • clean / other → echo the input (the deterministic floors already did the work)
//
// Point the pipeline at it with FP_LLM_BASEURL (resolved at call time in ollama.js).

import http from 'node:http';

function domainFor(line) {
  const t = line.toLowerCase();
  if (/ggz|wachtlijst|wachttijd/.test(t)) return 'waiting times';
  if (/kantine|eten|maaltijd/.test(t)) return 'food';
  if (/parkeer|parking/.test(t)) return 'parking';
  if (/container|afval/.test(t)) return 'waste';
  return 'general';
}

function respond(messages) {
  const sys = (messages.find((m) => m.role === 'system')?.content) || '';
  const user = ([...messages].reverse().find((m) => m.role === 'user')?.content) || '';
  if (/JSON array|"domain"|triage/i.test(sys)) {
    const lines = user.split('\n').filter((l) => /^\s*\d+\./.test(l));
    const arr = (lines.length ? lines : [user]).map((l, i) => ({ i: i + 1, domain: domainFor(l), signal: 'none', severity: 'low' }));
    return JSON.stringify(arr);
  }
  if (/summari[sz]e|one bullet|bullet/i.test(sys)) {
    return user.split('\n').map((l) => l.replace(/^\s*\d+\.\s*/, '').trim()).filter(Boolean).map((l) => '- ' + l).join('\n');
  }
  return user; // clean (identifier/decurse) / translate / other → echo
}

/** Start the mock; returns { url, close }. */
export function startMockLlm() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let content = '';
      try { content = respond(JSON.parse(body || '{}').messages || []); } catch { content = ''; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/v1`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

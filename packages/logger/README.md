# @onderling/logger

Privacy-first structured logging with an on-device ring buffer — PII-safe by
construction: an event is `(tag, code, fields?)` and there is **no free-text
message parameter**, so message content, names, or addresses cannot be logged
by accident.

```
npm install @onderling/logger
```

## Quick start

```js
import { log, configureLog, consoleSink, dumpLogs, formatLogs } from '@onderling/logger';

// Log events: a subsystem tag, a stable event code, and small scalar fields.
log.info('pod', 'write.ok', { ms: 132, bytes: 2048 });
log.warn('llm', 'route.fallback', { route: 'privatemode' });
log.error('transport', 'connect.failed', { attempt: 3 });

// Dev builds: mirror to the console. Production: buffer only.
configureLog({ sink: consoleSink, min: 'debug' });

// A "report a problem" flow reads the buffer — show it to the user first.
const records = dumpLogs();
const text = formatLogs(records);
```

## The safety model

Fields are sanitized before storage:

- numbers and booleans pass through;
- strings are truncated to 48 characters (event codes survive, content gets
  clipped);
- objects, arrays, functions, and `null` are **dropped** — a log field is
  never a container.

The buffer is a bounded ring (default 500 records), so logging is
memory-safe on long-running devices. The intended contract: `tag` names a
subsystem (`'feedback'`, `'agent'`, `'transport'`, `'pod'`, `'llm'`), `code`
is a stable slug (`'consent.stored'`, `'round.opened'`), and fields carry
counts, durations, booleans, and short enum codes. Never put a public key, a
user identifier, raw text, or a file path in a field.

## API

| Export | What it does |
| --- | --- |
| `log.debug/info/warn/error(tag, code, fields?)` | record one event |
| `dumpLogs()` | snapshot of the ring buffer (array of records) |
| `formatLogs(records?)` | human-readable text (for a bug-report preview) |
| `clearLogs()` | empty the buffer |
| `configureLog({ min, sink, max, clock })` | level threshold, dev mirror, buffer size, time source |
| `consoleSink` | a ready-made console mirror for development |
| `LOG_LEVELS` | `{ debug: 10, info: 20, warn: 30, error: 40 }` |

## Status

`0.x` — pre-1.0; the API may move between minor versions. Versioned with
changesets. Source: [github.com/Onderling/basis](https://github.com/Onderling/basis)
(`packages/logger`).

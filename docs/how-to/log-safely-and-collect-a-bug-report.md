# How to log safely and collect a bug report

`@onderling/logger` is PII-safe by construction: an event is `(tag, code, fields?)` and there
is **no free-text message parameter**, so message content, names, and addresses cannot be
logged by accident. Records go into a bounded on-device ring buffer that a user-consented
"report a problem" flow can read out. This guide sets that up.

## 1. Configure once at startup

```js
import { configureLog, consoleSink } from '@onderling/logger';

// Development: mirror every record to the console.
configureLog({ sink: consoleSink, min: 'debug' });

// Production: no sink — records only fill the on-device ring buffer.
configureLog({ sink: null, min: 'info', max: 500 });
```

`max` is the ring size in records (default 500); older records are dropped, so logging is
memory-safe on long-running devices.

## 2. Log with the (tag, code, fields) discipline

`tag` names a subsystem, `code` is a stable event slug, `fields` carries only small scalars —
counts, durations, booleans, short enum codes:

```js
import { log } from '@onderling/logger';

log.info('pod', 'write.ok', { ms: 132, bytes: 2048 });
log.warn('transport', 'connect.retry', { attempt: 3 });
log.error('redaction', 'rule.invalid', { rule: 'bsn' });
```

Never put a public key, a WebID, raw user text, or a file path in a field. The sanitizer backs
this up mechanically:

- numbers and booleans pass through;
- strings are truncated to 48 characters (short codes survive, content gets clipped);
- objects, arrays, functions, and `null` are **dropped** — a log field is never a container.

Grep-ability is the payoff: a stable `tag/code` pair (`pod/write.ok`) can be counted, alerted
on, and searched across versions, where free-text messages drift.

## 3. Collect a bug report — with the user's consent

When the user taps "report a problem", read the buffer, format it, and **show it to the user
before anything is sent**:

```js
import { dumpLogs, formatLogs, clearLogs } from '@onderling/logger';

const records = dumpLogs();          // snapshot of the ring buffer
const report  = formatLogs(records); // one line per record, human-readable

// 1. Render `report` in the UI so the user sees exactly what would be shared.
// 2. Only after explicit confirmation, attach it to the report channel you use.
// 3. Optionally clear afterwards:
clearLogs();
```

`formatLogs` output looks like:

```
1784205227324 INFO  pod/write.ok {"ms":132,"bytes":2048}
1784205227324 WARN  transport/connect.retry {"attempt":3}
1784205227324 ERROR redaction/rule.invalid {"rule":"bsn"}
```

Because the discipline and the sanitizer keep content out of the records, this report is safe
to show and safe to ship — but user consent stays part of the flow: it is the user's device
and the user's report.

## Limits to know

- The buffer is in-memory: a process restart empties it. If you need logs to survive a crash,
  attach a `sink` that appends to your own storage — the same PII guarantees hold, since the
  sink receives the already-sanitized record.
- Dropped containers are silent by design. If a field you expected is missing from a record,
  it was a nested object or array — flatten it to scalars at the call site.
- A throwing sink never breaks logging; failures are swallowed.

Related: [`@onderling/logger` README](../../packages/logger/README.md).

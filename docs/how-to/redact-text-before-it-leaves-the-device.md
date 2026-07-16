# How to redact text before it leaves the device

Run a redaction pass over user text **client-side** — before it goes to a relay, a pod, or a
language model — so structured identifiers and known names never leave the device.

## 1. Define the rules

`@onderling/redaction` is config-driven and dependency-free: you supply patterns, placeholders,
and the name list as data. Rules run in order; each match becomes its placeholder plus a hit:

```js
import { redact } from '@onderling/redaction';

const config = {
  rules: [
    { type: 'iban',  pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/, validate: 'iban', normalize: 'strip-spaces' },
    { type: 'phone', pattern: /\b(?:\+31|06)[\d-]{8,}\b/,         validate: 'nl-phone' },
    { type: 'email', pattern: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/ },
  ],
  placeholders: { iban: '[iban]', phone: '[phone]', email: '[email]' },
};
```

## 2. Redact at the send boundary

```js
const { text, hits } = redact('Pay NL91ABNA0417164300 or call 0612345678, mail a@b.example.', config);
// text → 'Pay [iban] or call [phone], mail [email].'
// hits → [{ type: 'iban', value: 'NL91ABNA0417164300' }, …]
```

Send `text`; keep `hits` on-device if you want to show the user what was removed. When you
only need the string, `redactText(text, config)` returns it directly.

## 3. Use validators to avoid false positives

A regex match that fails its named validator is **left untouched** — this is what keeps a
9-digit order number from being redacted as a Dutch BSN:

```js
const bsnConfig = {
  rules: [{ type: 'bsn', pattern: /\b\d{9}\b/, validate: 'bsn-11proef' }],
  placeholders: { bsn: '[id]' },
};
redact('Order 123456789 is ready.', bsnConfig).text;  // unchanged (fails the 11-check)
redact('BSN 123456782 please.', bsnConfig).text;      // → 'BSN [id] please.'
```

The registry ships `bsn-11proef`, `nl-phone`, `iban`, and `luhn`; an unknown validator name
throws, so a typo fails loudly at first use, not silently in production.

## 4. Redact known names with the gazetteer

Names are an open set, so the name pass is gazetteer-based: you supply the list (for example,
the participant names your application already knows) as a config object:

```js
import { redactGazetteer } from '@onderling/redaction';

const { text } = redactGazetteer('Jan spoke to Fatima.', {
  names:       ['Jan', 'Fatima'],
  placeholder: '[name]',
});
// text → '[name] spoke to [name].'
```

To run both passes in one call, put the gazetteer in the main config — structured rules run
first, then the name pass:

```js
import { redact } from '@onderling/redaction';

const { text } = redact('Call 0612345678 for Jan.', {
  rules:        [{ type: 'phone', pattern: /\b(?:\+31|06)[\d-]{8,}\b/, validate: 'nl-phone' }],
  placeholders: { phone: '[phone]' },
  gazetteer:    { names: ['Jan'], placeholder: '[name]' },
});
// text → 'Call [phone] for [name].'
```

## Limits to know

- The gazetteer is **best-effort**: unlisted names pass through, and capitalized common words
  that are also names ("Grace", "Storm") over-match. Only capitalized tokens are considered,
  so lowercase homographs survive. Treat it as risk reduction, not a guarantee.
- Patterns are data — keep your locale's ruleset in one module and reuse it at every exit
  point (message send, feedback submission, LLM prompt assembly).

Related: [`@onderling/redaction` README](../../packages/redaction/README.md).

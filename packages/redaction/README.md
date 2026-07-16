# @onderling/redaction

Config-driven text redaction: ordered regex rules, a registry of named
validators (Dutch BSN 11-check, phone, IBAN, Luhn), and an optional
gazetteer pass for names. The engine is locale-agnostic — every pattern,
placeholder, and name list is data supplied by the caller.

```
npm install @onderling/redaction
```

Zero dependencies.

## Quick start

```js
import { redact } from '@onderling/redaction';

const config = {
  rules: [
    { type: 'bsn',   pattern: /\b\d{9}\b/,                validate: 'bsn-11proef' },
    { type: 'phone', pattern: /\b(?:\+31|06)[\d\s-]{8,}/, validate: 'nl-phone' },
  ],
  placeholders: { bsn: '[id]', phone: '[phone]' },
};

const { text, hits } = redact('Call 0612345678 about BSN 123456782.', config);
// text → 'Call [phone] about BSN [id].'
// hits → [{ type: 'phone', value: '0612345678' }, { type: 'bsn', value: '123456782' }]
```

## How a rule works

Rules run in order. Each rule is
`{ type, pattern, validate?, normalize?, captureGroup?, replacement? }`:

- `pattern` — a `RegExp` (the global flag is added if missing);
- `validate` — the name of a registered validator; a regex match that fails
  validation is **left untouched** (this is what keeps a 9-digit order
  number from being redacted as a BSN);
- `replacement` — literal replacement text; falls back to
  `placeholders[type]`;
- `captureGroup` / `normalize` — validate and record a sub-group or a
  normalized form instead of the raw match.

An unknown validator name throws — misconfiguration fails loudly, not
silently.

## Validators

The registry ships with `bsn-11proef` (Dutch social-security 11-check),
`nl-phone`, `iban`, and `luhn`; the underlying functions are also exported
directly (`bsn11proef`, `nlPhone`, `iban`, `luhn`, and the `VALIDATORS`
map).

## Gazetteer pass

```js
import { redactGazetteer } from '@onderling/redaction';

const { text, hits } = redactGazetteer('Jan spoke to Fatima.', {
  names:       ['Jan', 'Fatima'],
  placeholder: '[name]',
});
// text → '[name] spoke to [name].'   hits → [{ type: 'name', value: 'Jan' }, …]
```

`redactGazetteer(text, gazetteer)` replaces name-list matches; the `gazetteer`
config is `{ names, placeholder, particles?, titlePatterns? }` — supply
your own list (e.g. participant names known to the application). Also
exported: `redactText(text, config)`, the same rule pass when you only need
the redacted string.

## Where it is used

This package is the redaction layer of Onderling's feedback pipeline
(pseudonymous community feedback), extracted so any application can run the
same pass client-side before content leaves the device.

## Status

`0.x` — pre-1.0; the API may move between minor versions. Versioned with
changesets. Source: [github.com/Onderling/basis](https://github.com/Onderling/basis)
(`packages/redaction`).

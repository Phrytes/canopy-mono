# Localisation convention — every app ships translatable

> **Status:** locked 2026-05-05; renamed from `i18n.md` 2026-05-07
> for clarity (the "i18n" numeronym is jargon).
> **Companion:** [`./app-readme-scheme.md`](./app-readme-scheme.md).
> **Applies to:** every directory under `apps/` that has a user-facing surface (UI, CLI prompts, push-notification copy).

## Why this exists

Stoop has a Dutch buurt as primary audience and English-speaking
contributors. Folio's user base is similar. Future apps will land in
the same shape. Hardcoding strings in source means every new locale
is a refactor. **Build for translation from the first commit.**

## Rules

1. **No user-facing strings in code.** Every string a user could see
   (UI label, error message, push body, email subject, CLI prompt)
   is referenced by key, not inlined.
2. **Strings live in per-app locale files.** Not in substrates, not
   in the SDK.
3. **Substrates emit error codes, never user-facing strings.** Apps
   are responsible for translating substrate error codes into
   localised text. This keeps substrates locale-agnostic.
4. **The default locale is `en`.** Every app ships at minimum `en`.
   Stoop also ships `nl` from V1.
5. **Locale files are JSON.** Flat or nested by feature; one file per
   locale per app.
6. **Locale fallback is automatic.** Missing key in `nl` → fall back
   to `en`. Missing in both → render the key + warn in dev.

## File layout (per app)

```
apps/<name>/
  locales/
    en.json          ← default; required
    nl.json          ← additional locales as needed
  src/
    lib/i18n.js      ← thin wrapper over chosen library; exposes t()
    ...
```

Locale file shape (nested by feature is recommended for any app
larger than ~50 keys):

```json
{
  "common": {
    "save":    { "text": "Save",     "doc": "Generic save button — profile, settings, post form." },
    "cancel":  { "text": "Cancel",   "doc": "Generic cancel — returns to the previous step without committing." },
    "loading": { "text": "Loading…", "doc": "Inline status while a skill is running. Trailing ellipsis is intentional." }
  },
  "prikbord": {
    "title": { "text": "Buurt", "doc": "Heading at the top of the main feed page." }
  },
  "errors": {
    "relay.unknown_recipient": {
      "text": "Couldn't find that member — they may have left the group.",
      "doc": "Shown when the relay rejects a send because the destination pubKey is unknown. Substrate code: relay.unknown_recipient."
    }
  }
}
```

### Leaf shape: `{ "text": ..., "doc": ... }` — required for every entry

Locked 2026-05-06. **Every locale entry MUST be an object with two
fields:**

- `text` — the translatable string itself.
- `doc` — a context note for translators (English): where it appears,
  what surrounding state means, what tone (warning / button / inline
  status), what placeholders mean. At minimum, name the surface
  (page / element) and its trigger.

Why this matters:

- Translators don't have the running app. A bare string `"Klaar"`
  could be "Done", "Ready", or "Finished" — the surface picks, not
  the dictionary. The `doc` field encodes the disambiguation.
- Tone signals (warning vs. confirmation vs. button label) are
  invisible in the JSON without it.
- Placeholders (`{{name}}`, `{{count}}`) need examples or the
  translator can mis-position them in flexible word orders.

The runtime resolver (`t(key)`) returns only `.text`. `doc` is
metadata for the translation pipeline only.

**Back-compat:** plain-string leaves still resolve — the runtime
unwraps either shape. Migrate opportunistically; a string-shaped
entry is a known-incomplete entry, not a broken one. **New entries
must be `{text, doc}`.**

Substrate error codes follow `<substrate>.<code>` shape (e.g.
`relay.unknown_recipient`, `pod.acl_forbidden`). Apps map these to
localised user-facing copy in their `errors.*` namespace.

## Recommended library

**`i18next`** + **`react-i18next`** (web) / **`react-i18next` with
`expo-localization`** (RN). Reasons:

- Largest ecosystem; community-maintained adapters for both runtimes.
- Built-in fallback chains, plurals, interpolation.
- Stable API; widely used.
- Does not require a build step (runtime loading of JSON works).

Apps that don't use React (CLI, Node services) can use **`i18next`
core** standalone — it doesn't depend on React.

Other libraries (Lingui, FormatJS/react-intl, Fluent) are acceptable
when an app's needs justify them — document the choice in that app's
README. **Don't add a 3rd library without rule-of-two justification.**

## Minimal `lib/i18n.js` shape

```js
// apps/<name>/src/lib/i18n.js
import i18next from 'i18next';
import en from '../../locales/en.json' assert { type: 'json' };
import nl from '../../locales/nl.json' assert { type: 'json' };

await i18next.init({
  lng: detectLocale(),         // navigator.language / Expo-localization / env
  fallbackLng: 'en',
  resources: { en: { translation: en }, nl: { translation: nl } },
  interpolation: { escapeValue: false },
});

export const t = i18next.t.bind(i18next);
```

Apps that use React render with the official hook:

```jsx
import { useTranslation } from 'react-i18next';

function PrikbordHeader() {
  const { t } = useTranslation();
  return <h1>{t('prikbord.title')}</h1>;
}
```

## Substrate-side rules

Substrates (`packages/<name>` that compose the SDK) must:

- Throw / emit errors with `code` strings (e.g. `'relay.unknown_recipient'`), **not** locale-bound message strings.
- Optionally include a `defaultMessage` field in English for developer-debug logs only — never displayed to end-users without translation.
- Document each error code in the substrate's README so app authors know what keys to provide translations for.

The SDK packages (`@canopy/{core,relay,pod-client,react-native}`)
follow the same rule: error codes, no user-facing strings.

## What's required in each app's README

Per [`app-readme-scheme.md`](./app-readme-scheme.md), every app
README's **Bring it up** section should mention the locale files and
the supported locales. A minimal addition:

```markdown
## Localisation

Strings live in `locales/<lang>.json`. Default `en`; this app also
ships: <list>. Add a locale by creating `locales/<xx>.json` and
mirroring the keys from `en.json`.
```

## Migration

Existing apps were not built with this convention. Migration is not
required to ship — but **any app that adds, renames, or changes a
user-facing string after 2026-05-05 must move it into the locale
files in the same change**. Big-bang migrations are not required;
opportunistic migration converges over time.

The same applies to the `{text, doc}` leaf shape (locked 2026-05-06):
plain-string entries keep resolving, but any entry that is added,
renamed, or edited after that date must land as `{text, doc}` —
including a useful `doc` note. Tracked in
[`../TODO-GENERAL.md`](../TODO-GENERAL.md) as a back-fill task.

New apps must ship with locale files from the first commit, in
`{text, doc}` shape.

## Terminology contract — Solid pod concept (locked 2026-05-14)

Phase 52.15.6 (Solid-auth consolidation). Across every app, the same
underlying concepts MUST use the same word so the user UX feels
unified.

| Concept | Locked EN term | Locked NL term | Rule |
|---|---|---|---|
| Solid storage / OIDC-attached pod | **Pod** | **Pod** | Same word both languages — technical term, kept in English. |
| Local identity / mnemonic recovery | **Account** | **Account** | Distinct from Pod; used only in onboarding / restore flows. |
| Ownership / privacy framing | "your data" / "jouw data" | (only as marketing copy) | NOT a substitute for "Pod" in technical contexts. |
| What we avoid (negative framing) | "third-party cloud" | "third-party cloud" | Only in privacy section, not as a synonym for Pod. |

**Banned as Pod synonyms** (will trip the audit script):
- EN: `storage`, `drive`, `cloud`, `your data` (in technical
  contexts), `vault`, `bucket`.
- NL: `opslag`, `schijf`, `cloud`, `jouw data` (in technical
  contexts), `kluis`, `bak`.

Exception: technical strings that *aren't* about the pod (e.g.
"cloud provider" in a privacy-explainer paragraph; "vault" referring
to the mnemonic vault) MAY use these words. Whether a string is
"about the pod" is judged by reading the `doc` field on the locale
entry — the audit only flags entries whose `doc` indicates a
pod-related context.

## Audit script

`scripts/audit-locales.mjs` (at the repo root) scans every
`apps/*/locales/*.json` for banned-substitution violations. Run via:

```
node scripts/audit-locales.mjs
```

Exit code 0 = clean, 1 = violations found. CI integration is open
(repo doesn't have CI yet); developers run it before locale-touching
PRs.

The script is deliberately conservative: it only flags entries whose
`text` field contains a banned synonym AND whose `doc` field
indicates a pod-related context (matches `/pod/i` in `doc`). False
positives can be silenced by editing the `doc` field to clarify the
non-pod context (e.g. "cloud provider — privacy explainer paragraph,
NOT about the Pod itself").

## Open questions

- **Server-rendered emails / push bodies in substrates.** Currently
  not a problem because substrates don't compose user-facing copy.
  If a future substrate needs to (e.g. a "send digest" channel that
  formats text), it should accept a translation function as
  dependency injection from the calling app, not embed strings.
- **Right-to-left scripts.** Not blocking V1; design when an RTL
  locale is requested.
- **Date / number formatting.** `Intl.DateTimeFormat` and
  `Intl.NumberFormat` are sufficient for V1; no library needed.

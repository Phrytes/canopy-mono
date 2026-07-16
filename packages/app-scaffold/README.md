# @onderling/app-scaffold

A pure manifest-to-app scaffolder. Give it an app manifest and a `requires`
capability list; it validates the requires against the SDK's capability
vocabulary and returns a runnable app skeleton as a map of path → content
strings. Pure code generation — nothing touches the filesystem unless you
inject a `writer`.

```
npm install @onderling/app-scaffold
```

## Quick start

```js
import { scaffoldApp } from '@onderling/app-scaffold';

const { files, warnings } = scaffoldApp({
  manifest,                      // your app's manifest (operations, surfaces)
  requires: ['core', 'high'],    // SDK capabilities the app needs
  appId: 'my-app',
});

Object.keys(files);
// → ['package.json', 'manifest.js', 'src/index.js', 'README.md']
```

The generated skeleton contains a `package.json` whose **sole dependency is
`@onderling/sdk`**, the manifest itself, and a `src/index.js` entry that
builds an agent (`createAgent`) and registers **one `wireSkill` stub per
manifest operation**. Fill in the per-operation functions and you have a
working app: every surface a manifest declares (chat, slash commands, GUI)
projects from the same operation declarations.

## Validation before generation

`requires` is checked against `@onderling/sdk/requires`
(`CAPABILITIES = ['core', 'transports', 'vault', 'pod', 'high']`). An
unknown capability throws with a stable diagnostic code from
`APP_SCAFFOLD_CODES` before anything is generated — branch on codes, not
message text:

```js
scaffoldApp({ manifest, requires: ['core', 'blockchain'], appId: 'demo' });
// → throws, err.code === 'ERR_APP_SCAFFOLD_INVALID_REQUIRES'
```

## Writing to disk

The core stays string-returning and testable; pass a `writer` to also
persist:

```js
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

scaffoldApp({
  manifest, requires: ['core'], appId: 'my-app',
  writer: (path, content) => {
    const full = join('out/my-app', path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  },
});
```

## Related packages

- `@onderling/sdk` — the generated app's single dependency; also documents
  the capability vocabulary (`@onderling/sdk/requires`).
- `@onderling/app-manifest` — authoring and validating the manifest you feed
  in.

## Status

`0.x` — pre-1.0; the API may move between minor versions. Versioned with
changesets. Source: [github.com/Onderling/basis](https://github.com/Onderling/basis)
(`packages/app-scaffold`).

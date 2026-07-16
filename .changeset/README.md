# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets). It drives
versioning + publishing of the **public `@onderling/*` platform surface** to npm.

## What publishes

Only the 12 packages that make up the published SDK surface — everything else in `packages/*`
and every app in `apps/*` carries `"private": true` and is skipped by `changeset publish`:

`@onderling/core`, `@onderling/vault`, `@onderling/transports`, `@onderling/pod-client`, `@onderling/oidc-session`,
`@onderling/redaction`, `@onderling/pseudo-pod`, `@onderling/item-types`, `@onderling/item-store`,
`@onderling/app-manifest`, `@onderling/app-scaffold`, `@onderling/sdk`.

Versioning is **independent** per package (no `fixed`/`linked`); `access` is `public`.

## Workflow

1. `pnpm changeset` — describe your change; pick the affected package(s) + bump level.
2. `pnpm changeset version` — consume changesets: bump versions, write CHANGELOGs, and rewrite the
   `workspace:^` interdeps to real ranges is done at publish time by pnpm.
3. `pnpm changeset publish` — publish the bumped packages to npm (requires `npm login` first).

The very first publish does not need a changeset: the current `0.1.x`/`0.2.x` versions are not yet on
the registry, so `changeset publish` releases them as-is.

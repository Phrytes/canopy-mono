# Conventions

Project-wide rules every contributor follows. Read the ones relevant to what you're touching **before** you
author code — several are load-bearing invariants, not style preferences.

- **[architectural-layering.md](./architectural-layering.md)** — the `apps → substrates → SDK` layering: what
  each layer owns and what is not acceptable. The core invariant.
- **[app-readme-scheme.md](./app-readme-scheme.md)** — the README scheme every app under `apps/` follows from
  its first commit (including the honest phase table).
- **[localisation.md](./localisation.md)** — every user-facing surface ships translatable from commit one;
  substrates emit error codes, not strings.
- **[cross-app-settings.md](./cross-app-settings.md)** — pod-side settings split into portable `shared.json` +
  per-install `devices/<id>.json`.
- **[cross-pod-refs.md](./cross-pod-refs.md)** — how items reference content across pods.
- **[pod-independence.md](./pod-independence.md)** — local-only mode is the floor; the pod is the portability
  layer, not a runtime dependency.
- **[single-agent.md](./single-agent.md)** — one `core.Agent` per service-context; transports are routes into
  it, not parallel agents.
- **[storage-layout.md](./storage-layout.md)** — how app data is laid out in a pod.
- **[doc-structure.md](./doc-structure.md)** — what belongs in `CLAUDE.md` vs the docs tree, and when to
  compress/enlarge `CLAUDE.md` (the rule governing this split).
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — contribution basics.

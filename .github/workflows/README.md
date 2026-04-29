# GitHub Actions — what runs when

| Workflow      | File              | Triggers                                            |
| ------------- | ----------------- | --------------------------------------------------- |
| `tests`       | `test.yml`        | every PR (any branch) + push to `master`, `track-H-folio` |

## `tests` — per-package matrix

One job per package, in parallel. `fail-fast: false` so every suite reports.

| Suite               | Required? | Notes                                                          |
| ------------------- | --------- | -------------------------------------------------------------- |
| `core`              | yes       | runs vitest with `--retry=2` for the known WebRTC timing flake |
| `pod-client`        | yes       |                                                                |
| `relay`             | yes       |                                                                |
| `react-native`      | **no**    | `continue-on-error: true` — informational until BleTransport / MdnsTransport parser failures are fixed |
| `integration-tests` | yes       | priority cross-component scenarios                             |
| `folio`             | yes       | installs first because of `file:` deps on `core` + `pod-client` |

Required jobs gate PR merges. The `react-native` job is yellow / informational.
Wall-clock target: ~6 minutes when all jobs run in parallel.

## Branch protection (manual, one-time)

Mark `core`, `pod-client`, `relay`, `integration-tests`, `folio` as required
status checks on `master` and `track-H-folio` in the GitHub repo settings.
Leave `react-native` unchecked so it can stay yellow.

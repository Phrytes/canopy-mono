# Security policy

## Supported versions

All `@onderling/*` packages are `0.x` (pre-1.0). Only the **latest minor** of each package
receives security fixes; there are no maintained older release lines.

## Reporting a vulnerability

Report vulnerabilities **privately** to **security@onderling.org**.
Do **not** open a public issue or pull request for a vulnerability.

Please include:

- the affected package(s) and version(s) (`@onderling/<name>@x.y.z`);
- a reproduction — a minimal script or test is ideal;
- your assessment of the impact (what an attacker gains, and under which conditions).

What to expect:

- an acknowledgement within **7 days**;
- a coordinated disclosure: we agree on a timeline with you, fix privately, release, and credit
  you in the release notes if you want that.

## Scope

This is a privacy-first platform: content is sealed end-to-end, data lives local-first and on
the user's own pod, and infrastructure (the relay, a pod host) is designed to be untrusted.
That makes some finding classes especially valuable to us — explicitly in scope and welcome:

- **Metadata leakage** — anything an untrusted relay, pod host, or network observer can learn
  beyond what the design admits (timing, sizes, identifiers, correlation across sessions).
- **Sealing** — flaws in the envelope crypto, group-key handling, key rotation, or anything
  that lets a non-key-holder (including the pod host) read sealed content.
- **Key handling** — vault storage, identity key material, token persistence.
- **The relay** — abuse of the WebSocket relay as an amplifier or open proxy, authentication
  bypass, or ways to make it learn message content it should never see.
- **PII in logs** — the logger is PII-safe by construction; anything that smuggles user content
  into a log record is a bug.

The repo carries an adversarial security suite (`packages/*/test/security/`, currently in
`core`, `pod-client`, and `relay`) that encodes known attack scenarios as tests. A fix for a
reported vulnerability normally lands together with a new test there, so the same hole cannot
reopen silently.

Findings in dependencies are also welcome — we will pass them upstream and mitigate here where
we can.

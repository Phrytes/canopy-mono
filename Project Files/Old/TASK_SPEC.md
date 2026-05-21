# Task: [short name]

## Goal
[1–3 sentences. What should be true when this is done that isn't true now?
Frame it as an outcome, not a set of steps. "Users can reset their password
via email" not "add a POST /reset endpoint that does X."]

## Why
[Short context. Why does this matter, what's the user/business need.
This helps Claude make good calls on the 10 small decisions you didn't specify.]

## In scope
[Specific files, modules, or surfaces that can be changed.
E.g. "src/auth/*, tests/auth/*, migrations/"]

## Out of scope
[Explicit guardrails. Things Claude should NOT touch even if it seems related.
E.g. "don't refactor the session handling — separate task."]

## Acceptance criteria
[Concrete, checkable. The more testable, the better.
- [ ] Running `pytest tests/auth/test_reset.py` passes
- [ ] A user with a valid email receives a reset link within 30s
- [ ] Invalid emails return 200 (don't leak account existence)
- [ ] Rate-limited to 3 requests per email per hour]

## Non-requirements
[Things you DON'T want, to prevent gold-plating:
- No UI work; API only
- No need to handle SSO users in this pass
- Don't add new dependencies]

## Relevant context
[Files Claude should read first, prior decisions, linked issues.
"See src/auth/login.py for the existing token pattern — follow that shape."]

## How to verify
[If there's a manual check step, describe it.
"Run the server, POST to /reset with a test email, check that Mailhog received it."]

## When to stop and ask
[Decisions you want to make yourself:
- If the existing token module needs significant refactoring to support this
- If you need to change the users table schema
- If you find a bug in unrelated code, note it but don't fix it here]

# Security TODOs

## Verified relay origin

**Status:** planned as **Group Z** in [`EXTRACTION-PLAN.md`](./EXTRACTION-PLAN.md) — see that file for the full design, implementation sketch, test checklist, and open design questions.

Summary: the `_origin` header added to RQ payloads in the 2026-04-20 session is claim-only. Group Z adds an Ed25519 signature over the canonical payload so receivers can verify the original caller. Missing/invalid signatures fall back to `envelope._from` and emit a `security-warning` event, so migration is backward-compatible.

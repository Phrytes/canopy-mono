# Security TODOs

## Verified relay origin

**Status:** design approved; implementation in **Group Z** (CODING-PLAN.md §Z2–Z5).

- Design doc: [`Design-v3/origin-signature.md`](./Design-v3/origin-signature.md) (Z1 decisions recorded 2026-04-22).
- Roadmap in [`EXTRACTION-PLAN.md §7 Group Z`](./EXTRACTION-PLAN.md) + [`CODING-PLAN.md §Group Z`](./CODING-PLAN.md).

Summary: the `_origin` header added to RQ payloads in the 2026-04-20 session is claim-only. Group Z adds an Ed25519 signature over `canonicalize({ v:1, target, skill, parts, ts })` so receivers can verify the original caller. Missing or invalid signatures downgrade `ctx.originFrom` to `envelope._from` (the relay) and emit a `security-warning` event; apps gate on a new `ctx.originVerified` flag for security-relevant decisions. Fully backward-compatible: unsigned pre-Z callers still deliver successfully, they just appear attributed to the relay.

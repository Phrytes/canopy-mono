# Klai cooperation models — a complementary partnership

Companion to `KLAI-evaluation.md` (what Klai is) and `README-mcp.md` (the integration
surface). This frames *how we cooperate* without ceding the core.

## North star: USER CONTROL, AIDED BY AI
The product is not "privacy-preserving infrastructure" (that's Klai/Shield: org-controlled
hosting + automated redaction, no data subject in the loop). It is **user-sovereign
consent with AI as the assistant** — the data subject sees their AI-cleaned message and
*approves it* before anything is released; the human stays eindredacteur, the local LLM
just makes that control scalable.

**Hard consequence — local-first is constitutive, not cosmetic.** If the assisting AI ran
remotely, raw data would leave the user's hands *before* consent, breaking control at step
one. So:
- The AI-assisted curation MUST run locally (Ollama / on-device), before any release.
- **Klai/Shield can NEVER be the primary redactor** — that would process raw data off the
  user's machine pre-consent. They are *mandated downstream* of co-redaction.
- Shield is a backstop that only ever *adds* protection (masks a residual our methods
  missed), never *substitutes* for consent — and ideally surfaces back to the user what it
  masked (control includes knowing what happened to your data).

One sentence: *the user controls their data, AI helps them do it locally before anything
leaves, and every downstream layer (Klai, Shield, the researcher room) only ever touches
what they already consented to release.*

## Why the problems differ
Ours: collection + consent + **k-anonymity + signal triage + co-redaction**, local-first
(no data leaves the box). Klai: **EU hosting, access governance, compliance logging, a
curator workspace**, and (roadmap) **Shield** — a cross-border PII-redaction proxy. The
overlap (redaction) is the commodity; the cooperation is in the complement.

```
collection (our chatbots) → user co-redaction + Solid pod   [OURS: consent + ownership]
  → local pipeline: redact · triage · k-anon · signal       [OURS: local Ollama, no border]
  → anonymised outputs (themes · signals · transparency report)
  → KLAI LAYER ───────────────────────────────────────────────
       (2b) secure GDPR access room for independent researchers   ← LEAD WITH THIS
       (2a) optional EU-Mistral exploration of the aggregates
       (1)  Shield as an independent 2nd redaction net
  → referral programme wraps the commercial side
```

## The three models (ranked by near-term value / low risk)

### 2b — Klai as the GDPR-safe researcher interface  ★ lead with this
Even with **zero LLM/prompt integration**, Klai is an EU-hosted, access-controlled,
audit-logged, multi-tenant environment — the "secure data room" between our pipeline
and the afnemers / independent researchers (pipeline step 6, curatie/rapportage). We
upload only **anonymised aggregates**; Klai governs *who sees what* and logs it.
- **Why it fits:** offloads compliance-hosting + access governance we'd otherwise build;
  their Shield compliance-trail/score feature maps onto our transparency requirement.
- **Risk:** low. Works regardless of whether Shield or MCP ever ship.

### 2a — Upload aggregates → (Shield) → EU-Mistral exploration
Our k-anon/triage/stats files live in Klai Knowledge; a researcher explores them via
Klai's EU Mistral.
- **Design constraint — mosaic re-identification:** k-anonymity protects each theme in
  isolation, but free-form LLM Q&A across many aggregates can *recombine* them into a
  re-identification. Shield won't catch this (it redacts PII *tokens*, not *inferences*).
  Mitigation = Klai's access control + audit + trusted-researcher scoping. The LLM layer
  is safe *because of* Klai's governance, not in spite of it.
- **Push vs pull:** upload (this model) persists a copy in Klai and works **today** via
  Knowledge; the MCP route (`README-mcp.md`) persists nothing but needs Klai to whitelist
  a custom server. They can coexist.

### 1 — Shield as a defense-in-depth second redaction net
An **independent** redaction layer (different infra, different detector) catches what our
floors + co-redaction miss — and the misses are real (the civic run leaked relational
names until patched). Double-certification across an org boundary = stronger posture.
- **Caveat A:** Shield is unbuilt and explicitly lacks **Dutch PII detection** — the exact
  gap where our misses live. Keep our floors as the guarantee; Shield is the last net.
- **Caveat B:** Klai's engine is EU Mistral → no border crossing, so Shield is "extra
  redaction," not a compliance gate, unless a researcher uses a US model.

## What stays ours (the moat — do not contribute for free)
- **User control, aided by AI** (the north star above) — local-first AI-assisted consent;
  Klai's model is org/hosting control, structurally not subject control.
- Local-first (no cross-border, not even sanitised) + **Solid-pod ownership** + **user
  co-redaction** (subject holds and approves their own data — Klai structurally can't).
- **k-anonymity + signal-triage governance** (auditable policy, domain-tuned floors).
- **Dutch PII detection** (BSN 11-proef, obfuscated-email, name/honorific/relational
  floors, dossier/zaaknummer, keep-orgs category policy) — precisely what Klai says it
  lacks. Hold as leverage in the partner talk.

## Commercial wrapper
Klai's **partner programme is referral-only** (bring a client → share of their first 12
months; client stays Klai's; no reseller obligations). Good easy monetisation given the
consultant / privacy-officer positioning — but it is NOT the technical/OEM integration
the layered architecture above needs. Treat them as two separate conversations:
1. **Referral** (their programme, today).
2. **Technical integration** (2b → 2a → 1, custom — needs Knowledge access, later MCP
   whitelist, later Shield).

## One question to put to Klai
"Is Shield record-level redaction only, or do you intend cross-record disclosure
control?" — record-level ⇒ partner; cross-record ⇒ they're entering our core.

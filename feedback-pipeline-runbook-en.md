# Feedback pipeline — deployment runbook (Tier 3)

*The infra-as-code lives in `apps/feedback-pipeline/deploy/`. This runbook is the operator
sequence. Companion to the architecture / build-proposal / TODO docs.*

What this stack stands up (architecture §1, §3):

- **CSS** — Community Solid Server (ACP config) hosting the project + participant pods.
- **privatemode-proxy** — the TEE LLM route (OpenAI-compatible, attestation per request).
- **activation** — the activation service: cohort code → ACP-locked participant container.
- **Caddy** — TLS + reverse proxy for the public hostnames.

> Status: the activation service and the pod/ACP layer are **built and tested** (see
> `npm test`, the live-CSS smokes, and the Tier-1 e2e). The compose stack + this runbook are
> infra-as-code — verified by config and local boot, not by a live cloud deploy. Privatemode
> needs an Edgeless account/key (not bundled).

## 0. Prerequisites

- A host with Docker + Docker Compose, and DNS for two names → that host:
  `PODS_HOST` (pods) and `ACTIVATE_HOST` (activation).
- A Privatemode (Edgeless) account + project key.

## 0b. Local test on a laptop (no VPS / DNS / TLS)

To exercise the whole flow first, run it on your machine. CSS + the proxy go in Docker on
localhost; the activation service + bots run as host `node` processes (one hostname →
`http://localhost:3000`, so Solid's absolute URIs line up). No Caddy.

```bash
# 0. one-time: the server-side CSS auth lib the activation service + TG bot need
cd apps/feedback-pipeline && npm i @inrupt/solid-client-authn-core

# 1. CSS (:3000) + privatemode-proxy (:8080)
PRIVATEMODE_API_KEY=<key> docker compose -f deploy/docker-compose.dev.yml up -d

# 2. project-pod owner → paste the printed FP_OWNER_* / FP_PROJECT_POD into your shell/env
CSS_URL=http://localhost:3000 node scripts/bootstrap-owner.js

# 3. confirm the LLM route
FP_LLM_BASEURL=http://localhost:8080/v1 FP_MODEL=kimi-k2.6 npm run llm-health
```

(No cohort codes needed for the Telegram path below — the bot provisions on first contact.
Codes are only for the canopy-chat `/feedback <code>` flow, set up at the end of this section.)

> **`permission denied … /var/run/docker.sock`?** Your shell session predates your `docker`
> group membership (you're in the group, the session hasn't picked it up). Run `newgrp docker`
> in that terminal and retry, or log out/in once to fix it everywhere (`id | grep docker` to
> check). Or prefix the command with `sudo`.
>
> **`Pod creation failed: There already is a resource …`?** The CSS volume kept a previous
> run's pod. Either reset it — `docker compose -f deploy/docker-compose.dev.yml down -v` then
> `up -d` — or bootstrap a different name (`POD_NAME=project2 …`) and use that in `FP_PROJECT_POD`.

Then test a **surface** — easiest is **Telegram** (long-polling needs no public URL):

```bash
FP_TG_BOT_TOKEN=<@BotFather token> \
CSS_URL=http://localhost:3000 \
FP_OWNER_CLIENT_ID=… FP_OWNER_CLIENT_SECRET=… FP_OWNER_WEBID=… FP_PROJECT_POD=http://localhost:3000/project/ \
FP_LLM_BASEURL=http://localhost:8080/v1 FP_LLM_APIKEY=<key> FP_MODEL=kimi-k2.6 FP_THINKING_LABEL=off \
npm run tg-bot-smoke
```

DM the bot → it floors + cleans (real Privatemode model) → `/klaar` → tap a consent button →
the contribution lands in your local pod. (Or skip surfaces entirely and just run
`node scripts/e2e-smoke.js` against the local CSS for the backbone, or `npm run curator-smoke`.)

The browser surface (canopy-chat) also works locally, but needs **cohort codes** + the
**activation service** (and the browser pod-login is fiddlier than TG — start with TG):

```bash
# cohort codes (create-project reads the projectId from a config JSON; k lives there)
cp deploy/project.example.json deploy/project.json    # edit if you like
npm run cohort -- create-project --config deploy/project.json --expires 2026-12-31T00:00:00Z --ceiling 50 --store deploy/cohort-store.json
npm run cohort -- generate-codes --project test --count 20 --store deploy/cohort-store.json

# activation service (host, :8787) — needs the owner creds from step 2
CSS_URL=http://localhost:3000 FP_OWNER_CLIENT_ID=… FP_OWNER_CLIENT_SECRET=… FP_OWNER_WEBID=… \
  FP_PROJECT_POD=http://localhost:3000/project/ npm run activation-service
```

Then build canopy-chat with `VITE_FEEDBACK_ACTIVATION_URL=http://localhost:8787`
`VITE_FEEDBACK_LLM_BASEURL=http://localhost:8080/v1` `VITE_FEEDBACK_PROJECT_ID=test npm run build`,
serve it, log into the `http://localhost:3000` pod, and `/feedback <code>`.

## 1. Configure

```bash
cd apps/feedback-pipeline/deploy
cp .env.example .env      # fill in hostnames, PRIVATEMODE_API_KEY, owner creds (step 3)
```

Images in `docker-compose.yml` are pinned by `@sha256` digest. The `privatemode-proxy`
`:latest` digest drifts — re-vet + re-pin it when you update.

## 2. Boot CSS

```bash
docker compose --env-file .env up -d css caddy
```

CSS is now at `https://${PODS_HOST}/`.

## 3. Bootstrap the project-pod owner (once)

The activation service acts as the **project-pod owner** (the intermediary/steward). Run the
bootstrap script — it creates the account + pod + client-credentials and prints the `.env` lines:

```bash
cd apps/feedback-pipeline && CSS_URL=https://${PODS_HOST} node scripts/bootstrap-owner.js
```

Paste its output (`FP_OWNER_CLIENT_ID` / `FP_OWNER_CLIENT_SECRET` / `FP_OWNER_WEBID` /
`FP_PROJECT_POD`) into `deploy/.env`.

## 4. Create the project + cohort codes

```bash
cd apps/feedback-pipeline
npm run cohort -- create-project --project buurt-oost --k 4 --store deploy/cohort-store.json
npm run cohort -- generate-codes --project buurt-oost --n 50 --store deploy/cohort-store.json
```

Mount that store into the activation container (compose maps `FP_COHORT_STORE=/data/...`).

## 5. Start the activation service + the LLM route

```bash
cd apps/feedback-pipeline/deploy
docker compose --env-file .env up -d privatemode-proxy activation
```

- The activation service: `POST https://${ACTIVATE_HOST}/activate`
  `{ projectId, code, recoveryHash, webId }` → `{ ok, podRef }` (a fresh ACP-locked
  container; the participant's WebID gets write/delete, the owner read/control).
- The LLM route is now `http://privatemode-proxy:8080/v1`. Point every pipeline component at
  it: `FP_LLM_BASEURL=http://privatemode-proxy:8080/v1`, `FP_LLM_APIKEY=<project key>`
  (Tier-3d — no app code change; in the browser, inject it via `setLlmRoute`).

Before pointing the pipeline at the LLM route, verify it answers:

```bash
cd apps/feedback-pipeline
FP_LLM_BASEURL=http://localhost:8080/v1 FP_LLM_APIKEY=<key> FP_LLM_MODEL=<model> npm run llm-health
```

## 6. Participant-pod wiring (Tier 3c — the capstone)

Once 1–5 run, swap each surface's in-memory pod for the real, ACP-locked one. The helper
`makeCssCentralPod({ podBase, authedFetch | {cssUrl,clientId,clientSecret} })` builds it; the
`CssCentralPod` + ACP path is already proven (Tier-1 e2e + the offline wiring test).

- **Telegram bot service** (post-receipt) — the bot writes on participants' behalf, so give
  the bot a writer role: provision containers with `FP_WRITER_WEBIDS=<bot WebID>` (the
  activation service passes it into the ACP), and run the bot with `CSS_URL` +
  `FP_PROJECT_POD` + `FP_BOT_CLIENT_ID/SECRET` set — `scripts/tg-bot-smoke.js` then builds a
  `CssCentralPod` automatically instead of in-memory.
- **canopy-chat** (pre-send) — the participant writes themselves: they activate (get
  `podRef`), authenticate with `@inrupt/solid-client-authn-browser` (keys from `@canopy/vault`),
  and the feedback surface is constructed with
  `pod: await makeCssCentralPod({ podBase: podRef, authedFetch: browserFetch })` and
  `llmRoute` = the privatemode-proxy. (The surface already accepts `pod`; this is the runtime
  auth wiring done in the polish pass.)

## 7. Aggregation + curator (scheduled)

Run Task 2 + the curator release as a periodic job (cron/container) reading the project pod
with the owner fetch: `aggregateForProject(await pod.forAggregation(), config, {skipClean:true})`
→ `createCuratorWorkspace(...)` → review → `release({ now })`. The release marks included
contributions in the pod and emits the manifest + transparency report.

## 8. Backups (Tier 3d)

Backups run as a **compose sidecar** (`backup` service) — multi-target restic, one encrypted
snapshot per configured target (e.g. two providers, for redundancy), on a schedule. Configure
targets by copying the examples (real files are git-ignored):

```bash
cd apps/feedback-pipeline/deploy/backup-targets
cp primary.env.example primary.env       # e.g. S3 (EU)
cp secondary.env.example secondary.env   # e.g. Backblaze B2 — a DIFFERENT provider
# fill in RESTIC_REPOSITORY / RESTIC_PASSWORD / provider creds in each
docker compose --env-file ../.env up -d backup
```

Each run does `init` (first time) → `backup` → `forget --prune` → **`check`** (integrity).
Operate it directly too:

```bash
sh deploy/backup.sh snapshots                      # list per target
sh deploy/backup.sh check                          # verify every repo
sh deploy/backup.sh restore <target> latest <dir>  # restore one target
```

(The script also works as a plain host cron — set `CSS_DATA`/`ACTIVATION_DATA` to the volume
paths, or `RESTIC_REPOSITORY`/`RESTIC_PASSWORD` for a single ambient target.) Verified
end-to-end (backup → prune → check → restore) against local repos.

Recovery codes are client-side; the pod data + the amnesic recovery-hash↔pod-ref records are
what the backup protects.

## What is NOT in this stack (by design)

- Raw, pre-consent message text — it never leaves the participant's device/pod; the central
  pod holds only consented, cleaned contributions.
- Identities — the activation records are amnesic (recovery-hash ↔ pod-ref only).

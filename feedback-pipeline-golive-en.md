# Feedback pipeline — go-live instructions (what's needed to run the whole thing)

Everything required to take the built + tested pipeline to a running production deployment:
the inputs to obtain, the steps to run, and the config to flip. Grounded in
`apps/feedback-pipeline/deploy/` and the scripts; companion to `feedback-pipeline-runbook-en.md`
(operator sequence) and `feedback-pipeline-todo-en.md` (build status).

Legend: **[obtain]** = something you provide/buy/register · **[run]** = a command ·
**[decide]** = a per-project choice.

---

## 0. Decisions to make per project   [decide]

These go into the project's `ProjectConfig` (zod-validated; see
`src/config/project-config.js`) and the cohort spec:

- **LLM route** — `privatemode` (TEE, recommended) / `ovh` / `within-walls` / `local`.
- **k-anonymity threshold** — how many distinct participants a theme needs before it can
  surface (e.g. 4). Lower = more themes shown, weaker anonymity.
- **Below-threshold policy** — `drop` / `quarantine` (default; never silently drop) /
  `rephrase`.
- **Escalation categories** — which signal categories (e.g. `crisis`, `integrity`) route to a
  human, and **to whom** (the destinations — D3/D4 in the ethics doc).
- **Language** — `nl` or `en` (the whole participant surface follows this).
- **Review mode** — `notification` or `required-approval`.

---

## 1. Things to obtain   [obtain]

| #   | Item                                                                                                                 | Where                                     | Used for                   |
| --- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------- |
| 1   | A **VPS** (2 vCPU / 4 GB+, EU region), Docker + Compose installed                                                    | any EU host                               | runs the whole stack       |
| 2   | **Two DNS names** → the VPS IP: `PODS_HOST` (pods) and `ACTIVATE_HOST` (activation)                                  | your registrar                            | Caddy TLS + routing        |
| 3   | A **Privatemode account + project API key**                                                                          | Edgeless (getprivatemode / edgelesssys)   | the TEE LLM route          |
| 4   | The **`privatemode-proxy` image digest** (`@sha256:…`) you vet                                                       | the image registry                        | pinning the proxy          |
| 5   | **One or more restic targets** + repo passwords (e.g. an EU S3 bucket; a 2nd on a different provider for redundancy) | any restic backend (s3/b2/gs/azure/sftp…) | encrypted off-host backups |
| 6   | (Telegram surface) a **bot token** from @BotFather                                                                   | Telegram                                  | the TG channel             |
| 7   | (optional) a **container registry** to build/push the activation image                                               | your choice                               | if not building on the VPS |

You do **not** need: an LLM GPU (Privatemode hosts it), per-participant identities (generated
client-side), or any raw-data store (raw never leaves the device/pod).

---

## 2. Provision the host   [run]

```bash
# on the VPS
git clone <this repo> && cd canopy-mono/apps/feedback-pipeline/deploy
cp .env.example .env
```

Fill `.env`:

```ini
PODS_HOST=pods.yourdomain.org
ACTIVATE_HOST=activate.yourdomain.org
PRIVATEMODE_API_KEY=<item 3>
# owner creds are filled in step 4 (after CSS is up)
FP_OWNER_CLIENT_ID=
FP_OWNER_CLIENT_SECRET=
FP_OWNER_WEBID=https://pods.yourdomain.org/project/profile/card#me
FP_PROJECT_POD=https://pods.yourdomain.org/project/
```

Pin the proxy in `docker-compose.yml`: replace
`ghcr.io/edgelesssys/privatemode-proxy:latest` with `…/privatemode-proxy@sha256:<item 4>`.

Point DNS (item 2) at the VPS, then:

```bash
docker compose --env-file .env up -d css caddy   # CSS + TLS first
```

---

## 3. Bootstrap the project-pod owner   [run]   (once)

The activation service acts as the project-pod **owner** (the steward). Easiest — run the
bootstrap script, which creates the account + pod + client-credentials and prints the `.env`
lines:

```bash
cd apps/feedback-pipeline
CSS_URL=https://${PODS_HOST} node scripts/bootstrap-owner.js   # → FP_OWNER_CLIENT_ID/SECRET/WEBID + FP_PROJECT_POD
```

Paste its output into `deploy/.env`. (Or do it by hand via the CSS web UI at
`https://${PODS_HOST}/.account/` + the "client credentials" control.)

---

## 4. Create the project + cohort codes   [run]

```bash
cd ..                                   # apps/feedback-pipeline
npm run cohort -- create-project --project buurt-oost --k 4 --store deploy/cohort-store.json
npm run cohort -- generate-codes --project buurt-oost --n 100 --store deploy/cohort-store.json
```

The codes are what participants enter. The store is mounted into the activation container.

---

## 5. Start the LLM route + activation service   [run]

```bash
cd deploy
docker compose --env-file .env up -d privatemode-proxy activation
```

Verify the route answers (item 3 in place):

```bash
cd .. && FP_LLM_BASEURL=http://localhost:8080/v1 FP_LLM_APIKEY=$PRIVATEMODE_API_KEY \
  FP_LLM_MODEL=<the model you chose> npm run llm-health        # expect: OK (…ms)
```

Activation is now live at `https://${ACTIVATE_HOST}/activate`.

---

## 6. Wire the participant surfaces

### canopy-chat (in-browser, pre-send)   [set env → build]

Config is via **Vite env** (no source edits) — set at build time:

```bash
cd apps/canopy-chat
VITE_FEEDBACK_LLM_BASEURL='https://<llm route>/v1' \
VITE_FEEDBACK_ACTIVATION_URL='https://activate.yourdomain.org' \
VITE_FEEDBACK_PROJECT_ID='buurt-oost' \
npm run build
```

A participant then: logs in to their pod → types `/feedback <code>` → their ACP-locked
container is provisioned and the bot writes there with their browser keys.

> Note: the browser needs to reach the LLM route. Either expose the proxy on an HTTPS origin
> with CORS, or front it with a same-origin path. (Don't ship the Privatemode key in the
> browser bundle — use a thin same-origin relay that injects it, or a per-session token.)

### Telegram (server-side, post-receipt)   [obtain → run]

The TG bot service runs **as the project-pod owner** — it provisions each participant's ACP
container on first contact (onActivate) and writes to it:

```bash
cd apps/feedback-pipeline
FP_TG_BOT_TOKEN=<item 6> \
CSS_URL=https://pods.yourdomain.org FP_PROJECT_POD=https://pods.yourdomain.org/project/ \
FP_OWNER_CLIENT_ID=… FP_OWNER_CLIENT_SECRET=… FP_OWNER_WEBID=https://pods.yourdomain.org/project/profile/card#me \
FP_LLM_BASEURL=http://localhost:8080/v1 FP_LLM_APIKEY=$PRIVATEMODE_API_KEY FP_LLM_MODEL=<model> \
npm run tg-bot-smoke
```

(Run it as a long-lived service — a small compose service or systemd unit — not a smoke, for
production.)

---

## 7. Scheduled aggregation + curator release   [run]   (periodic)

Run Task 2 + the curator on a schedule (cron/container), reading the project pod with the
owner fetch:

```
aggregateForProject(await pod.forAggregation(), config, { skipClean:true })
  → createCuratorWorkspace({ aggregate, pod, reportId })
  → review() → (curator decisions) → release({ now })
```

Release marks included contributions in the pod (blocks withdrawal), emits the manifest +
the transparency report. `npm run curator-smoke` shows the shape end-to-end.

---

## 8. Backups   [obtain → run]

Multi-target restic runs as the `backup` compose sidecar. For each target you want (one is
enough; two different providers gives redundancy), copy an example and fill it in:

```bash
cd apps/feedback-pipeline/deploy/backup-targets
cp primary.env.example   primary.env     # e.g. S3 (EU)        — item 5
cp secondary.env.example secondary.env   # e.g. Backblaze B2   — a different provider (optional)
cd .. && docker compose --env-file .env up -d backup
```

Each scheduled run does init → backup → prune → **check** per target. Verify / restore any
time:

```bash
sh deploy/backup.sh snapshots
sh deploy/backup.sh check
sh deploy/backup.sh restore primary latest /tmp/restore-test   # drill the restore!
```

It backs up the CSS pod data + the cohort store, encrypted client-side. Recovery codes are
client-side and are deliberately **not** in the backup. (Tested end-to-end against local
repos; you supply the real targets in item 5.)

---

## 9. Remaining wiring

- **Per-participant provisioning for Telegram — DONE.** The TG bot now auto-provisions
  `central/<pseudonym>/` on a chat's first message (the `onActivate` hook → `provisionCssPod`);
  the bot service runs as the project-pod owner (provisions + writes). No manual pre-provisioning.
- **canopy-chat LLM relay — your call (ops).** Decide how the browser reaches the LLM without
  holding the Privatemode key (a same-origin relay that injects the key, or a per-session token).

---

## 10. Verify the whole chain   [run]

- `npm test` (both apps) — the full unit/integration suite is green.
- `npm run llm-health` — the route answers.
- The live-CSS smokes (`scripts/e2e-smoke.js`, `css-acp-smoke.js`) against your CSS — prove
  activation → ACP-locked write → aggregation, and that consent-as-write is enforced.
- A real `/feedback <code>` in canopy-chat → check the contribution lands in the participant's
  pod container, and the curator job produces a report + transparency counters.

---

## What to hand me if you want me to do parts

To wire/verify against your environment I'd need: the `CSS_URL` + owner client id/secret (or
let me bootstrap them), the `ACTIVATE_HOST`/`PODS_HOST`, the Privatemode base URL + key (for a
`llm-health` check), and the TG bot token (for the TG service). I can then run the smokes
against the live stack, finish the §9 TG provisioning wiring, and set the canopy-chat
constants. I cannot register the accounts, buy the VPS, or obtain the Privatemode/restic
credentials for you — those are items 1–7.

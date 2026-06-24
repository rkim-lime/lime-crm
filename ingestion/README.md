# Lime CRM — Ingestion Service

Standalone Node.js service that ingests SEC filings (13F, Form ADV) and writes
prospect data into Supabase.

## Requirements

- Node 20+
- A Supabase project with migrations 010–016 applied

## Setup

```bash
cd ingestion
npm install
cp .env.example .env
# Edit .env with your real values
```

### Environment variables

| Variable               | Required | Default | Description                                                  |
|------------------------|----------|---------|--------------------------------------------------------------|
| `SUPABASE_URL`         | ✓        | —       | Supabase project URL                                        |
| `SUPABASE_SERVICE_KEY` | ✓        | —       | service_role key — bypasses RLS; **never commit or expose** |
| `SEC_USER_AGENT`       | ✓        | —       | `AppName/1.0 (contact@you.com)` — required by SEC EDGAR     |
| `WORKER_POLL_MS`       |          | `10000` | Poll interval in poll mode (ms)                             |
| `WORKER_MODE`          |          | `poll`  | Set to `once` for CI/GitHub Actions mode                    |
| `FAIL_ON_JOB_ERROR`    |          | `false` | Set to `true` to exit 1 if any job fails (CI use)           |

---

## Run modes

### 1 — Local poll mode (default, for manual use)

```bash
npm run worker
```

Polls the `job_runs` queue forever. Your laptop must stay on. For local
development and manual ad-hoc runs.

Behaviour:
1. Resets any runs stuck in `running` from a previously crashed worker.
2. Starts the scheduler in-process — checks `job_schedules` every 60 s.
3. Polls every `WORKER_POLL_MS` (default 10 s) for the oldest queued run.
4. Atomically claims and executes each run.
5. Streams progress to `job_runs.log` + `job_runs.stats` every 5 s.
6. On `SIGINT`/`SIGTERM`: resets in-flight run back to `queued` before exiting.

### 2 — Once mode (for GitHub Actions / CI)

```bash
npm run worker:once
```

Drains the queue once and exits. Used by the GitHub Actions scheduled workflow.

Behaviour:
1. Resets stale runs (same as poll mode).
2. Runs **one scheduler pass** — enqueues any `job_schedules` whose
   `next_run_at <= now()`. This is what lets daily Actions invocations handle
   monthly/quarterly schedules correctly: jobs are only enqueued on their
   actual due date, not every day.
3. Processes every queued run sequentially until the queue is empty.
4. Exits 0. If `FAIL_ON_JOB_ERROR=true` and any run failed, exits 1.

### 3 — Autonomous (GitHub Actions)

See **GitHub Actions** section below. The `.github/workflows/ingestion-worker.yml`
workflow runs `npm run worker:once` daily at 07:00 UTC. No laptop needed.

---

## One-shot commands

```bash
npm run ingest:13f           # ingest up to 50 recent 13F filers (bypasses queue)
npm run ingest:13f:test      # ingest 5 filers (smoke test)
```

---

## ADV bulk-URL resolution

Form ADV bulk files are published at:
```
https://reports.adviserinfo.sec.gov/reports/CompilationReports/IA_FIRM_SEC_Feed_<MM_DD_YYYY>.xml.gz
```

The SEC does not publish a machine-readable file index. The connector resolves
the URL using two strategies:

**Manual override (always wins):**
If `advBulkUrl` is set in the job's config (saved in the definition or provided
via the Run Now modal), that URL is used directly. This is the path for local
manual runs.

**Auto-resolve (scheduled / autonomous runs):**
If `advBulkUrl` is absent, the connector walks backwards from today up to 14
days, sending a HEAD request for each candidate filename. The first URL that
returns HTTP 200 is used. The most recent file is typically 1–7 days old.

```
ADV: auto-resolving bulk URL (probing last 14 days)
ADV probe [1/14]: HEAD https://.../IA_FIRM_SEC_Feed_06_24_2026.xml.gz  → 404
ADV probe [2/14]: HEAD https://.../IA_FIRM_SEC_Feed_06_23_2026.xml.gz  → 200
ADV: resolved bulk URL (published 1 day ago): https://...
```

If no URL resolves within 14 days, the run fails with a clear error listing
every URL attempted, so you can investigate and set `advBulkUrl` manually.

---

## GitHub Actions

### How it works

The workflow at `.github/workflows/ingestion-worker.yml`:
- Runs **daily at 07:00 UTC** (3:00 AM ET — well off market hours).
- Can also be triggered manually from the GitHub Actions UI (`workflow_dispatch`).
- Has **no `push` trigger** — pushing code never runs a job (see Deploy Safety).
- Concurrency group prevents two runs from overlapping.

### Required GitHub repository secrets

Set these in **Settings → Secrets and variables → Actions → New repository secret**:

| Secret name            | Value to set                                         |
|------------------------|------------------------------------------------------|
| `SUPABASE_URL`         | Your Supabase project URL (from Supabase dashboard)  |
| `SUPABASE_SERVICE_KEY` | The `service_role` key (Project Settings → API)      |
| `SEC_USER_AGENT`       | `YourApp/1.0 (contact@yourdomain.com)`               |

> **IMPORTANT:** Secrets must be set **before the first scheduled run**. Without
> them the workflow fails immediately on startup with a missing-credentials error.
> Verify by triggering a manual `workflow_dispatch` run first.

### Testing before relying on the schedule

1. Set the three secrets above in GitHub.
2. Go to **Actions → Ingestion Worker → Run workflow → Run workflow**.
3. Watch the logs — confirm: worker starts, scheduler pass runs, any queued jobs
   are processed, exits 0.
4. Once manual dispatch works cleanly, the daily schedule takes over.

### Deploy safety

**Deploys never trigger ingestion runs.** The workflow has no `push` trigger.

Pushing code to `main`:
- Deploys the frontend via Vercel's Git integration.
- Does **not** start the worker or run any job.

The next scheduled GitHub Actions run checks out the latest `main` automatically,
so new connector code is picked up on the next daily tick. There is no always-on
worker that could be interrupted mid-job by a deploy.

---

## Scheduling a job

1. Create a job definition in the Data Pipelines UI.
2. Add a schedule via the "Schedule" button.
3. In poll mode: the in-process scheduler picks it up within 60 s.
4. In once/Actions mode: the next daily run enqueues it if `next_run_at <= now()`.

The scheduler warns (but does not block) if a run falls within US market hours
(9:30 AM – 4:00 PM ET). Prefer off-hours scheduling.

---

## Job definition config

### 13F config

| Key          | Type     | Default | Description                                        |
|--------------|----------|---------|----------------------------------------------------|
| `limit`      | integer  | 50      | Max 13F filers to process per run                  |
| `minAum`     | number   | null    | Skip filers with computed AUM below this (USD)     |
| `filerTypes` | string[] | null    | Restrict to specific `inferred_segment` values     |

### ADV config

| Key          | Type    | Default | Description                                                      |
|--------------|---------|---------|------------------------------------------------------------------|
| `limit`      | integer | 50      | Max ADV filers to process per run                                |
| `minAum`     | number  | null    | Skip advisers with AUM below this; null AUM (private funds) pass |
| `advBulkUrl` | string  | null    | Direct .gz URL; auto-resolved via HEAD probes if absent          |

---

## Architecture

```
src/
  index.js                    — CLI entry point (ingest-13f | worker | worker --once)
  config.js                   — loads .env, validates required vars
  supabaseClient.js           — Supabase client with service_role key
  connectors/
    types.js                  — JSDoc typedefs: FirmSignal, Connector, ConnectorContext
    registry.js               — connector registry (Map + register/get/list)
    index.js                  — imports and registers all connectors at startup
    _shared/
      edgarClient.js          — EDGAR HTTP client (shared across SEC connectors)
    ingest_13f/
      index.js                — 13F connector: discover, fetch quarters, normalize
      parse13F.js             — 13F XML → structured holdings
    ingest_adv/
      index.js                — ADV connector: streaming .gz XML, Q-code fields
      resolveBulkUrl.js       — auto-resolves current IAPD bulk URL via HEAD probes
  engine/
    runConnector.js           — discover → fetch → normalize → resolve → write pipeline
    resolveFirm.js            — 5-step dedup: CIK/CRD match → fuzzy name → new
    computeSignals.js         — AUM, turnover, asset mix, segment, ICP filter
    fitScore.js               — loads scoring weights from DB, computes fit score
    writers.js                — DB write helpers
  worker/
    worker.js                 — poll loop + once mode, job claiming, graceful shutdown
    scheduler.js              — checks job_schedules, enqueues due runs, advances next_run_at
  utils/
    logger.js                 — timestamped console logger
```

## Rate limiting

120 ms between EDGAR requests (~8 req/s). ADV URL probes use 250 ms inter-request
delay. Automatic exponential backoff on 429/503.

## Idempotency

- 13F prospects upserted on `(cik, source)`; ADV on `(crd_number, source)`
- `resolveFirm` routes returning firms to their existing Account or Prospect
- Filings skipped if `accession_no` already exists
- Fit score history appended on every run (cumulative)
- `dedup_queue` rows guarded against duplicates

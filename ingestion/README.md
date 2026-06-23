# Lime CRM — Ingestion Service

Standalone Node.js service that ingests SEC 13F filings and writes prospect data into Supabase.

## Requirements

- Node 18+ (uses native `fetch`)
- A Supabase project with migrations 010–015 applied

## Setup

```bash
cd ingestion
npm install
cp .env.example .env
# Edit .env with your real values
```

### Environment variables

| Variable               | Default  | Description                                                    |
|------------------------|----------|----------------------------------------------------------------|
| `SUPABASE_URL`         | —        | Your Supabase project URL (required)                          |
| `SUPABASE_SERVICE_KEY` | —        | service_role key — bypasses RLS; **never commit or expose**   |
| `SEC_USER_AGENT`       | —        | `AppName/1.0 (contact@you.com)` — required by SEC EDGAR       |
| `WORKER_POLL_MS`       | `10000`  | How often the worker polls for new jobs (ms)                  |

## Commands

### One-shot runs

```bash
npm run ingest:13f           # ingest up to 50 recent 13F filers
npm run ingest:13f:test      # ingest 5 filers (smoke test)

# Custom options
node src/index.js ingest-13f --limit 20
```

### Worker mode (long-running, polls job queue)

```bash
npm run worker
# or
node src/index.js worker
```

The worker connects to the `job_runs` table in Supabase and:

1. On startup, resets any `running` jobs stuck from a previous crashed worker
   (claimed more than 1 hour ago) back to `queued`.
2. Starts the **scheduler** in-process — checks `job_schedules` every 60 seconds
   and enqueues new `job_runs` rows when `next_run_at <= now()`.
3. Polls every `WORKER_POLL_MS` (default 10 s) for the oldest `queued` run.
4. **Atomically claims** the run: `UPDATE … WHERE status='queued'` — the status
   check in the WHERE clause prevents two workers from executing the same job.
5. Executes the appropriate pipeline (currently `ingest_13f`).
6. Streams live progress to `job_runs.log` and `job_runs.stats` every 5 seconds.
7. Marks the run `completed` (with final stats) or `failed` (with error message).
8. On `SIGINT`/`SIGTERM`: if mid-job, resets the run back to `queued` before exiting.

**For now the worker runs locally** — your machine must be on for jobs to execute.
It can be deployed to Railway, Render, or Fly.io unchanged — no web server needed,
just `node src/index.js worker` as the start command.

## Scheduling a job

1. Insert a `job_definitions` row (or use the seeded "13F — Standard Batch" one).
2. Insert a `job_schedules` row pointing at the definition with `next_run_at` set:

```sql
INSERT INTO job_schedules (job_definition_id, schedule_type, recurrence,
  hour_of_day, minute_of_hour, timezone, is_active, next_run_at)
VALUES (
  '<definition-id>',
  'preset', 'daily', 2, 0,             -- every day at 2:00 AM ET
  'America/New_York', true,
  (now() AT TIME ZONE 'America/New_York')::date + interval '1 day 2 hours'
);
```

3. Start the worker — the scheduler will pick it up at the next minute tick.

The scheduler warns (but does not block) if a scheduled run falls within US
market hours (9:30 AM – 4:00 PM ET). Prefer off-hours scheduling to reduce
load on SEC EDGAR servers.

## Job definition config

The `config` JSONB column is passed directly to the pipeline:

| Key          | Type     | Default | Description                              |
|--------------|----------|---------|------------------------------------------|
| `limit`      | integer  | 50      | Max number of 13F filers to process      |
| `minAum`     | number   | null    | Skip filers whose computed AUM < this    |
| `filerTypes` | string[] | null    | Restrict to specific `inferred_segment` values |
| `sortBy`     | string   | null    | Reserved for future use                  |

Example:
```json
{ "limit": 200, "minAum": 500000000, "filerTypes": ["hedge_fund", "quant_fund"] }
```

## Architecture

```
src/
  index.js              — CLI entry point (ingest-13f | worker)
  config.js             — loads .env, validates required vars
  supabaseClient.js     — Supabase client with service_role key
  sec/
    edgarClient.js      — EDGAR API: search, submissions, filing docs
    parse13F.js         — 13F XML → structured holdings
  pipeline/
    ingest13F.js        — orchestrates: resolve → fetch → parse → upsert → score
    computeSignals.js   — AUM, turnover, asset mix, segment, ICP filter
    fitScore.js         — loads weights from DB, computes prospect_fit score
    resolveFirm.js      — 5-step dedup: CIK match → fuzzy name → new
  worker/
    worker.js           — poll loop, job claiming, execution, graceful shutdown
    scheduler.js        — checks job_schedules, enqueues due runs, computes next_run_at
  utils/
    logger.js           — timestamped console logger
```

## Rate limiting

The service sleeps 120 ms between EDGAR requests (~8 req/s, within the 10 req/s limit).
Automatic exponential backoff on 429/503 responses.

## Idempotency

- Prospects upserted on `(cik, source)` — re-running merges signals
- `resolveFirm` routes returning firms to their existing Account or Prospect
- Filings skipped if `accession_no` already exists
- Holdings only inserted for new filings
- Fit score history appended on every run (cumulative)
- `dedup_queue` rows guarded — only inserted if no pending row exists for the same prospect

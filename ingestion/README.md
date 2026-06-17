# Lime CRM — Ingestion Service

Standalone Node.js service that ingests SEC 13F filings and writes prospect data into Supabase.

## Requirements

- Node 18+ (uses native `fetch`)
- A Supabase project with migration 010 applied

## Setup

```bash
cd ingestion
npm install
cp .env.example .env
# Edit .env with your real values
```

### Environment variables

| Variable              | Description                                                  |
|-----------------------|--------------------------------------------------------------|
| `SUPABASE_URL`        | Your Supabase project URL                                    |
| `SUPABASE_SERVICE_KEY`| service_role key — **never commit, never expose to frontend**|
| `SEC_USER_AGENT`      | `AppName/1.0 (contact@you.com)` — required by SEC EDGAR     |

## Running

```bash
# Full run (up to 50 recent 13F filers)
npm run ingest:13f

# Quick test run (5 filers only)
npm run ingest:13f:test

# Custom limit
node src/index.js ingest-13f --limit 20
```

## Architecture

```
src/
  index.js           — CLI entry point, env validation
  config.js          — loads .env, validates required vars
  supabaseClient.js  — Supabase client with service_role key
  sec/
    edgarClient.js   — EDGAR API: search, submissions, filing docs
    parse13F.js      — 13F XML → structured holdings
  pipeline/
    ingest13F.js     — orchestrates: fetch → parse → upsert → score
    computeSignals.js — AUM, turnover, asset mix, segment heuristics
    fitScore.js      — loads weights from DB, computes prospect_fit score
  utils/
    logger.js        — timestamped console logger
```

## Rate limiting

The service sleeps 120ms between EDGAR requests (~8 req/s, within the 10 req/s limit). Automatic exponential backoff on 429/503 responses.

## Idempotency

- Prospects upserted on `(cik, source)` — re-running updates signals
- Filings skipped if `accession_no` already exists
- Holdings only inserted for new filings
- Fit score history appended on every run (cumulative)

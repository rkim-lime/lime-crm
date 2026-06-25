# Observability

Lime CRM has two surfaces monitored for errors:

| Surface | Tool | Alert channel |
|---------|------|---------------|
| Frontend (React/Vercel) | Sentry (React project) | Sentry email alerts |
| Ingestion worker (GitHub Actions) | Sentry (Node project) + GitHub Actions | Sentry email + GitHub workflow failure email |

---

## Sentry — Error Monitoring

### Frontend

**What's captured:** unhandled JS exceptions, React render errors caught by the root error boundary.

**What's NOT sent:** cookies, Authorization headers, user identity (stripped in `beforeSend`). No Supabase rows or client data.

**Env var required:** `VITE_SENTRY_DSN` — add to Vercel project under Settings → Environment Variables (Production + Preview).

**Code path:** `src/main.jsx` initialises the SDK; `src/components/ErrorBoundary.jsx` catches React tree crashes and shows a friendly fallback instead of a white screen.

### Worker

**What's captured:** any exception that causes a `job_runs` row to transition to `failed` status. Sentry context includes `job_type`, `run_id`, and `job_definition_id` — enough to find the full log in Supabase.

**What's NOT sent:** `config` object (may contain ADV bulk URL or other runtime overrides), Supabase row contents.

**Secret required:** `SENTRY_DSN` — add to GitHub repository secrets (Settings → Secrets and variables → Actions).

**Code path:** `ingestion/src/instrument.js` (init) → `ingestion/src/worker/worker.js` `executeJob` catch block (capture).

---

## Alerting on Failed Scheduled Jobs

Two independent layers so you're never flying blind:

### Layer 1 — Sentry alert rule

Set up a Sentry alert to email you when a new error hits the worker project:

1. In the Sentry dashboard, open the **lime-crm-worker** project.
2. Go to **Alerts → Create Alert → Issues**.
3. Condition: `When: A new issue is created`.
4. Action: `Send an email to: rkim@limex.com`.
5. Save. You'll get one email per new unique error (de-duplicated by Sentry).

### Layer 2 — GitHub Actions failure email

`FAIL_ON_JOB_ERROR=true` is set in the workflow, so any failed `job_run` causes the GitHub Action to exit with code 1 — the run shows as red in the Actions tab. GitHub automatically emails repository owners when a **scheduled** workflow fails.

**Confirm your GitHub notification settings:**
- GitHub → Settings → Notifications → Actions → "Send email when a workflow run fails".

Together these mean: if an autonomous 07:00 UTC ingestion run fails, you get (a) a Sentry email with the error and stack trace, and (b) a GitHub "workflow failed" email as a backup.

---

## Environment Variables / Secrets Reference

| Name | Where to add | Used by |
|------|-------------|---------|
| `VITE_SENTRY_DSN` | Vercel → Settings → Environment Variables (Production + Preview) | Frontend Sentry SDK |
| `SENTRY_DSN` | GitHub → Settings → Secrets and variables → Actions | Worker Sentry SDK |

---

## Finding Errors

- **Frontend errors:** Sentry dashboard → lime-crm-frontend project → Issues
- **Worker errors:** Sentry dashboard → lime-crm-worker project → Issues  
  OR Supabase → `job_runs` table → `status = 'failed'`, `error_message`, `log` columns
- **GitHub Actions history:** repo → Actions tab → Ingestion Worker workflow

---

## Local Development Without a DSN

Both SDKs are no-ops when the DSN env var is absent. Local dev and CI tests work without any Sentry config.

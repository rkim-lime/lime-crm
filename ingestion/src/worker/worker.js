import { hostname }                        from 'os';
import * as Sentry                         from '@sentry/node';
import { supabase }                        from '../supabaseClient.js';
import { logger }                          from '../utils/logger.js';
import { runConnector }                    from '../engine/runConnector.js';
import { runScheduler, runSchedulerOnce }  from './scheduler.js';

const POLL_INTERVAL_MS      = parseInt(process.env.WORKER_POLL_MS ?? '10000', 10);
const STALE_THRESHOLD_MS    = 5 * 60 * 1000;  // 5 min — reliable with 30s heartbeat
const HEARTBEAT_INTERVAL_MS = 30 * 1000;       // 30s — updates claimed_at to signal liveness

// Unique identity for this worker process (for claim tracking)
const workerId = `${hostname()}-${Math.random().toString(36).slice(2, 8)}`;

// Global so the shutdown handler can reference the in-flight run
let currentRunId  = null;
let shuttingDown  = false;

// ── Stale-job reaper ─────────────────────────────────────────────────────────
// Resets any run stuck in 'running' from a previously crashed worker.

async function reaperOnce() {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
  const { data: stale } = await supabase
    .from('job_runs')
    .select('id, claimed_by')
    .eq('status', 'running')
    .lt('claimed_at', cutoff);

  if (!stale?.length) return;

  for (const run of stale) {
    await supabase
      .from('job_runs')
      .update({ status: 'queued', claimed_by: null, claimed_at: null, started_at: null })
      .eq('id', run.id);
    logger.warn(`Reaper: reset stale run ${run.id} (was claimed by ${run.claimed_by})`);
  }
  logger.info(`Reaper: reset ${stale.length} stale job(s) to queued`);
}

// ── Job claiming ─────────────────────────────────────────────────────────────
// Two-step: SELECT the oldest queued row, then UPDATE with a status check
// in the WHERE clause. The WHERE status='queued' guard prevents double-claim
// races — only one worker's UPDATE will match.

async function claimNextJob() {
  const { data: candidates } = await supabase
    .from('job_runs')
    .select('id, job_definition_id, config_snapshot')
    .eq('status', 'queued')
    .order('queued_at', { ascending: true })
    .limit(1);

  if (!candidates?.length) return null;
  const candidate = candidates[0];

  const now = new Date().toISOString();
  const { data: claimed, error } = await supabase
    .from('job_runs')
    .update({
      status:     'running',
      claimed_by: workerId,
      claimed_at: now,
      started_at: now,
    })
    .eq('id', candidate.id)
    .eq('status', 'queued')       // prevents double-claim race
    .select('id, job_definition_id, config_snapshot')
    .maybeSingle();

  if (error || !claimed) return null; // another worker got it
  return claimed;
}

// ── Job execution ─────────────────────────────────────────────────────────────

async function executeJob(run) {
  logger.info(`[${workerId}] Executing run ${run.id}`);

  // Resolve job_type and config from the definition, merged with config_snapshot.
  // config_snapshot overrides definition.config (it captures runtime overrides like advBulkUrl).
  // There is NO default connector — if we can't determine job_type the run must FAIL,
  // not silently run the wrong connector.
  let config  = {};
  let jobType = null;

  if (!run.job_definition_id) {
    throw new Error(
      `Run ${run.id} has no job_definition_id — cannot determine which connector to run`
    );
  }

  const { data: def, error: defErr } = await supabase
    .from('job_definitions')
    .select('config, job_type')
    .eq('id', run.job_definition_id)
    .maybeSingle();

  if (defErr) {
    throw new Error(
      `Failed to fetch job definition ${run.job_definition_id} for run ${run.id}: ${defErr.message}`
    );
  }
  if (!def) {
    throw new Error(
      `Job definition ${run.job_definition_id} not found (run ${run.id}) — ` +
      'was it deleted after the run was queued?'
    );
  }

  jobType = def.job_type;
  if (!jobType) {
    throw new Error(
      `Job definition ${run.job_definition_id} has no job_type — ` +
      'cannot determine which connector to run'
    );
  }

  // Merge: definition.config provides base defaults; config_snapshot overrides
  // (config_snapshot captures runtime fields like advBulkUrl added at trigger time).
  config = { ...(def.config ?? {}), ...(run.config_snapshot ?? {}) };

  const logLines   = [];
  let   lastFlush  = Date.now();

  const flushProgress = async (stats) => {
    await supabase
      .from('job_runs')
      .update({ stats, log: logLines.join('\n') })
      .eq('id', run.id);
    lastFlush = Date.now();
  };

  // onProgress is called by runConnector after each filer
  const onProgress = async ({ stats, logLine }) => {
    if (logLine) logLines.push(`[${new Date().toISOString()}] ${logLine}`);
    if (Date.now() - lastFlush >= 5000) await flushProgress(stats);
  };

  // Heartbeat: refresh claimed_at every 30s so the UI/reaper can detect a dead worker
  const heartbeat = setInterval(async () => {
    await supabase
      .from('job_runs')
      .update({ claimed_at: new Date().toISOString() })
      .eq('id', run.id)
      .eq('status', 'running'); // no-op if job already finished
  }, HEARTBEAT_INTERVAL_MS);

  let succeeded = false;
  try {
    const stats = await runConnector(jobType, config, { supabase, logger, onProgress });

    await supabase
      .from('job_runs')
      .update({
        status:      'completed',
        finished_at: new Date().toISOString(),
        stats,
        log:         logLines.join('\n'),
      })
      .eq('id', run.id);

    logger.info(`[${workerId}] Run ${run.id} completed — ${JSON.stringify(stats)}`);
    succeeded = true;
  } catch (err) {
    // Report to Sentry with job context — NOT config (may contain advBulkUrl etc.)
    Sentry.withScope((scope) => {
      scope.setTag('job_type', jobType ?? 'unknown');
      scope.setContext('job_run', {
        run_id:            run.id,
        job_definition_id: run.job_definition_id,
      });
      Sentry.captureException(err);
    });

    logLines.push(`[${new Date().toISOString()}] ERROR: ${err.message}`);
    await supabase
      .from('job_runs')
      .update({
        status:        'failed',
        finished_at:   new Date().toISOString(),
        error_message: err.message,
        log:           logLines.join('\n'),
      })
      .eq('id', run.id);

    logger.error(`[${workerId}] Run ${run.id} failed — ${err.message}`);
  } finally {
    clearInterval(heartbeat);
  }

  currentRunId = null;
  return succeeded;
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function gracefulShutdown(signal) {
  logger.info(`[${workerId}] ${signal} received, shutting down…`);
  shuttingDown = true;

  if (currentRunId) {
    logger.warn(`[${workerId}] Mid-job shutdown — resetting run ${currentRunId} to queued`);
    // Only reset if still running (not already completed by a race)
    await supabase
      .from('job_runs')
      .update({
        status:     'queued',
        claimed_by: null,
        claimed_at: null,
        started_at: null,
        log:        'Interrupted by worker shutdown — will be re-queued automatically',
      })
      .eq('id', currentRunId)
      .eq('status', 'running');
  }

  await Sentry.flush(2000);
  process.exit(0);
}

// ── Once mode ─────────────────────────────────────────────────────────────────
// Used by GitHub Actions and CI: run one scheduler pass, drain the queue,
// then exit cleanly. No infinite polling loop.
//
// Exit codes:
//   0 — queue drained successfully (even if individual jobs failed, unless
//       FAIL_ON_JOB_ERROR=true is set — useful for surfacing failures in CI)
//   1 — FAIL_ON_JOB_ERROR=true AND at least one job returned a failed status

export async function startWorkerOnce() {
  logger.info(`[${workerId}] Worker starting (once mode) — will drain queue then exit`);

  process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  await reaperOnce();
  await runSchedulerOnce(); // enqueue any jobs whose schedule is now due

  let processed  = 0;
  let anyFailed  = false;

  while (!shuttingDown) {
    const run = await claimNextJob();
    if (!run) break; // queue is empty — we're done

    currentRunId = run.id;
    const ok = await executeJob(run);
    if (!ok) anyFailed = true;
    processed++;
  }

  logger.info(
    `[${workerId}] Once mode complete — processed ${processed} job(s)` +
    (anyFailed ? ', some failed (see job_runs for details)' : ', all succeeded')
  );

  await Sentry.flush(2000); // ensure captured exceptions are sent before exit

  if (anyFailed && process.env.FAIL_ON_JOB_ERROR === 'true') {
    logger.error('[worker] Exiting 1 — FAIL_ON_JOB_ERROR is set and at least one job failed');
    process.exit(1);
  }
  await Sentry.flush(2000);
  process.exit(0);
}

// ── Poll mode (default) ───────────────────────────────────────────────────────

export async function startWorker() {
  logger.info(`[${workerId}] Worker starting up — poll interval ${POLL_INTERVAL_MS}ms`);

  process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // Reset any runs left stuck in 'running' by a previous crash
  await reaperOnce();

  // Scheduler runs in the same process on its own setInterval
  runScheduler();

  while (!shuttingDown) {
    try {
      const run = await claimNextJob();
      if (run) {
        currentRunId = run.id;
        await executeJob(run);
      }
    } catch (err) {
      logger.error(`[${workerId}] Poll error — ${err.message}`);
    }

    if (!shuttingDown) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
}

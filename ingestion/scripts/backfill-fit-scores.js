/**
 * One-off backfill: recompute fit_score for all existing prospects.
 *
 * The core loop lives in src/engine/backfills.js (runBackfillFitScores) — the
 * SAME function the worker runs for job_type 'backfill_fit_scores', reusing
 * computeFitScore (the connector's scorer). This wrapper only supplies the CLI
 * context (supabase + a console logger + DRY_RUN). Behaviour is identical to
 * running the recompute as a queued job.
 *
 * Usage:
 *   DRY_RUN=true node --env-file=.env scripts/backfill-fit-scores.js   # preview, no writes
 *   node --env-file=.env scripts/backfill-fit-scores.js                # write
 */

import { supabase } from '../src/supabaseClient.js';
import { runBackfillFitScores } from '../src/engine/backfills.js';

const logger = {
  warn:  (...a) => console.warn('[WARN]', ...a),
  info:  (...a) => console.log('[INFO]', ...a),
  error: (...a) => console.error('[ERR]',  ...a),
};

runBackfillFitScores({ supabase, logger, dryRun: process.env.DRY_RUN === 'true' })
  .catch((err) => { console.error('Fatal:', err); process.exit(1); });

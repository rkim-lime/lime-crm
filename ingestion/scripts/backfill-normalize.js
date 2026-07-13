/**
 * One-off backfill: normalize all existing prospects and accounts.
 *
 * The core loop lives in src/engine/backfills.js (runBackfillNormalize) — the
 * SAME function the worker runs for job_type 'backfill_normalize'. This wrapper
 * only supplies the CLI context (supabase + a console logger + DRY_RUN). Behaviour
 * is identical to running the recompute as a queued job.
 *
 * Usage:
 *   DRY_RUN=true node --env-file=.env scripts/backfill-normalize.js   # preview, no writes
 *   node --env-file=.env scripts/backfill-normalize.js                # write
 */

import { supabase } from '../src/supabaseClient.js';
import { runBackfillNormalize } from '../src/engine/backfills.js';

const logger = {
  warn:  (...a) => console.warn('[WARN]', ...a),
  info:  (...a) => console.log('[INFO]', ...a),
  error: (...a) => console.error('[ERR]',  ...a),
  debug: () => {},
};

runBackfillNormalize({ supabase, logger, dryRun: process.env.DRY_RUN === 'true' })
  .catch((err) => { console.error('Fatal:', err); process.exit(1); });

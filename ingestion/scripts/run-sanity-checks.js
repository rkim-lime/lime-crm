/**
 * Standalone sanity-check runner — runs the same checks the worker runs after a
 * job, but on demand against the live DB (no job_run required).
 *
 * Requires migrations 029 + 030 applied (check_definitions catalogue +
 * signal_definitions.derivation registry).
 *
 * Usage:
 *   node --env-file=.env scripts/run-sanity-checks.js              # run + persist check_results (job_run_id null)
 *   DRY_RUN=true node --env-file=.env scripts/run-sanity-checks.js # preview, write nothing
 *
 * Exit code: 1 if any check FAILED (so you can gate a shell pipeline on it), else 0.
 */

import { execSync } from 'child_process';
import { supabase } from '../src/supabaseClient.js';
import { logger }   from '../src/utils/logger.js';
import { runSanityChecks } from '../src/engine/sanityChecks.js';

const DRY_RUN = process.env.DRY_RUN === 'true';
const gitSha  = process.env.GITHUB_SHA
  ?? (() => { try { return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { return 'local'; } })();

console.log(`Sanity checks — ${DRY_RUN ? 'DRY RUN (no writes)' : 'writing check_results (job_run_id=null)'} — git ${gitSha.slice(0, 12)}`);

const { overall, sanity, results } = await runSanityChecks(
  { supabase, logger },
  { jobRunId: null, gitSha, persist: !DRY_RUN },
);

console.log(`\n=== ${overall.toUpperCase()} — ${sanity.pass} pass / ${sanity.warn} warn / ${sanity.fail} fail ===`);
for (const r of results) {
  const mark = r.status === 'pass' ? '  ok ' : r.status === 'warn' ? ' WARN' : ' FAIL';
  const detail = r.status === 'pass' ? '' : ` — rows=${r.row_count} ${JSON.stringify(r.observed).slice(0, 240)}`;
  console.log(`${mark}  ${r.check_key}${detail}`);
}

process.exit(overall === 'failed' ? 1 : 0);

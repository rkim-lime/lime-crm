/**
 * One-off backfill: reconstruct match_reason for resolved dedup_queue rows that
 * were dismissed to 'not_duplicate' without recording a reason.
 *
 * recheck-dedup-queue.js only re-evaluates status='pending' rows, so these
 * already-resolved rows can't be fixed by re-running it. This re-derives the
 * SAME Fix-A reason the live path writes — from the two firms' stored CRD/CIK —
 * for genuine explainability (identifier_mismatch = distinct registration ids =
 * definitively different firms). Rows whose reason is genuinely unreconstructible
 * get an honest legacy marker, not a fabricated one.
 *
 * Usage:
 *   DRY_RUN=true node --env-file=.env scripts/backfill-dedup-match-reason.js  # preview breakdown
 *   node --env-file=.env scripts/backfill-dedup-match-reason.js               # write
 */

import { supabase } from '../src/supabaseClient.js';

const DRY_RUN = process.env.DRY_RUN === 'true';

const { data: rows, error } = await supabase
  .from('dedup_queue')
  .select('id, match_type, similarity, prospect_id, matched_prospect_id, matched_account_id')
  .eq('status', 'not_duplicate')
  .is('match_reason', null);
if (error) { console.error(error); process.exit(1); }

console.log(`Reconstructing match_reason for ${rows.length} resolved rows${DRY_RUN ? ' [DRY RUN]' : ''}`);

let fixA = 0, legacy = 0, errors = 0;
for (const r of rows) {
  const { data: prospect } = await supabase.from('prospects').select('crd_number, cik').eq('id', r.prospect_id).maybeSingle();
  let mCrd = null, mCik = null;
  if (r.match_type === 'prospect' && r.matched_prospect_id) {
    const { data: mp } = await supabase.from('prospects').select('crd_number, cik').eq('id', r.matched_prospect_id).maybeSingle();
    mCrd = mp?.crd_number ?? null; mCik = mp?.cik ?? null;
  } else if (r.match_type === 'account' && r.matched_account_id) {
    const { data: ma } = await supabase.from('accounts').select('crd_number, cik').eq('id', r.matched_account_id).maybeSingle();
    mCrd = ma?.crd_number ?? null; mCik = ma?.cik ?? null;
  }
  const pCrd = prospect?.crd_number ?? null, pCik = prospect?.cik ?? null;
  const crdMismatch = pCrd && mCrd && pCrd !== mCrd;
  const cikMismatch = pCik && mCik && pCik !== mCik;

  let reason;
  if (crdMismatch || cikMismatch) {
    reason = { stage: 'fix_a', decision: 'dismiss', reason: 'identifier_mismatch',
      ...(crdMismatch ? { crd_a: pCrd, crd_b: mCrd } : {}),
      ...(cikMismatch ? { cik_a: pCik, cik_b: mCik } : {}) };
    fixA++;
  } else {
    reason = { stage: 'legacy', reason: 'created before match_reason existed' };
    legacy++;
  }
  if (!DRY_RUN) {
    const { error: uErr } = await supabase.from('dedup_queue').update({ match_reason: reason }).eq('id', r.id);
    if (uErr) { errors++; console.warn(`  ${r.id}: ${uErr.message}`); }
  }
}

console.log(`\nDone${DRY_RUN ? ' [DRY RUN — no writes]' : ''}: fix_a=${fixA}, legacy=${legacy}, errors=${errors} (of ${rows.length})`);
process.exit(0);

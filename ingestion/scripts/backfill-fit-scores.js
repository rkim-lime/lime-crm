/**
 * One-off backfill: recompute fit_score for all existing prospects.
 *
 * The connector computes fit_score at ingest time (saveFitScore →
 * computeFitScore). After a scoring-logic change (e.g. segment abstention:
 * unknown/other drop filer_type and renormalize the remaining criteria to
 * 100), previously-ingested prospects keep their STALE scores until the next
 * ingest. This script recomputes them in place from stored data.
 *
 * It reuses computeFitScore (the SAME function the connector uses) — no scoring
 * logic is reimplemented here. Inputs are assembled from:
 *   • prospect columns:        estimated_aum_usd, portfolio_turnover_pct,
 *                              equities_pct, options_present, position_count
 *   • segment:                 segment_canonical (the AUTHORITATIVE, config-driven
 *                              value from normalization) — this is what drives
 *                              abstention (unknown/other). Falls back to the raw
 *                              inferred_segment column only when canonical is null.
 *   • normalized_signals:      client_types.value, has_private_fund_clients.value
 *
 * Scope: ALL non-audit prospects (13F + ADV). Abstention affects any prospect
 * whose segment is 'unknown' or 'other' (including 13F name-heuristic 'other'),
 * so recomputing the whole table keeps scores internally consistent.
 *
 * Idempotent: fit_score converges to the same value on re-run. A fresh
 * prospect_fit_scores breakdown row is appended each run (same as the connector
 * does per ingest); the UI reads the most-recent by computed_at.
 *
 * Usage:
 *   DRY_RUN=true node --env-file=.env scripts/backfill-fit-scores.js   # preview, no writes
 *   node --env-file=.env scripts/backfill-fit-scores.js                # write
 */

import { supabase } from '../src/supabaseClient.js';
import { computeFitScore } from '../src/engine/fitScore.js';

const PAGE_SIZE = 100;
const DRY_RUN   = process.env.DRY_RUN === 'true';
const logger = {
  warn:  (...a) => console.warn('[WARN]', ...a),
  info:  (...a) => console.log('[INFO]', ...a),
  error: (...a) => console.error('[ERR]',  ...a),
};

// Assemble the shape computeFitScore expects from a prospect row + its
// normalized_signals. Segment drives abstention → use segment_canonical.
function scoringInput(prospect) {
  const ns = prospect.normalized_signals ?? {};
  return {
    estimated_aum_usd:      prospect.estimated_aum_usd,
    portfolio_turnover_pct: prospect.portfolio_turnover_pct,
    equities_pct:           prospect.equities_pct,
    options_present:        prospect.options_present,
    position_count:         prospect.position_count,
    inferred_segment:       prospect.segment_canonical ?? prospect.inferred_segment ?? '',
    clientTypes:            ns.client_types?.value ?? [],
    advFlags:               { hasPrivateFundClients: ns.has_private_fund_clients?.value ?? false },
  };
}

// Rolling per-segment score stats so we can eyeball that unknowns now vary
// (not a uniform filler) and classified firms shifted sensibly.
function makeStats() { return {}; }
function record(stats, segment, score) {
  const key = segment ?? 'NULL';
  const s = stats[key] ??= { n: 0, sum: 0, min: Infinity, max: -Infinity, abstained: 0 };
  s.n++; s.sum += score; s.min = Math.min(s.min, score); s.max = Math.max(s.max, score);
}

async function main() {
  logger.info(`Fit-score backfill starting${DRY_RUN ? ' [DRY RUN — no writes]' : ''}`);

  const stats = makeStats();
  let total = 0, errors = 0, offset = 0;

  while (true) {
    const { data: prospects, error } = await supabase
      .from('prospects')
      .select('id, firm_name, source, estimated_aum_usd, position_count, portfolio_turnover_pct, '
        + 'equities_pct, options_present, inferred_segment, segment_canonical, normalized_signals, fit_score')
      .eq('is_audit_only', false)
      .range(offset, offset + PAGE_SIZE - 1)
      .order('created_at', { ascending: true });

    if (error) throw error;
    if (!prospects?.length) break;

    for (const prospect of prospects) {
      try {
        const input = scoringInput(prospect);
        const { score, breakdown } = await computeFitScore({ ...input, id: prospect.id });
        record(stats, input.inferred_segment, score);
        if (breakdown.filer_type?.abstained) stats[input.inferred_segment ?? 'NULL'].abstained++;

        if (!DRY_RUN) {
          await supabase
            .from('prospects')
            .update({ fit_score: score, fit_score_computed_at: new Date().toISOString() })
            .eq('id', prospect.id);
          await supabase
            .from('prospect_fit_scores')
            .insert({ prospect_id: prospect.id, score, breakdown });
        }

        total++;
        if (total % 100 === 0) logger.info(`${total} scored so far…`);
      } catch (err) {
        logger.error(`Prospect ${prospect.id} (${prospect.firm_name}): ${err.message}`);
        errors++;
      }
    }

    offset += PAGE_SIZE;
    if (prospects.length < PAGE_SIZE) break;
  }

  // ── Summary: new-score distribution by segment ──
  logger.info(`\nFit-score backfill complete${DRY_RUN ? ' [DRY RUN — no writes]' : ''}:`);
  logger.info(`  Prospects scored: ${total} (${errors} errors)`);
  logger.info('  New fit_score distribution by segment (segment → n, avg, min–max, abstained):');
  const rows = Object.entries(stats).sort((a, b) => b[1].n - a[1].n);
  for (const [seg, s] of rows) {
    const avg = (s.sum / s.n).toFixed(1);
    logger.info(`    ${seg.padEnd(16)} n=${String(s.n).padEnd(4)} avg=${String(avg).padEnd(5)} `
      + `range=${s.min}–${s.max}  abstained=${s.abstained}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

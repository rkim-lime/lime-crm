/**
 * Recompute backfills — the core loops, extracted so BOTH the CLI scripts
 * (scripts/backfill-normalize.js, scripts/backfill-fit-scores.js) AND the worker
 * (runConnector dispatch for job_type backfill_normalize / backfill_fit_scores)
 * call the SAME function. One source, two callers — no logic is reimplemented.
 *
 * ctx = { supabase, logger, onProgress?, jobRunId?, dryRun? }
 *   - onProgress: worker heartbeat/log streaming (optional; CLI omits it).
 *   - jobRunId:   when running as a job, config_snapshot is dumped to this run
 *                 (traceability); omitted by the CLI.
 *   - dryRun:     CLI preview — no writes (the worker never dry-runs).
 *
 * rows_changed counts ACTUALLY-CHANGED rows (derived output differs from the
 * stored value), NOT rows processed — so an idempotent re-backfill reports 0 and
 * the delta sanity check (config_changed_no_rows_changed) stays silent.
 */

import { normalizeFirm, loadNormalizationRefs } from './normalize.js';
import { inferSegment } from './computeSignals.js';
import { computeFitScore, loadFitScoreConfig } from './fitScore.js';

const PAGE_SIZE = 100;

// ── normalize backfill ────────────────────────────────────────────────────────

// Derived fields whose change (vs the pre-backfill row) counts as a real change.
// Excludes normalized_at (bumped every write) and the normalized_signals blob.
const DERIVED_KEYS = [
  'segment_canonical', 'segment_confidence', 'aum_canonical', 'aum_basis', 'aum_source',
  'aum_as_of', 'size_tier', 'signal_completeness', 'asset_class_relevance', 'asset_class_served_fraction',
];
function derivedChanged(prior, patch) {
  if (!patch) return false;
  for (const k of DERIVED_KEYS) {
    if (JSON.stringify(prior?.[k] ?? null) !== JSON.stringify(patch?.[k] ?? null)) return true;
  }
  return false;
}

function buildFirmSignal13F(prospect, rawSignals, periodOfReport = null) {
  return {
    source:                 'sec_13f',
    cik:                    prospect.cik,
    crdNumber:              prospect.crd_number ?? null,
    firmName:               prospect.firm_name,
    estimated_aum_usd:      rawSignals.estimated_aum_usd ?? prospect.estimated_aum_usd ?? 0,
    position_count:         rawSignals.position_count ?? prospect.position_count ?? 0,
    portfolio_turnover_pct: rawSignals.portfolio_turnover_pct ?? prospect.portfolio_turnover_pct ?? null,
    equities_pct:           rawSignals.equities_pct ?? prospect.equities_pct ?? 0,
    options_present:        rawSignals.options_present ?? prospect.options_present ?? false,
    inferred_segment:       inferSegment(prospect.firm_name), // re-derive; don't use stale column
    // Preserve provenance: emit the latest filing date so the recompute tuple carries as_of.
    quarters:               periodOfReport ? [{ filing: { periodOfReport } }] : [],
  };
}

async function latestPeriod(supabase, prospectId) {
  const { data } = await supabase
    .from('prospect_filings')
    .select('period_of_report')
    .eq('prospect_id', prospectId)
    .order('period_of_report', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.period_of_report ?? null;
}

function buildFirmSignalADV(prospect, rawSignals) {
  const stored = rawSignals.estimated_aum_usd ?? prospect.estimated_aum_usd ?? 0;
  return {
    source:                 'sec_adv',
    cik:                    null,
    crdNumber:              prospect.crd_number ?? null,
    firmName:               prospect.firm_name,
    regulatoryAum:          'regulatoryAum' in rawSignals
                              ? rawSignals.regulatoryAum
                              : stored > 0 ? stored : null,
    estimated_aum_usd:      stored,
    clientTypes:            rawSignals.clientTypes ?? [],
    advFlags:               rawSignals.advFlags    ?? { hasPrivateFundClients: false },
    inferred_segment:       inferSegment(prospect.firm_name),
    quarters:               [],
  };
}

const PROSPECT_COLS =
  'id, cik, crd_number, firm_name, source, estimated_aum_usd, position_count, portfolio_turnover_pct, '
  + 'equities_pct, options_present, inferred_segment, segment_canonical, segment_confidence, aum_canonical, '
  + 'aum_basis, aum_source, aum_as_of, size_tier, signal_completeness, asset_class_relevance, asset_class_served_fraction';

async function backfillProspects(ctx, normRefs) {
  const { supabase, logger, onProgress, dryRun } = ctx;
  let total = 0, changed = 0, errors = 0, offset = 0;

  while (true) {
    const { data: prospects, error } = await supabase
      .from('prospects')
      .select(PROSPECT_COLS)
      .eq('is_audit_only', false)
      .range(offset, offset + PAGE_SIZE - 1)
      .order('created_at', { ascending: true });

    if (error) throw error;
    if (!prospects?.length) break;

    for (const prospect of prospects) {
      try {
        const { data: sources } = await supabase
          .from('prospect_sources')
          .select('source, signals')
          .eq('prospect_id', prospect.id);

        const sourceMap = Object.fromEntries((sources ?? []).map(s => [s.source, s.signals ?? {}]));
        const sourcesToProcess = sources?.length ? sources.map(s => s.source) : [prospect.source];

        let lastPatch = null;
        for (const source of sourcesToProcess) {
          const rawSignals = sourceMap[source] ?? {};
          const firmSignal = source === 'sec_13f'
            ? buildFirmSignal13F(prospect, rawSignals, await latestPeriod(supabase, prospect.id))
            : source === 'sec_adv'
              ? buildFirmSignalADV(prospect, rawSignals)
              : null;
          if (!firmSignal) continue;
          if (!dryRun) {
            // recompute: this backfill IS the authority — must overwrite dated incumbents.
            lastPatch = await normalizeFirm({ supabase, logger }, { prospectId: prospect.id }, firmSignal, normRefs, { recompute: true });
          }
        }

        total++;
        if (derivedChanged(prospect, lastPatch)) changed++;
        if (total % 50 === 0) {
          logger.info(`Prospects: ${total} normalized (${changed} changed)…`);
          if (onProgress) await onProgress({ stats: { prospectsNormalized: total, rows_changed: changed }, logLine: `Prospects: ${total} normalized (${changed} changed)` });
        }
      } catch (err) {
        logger.error(`Prospect ${prospect.id} (${prospect.firm_name}): ${err.message}`);
        errors++;
      }
    }

    offset += PAGE_SIZE;
    if (prospects.length < PAGE_SIZE) break;
  }
  return { total, changed, errors };
}

async function backfillAccounts(ctx, normRefs) {
  const { supabase, logger, onProgress, dryRun } = ctx;
  let total = 0, changed = 0, errors = 0, offset = 0;

  while (true) {
    const { data: accounts, error } = await supabase
      .from('accounts')
      .select('id, name, cik, crd_number, segment_canonical, segment_confidence, aum_canonical, aum_basis, aum_source, aum_as_of, size_tier, signal_completeness')
      .or('cik.not.is.null,crd_number.not.is.null')
      .range(offset, offset + PAGE_SIZE - 1)
      .order('id', { ascending: true });

    if (error) throw error;
    if (!accounts?.length) break;

    for (const account of accounts) {
      try {
        const { data: auditProspects } = await supabase
          .from('prospects')
          .select('id, source, cik, crd_number, firm_name, estimated_aum_usd, position_count, portfolio_turnover_pct, equities_pct, options_present, inferred_segment')
          .eq('matched_to_account_id', account.id)
          .eq('is_audit_only', true);

        if (!auditProspects?.length) continue;

        let lastPatch = null;
        for (const auditProspect of auditProspects) {
          const { data: sources } = await supabase
            .from('prospect_sources')
            .select('source, signals')
            .eq('prospect_id', auditProspect.id);

          const sourceMap = Object.fromEntries((sources ?? []).map(s => [s.source, s.signals ?? {}]));
          const sourcesToProcess = sources?.length ? sources.map(s => s.source) : [auditProspect.source];

          for (const source of sourcesToProcess) {
            const rawSignals = sourceMap[source] ?? {};
            const signalBase = {
              ...auditProspect,
              firm_name:  account.name ?? auditProspect.firm_name,
              cik:        account.cik ?? auditProspect.cik,
              crd_number: account.crd_number ?? auditProspect.crd_number,
            };
            const firmSignal = source === 'sec_13f'
              ? buildFirmSignal13F(signalBase, rawSignals, await latestPeriod(supabase, auditProspect.id))
              : source === 'sec_adv'
                ? buildFirmSignalADV(signalBase, rawSignals)
                : null;
            if (!firmSignal) continue;
            if (!dryRun) {
              lastPatch = await normalizeFirm({ supabase, logger }, { accountId: account.id }, firmSignal, normRefs, { recompute: true });
            }
          }
        }

        total++;
        if (derivedChanged(account, lastPatch)) changed++;
        if (total % 20 === 0) {
          logger.info(`Accounts: ${total} normalized (${changed} changed)…`);
          if (onProgress) await onProgress({ stats: { accountsNormalized: total, rows_changed: changed }, logLine: `Accounts: ${total} normalized (${changed} changed)` });
        }
      } catch (err) {
        logger.error(`Account ${account.id}: ${err.message}`);
        errors++;
      }
    }

    offset += PAGE_SIZE;
    if (accounts.length < PAGE_SIZE) break;
  }
  return { total, changed, errors };
}

export async function runBackfillNormalize(ctx) {
  const { supabase, logger, jobRunId = null, dryRun = false } = ctx;
  logger.info(`Backfill normalization starting${dryRun ? ' [DRY RUN]' : ''}`);

  const normRefs = await loadNormalizationRefs(supabase);
  logger.info(
    `Refs loaded — ${normRefs.signalDefs.length} signal defs, ${normRefs.segmentMappings.length} segment mappings, `
    + `${normRefs.sizeBands.length} size bands, ${normRefs.nameSignals.length} name signals`,
  );

  // config_snapshot: dump the effective config used, so a stored verdict traces
  // to the exact config that produced it. (CLI/dry-run: no jobRunId → skipped.)
  if (jobRunId && !dryRun) {
    await supabase.from('job_runs').update({ config_snapshot: normRefs }).eq('id', jobRunId);
  }

  const p = await backfillProspects(ctx, normRefs);
  const a = await backfillAccounts(ctx, normRefs);

  logger.info(
    `\nBackfill complete${dryRun ? ' [DRY RUN — no writes]' : ''}:\n`
    + `  Prospects normalized: ${p.total} (${p.changed} changed, ${p.errors} errors)\n`
    + `  Accounts normalized:  ${a.total} (${a.changed} changed, ${a.errors} errors)`,
  );

  return {
    prospectsNormalized: p.total,
    accountsNormalized:  a.total,
    errors:              p.errors + a.errors,
    rows_changed:        p.changed + a.changed,
  };
}

// ── fit-score backfill ────────────────────────────────────────────────────────

function scoringInput(prospect) {
  const ns = prospect.normalized_signals ?? {};
  return {
    estimated_aum_usd:      prospect.estimated_aum_usd,
    portfolio_turnover_pct: prospect.portfolio_turnover_pct,
    equities_pct:           prospect.equities_pct,
    options_present:        prospect.options_present,
    position_count:         prospect.position_count,
    segment_canonical:      prospect.segment_canonical ?? prospect.inferred_segment ?? '',
    clientTypes:            ns.client_types?.value ?? [],
    advFlags:               { hasPrivateFundClients: ns.has_private_fund_clients?.value ?? false },
  };
}

function recordSeg(stats, segment, score) {
  const key = segment ?? 'NULL';
  const s = stats[key] ??= { n: 0, sum: 0, min: Infinity, max: -Infinity, abstained: 0 };
  s.n++; s.sum += score; s.min = Math.min(s.min, score); s.max = Math.max(s.max, score);
}

export async function runBackfillFitScores(ctx) {
  const { supabase, logger, onProgress, jobRunId = null, dryRun = false } = ctx;
  logger.info(`Fit-score backfill starting${dryRun ? ' [DRY RUN — no writes]' : ''}`);

  const cfg = await loadFitScoreConfig();   // inject once; computeFitScore never fetches
  if (jobRunId && !dryRun) {
    await supabase.from('job_runs').update({ config_snapshot: cfg }).eq('id', jobRunId);
  }

  const bySegment = {};
  let total = 0, changed = 0, errors = 0, offset = 0;

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
        const { score, breakdown } = computeFitScore({ ...input, id: prospect.id }, cfg);
        recordSeg(bySegment, input.segment_canonical, score);
        if (breakdown.filer_type?.abstained) bySegment[input.segment_canonical ?? 'NULL'].abstained++;

        const scoreChanged = score !== prospect.fit_score;
        if (!dryRun) {
          await supabase
            .from('prospects')
            .update({ fit_score: score, fit_score_computed_at: new Date().toISOString() })
            .eq('id', prospect.id);
          await supabase
            .from('prospect_fit_scores')
            .insert({ prospect_id: prospect.id, score, breakdown });
        }

        total++;
        if (scoreChanged) changed++;
        if (total % 100 === 0) {
          logger.info(`${total} scored (${changed} changed)…`);
          if (onProgress) await onProgress({ stats: { scored: total, rows_changed: changed }, logLine: `${total} scored (${changed} changed)` });
        }
      } catch (err) {
        logger.error(`Prospect ${prospect.id} (${prospect.firm_name}): ${err.message}`);
        errors++;
      }
    }

    offset += PAGE_SIZE;
    if (prospects.length < PAGE_SIZE) break;
  }

  logger.info(`\nFit-score backfill complete${dryRun ? ' [DRY RUN — no writes]' : ''}:`);
  logger.info(`  Prospects scored: ${total} (${changed} changed, ${errors} errors)`);
  logger.info('  New fit_score distribution by segment (segment → n, avg, min–max, abstained):');
  for (const [seg, s] of Object.entries(bySegment).sort((a, b) => b[1].n - a[1].n)) {
    const avg = (s.sum / s.n).toFixed(1);
    logger.info(`    ${seg.padEnd(16)} n=${String(s.n).padEnd(4)} avg=${String(avg).padEnd(5)} range=${s.min}–${s.max}  abstained=${s.abstained}`);
  }

  return { scored: total, errors, rows_changed: changed, bySegment };
}

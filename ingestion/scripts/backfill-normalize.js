/**
 * One-off backfill: normalize all existing prospects and accounts.
 *
 * For each prospect (non-audit-only): loads per-source raw signals from
 * prospect_sources, constructs synthetic FirmSignals, and runs normalizeFirm.
 *
 * For each account: finds its linked audit prospect to derive source/signal
 * context, then normalizes the account record directly.
 *
 * Idempotent — safe to re-run. Each call fully recomputes normalized_signals
 * and canonical fields from the best available stored data.
 *
 * LIMITATIONS (to be resolved by future full re-ingest):
 *   • ADV backfill lacks client_types and has_private_fund_clients — these
 *     were not stored in prospect_sources.signals. segment_inferred from the
 *     prospect column is used directly with confidence='low' until a live
 *     ADV ingest refreshes the data.
 *   • 13F backfill lacks the periodOfReport filing date (as_of=null) since
 *     quarters are not stored in rawSignals.
 *
 * Usage:
 *   node --env-file=.env scripts/backfill-normalize.js
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/backfill-normalize.js
 */

import { supabase } from '../src/supabaseClient.js';
import { normalizeFirm, loadNormalizationRefs } from '../src/engine/normalize.js';
import { inferSegment } from '../src/engine/computeSignals.js';

const PAGE_SIZE = 100;
const DRY_RUN   = process.env.DRY_RUN === 'true';
const logger   = {
  warn:  (...a) => console.warn('[WARN]', ...a),
  info:  (...a) => console.log('[INFO]', ...a),
  error: (...a) => console.error('[ERR]',  ...a),
  debug: () => {},
};
const ctx = { supabase, logger };

// ── Synthetic FirmSignal builders ─────────────────────────────────────────────

function buildFirmSignal13F(prospect, rawSignals) {
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
    quarters:               [], // no quarter history in backfill; as_of will be null
  };
}

function buildFirmSignalADV(prospect, rawSignals) {
  // ADV: estimated_aum_usd stored in rawSignals is the engine-safe value (0 when null).
  // Treat 0 as null for regulatory AUM (private-fund-only advisers have no AUM to report).
  const stored = rawSignals.estimated_aum_usd ?? prospect.estimated_aum_usd ?? 0;

  // regulatoryAum, clientTypes, advFlags are now persisted in rawSignals by
  // buildRawSignals() (runConnector.js). Fall back to safe defaults for rows
  // written before this fix was deployed (missing key → pre-fix row).
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

// ── Prospect backfill ─────────────────────────────────────────────────────────

async function backfillProspects(normRefs) {
  let total = 0, errors = 0;
  let offset = 0;

  while (true) {
    const { data: prospects, error } = await supabase
      .from('prospects')
      .select('id, cik, crd_number, firm_name, source, estimated_aum_usd, position_count, portfolio_turnover_pct, equities_pct, options_present, inferred_segment')
      .eq('is_audit_only', false)
      .range(offset, offset + PAGE_SIZE - 1)
      .order('created_at', { ascending: true });

    if (error) throw error;
    if (!prospects?.length) break;

    for (const prospect of prospects) {
      try {
        // Load all per-source signals for this prospect
        const { data: sources } = await supabase
          .from('prospect_sources')
          .select('source, signals')
          .eq('prospect_id', prospect.id);

        const sourceMap = Object.fromEntries(
          (sources ?? []).map(s => [s.source, s.signals ?? {}])
        );

        // Determine sources to process (prefer stored sources; fall back to prospect.source)
        const sourcesToProcess = sources?.length
          ? sources.map(s => s.source)
          : [prospect.source];

        for (const source of sourcesToProcess) {
          const rawSignals = sourceMap[source] ?? {};
          const firmSignal = source === 'sec_13f'
            ? buildFirmSignal13F(prospect, rawSignals)
            : source === 'sec_adv'
              ? buildFirmSignalADV(prospect, rawSignals)
              : null;

          if (!firmSignal) continue;

          if (!DRY_RUN) {
            await normalizeFirm(ctx, { prospectId: prospect.id }, firmSignal, normRefs);
          }
        }

        total++;
        if (total % 50 === 0) logger.info(`Prospects: ${total} normalized so far…`);
      } catch (err) {
        logger.error(`Prospect ${prospect.id} (${prospect.firm_name}): ${err.message}`);
        errors++;
      }
    }

    offset += PAGE_SIZE;
    if (prospects.length < PAGE_SIZE) break;
  }

  return { total, errors };
}

// ── Account backfill ──────────────────────────────────────────────────────────

async function backfillAccounts(normRefs) {
  let total = 0, errors = 0;
  let offset = 0;

  while (true) {
    // Load accounts that have at least one SEC signal (cik or crd_number set)
    const { data: accounts, error } = await supabase
      .from('accounts')
      .select('id, name, cik, crd_number')
      .or('cik.not.is.null,crd_number.not.is.null')
      .range(offset, offset + PAGE_SIZE - 1)
      .order('id', { ascending: true });

    if (error) throw error;
    if (!accounts?.length) break;

    for (const account of accounts) {
      try {
        // Find the linked audit prospect(s) to get source context and stored signals
        const { data: auditProspects } = await supabase
          .from('prospects')
          .select('id, source, cik, crd_number, firm_name, estimated_aum_usd, position_count, portfolio_turnover_pct, equities_pct, options_present, inferred_segment')
          .eq('matched_to_account_id', account.id)
          .eq('is_audit_only', true);

        if (!auditProspects?.length) continue;

        for (const auditProspect of auditProspects) {
          const { data: sources } = await supabase
            .from('prospect_sources')
            .select('source, signals')
            .eq('prospect_id', auditProspect.id);

          const sourceMap = Object.fromEntries(
            (sources ?? []).map(s => [s.source, s.signals ?? {}])
          );

          const sourcesToProcess = sources?.length
            ? sources.map(s => s.source)
            : [auditProspect.source];

          for (const source of sourcesToProcess) {
            const rawSignals = sourceMap[source] ?? {};

            // Build synthetic signal using account's firm identity + audit prospect's signals
            const signalBase = {
              ...auditProspect,
              firm_name:  account.name ?? auditProspect.firm_name,
              cik:        account.cik ?? auditProspect.cik,
              crd_number: account.crd_number ?? auditProspect.crd_number,
            };

            const firmSignal = source === 'sec_13f'
              ? buildFirmSignal13F(signalBase, rawSignals)
              : source === 'sec_adv'
                ? buildFirmSignalADV(signalBase, rawSignals)
                : null;

            if (!firmSignal) continue;

            if (!DRY_RUN) {
              await normalizeFirm(ctx, { accountId: account.id }, firmSignal, normRefs);
            }
          }
        }

        total++;
        if (total % 20 === 0) logger.info(`Accounts: ${total} normalized so far…`);
      } catch (err) {
        logger.error(`Account ${account.id}: ${err.message}`);
        errors++;
      }
    }

    offset += PAGE_SIZE;
    if (accounts.length < PAGE_SIZE) break;
  }

  return { total, errors };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  logger.info(`Backfill normalization starting${DRY_RUN ? ' [DRY RUN]' : ''}`);

  const normRefs = await loadNormalizationRefs(supabase);
  logger.info(
    `Refs loaded — ${normRefs.signalDefs.length} signal defs, `
    + `${normRefs.segmentMappings.length} segment mappings, `
    + `${normRefs.sizeBands.length} size bands`
  );

  const pResult = await backfillProspects(normRefs);
  const aResult = await backfillAccounts(normRefs);

  logger.info(
    `\nBackfill complete${DRY_RUN ? ' [DRY RUN — no writes]' : ''}:\n`
    + `  Prospects normalized: ${pResult.total} (${pResult.errors} errors)\n`
    + `  Accounts normalized:  ${aResult.total} (${aResult.errors} errors)`
  );
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

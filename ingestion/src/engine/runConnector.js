import '../connectors/index.js'; // side-effect: registers all connectors
import { getConnector }        from '../connectors/registry.js';
import { resolveFirm, normalizeName } from './resolveFirm.js';
import { computePassesICP }    from './computeSignals.js';
import {
  loadIcpConfig,
  writeFilingsAndHoldings,
  upsertSource,
  saveFitScore,
}                              from './writers.js';
import { supabase as defaultSupabase } from '../supabaseClient.js';
import { logger   as defaultLogger   } from '../utils/logger.js';

export async function runConnector(connectorKey, config = {}, ctx = {}) {
  const supabase   = ctx.supabase   ?? defaultSupabase;
  const logger     = ctx.logger     ?? defaultLogger;
  const onProgress = ctx.onProgress ?? null;

  const connector = getConnector(connectorKey);
  if (!connector) throw new Error(`No connector registered for key: ${connectorKey}`);

  logger.info(
    `Starting ${connectorKey} ingestion — limit ${config.limit ?? 50}`
    + (config.minAum     ? `, minAum $${(config.minAum / 1e9).toFixed(1)}B`          : '')
    + (config.filerTypes ? `, filerTypes [${config.filerTypes.join(',')}]` : '')
  );

  const stats = {
    prospects: 0, filings: 0, holdings: 0, errors: 0,
    accountMatches: 0, merges: 0, dupes: 0, skipped: 0,
  };

  const icpConfig = await loadIcpConfig(supabase);
  logger.info(
    icpConfig
      ? `ICP config — min AUM $${(icpConfig.min_aum_usd ?? 0).toLocaleString()}, `
        + `excluded segments: [${(icpConfig.excluded_segments ?? []).join(', ')}]`
      : 'ICP config not found — all prospects will pass ICP filter'
  );

  const connCtx = { supabase, logger, config, onProgress };
  const filers  = await connector.discover(config, connCtx);
  logger.info(`Found ${filers.length} filers to process`);

  for (let i = 0; i < filers.length; i++) {
    const filer  = filers[i];
    const prefix = `[${i + 1}/${filers.length}] ${filer.firmName}`;

    try {
      const quarters = await connector.fetch(filer, config, connCtx);
      if (!quarters.length) continue;

      const signal = connector.normalize(filer, quarters);

      // Config-level filters (applied after signals are known)
      if (config.minAum != null && signal.estimated_aum_usd < config.minAum) {
        logger.debug(`${prefix} — skipping (AUM $${(signal.estimated_aum_usd / 1e9).toFixed(2)}B < min $${(config.minAum / 1e9).toFixed(2)}B)`);
        stats.skipped++;
        if (onProgress) await onProgress({ stats: { ...stats }, logLine: `${filer.firmName} — skipped (below min AUM)` });
        continue;
      }
      if (config.filerTypes?.length && !config.filerTypes.includes(signal.inferred_segment)) {
        logger.debug(`${prefix} — skipping (segment "${signal.inferred_segment}" not in [${config.filerTypes.join(',')}])`);
        stats.skipped++;
        if (onProgress) await onProgress({ stats: { ...stats }, logLine: `${filer.firmName} — skipped (segment filter)` });
        continue;
      }

      const rawSignals = {
        estimated_aum_usd:      signal.estimated_aum_usd,
        position_count:         signal.position_count,
        portfolio_turnover_pct: signal.portfolio_turnover_pct,
        equities_pct:           signal.equities_pct,
        options_present:        signal.options_present,
        computed_at:            new Date().toISOString(),
      };

      const basePayload = {
        firm_name:              signal.firmName,
        cik:                    signal.cik,
        crd_number:             signal.crdNumber ?? null,
        source:                 signal.source,
        source_url:             signal.source_url,
        estimated_aum_usd:      signal.estimated_aum_usd,
        position_count:         signal.position_count,
        portfolio_turnover_pct: signal.portfolio_turnover_pct,
        equities_pct:           signal.equities_pct,
        options_present:        signal.options_present,
        inferred_segment:       signal.inferred_segment,
      };

      // Use (crd_number, source) as the upsert conflict key when CRD is the
      // primary identifier (ADV); fall back to (cik, source) for 13F.
      const conflictKey = signal.crdNumber ? 'crd_number,source' : 'cik,source';

      const resolution = await resolveFirm(supabase, {
        cik:       signal.cik,
        firmName:  signal.firmName,
        crdNumber: signal.crdNumber,
      });

      let prospectId;

      // ── PATH A: exact CIK match to an existing Account ───────────────────────
      if (resolution.resolution === 'account_match') {
        await supabase
          .from('accounts')
          .update({
            sec_estimated_aum_usd:      signal.estimated_aum_usd,
            sec_position_count:         signal.position_count,
            sec_portfolio_turnover_pct: signal.portfolio_turnover_pct,
            sec_equities_pct:           signal.equities_pct,
            sec_options_present:        signal.options_present,
            sec_signals_updated_at:     new Date().toISOString(),
          })
          .eq('id', resolution.accountId);

        const { data: auditProspect, error: auditErr } = await supabase
          .from('prospects')
          .upsert(
            {
              ...basePayload,
              normalized_name:       normalizeName(signal.firmName),
              is_audit_only:         true,
              status:                'matched_to_account',
              matched_to_account_id: resolution.accountId,
            },
            { onConflict: conflictKey, ignoreDuplicates: false }
          )
          .select('id')
          .single();

        if (auditErr) throw auditErr;
        prospectId = auditProspect.id;
        stats.accountMatches++;
        logger.info(`${prefix} → matched existing ACCOUNT (${resolution.accountId}), signals updated`);

      // ── PATH B: exact CIK match to an existing Prospect ──────────────────────
      } else if (resolution.resolution === 'prospect_merge') {
        await supabase
          .from('prospects')
          .update({
            estimated_aum_usd:      signal.estimated_aum_usd,
            position_count:         signal.position_count,
            portfolio_turnover_pct: signal.portfolio_turnover_pct,
            equities_pct:           signal.equities_pct,
            options_present:        signal.options_present,
          })
          .eq('id', resolution.prospectId);

        await upsertSource(supabase, resolution.prospectId, signal.source, signal.source_url, rawSignals);
        prospectId = resolution.prospectId;
        stats.merges++;
        logger.info(`${prefix} → merged into existing prospect (${resolution.prospectId})`);

      // ── PATH C: fuzzy name match — flag as possible duplicate ─────────────────
      } else if (
        resolution.resolution === 'fuzzy_account' ||
        resolution.resolution === 'fuzzy_prospect'
      ) {
        const passesIcp = computePassesICP(basePayload, icpConfig);

        const { data: dupeProspect, error: dupeErr } = await supabase
          .from('prospects')
          .upsert(
            {
              ...basePayload,
              normalized_name: normalizeName(signal.firmName),
              status:          'possible_duplicate',
              passes_icp:      passesIcp,
            },
            { onConflict: conflictKey, ignoreDuplicates: false }
          )
          .select('id')
          .single();

        if (dupeErr) throw dupeErr;
        prospectId = dupeProspect.id;

        const { data: existingDedup } = await supabase
          .from('dedup_queue')
          .select('id')
          .eq('prospect_id', prospectId)
          .eq('status', 'pending')
          .maybeSingle();

        if (!existingDedup) {
          const isAccountMatch = resolution.resolution === 'fuzzy_account';
          await supabase.from('dedup_queue').insert({
            prospect_id:         prospectId,
            match_type:          isAccountMatch ? 'account' : 'prospect',
            matched_account_id:  isAccountMatch ? resolution.matchId : null,
            matched_prospect_id: isAccountMatch ? null : resolution.matchId,
            similarity:          resolution.similarity,
            matched_name:        resolution.matchName,
          });
        }

        await upsertSource(supabase, prospectId, signal.source, signal.source_url, rawSignals);
        stats.dupes++;
        logger.warn(
          `${prefix} → flagged possible duplicate of "${resolution.matchName}" `
          + `(similarity ${(resolution.similarity * 100).toFixed(0)}%)`
        );

      // ── PATH D: new firm — create fresh prospect ──────────────────────────────
      } else {
        const passesIcp = computePassesICP(basePayload, icpConfig);

        const { data: newProspect, error: newErr } = await supabase
          .from('prospects')
          .upsert(
            {
              ...basePayload,
              normalized_name: normalizeName(signal.firmName),
              passes_icp:      passesIcp,
            },
            { onConflict: conflictKey, ignoreDuplicates: false }
          )
          .select('id')
          .single();

        if (newErr) throw newErr;
        prospectId = newProspect.id;

        await upsertSource(supabase, prospectId, signal.source, signal.source_url, rawSignals);
        stats.prospects++;

        logger.info(
          `${prefix} — $${(signal.estimated_aum_usd / 1e9).toFixed(2)}B AUM, `
          + `${signal.position_count} positions, `
          + `turnover ${signal.portfolio_turnover_pct?.toFixed(0) ?? 'N/A'}%, `
          + `fit score pending, ICP ${passesIcp ? '✓' : '✗'}`
        );
      }

      await writeFilingsAndHoldings(supabase, logger, prospectId, signal.cik, signal.quarters, stats, prefix);
      await saveFitScore(supabase, prospectId, basePayload);

      if (onProgress) {
        const logLine = `${filer.firmName} — ${resolution.resolution}`
          + (resolution.resolution === 'new'
            ? ` ($${(signal.estimated_aum_usd / 1e9).toFixed(2)}B AUM, ${signal.position_count} positions)`
            : '');
        await onProgress({ stats: { ...stats }, logLine });
      }

    } catch (err) {
      logger.error(`${prefix} — ${err.message}`);
      stats.errors++;
      if (onProgress) {
        await onProgress({ stats: { ...stats }, logLine: `${filer.firmName} — ERROR: ${err.message}` });
      }
    }
  }

  logger.info(
    `Run complete — new:${stats.prospects} merges:${stats.merges} `
    + `acctMatches:${stats.accountMatches} dupes:${stats.dupes} `
    + `skipped:${stats.skipped} filings:${stats.filings} `
    + `holdings:${stats.holdings} errors:${stats.errors}`
  );
  return stats;
}

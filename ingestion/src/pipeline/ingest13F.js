import { supabase }                                                   from '../supabaseClient.js';
import { logger }                                                      from '../utils/logger.js';
import { getRecent13FFilers, getFilingHistory, getFilingDocument }     from '../sec/edgarClient.js';
import { parse13F }                                                     from '../sec/parse13F.js';
import { estimateAUM, computeTurnover, assetMix, inferSegment,
         computePassesICP }                                            from './computeSignals.js';
import { computeFitScore }                                             from './fitScore.js';
import { resolveFirm, normalizeName }                                  from './resolveFirm.js';

// ── ICP config loader (once per run) ─────────────────────────────────────────

async function loadIcpConfig() {
  const { data } = await supabase
    .from('icp_filter_config')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  return data ?? null;
}

// ── Filing + holdings writer (shared across all resolution paths) ─────────────

async function writeFilingsAndHoldings(prospectId, filer, quarters, stats, prefix) {
  for (const q of quarters) {
    const { data: existing } = await supabase
      .from('prospect_filings')
      .select('id')
      .eq('accession_no', q.filing.accessionNo)
      .maybeSingle();

    if (existing) {
      logger.debug(`${prefix} — filing ${q.filing.accessionNo} already exists, skipping`);
      stats.filings++;
      continue;
    }

    const { data: newFiling, error: filingErr } = await supabase
      .from('prospect_filings')
      .insert({
        prospect_id:      prospectId,
        filing_type:      '13F-HR',
        accession_no:     q.filing.accessionNo,
        period_of_report: q.filing.periodOfReport || null,
        filed_at:         q.filing.filedAt        || null,
        total_value_usd:  q.totalValueUsd,
        holding_count:    q.holdingCount,
        source_url: `https://www.sec.gov/Archives/edgar/data/${parseInt(filer.cik)}/${q.filing.accessionNo.replace(/-/g, '')}/`,
      })
      .select('id')
      .single();

    if (filingErr) {
      logger.warn(`${prefix} — filing insert error: ${filingErr.message}`);
      continue;
    }
    stats.filings++;

    const rows = q.holdings.map(h => ({
      prospect_id:      prospectId,
      filing_id:        newFiling.id,
      period_of_report: q.filing.periodOfReport || null,
      cusip:            h.cusip,
      issuer_name:      h.issuerName   || null,
      value_usd:        h.valueUsd,
      shares:           h.shares,
      class_title:      h.titleOfClass || null,
      put_call:         h.putCall      || null,
    }));

    for (let b = 0; b < rows.length; b += 200) {
      const { error: holdErr } = await supabase
        .from('prospect_holdings')
        .insert(rows.slice(b, b + 200));
      if (holdErr) logger.warn(`${prefix} — holdings batch error: ${holdErr.message}`);
      else stats.holdings += Math.min(200, rows.length - b);
    }
  }
}

// ── Fit score persist ─────────────────────────────────────────────────────────

async function saveFitScore(prospectId, payload) {
  const { score, breakdown } = await computeFitScore({ ...payload, id: prospectId });

  await supabase
    .from('prospects')
    .update({ fit_score: score, fit_score_computed_at: new Date().toISOString() })
    .eq('id', prospectId);

  await supabase
    .from('prospect_fit_scores')
    .insert({ prospect_id: prospectId, score, breakdown });

  return score;
}

// ── prospect_sources upsert ───────────────────────────────────────────────────

async function upsertSource(prospectId, filer, signals) {
  const sourceUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filer.cik}&type=13F-HR`;
  await supabase
    .from('prospect_sources')
    .upsert(
      {
        prospect_id:  prospectId,
        source:       'sec_13f',
        source_url:   sourceUrl,
        signals,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'prospect_id,source', ignoreDuplicates: false }
    );
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function ingest13F({ limit = 50 } = {}) {
  logger.info(`Starting 13F ingestion — limit ${limit}`);
  const stats = {
    prospects:      0,
    filings:        0,
    holdings:       0,
    errors:         0,
    accountMatches: 0,
    merges:         0,
    dupes:          0,
  };

  // Load ICP config once for the whole run
  const icpConfig = await loadIcpConfig();
  logger.info(
    icpConfig
      ? `ICP config — min AUM $${(icpConfig.min_aum_usd ?? 0).toLocaleString()}, `
        + `excluded segments: [${(icpConfig.excluded_segments ?? []).join(', ')}]`
      : 'ICP config not found — all prospects will pass ICP filter'
  );

  const filers = await getRecent13FFilers(limit);
  logger.info(`Found ${filers.length} filers to process`);

  for (let i = 0; i < filers.length; i++) {
    const filer  = filers[i];
    const prefix = `[${i + 1}/${filers.length}] ${filer.firmName}`;

    try {
      // ── Fetch + parse filings ────────────────────────────────
      const history = await getFilingHistory(filer.cik, 3);
      if (!history.length) { logger.warn(`${prefix} — no filings found`); continue; }

      const quarters = [];
      for (const filing of history) {
        try {
          const xml = await getFilingDocument(filer.cik, filing.accessionNo);
          const { holdings, totalValueUsd, holdingCount } = parse13F(xml, filing.periodOfReport);
          quarters.push({ filing, holdings, totalValueUsd, holdingCount });
        } catch (err) {
          logger.warn(`${prefix} — skipping ${filing.accessionNo}: ${err.message}`);
        }
      }
      if (!quarters.length) continue;

      // ── Compute signals ──────────────────────────────────────
      const latest                          = quarters[0];
      const prior                           = quarters[1];
      const aum                             = estimateAUM(latest.holdings);
      const { equitiesPct, optionsPresent } = assetMix(latest.holdings);
      const turnoverPct                     = computeTurnover(latest.holdings, prior?.holdings);
      const segment                         = inferSegment(filer.firmName);

      const signals = {
        estimated_aum_usd:      aum,
        position_count:         latest.holdingCount,
        portfolio_turnover_pct: turnoverPct != null ? parseFloat(turnoverPct.toFixed(2)) : null,
        equities_pct:           equitiesPct,
        options_present:        optionsPresent,
        computed_at:            new Date().toISOString(),
      };

      // Shared prospect field payload
      const basePayload = {
        firm_name:              filer.firmName,
        cik:                    filer.cik,
        source:                 'sec_13f',
        source_url:             `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filer.cik}&type=13F-HR`,
        estimated_aum_usd:      aum,
        position_count:         latest.holdingCount,
        portfolio_turnover_pct: signals.portfolio_turnover_pct,
        equities_pct:           equitiesPct,
        options_present:        optionsPresent,
        inferred_segment:       segment,
      };

      // ── Resolve firm ─────────────────────────────────────────
      const resolution = await resolveFirm(supabase, {
        cik:      filer.cik,
        firmName: filer.firmName,
      });

      let prospectId;

      // ─────────────────────────────────────────────────────────
      // PATH A: exact CIK match to an existing Account
      // Update account SEC signals + create audit-only prospect
      // ─────────────────────────────────────────────────────────
      if (resolution.resolution === 'account_match') {
        await supabase
          .from('accounts')
          .update({
            sec_estimated_aum_usd:      aum,
            sec_position_count:         latest.holdingCount,
            sec_portfolio_turnover_pct: signals.portfolio_turnover_pct,
            sec_equities_pct:           equitiesPct,
            sec_options_present:        optionsPresent,
            sec_signals_updated_at:     new Date().toISOString(),
          })
          .eq('id', resolution.accountId);

        const { data: auditProspect, error: auditErr } = await supabase
          .from('prospects')
          .upsert(
            {
              ...basePayload,
              normalized_name:       normalizeName(filer.firmName),
              is_audit_only:         true,
              status:                'matched_to_account',
              matched_to_account_id: resolution.accountId,
            },
            { onConflict: 'cik,source', ignoreDuplicates: false }
          )
          .select('id')
          .single();

        if (auditErr) throw auditErr;
        prospectId = auditProspect.id;
        stats.accountMatches++;
        logger.info(`${prefix} → matched existing ACCOUNT (${resolution.accountId}), signals updated`);

      // ─────────────────────────────────────────────────────────
      // PATH B: exact CIK match to an existing Prospect
      // Update signals, upsert source row, recompute fit score
      // ─────────────────────────────────────────────────────────
      } else if (resolution.resolution === 'prospect_merge') {
        await supabase
          .from('prospects')
          .update({
            estimated_aum_usd:      aum,
            position_count:         latest.holdingCount,
            portfolio_turnover_pct: signals.portfolio_turnover_pct,
            equities_pct:           equitiesPct,
            options_present:        optionsPresent,
          })
          .eq('id', resolution.prospectId);

        await upsertSource(resolution.prospectId, filer, signals);
        prospectId = resolution.prospectId;
        stats.merges++;
        logger.info(`${prefix} → merged into existing prospect (${resolution.prospectId})`);

      // ─────────────────────────────────────────────────────────
      // PATH C: fuzzy name match — flag as possible duplicate
      // Create prospect, insert dedup_queue row for human review
      // ─────────────────────────────────────────────────────────
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
              normalized_name: normalizeName(filer.firmName),
              status:          'possible_duplicate',
              passes_icp:      passesIcp,
            },
            { onConflict: 'cik,source', ignoreDuplicates: false }
          )
          .select('id')
          .single();

        if (dupeErr) throw dupeErr;
        prospectId = dupeProspect.id;

        // Guard against duplicate dedup_queue rows on re-ingestion
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

        await upsertSource(prospectId, filer, signals);
        stats.dupes++;
        logger.warn(
          `${prefix} → flagged possible duplicate of "${resolution.matchName}" `
          + `(similarity ${(resolution.similarity * 100).toFixed(0)}%)`
        );

      // ─────────────────────────────────────────────────────────
      // PATH D: new firm — create fresh prospect
      // ─────────────────────────────────────────────────────────
      } else {
        const passesIcp = computePassesICP(basePayload, icpConfig);

        const { data: newProspect, error: newErr } = await supabase
          .from('prospects')
          .upsert(
            {
              ...basePayload,
              normalized_name: normalizeName(filer.firmName),
              passes_icp:      passesIcp,
            },
            { onConflict: 'cik,source', ignoreDuplicates: false }
          )
          .select('id')
          .single();

        if (newErr) throw newErr;
        prospectId = newProspect.id;

        await upsertSource(prospectId, filer, signals);
        stats.prospects++;

        const aumB = (aum / 1e9).toFixed(2);
        logger.info(
          `${prefix} — $${aumB}B AUM, ${latest.holdingCount} positions, `
          + `turnover ${turnoverPct?.toFixed(0) ?? 'N/A'}%, `
          + `fit score pending, ICP ${passesIcp ? '✓' : '✗'}`
        );
      }

      // ── Write filings + holdings (all paths) ─────────────────
      await writeFilingsAndHoldings(prospectId, filer, quarters, stats, prefix);

      // ── Compute and persist fit score (all paths) ────────────
      await saveFitScore(prospectId, basePayload);

    } catch (err) {
      logger.error(`${prefix} — ${err.message}`);
      stats.errors++;
    }
  }

  logger.info(
    `Run complete — new:${stats.prospects} merges:${stats.merges} `
    + `acctMatches:${stats.accountMatches} dupes:${stats.dupes} `
    + `filings:${stats.filings} holdings:${stats.holdings} errors:${stats.errors}`
  );
  return stats;
}

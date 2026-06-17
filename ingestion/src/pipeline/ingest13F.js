import { supabase }                                                   from '../supabaseClient.js';
import { logger }                                                      from '../utils/logger.js';
import { getRecent13FFilers, getFilingHistory, getFilingDocument }     from '../sec/edgarClient.js';
import { parse13F }                                                     from '../sec/parse13F.js';
import { estimateAUM, computeTurnover, assetMix, inferSegment }        from './computeSignals.js';
import { computeFitScore }                                              from './fitScore.js';

export async function ingest13F({ limit = 50 } = {}) {
  logger.info(`Starting 13F ingestion — limit ${limit}`);
  const stats = { prospects: 0, filings: 0, holdings: 0, errors: 0 };

  const filers = await getRecent13FFilers(limit);
  logger.info(`Found ${filers.length} filers to process`);

  for (let i = 0; i < filers.length; i++) {
    const filer  = filers[i];
    const prefix = `[${i + 1}/${filers.length}] ${filer.firmName}`;

    try {
      // ── Fetch filing history (last 3 quarters) ──────────────
      const history = await getFilingHistory(filer.cik, 3);
      if (!history.length) { logger.warn(`${prefix} — no filings found`); continue; }

      // ── Parse each quarter ───────────────────────────────────
      const quarters = [];
      for (const filing of history) {
        try {
          const xml                                = await getFilingDocument(filer.cik, filing.accessionNo);
          const { holdings, totalValueUsd, holdingCount } = parse13F(xml, filing.periodOfReport);
          quarters.push({ filing, holdings, totalValueUsd, holdingCount });
        } catch (err) {
          logger.warn(`${prefix} — skipping ${filing.accessionNo}: ${err.message}`);
        }
      }
      if (!quarters.length) continue;

      // ── Compute signals from latest quarter ──────────────────
      const latest              = quarters[0];
      const prior               = quarters[1];
      const aum                 = estimateAUM(latest.holdings);
      const { equitiesPct, optionsPresent } = assetMix(latest.holdings);
      const turnoverPct         = computeTurnover(latest.holdings, prior?.holdings);
      const segment             = inferSegment(filer.firmName);

      // ── Upsert prospect ─────────────────────────────────────
      const payload = {
        firm_name:              filer.firmName,
        cik:                    filer.cik,
        source:                 'sec_13f',
        source_url:             `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filer.cik}&type=13F-HR`,
        estimated_aum_usd:      aum,
        position_count:         latest.holdingCount,
        portfolio_turnover_pct: turnoverPct != null ? parseFloat(turnoverPct.toFixed(2)) : null,
        equities_pct:           equitiesPct,
        options_present:        optionsPresent,
        inferred_segment:       segment,
      };

      const { data: prospect, error: upsertErr } = await supabase
        .from('prospects')
        .upsert(payload, { onConflict: 'cik,source', ignoreDuplicates: false })
        .select('id')
        .single();

      if (upsertErr) throw upsertErr;
      stats.prospects++;

      // ── Upsert filings and insert holdings ───────────────────
      for (const q of quarters) {
        // Skip if filing already recorded (accession_no is unique)
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
            prospect_id:      prospect.id,
            filing_type:      '13F-HR',
            accession_no:     q.filing.accessionNo,
            period_of_report: q.filing.periodOfReport || null,
            filed_at:         q.filing.filedAt        || null,
            total_value_usd:  q.totalValueUsd,
            holding_count:    q.holdingCount,
            source_url:       `https://www.sec.gov/Archives/edgar/data/${parseInt(filer.cik)}/${q.filing.accessionNo.replace(/-/g, '')}/`,
          })
          .select('id')
          .single();

        if (filingErr) {
          logger.warn(`${prefix} — filing insert error: ${filingErr.message}`);
          continue;
        }
        stats.filings++;

        // Insert holdings in batches of 200
        const rows = q.holdings.map(h => ({
          prospect_id:      prospect.id,
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

      // ── Compute and persist fit score ────────────────────────
      const { score, breakdown } = await computeFitScore({ ...payload, id: prospect.id });

      await supabase
        .from('prospects')
        .update({ fit_score: score, fit_score_computed_at: new Date().toISOString() })
        .eq('id', prospect.id);

      await supabase
        .from('prospect_fit_scores')
        .insert({ prospect_id: prospect.id, score, breakdown });

      const aumB = (aum / 1e9).toFixed(2);
      logger.info(
        `${prefix} — $${aumB}B AUM, ${latest.holdingCount} positions, `
        + `turnover ${turnoverPct?.toFixed(0) ?? 'N/A'}%, fit score ${score}`
      );

    } catch (err) {
      logger.error(`${prefix} — ${err.message}`);
      stats.errors++;
    }
  }

  return stats;
}

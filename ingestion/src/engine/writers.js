import { computeFitScore, loadFitScoreConfig } from './fitScore.js';

export async function loadIcpConfig(supabase) {
  const { data } = await supabase
    .from('icp_filter_config')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  return data ?? null;
}

export async function writeFilingsAndHoldings(supabase, logger, prospectId, cik, quarters, stats, prefix) {
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
        source_url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${q.filing.accessionNo.replace(/-/g, '')}/`,
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

export async function upsertSource(supabase, prospectId, source, sourceUrl, rawSignals) {
  await supabase
    .from('prospect_sources')
    .upsert(
      {
        prospect_id:  prospectId,
        source,
        source_url:   sourceUrl,
        signals:      rawSignals,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'prospect_id,source', ignoreDuplicates: false }
    );
}

export async function saveFitScore(supabase, prospectId, payload) {
  const cfg = await loadFitScoreConfig();            // inject config; computeFitScore never fetches
  const { score, breakdown } = computeFitScore({ ...payload, id: prospectId }, cfg);

  await supabase
    .from('prospects')
    .update({ fit_score: score, fit_score_computed_at: new Date().toISOString() })
    .eq('id', prospectId);

  await supabase
    .from('prospect_fit_scores')
    .insert({ prospect_id: prospectId, score, breakdown });

  return score;
}

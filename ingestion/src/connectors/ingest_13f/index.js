import { getRecent13FFilers, getFilingHistory, getFilingDocument } from '../_shared/edgarClient.js';
import { parse13F }                                                 from './parse13F.js';
import { estimateAUM, computeTurnover, assetMix, inferSegment }    from '../../engine/computeSignals.js';

/** @type {import('../types.js').Connector} */
const sec13fConnector = {
  key: 'ingest_13f',

  async discover(config) {
    return getRecent13FFilers(config.limit ?? 50);
  },

  async fetch(filer, _config, ctx) {
    const { logger } = ctx;
    const history = await getFilingHistory(filer.cik, 3);
    if (!history.length) {
      logger.warn(`${filer.firmName} — no filings found`);
      return [];
    }

    const quarters = [];
    for (const filing of history) {
      try {
        const xml = await getFilingDocument(filer.cik, filing.accessionNo);
        const { holdings, totalValueUsd, holdingCount } = parse13F(xml, filing.periodOfReport);
        quarters.push({ filing, holdings, totalValueUsd, holdingCount });
      } catch (err) {
        logger.warn(`${filer.firmName} — skipping ${filing.accessionNo}: ${err.message}`);
      }
    }
    return quarters;
  },

  normalize(filer, quarters) {
    const latest                          = quarters[0];
    const prior                           = quarters[1];
    const aum                             = estimateAUM(latest.holdings);
    const { equitiesPct, optionsPresent } = assetMix(latest.holdings);
    const turnoverPct                     = computeTurnover(latest.holdings, prior?.holdings);
    const segment                         = inferSegment(filer.firmName);

    return {
      firmName:               filer.firmName,
      cik:                    filer.cik,
      estimated_aum_usd:      aum,
      position_count:         latest.holdingCount,
      portfolio_turnover_pct: turnoverPct != null ? parseFloat(turnoverPct.toFixed(2)) : null,
      equities_pct:           equitiesPct,
      options_present:        optionsPresent,
      inferred_segment:       segment,
      source:                 'sec_13f',
      source_url:             `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filer.cik}&type=13F-HR`,
      quarters,
    };
  },
};

export default sec13fConnector;

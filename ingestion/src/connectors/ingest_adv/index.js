/**
 * SEC Form ADV connector — bulk Part 1 ingestion.
 *
 * Access pattern: BULK FILE (contrast with 13F's per-filer API).
 * The SEC publishes quarterly IAPD bulk exports at:
 *   https://adviserinfo.sec.gov/compilation
 *   https://www.sec.gov/open/datasets/ia.shtml
 *
 * Supported file formats: .zip (containing a CSV), .gz, or plain CSV.
 * Formats are detected from the URL extension / Content-Type header.
 *
 * Future enrichment hook: fetch() leaves a stub for Part 2 brochure
 * PDF mining once the Part 1 bulk file is proven out.
 */

import { Readable }   from 'stream';
import { gunzipSync } from 'zlib';
import { parse as csvParse } from 'csv-parse';
import AdmZip          from 'adm-zip';
import { inferSegment } from '../../engine/computeSignals.js';

// ── Column name resolver ──────────────────────────────────────────────────────
// Normalizes CSV headers to lowercase_underscore and tries multiple aliases
// so the connector works against different IAPD export flavours.

function normalizeHeader(h) {
  return h.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function mkGet(...aliases) {
  const keys = aliases.map(a => a.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return (row) => {
    for (const k of keys) {
      const v = row[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  };
}

// ADV Part 1 column mappings (Item numbers reference Form ADV sections)
const getCrd      = mkGet('firm_crd', 'crd_num', 'crd_number', 'crd', 'crdfirm');                 // Item 1.A
const getSecFile  = mkGet('sec_file_num', 'sec_file_number', 'file_number', 'sec_no', 'form_adv_file_no'); // Item 1.D
const getFirmName = mkGet('legal_name', 'legal_nm', 'firm_name', 'name', 'entity_name', 'adviser_name');  // Item 1.A
const getAum      = mkGet(                                                                          // Item 5.F
  'total_regulatory_assets', 'regulatory_aum', 'reg_assets_usd',
  'total_net_assets', 'total_assets', 'gross_assets', 'aum_usd', 'total_aum'
);
const getPrivFund    = mkGet('priv_fund_advis_flag', 'private_fund_adviser', 'private_fund_flag', 'is_priv_fund'); // Item 7.A
// Item 5.D — Types of Clients (Y/N columns, naming varies by export)
const getClientPooled  = mkGet('pooled_invst_vehicles_flag', 'client_pooled_vehicles', 'clients_pool', 'pooled_vehicles_flag');
const getClientHNW     = mkGet('hnw_individuals_flag', 'client_high_net_worth', 'clients_hnw', 'high_net_worth_flag');
const getClientPension = mkGet('pension_plans_flag', 'client_pension', 'clients_pension', 'pension_flag');
const getClientInstit  = mkGet('institutional_flag', 'client_institutional', 'clients_inst', 'institutions_flag');
const getClientRetail  = mkGet('individuals_flag', 'client_individuals', 'clients_ind', 'retail_individuals_flag');

// ── Helpers ───────────────────────────────────────────────────────────────────

const isY = (v) => v != null && /^(y|yes|true|1|x)$/i.test(String(v).trim());

function parseClientTypes(row) {
  const types = [];
  if (isY(getClientPooled(row)))  types.push('pooled_investment_vehicles');
  if (isY(getClientHNW(row)))     types.push('high_net_worth');
  if (isY(getClientPension(row))) types.push('pension_plans');
  if (isY(getClientInstit(row)))  types.push('institutional');
  if (isY(getClientRetail(row)))  types.push('individuals');
  return types;
}

function inferAdvSegment(firmName, clientTypes, hasPrivFund) {
  if (hasPrivFund || clientTypes.includes('pooled_investment_vehicles')) {
    if (/quant(?:itative)?|systematic|algo(?:rithm)?/i.test(firmName)) return 'quant_fund';
    return 'hedge_fund';
  }
  if (clientTypes.includes('pension_plans')) return 'pension';
  // Purely retail/HNW advisers — map to broker_dealer (closest available segment)
  if (clientTypes.length > 0 && clientTypes.every(t => ['individuals', 'high_net_worth'].includes(t))) {
    return 'broker_dealer';
  }
  return inferSegment(firmName); // fall back to name heuristics from computeSignals
}

// ── Bulk file download ────────────────────────────────────────────────────────

async function downloadCsvText(advBulkUrl, logger) {
  logger.info(`ADV: downloading bulk file from ${advBulkUrl}`);
  const res = await fetch(advBulkUrl, {
    headers: { 'User-Agent': 'LimeCRM-Ingestion/1.0 (contact@limex.com)' },
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        `ADV bulk file not found (404): ${advBulkUrl}\n` +
        'The SEC rotates this file quarterly. Get the current URL from:\n' +
        '  https://adviserinfo.sec.gov/compilation\n' +
        'and update advBulkUrl in the job definition (or paste it in the Run Now modal).'
      );
    }
    throw new Error(`ADV bulk file download failed: HTTP ${res.status} — ${advBulkUrl}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const url  = advBulkUrl.toLowerCase();
  const ct   = (res.headers.get('content-type') ?? '').toLowerCase();

  if (url.endsWith('.zip') || ct.includes('zip')) {
    logger.info(`ADV: decompressing ZIP (${(buf.length / 1e6).toFixed(1)} MB)`);
    const zip   = new AdmZip(buf);
    const entry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.csv'));
    if (!entry) throw new Error('ADV ZIP archive contains no .csv file — check the URL points to the IAPD bulk export');
    logger.info(`ADV: extracted ${entry.entryName}`);
    return zip.readAsText(entry);
  }

  if (url.endsWith('.gz') || ct.includes('gzip')) {
    logger.info(`ADV: decompressing GZIP (${(buf.length / 1e6).toFixed(1)} MB)`);
    return gunzipSync(buf).toString('utf8');
  }

  logger.info(`ADV: plain CSV (${(buf.length / 1e6).toFixed(1)} MB)`);
  return buf.toString('utf8');
}

// ── Connector ─────────────────────────────────────────────────────────────────

/** @type {import('../types.js').Connector} */
const advConnector = {
  key:          'ingest_adv',
  label:        'SEC Form ADV (Registered Investment Advisers)',
  jurisdiction: 'us',
  kind:         'discovery',

  /**
   * Download the quarterly bulk file and stream-parse it into candidate rows.
   * config.advBulkUrl is required; config.limit caps how many rows are returned.
   * config.minAum filters below-threshold advisers before they reach the engine.
   */
  async discover(config, ctx) {
    const { logger } = ctx;
    const { advBulkUrl, limit = 50, minAum } = config;

    if (!advBulkUrl) {
      throw new Error(
        'ADV jobs require advBulkUrl in config — set it in the job definition or provide it in the Run Now modal.\n' +
        'Get the current quarterly file URL from https://adviserinfo.sec.gov/compilation'
      );
    }

    const csvText = await downloadCsvText(advBulkUrl, logger);

    // Stream-parse so we never hold all ~17 K rows in memory simultaneously
    const stream = Readable.from([csvText]).pipe(
      csvParse({
        columns:             h => h.map(normalizeHeader),
        skip_empty_lines:    true,
        trim:                true,
        relax_quotes:        true,
        relax_column_count:  true,
      })
    );

    const candidates = [];
    let scanned = 0;

    for await (const row of stream) {
      scanned++;
      const crdRaw  = getCrd(row);
      const name    = getFirmName(row);
      if (!crdRaw || !name) continue;

      const crdNumber = String(crdRaw).replace(/\D/g, '');
      if (!crdNumber) continue;

      // Early AUM filter — avoids engine overhead for below-threshold advisers
      if (minAum != null) {
        const rawAum = parseFloat(getAum(row) ?? '0');
        if (!isNaN(rawAum) && rawAum > 0 && rawAum < minAum) continue;
      }

      candidates.push({ firmName: name, crdNumber, _row: row });
      if (limit && candidates.length >= limit) break;
    }

    logger.info(`ADV: scanned ${scanned} rows → ${candidates.length} candidates (limit ${limit})`);
    return candidates;
  },

  /**
   * Part 1 data is already in the candidate row from discover() — pass through.
   * FUTURE: fetch Part 2 brochure PDF for keyword enrichment:
   *   e.g. GET https://adviserinfo.sec.gov/firm/summary/{crdNumber}
   *   and parse the PDF brochure for AUM narrative, strategy keywords, key personnel.
   */
  async fetch(filer, _config, _ctx) {
    return [filer._row];
  },

  /**
   * Map a raw ADV Part 1 CSV row to the FirmSignal contract.
   * Column references: Item numbers from Form ADV Part 1A.
   * AUM (Item 5.F) is taken as-is in USD from the bulk export.
   */
  normalize(filer, [rawRow]) {
    const { firmName, crdNumber } = filer;

    // Item 1.D — SEC file number
    const secNumber = getSecFile(rawRow) ?? null;

    // Item 5.F — Regulatory AUM (reported in USD in IAPD bulk exports)
    const rawAum        = parseFloat(getAum(rawRow) ?? '0');
    const regulatoryAum = isNaN(rawAum) || rawAum <= 0 ? 0 : rawAum;

    // Item 5.D — Types of clients
    const clientTypes = parseClientTypes(rawRow);

    // Item 7.A — Private fund adviser flag
    const hasPrivFund = isY(getPrivFund(rawRow));
    const advFlags    = { hasPrivateFundClients: hasPrivFund };

    const inferred_segment = inferAdvSegment(firmName, clientTypes, hasPrivFund);

    return {
      firmName,
      crdNumber,
      secNumber,
      cik:                    null,   // ADV primary key is CRD; CIK may be added later if available
      source:                 'sec_adv',
      source_url:             `https://adviserinfo.sec.gov/firm/summary/${crdNumber}`,
      estimated_aum_usd:      regulatoryAum,
      position_count:         0,      // ADV Part 1 has no holdings; AUM carries the size signal
      portfolio_turnover_pct: null,
      equities_pct:           0,
      options_present:        false,
      inferred_segment,
      clientTypes,
      advFlags,
      regulatoryAum,
      quarters: [],                   // no filing quarters for ADV Part 1
    };
  },
};

export default advConnector;

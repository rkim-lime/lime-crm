/**
 * SEC Form ADV connector — bulk Part 1 XML ingestion.
 *
 * Source: SEC IAPD quarterly firm feed (GZ-compressed XML)
 *   https://adviserinfo.sec.gov/compilation
 *
 * File format confirmed from live file (2026-06-24):
 *   <IAPDFirmSECReport> → <Firms> → <Firm>  (container + repeating element)
 *   All data stored in XML *attributes*, not element text.
 *   XML declaration: encoding="ISO-8859-1"; decoded as latin1.
 *
 * Field mapping (Q-codes confirmed against live file):
 *   CRD number  : <Info @_FirmCrdNb>
 *   Legal name  : <Info @_LegalNm>  (fallback: @_BusNm)
 *   SEC file no : <Info @_SECNb>
 *   Total AUM   : <Item5F @_Q5F2C>  (USD, disc + non-disc; absent when Q5F1="N")
 *   Client types: <Item5D @_Q5DX1>  count attributes (positive = active)
 *   Private fund: <Item7A>           empty string = no; object = yes
 */

import { createGunzip }      from 'zlib';
import { XMLParser }          from 'fast-xml-parser';
import { deriveAdvSegment }   from '../../engine/computeSignals.js';
import { resolveAdvBulkUrl }  from './resolveBulkUrl.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const FIRM_EL   = 'Firm';
const OPEN_PRE  = `<${FIRM_EL}`;    // '<Firm'
const CLOSE_TAG = `</${FIRM_EL}>`; // '</Firm>'

// ── XML parser (module-level singleton) ───────────────────────────────────────

const PARSER = new XMLParser({
  ignoreAttributes:    false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
  trimValues:          true,
  isArray:             () => false,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// Case-insensitive deep dot-path lookup.
function getPath(obj, dotPath) {
  let cur = obj;
  for (const part of dotPath.split('.')) {
    if (cur == null || typeof cur !== 'object') return null;
    const k = Object.keys(cur).find(k => k.toLowerCase() === part.toLowerCase());
    cur = k !== undefined ? cur[k] : null;
  }
  return cur ?? null;
}

// True when an Item5D count attribute is a positive integer.
// Q5DX1 = number of clients of type X; absent or 0 = none.
function hasCount(firm, qcode) {
  const v = getPath(firm, `FormInfo.Part1A.Item5D.@_${qcode}`);
  return v != null && Number(v) > 0;
}

// Parse a raw <Firm>…</Firm> XML string into a JS object (the Firm node).
function firmObjFromXml(firmXml) {
  const parsed = PARSER.parse(firmXml);
  return parsed[FIRM_EL] ?? parsed;
}

// ── Field extraction (exported so test-adv-parse.js can call the real logic) ──

/**
 * Extract a FirmSignal from an already-parsed Firm object.
 * Returns null if the block is missing the minimum identity fields.
 */
export function normalizeFromFirm(firm) {
  // ── Identity ──────────────────────────────────────────────────────────────
  const crdRaw    = getPath(firm, 'Info.@_FirmCrdNb');
  const crdNumber = crdRaw ? String(crdRaw).replace(/\D/g, '') || null : null;
  const firmName  = getPath(firm, 'Info.@_LegalNm') ?? getPath(firm, 'Info.@_BusNm');
  const secNumber = getPath(firm, 'Info.@_SECNb') ?? null;

  if (!crdNumber || !firmName) return null;

  // ── AUM — Item 5.F ────────────────────────────────────────────────────────
  // Q5F1 = "Y"/"N" — whether the firm has regulatory AUM (not the dollar figure)
  // Q5F2C = total regulatory AUM in USD (discretionary Q5F2A + non-disc Q5F2B)
  // Absent / "Y" / "N" → null (private-fund-only advisers legitimately have no SMA AUM)
  const aumRaw         = getPath(firm, 'FormInfo.Part1A.Item5F.@_Q5F2C');
  const aumIsNumeric   = aumRaw != null && aumRaw !== '' && aumRaw !== 'Y' && aumRaw !== 'N';
  const regulatoryAum  = aumIsNumeric
    ? (parseFloat(String(aumRaw).replace(/[^0-9.]/g, '')) || 0)
    : null;

  // ── Client types — Item 5.D (count-based) ─────────────────────────────────
  // Q5DX1 = count of clients of type X; positive = adviser has that client type.
  //   Q5DA = Individuals (non-HNW)           Q5DB = High net worth individuals
  //   Q5DC = Banking/thrift institutions      Q5DD = Investment companies (mutual funds)
  //   Q5DE = Business development companies  Q5DF = Pension/profit-sharing (non-gov)
  //   Q5DH = State/municipal gov entities     Q5DI = Other investment advisers
  //   Q5DJ = Insurance companies              Q5DK = Sovereign wealth funds
  //   Q5DM = Pooled investment vehicles (hedge funds, private equity, etc.)
  const clientTypes = [
    hasCount(firm, 'Q5DM1') && 'pooled_investment_vehicles',
    hasCount(firm, 'Q5DB1') && 'high_net_worth',
    (hasCount(firm, 'Q5DF1') || hasCount(firm, 'Q5DH1')) && 'pension_plans',
    (hasCount(firm, 'Q5DC1') || hasCount(firm, 'Q5DI1') ||
     hasCount(firm, 'Q5DJ1') || hasCount(firm, 'Q5DK1')) && 'institutional',
    hasCount(firm, 'Q5DA1') && 'individuals',
  ].filter(Boolean);

  // ── Private fund adviser — Item 7.A ───────────────────────────────────────
  // fast-xml-parser parses empty self-closing tags as "" (string).
  // When Item7A has content (Q7A1..Q7A16 attributes), it parses as an object.
  // An object value = this firm advises at least one private fund.
  const item7A = getPath(firm, 'FormInfo.Part1A.Item7A');
  const hasPrivateFundClients = item7A != null && item7A !== '' && typeof item7A === 'object';

  // ── Inferred segment — see deriveAdvSegment() in computeSignals.js for rules.
  // This is a composition-only best-effort (no name-signal config here) used for
  // the discover-phase filerTypes filter and the initial column. The AUTHORITATIVE
  // segment (segment_canonical) is recomputed in normalizeFirm with the full
  // name-signal config. Confidence is set in extractSignals (normalize.js).
  const { value: inferred_segment } = deriveAdvSegment(firmName, clientTypes, hasPrivateFundClients);

  return {
    firmName,
    crdNumber,
    secNumber,
    cik:                    null,   // ADV primary key is CRD, not CIK
    source:                 'sec_adv',
    source_url:             `https://adviserinfo.sec.gov/firm/summary/${crdNumber}`,
    estimated_aum_usd:      regulatoryAum ?? 0,  // 0 when not reported (engine-safe)
    position_count:         0,      // ADV Part 1 has no holdings data
    portfolio_turnover_pct: null,
    equities_pct:           0,
    options_present:        false,
    inferred_segment,
    clientTypes,
    advFlags: { hasPrivateFundClients },
    regulatoryAum,          // null = not reported in Item 5.F (private-fund-only advisers)
    quarters: [],
  };
}

/**
 * Convenience: parse a raw <Firm>…</Firm> XML string directly to FirmSignal.
 * Exported for use by test-adv-parse.js.
 */
export function parseFirmBlock(firmXml) {
  return normalizeFromFirm(firmObjFromXml(firmXml));
}

// ── Streaming XML block extractor ─────────────────────────────────────────────

/**
 * Stream-decompress the .gz file and yield <Firm> blocks until `limit` passing
 * candidates are collected or the stream ends.
 *
 * Memory strategy: accumulate decompressed bytes in a string buffer, scan for
 * complete <Firm>…</Firm> blocks as they arrive, process each immediately, and
 * trim the buffer. The download is aborted as soon as `limit` is reached.
 */
async function streamFirms(url, userAgent, limit, minAum, logger) {
  logger.info(`ADV: GET ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': userAgent } });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        `ADV bulk file not found (404): ${url}\n` +
        'The SEC rotates this file quarterly. Get the current URL from:\n' +
        '  https://adviserinfo.sec.gov/compilation\n' +
        'then paste it in the Run Now modal or save it in the job definition.'
      );
    }
    throw new Error(`ADV bulk file HTTP ${res.status}: ${url}`);
  }

  const gz         = createGunzip();
  let   buf        = '';
  let   stopped    = false;
  let   scanned    = 0;
  const candidates = [];

  // Scan buf for complete <Firm> blocks; process each one synchronously.
  const drainBuffer = () => {
    while (candidates.length < limit) {
      // Word-boundary-safe scan: <Firm must be followed by >, space, or /
      // to avoid matching the <Firms> container.
      let s = buf.indexOf(OPEN_PRE);
      while (s >= 0) {
        const next = buf[s + OPEN_PRE.length];
        if (!next || /[\s>\/]/.test(next)) break;
        s = buf.indexOf(OPEN_PRE, s + 1);
      }
      if (s < 0) {
        // No opening found — keep a small tail to handle chunk-split tags
        buf = buf.length > 20 ? buf.slice(-20) : buf;
        break;
      }

      const e = buf.indexOf(CLOSE_TAG, s);
      if (e < 0) {
        // Opening found but no closing yet — wait for more data
        buf = buf.slice(s);
        break;
      }

      const block = buf.slice(s, e + CLOSE_TAG.length);
      buf = buf.slice(e + CLOSE_TAG.length);
      scanned++;

      try {
        const firm = firmObjFromXml(block);
        const { crdNumber, firmName, aum, hasPriv } = quickMeta(firm);
        if (!crdNumber || !firmName) continue;

        // minAum filter:
        //   - Skip if AUM is reported, below threshold, and not a private fund adviser.
        //   - Private-fund-only advisers (null AUM) always pass — their AUM is
        //     legitimately blank, not zero.
        //   - Firms with unreported AUM that aren't private funds also pass through
        //     (can't make a call without data).
        if (minAum != null && aum !== null && !hasPriv && aum < minAum) continue;

        candidates.push({ firmName, crdNumber, _firm: firm });
      } catch {
        // skip malformed blocks silently
      }
    }

    if (candidates.length >= limit) stopped = true;
  };

  await new Promise((resolve, reject) => {
    let settled = false;
    const settle = () => { if (!settled) { settled = true; resolve(); } };
    const fail   = (err) => { if (!settled) { settled = true; reject(err); } };

    gz.on('data', chunk => {
      if (stopped) return;
      buf += chunk.toString('latin1'); // ISO-8859-1 per XML declaration
      drainBuffer();
    });
    gz.on('end',   settle);
    gz.on('close', settle);
    gz.on('error', err => { if (stopped) settle(); else fail(err); });

    const reader = res.body.getReader();
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done)    { gz.end(); break; }
          if (stopped) { gz.destroy(); await reader.cancel().catch(() => {}); break; }
          gz.write(value);
        }
      } catch (err) {
        if (!stopped) fail(err);
      }
    })();
  });

  logger.info(`ADV: scanned ${scanned} firms → ${candidates.length} candidates (limit ${limit})`);
  return candidates;
}

// Lightweight meta extraction for discover-phase filtering (avoids full signal build)
function quickMeta(firm) {
  const crdRaw = getPath(firm, 'Info.@_FirmCrdNb');
  const crdNumber = crdRaw ? String(crdRaw).replace(/\D/g, '') || null : null;
  const firmName  = getPath(firm, 'Info.@_LegalNm') ?? getPath(firm, 'Info.@_BusNm');
  const aumRaw    = getPath(firm, 'FormInfo.Part1A.Item5F.@_Q5F2C');
  const aumIsNum  = aumRaw != null && aumRaw !== '' && aumRaw !== 'Y' && aumRaw !== 'N';
  const aum       = aumIsNum ? (parseFloat(String(aumRaw).replace(/[^0-9.]/g, '')) || 0) : null;
  const item7A    = getPath(firm, 'FormInfo.Part1A.Item7A');
  const hasPriv   = item7A != null && item7A !== '' && typeof item7A === 'object';
  return { crdNumber, firmName, aum, hasPriv };
}

// ── Connector ─────────────────────────────────────────────────────────────────

/** @type {import('../types.js').Connector} */
const advConnector = {
  key:          'ingest_adv',
  label:        'SEC Form ADV (Registered Investment Advisers)',
  jurisdiction: 'us',
  kind:         'discovery',

  async discover(config, ctx) {
    const { limit = 50, minAum } = config;
    const { logger } = ctx;

    let bulkUrl;
    if (config.advBulkUrl) {
      // Manual override — explicit URL always wins (Run Now modal or saved config)
      bulkUrl = config.advBulkUrl;
      logger.info(`ADV: using manually-specified bulk URL: ${bulkUrl}`);
    } else {
      // Autonomous/scheduled run — resolve the URL automatically by probing
      // date-based SEC filenames for the most recent published file.
      bulkUrl = await resolveAdvBulkUrl(ctx);
    }

    const userAgent = process.env.SEC_USER_AGENT ?? 'lime-crm-ingestion/1.0 (contact@limex.com)';
    return streamFirms(bulkUrl, userAgent, limit, minAum, logger);
  },

  async fetch(filer, _config, _ctx) {
    // Part 1 data is already in _firm from discover() — pass it through.
    // FUTURE: fetch Part 2 brochure PDF for keyword enrichment:
    //   GET https://adviserinfo.sec.gov/firm/summary/{crdNumber}
    //   Parse the PDF for AUM narrative, strategy keywords, key personnel.
    return [filer._firm];
  },

  normalize(filer, [firm]) {
    return normalizeFromFirm(firm);
  },
};

export default advConnector;

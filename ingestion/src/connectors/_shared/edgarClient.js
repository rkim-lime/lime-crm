import { config } from '../../config.js';
import { logger }  from '../../utils/logger.js';

const EDGAR_BASE = 'https://www.sec.gov';
const EDGAR_DATA = 'https://data.sec.gov';
const EDGAR_EFTS = 'https://efts.sec.gov';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function secFetch(url, retries = 4) {
  await sleep(300); // stay well under EDGAR's 10 req/s limit
  const headers = {
    'User-Agent': config.secUserAgent,
    'Accept':     'application/json, text/xml, text/html, */*',
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers });
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(attempt * 2000);
      continue;
    }

    if (res.status === 429 || res.status === 503) {
      const wait = attempt * 5000;
      logger.warn(`Rate limited (${res.status}) — waiting ${wait}ms (attempt ${attempt}/${retries})`);
      await sleep(wait);
      if (attempt === retries) throw new Error(`Rate limited after ${retries} retries: ${url}`);
      continue;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return res;
  }
}

const secJson = async (url) => (await secFetch(url)).json();
const secText = async (url) => (await secFetch(url)).text();

// Zero-pad CIK to 10 digits for the submissions API
const padCik = (cik) => String(cik).replace(/^0+/, '').padStart(10, '0');

/**
 * Get recent 13F-HR filers via EDGAR full-text search.
 * Returns [{ cik, firmName, accessionNo, filedAt, periodOfReport }]
 *
 * EDGAR EFTS field names (verified from live API):
 *   ciks[]          — zero-padded CIK strings
 *   display_names[] — "FIRM NAME  (CIK 0000000000)"
 *   adsh            — accession number with dashes e.g. "0001234567-26-001234"
 *   file_date       — YYYY-MM-DD
 *   period_ending   — YYYY-MM-DD (period of report)
 *
 * Note: q= (empty) returns 500; must use q="13F-HR" or category=form-type.
 */
export async function getRecent13FFilers(limit = 50) {
  const now       = new Date();
  const startDate = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const endDate   = now.toISOString().slice(0, 10);

  const url = `${EDGAR_EFTS}/LATEST/search-index?q=%2213F-HR%22&forms=13F-HR`
    + `&dateRange=custom&startdt=${startDate}&enddt=${endDate}`;

  logger.info(`Searching for recent 13F filers (${startDate} → ${endDate})`);
  const data = await secJson(url);
  const hits = data?.hits?.hits ?? [];

  // Deduplicate by CIK — keep only the most-recent filing per firm
  const seen = new Set();
  const results = [];

  for (const h of hits) {
    const src       = h._source;
    const cik       = (src.ciks?.[0] ?? '').replace(/^0+/, '');
    const accessionNo = src.adsh ?? '';
    if (!cik || !accessionNo || seen.has(cik)) continue;
    seen.add(cik);

    // display_names format: "FIRM NAME  (CIK 0000000000)"
    const firmName = (src.display_names?.[0] ?? 'Unknown')
      .replace(/\s*\(CIK \d+\)\s*$/, '').trim();

    results.push({
      cik,
      firmName,
      accessionNo,
      filedAt:        src.file_date     ?? '',
      periodOfReport: src.period_ending ?? '',
    });

    if (results.length >= limit) break;
  }

  return results;
}

/**
 * Get the most recent N 13F-HR filings for a CIK.
 * Returns [{ accessionNo, filedAt, periodOfReport }] newest first.
 */
export async function getFilingHistory(cik, limit = 3) {
  const url  = `${EDGAR_DATA}/submissions/CIK${padCik(cik)}.json`;
  const data = await secJson(url);

  const r = data?.filings?.recent ?? {};
  const forms      = r.form            ?? [];
  const accessions = r.accessionNumber ?? [];
  const dates      = r.filingDate      ?? [];
  const reports    = r.reportDate      ?? [];

  const results = [];
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] === '13F-HR') {
      results.push({ accessionNo: accessions[i], filedAt: dates[i], periodOfReport: reports[i] });
      if (results.length >= limit) break;
    }
  }
  return results;
}

function resolveEdgarHref(href, baseUrl) {
  if (href.startsWith('http')) return href;
  if (href.startsWith('/'))    return `${EDGAR_BASE}${href}`;
  return `${baseUrl}/${href}`;
}

/**
 * Fetch the information table XML from a 13F filing.
 * Strategy:
 *  1. Fetch the index HTML and try all XML links except primary_doc/cover,
 *     prioritising links whose name contains 'infotable' / 'information'.
 *  2. Fall back to a list of common filenames.
 */
export async function getFilingDocument(cik, accessionNo) {
  const accNoDashes = accessionNo.replace(/-/g, '');
  const numericCik  = parseInt(cik, 10);
  const baseUrl     = `${EDGAR_BASE}/Archives/edgar/data/${numericCik}/${accNoDashes}`;

  // 1. Parse the filing index HTML for XML document links
  let indexHtml = '';
  try {
    indexHtml = await secText(`${baseUrl}/${accNoDashes}-index.htm`);
  } catch { /* fall through to direct filenames */ }

  if (indexHtml) {
    // Extract all .xml hrefs, skip cover/primary documents
    const xmlHrefs = [...indexHtml.matchAll(/href="([^"]*\.xml)"/gi)]
      .map(m => m[1])
      .filter(h => !/(primary_doc|cover|xbrl)/i.test(h));

    // Try infotable-named links first, then any remaining XML
    const ordered = [
      ...xmlHrefs.filter(h => /infotable|information/i.test(h)),
      ...xmlHrefs.filter(h => !/infotable|information/i.test(h)),
    ];

    for (const href of ordered) {
      try {
        const xml = await secText(resolveEdgarHref(href, baseUrl));
        if (xml.includes('infoTable') || xml.includes('informationTable')) return xml;
      } catch { /* try next */ }
    }
  }

  // 2. Try common filenames directly (covers filers with no index or unusual structure)
  const candidates = [
    'infotable.xml',
    'form13fInfoTable.xml',
    'InformationTable.xml',
    `${accNoDashes}-0002.txt`,
    `${accNoDashes}-0003.txt`,
  ];
  for (const name of candidates) {
    try {
      const xml = await secText(`${baseUrl}/${name}`);
      if (xml.includes('infoTable') || xml.includes('informationTable')) return xml;
    } catch { /* try next */ }
  }

  throw new Error(`Could not find information table for ${accessionNo}`);
}

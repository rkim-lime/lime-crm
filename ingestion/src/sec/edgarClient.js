import { config } from '../config.js';
import { logger }  from '../utils/logger.js';

const EDGAR_BASE = 'https://www.sec.gov';
const EDGAR_DATA = 'https://data.sec.gov';
const EDGAR_EFTS = 'https://efts.sec.gov';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function secFetch(url, retries = 3) {
  await sleep(120); // ~8 req/s — stay under EDGAR's 10 req/s limit
  const headers = {
    'User-Agent': config.secUserAgent,
    'Accept':     'application/json, text/xml, text/html, */*',
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 429 || res.status === 503) {
        const wait = attempt * 3000;
        logger.warn(`Rate limited (${res.status}) — waiting ${wait}ms (attempt ${attempt})`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(attempt * 1500);
    }
  }
}

const secJson = async (url) => (await secFetch(url)).json();
const secText = async (url) => (await secFetch(url)).text();

// Zero-pad CIK to 10 digits for the submissions API
const padCik = (cik) => String(cik).replace(/^0+/, '').padStart(10, '0');

/**
 * Get recent 13F-HR filers via EDGAR full-text search.
 * Returns [{ cik, firmName, accessionNo, filedAt, periodOfReport }]
 */
export async function getRecent13FFilers(limit = 50) {
  const now       = new Date();
  const startDate = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const endDate   = now.toISOString().slice(0, 10);

  const url = `${EDGAR_EFTS}/LATEST/search-index?q=&forms=13F-HR`
    + `&dateRange=custom&startdt=${startDate}&enddt=${endDate}`;

  logger.info(`Searching for recent 13F filers (${startDate} → ${endDate})`);
  const data = await secJson(url);
  const hits = data?.hits?.hits ?? [];

  return hits.slice(0, limit).map(h => ({
    cik:            (h._source.ciks?.[0] ?? '').replace(/^0+/, ''),
    firmName:       h._source.entity_name   ?? 'Unknown',
    accessionNo:    h._source.accession_no  ?? '',
    filedAt:        h._source.file_date     ?? '',
    periodOfReport: h._source.period_of_report ?? '',
  })).filter(f => f.cik && f.accessionNo);
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

/**
 * Fetch the information table XML from a 13F filing.
 * Tries the filing index HTML first, then falls back to common filenames.
 */
export async function getFilingDocument(cik, accessionNo) {
  const accNoDashes = accessionNo.replace(/-/g, '');
  const numericCik  = parseInt(cik, 10);
  const baseUrl     = `${EDGAR_BASE}/Archives/edgar/data/${numericCik}/${accNoDashes}`;

  // 1. Fetch filing index to locate the information table document
  let indexHtml = '';
  try {
    indexHtml = await secText(`${baseUrl}/${accNoDashes}-index.htm`);
  } catch {
    try { indexHtml = await secText(`${baseUrl}/`); } catch { /* ignore */ }
  }

  // 2. Extract information table document link from the index HTML
  const xmlMatch = indexHtml.match(
    /href="([^"]*(?:infotable|information[-_]?table|form13finfotable)[^"]*\.xml)"/i
  ) ?? indexHtml.match(/href="([^"]*\.xml)"/i);

  if (xmlMatch) {
    const href   = xmlMatch[1];
    const docUrl = href.startsWith('http') ? href : `${baseUrl}/${href.replace(/^\//, '')}`;
    const xml    = await secText(docUrl);
    if (xml.includes('infoTable') || xml.includes('informationTable')) return xml;
  }

  // 3. Fallback to common filenames
  for (const name of ['infotable.xml', 'form13fInfoTable.xml', `${accNoDashes}-0002.txt`, `${accNoDashes}-0003.txt`]) {
    try {
      const xml = await secText(`${baseUrl}/${name}`);
      if (xml.includes('infoTable') || xml.includes('informationTable')) return xml;
    } catch { /* try next */ }
  }

  throw new Error(`Could not find information table for ${accessionNo}`);
}

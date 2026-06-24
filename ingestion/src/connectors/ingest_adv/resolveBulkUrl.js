/**
 * ADV bulk-URL auto-resolver.
 *
 * The IAPD firm feed URL follows the pattern:
 *   https://reports.adviserinfo.sec.gov/reports/CompilationReports/IA_FIRM_SEC_Feed_<MM_DD_YYYY>.xml.gz
 *
 * The SEC does not publish a machine-readable index of available files
 * (the compilation page at adviserinfo.sec.gov/compilation is a JS SPA
 * whose network calls fetch rendered HTML, not a JSON manifest).
 *
 * Strategy:
 *   PRIMARY  — walk back from today up to LOOKBACK_DAYS, probing each date
 *              with a HEAD request. Return the first (most recent) URL that
 *              returns HTTP 200. The SEC publishes updates on a regular but
 *              non-daily cadence, so the live file is typically 1–7 days old.
 *   FALLBACK — if no date-based URL resolves, throw a clear error with the
 *              full list of attempted URLs so the operator can check manually.
 */

const BASE = 'https://reports.adviserinfo.sec.gov/reports/CompilationReports';
const LOOKBACK_DAYS    = 14;
const PROBE_DELAY_MS   = 250; // conservative — SEC limit is ~10 req/s

/** Format a JS Date as MM_DD_YYYY (zero-padded). */
function dateToSlug(d) {
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}_${dd}_${yyyy}`;
}

/**
 * Probe a URL via HEAD and return true if it resolves to HTTP 200.
 * Non-200 responses (including 403/404) are treated as "not found".
 * Network errors are caught and treated as misses (logged as warnings).
 */
async function probeUrl(url, userAgent, logger) {
  try {
    const res = await fetch(url, {
      method:  'HEAD',
      headers: { 'User-Agent': userAgent },
    });
    return res.ok;
  } catch (err) {
    logger.warn(`ADV URL probe network error for ${url}: ${err.message}`);
    return false;
  }
}

/**
 * Auto-resolve the current ADV IAPD bulk-file URL.
 *
 * @param {{ logger: import('../../utils/logger.js').Logger }} ctx
 * @returns {Promise<string>} The resolved https:// URL
 * @throws {Error} If no URL resolves within LOOKBACK_DAYS
 */
export async function resolveAdvBulkUrl(ctx) {
  const { logger } = ctx;
  const userAgent  = process.env.SEC_USER_AGENT ?? 'lime-crm-ingestion/1.0 (contact@limex.com)';

  logger.info(`ADV: auto-resolving bulk URL (probing last ${LOOKBACK_DAYS} days)`);

  const attempted = [];
  const today     = new Date();

  for (let i = 0; i < LOOKBACK_DAYS; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    const slug     = dateToSlug(date);
    const filename = `IA_FIRM_SEC_Feed_${slug}.xml.gz`;
    const url      = `${BASE}/${filename}`;
    attempted.push(url);

    logger.debug(`ADV probe [${i + 1}/${LOOKBACK_DAYS}]: HEAD ${url}`);

    const found = await probeUrl(url, userAgent, logger);
    if (found) {
      const age = i === 0 ? 'today' : `${i} day${i === 1 ? '' : 's'} ago`;
      logger.info(`ADV: resolved bulk URL (published ${age}): ${url}`);
      return url;
    }

    // Throttle between probes — don't hammer the SEC server
    if (i < LOOKBACK_DAYS - 1) {
      await new Promise(r => setTimeout(r, PROBE_DELAY_MS));
    }
  }

  // ── Fallback note ────────────────────────────────────────────────────────────
  //
  // The adviserinfo.sec.gov/compilation page is a JS SPA (Angular) that renders
  // its file list client-side. The underlying API calls are not publicly documented.
  //
  // If you need to extend this resolver, open the compilation page in DevTools →
  // Network tab and look for XHR/fetch calls to identify the file-listing endpoint.
  // Common patterns to investigate:
  //   https://api.adviserinfo.sec.gov/                          (IAPD API root)
  //   https://reports.adviserinfo.sec.gov/reports/              (reports root)
  //   https://efts.sec.gov/LATEST/search-index/                 (EDGAR FTS)
  //
  // If a JSON endpoint is found that lists CompilationReports files, add the
  // fetch + parse logic here before the throw below.

  throw new Error(
    `ADV: could not auto-resolve bulk URL — no file found in the last ${LOOKBACK_DAYS} days.\n` +
    'Set advBulkUrl manually in the job config (or in the Run Now modal).\n' +
    'Get the current file from: https://adviserinfo.sec.gov/compilation\n\n' +
    `Last ${attempted.length} URLs probed:\n` +
    attempted.map(u => `  ${u}`).join('\n')
  );
}

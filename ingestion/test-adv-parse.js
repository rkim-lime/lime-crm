#!/usr/bin/env node
/**
 * test-adv-parse.js — ADV XML parse verification tool.
 *
 * Downloads the IAPD firm .gz feed, decompresses it, extracts 5 <Firm>
 * records, and passes each through the REAL connector's parseFirmBlock()
 * function. This verifies the connector itself, not a copy of its logic.
 *
 * No database writes. Safe to run at any time.
 * Usage:  node test-adv-parse.js
 */

import { createGunzip } from 'zlib';
import { readFileSync }  from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Import the REAL connector's parse function ────────────────────────────────
import { parseFirmBlock } from './src/connectors/ingest_adv/index.js';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── .env ──────────────────────────────────────────────────────────────────────
let SEC_USER_AGENT = 'lime-crm-ingestion/1.0 (contact@limex.com)';
try {
  const raw = readFileSync(join(__dir, '.env'), 'utf8');
  const m   = raw.match(/^SEC_USER_AGENT\s*=\s*(.+)$/m);
  if (m) SEC_USER_AGENT = m[1].trim().replace(/^["']|["']$/g, '');
} catch { /* no .env — use default */ }

const ADV_URL   = 'https://reports.adviserinfo.sec.gov/reports/CompilationReports/IA_FIRM_SEC_Feed_06_24_2026.xml.gz';
const SAMPLE    = 5;
const MAX_BYTES = 12_000_000; // 12 MB decompressed head — plenty for 5+ records

const FIRM_EL   = 'Firm';
const OPEN_PRE  = `<${FIRM_EL}`;
const CLOSE_TAG = `</${FIRM_EL}>`;

// ── Stream-decompress first MAX_BYTES of the feed ────────────────────────────
async function streamHead(url, maxBytes) {
  console.log(`\nGET ${url}`);
  console.log(`User-Agent: ${SEC_USER_AGENT}`);
  const res = await fetch(url, { headers: { 'User-Agent': SEC_USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const gz     = createGunzip();
  const chunks = [];
  let outBytes = 0;
  let stopped  = false;

  const result = new Promise((resolve, reject) => {
    let settled = false;
    const settle = (val) => { if (!settled) { settled = true; resolve(val); } };
    const fail   = (err)  => { if (!settled) { settled = true; reject(err); } };

    gz.on('data',  chunk => { chunks.push(chunk); outBytes += chunk.length; });
    gz.on('end',   ()    => settle(Buffer.concat(chunks).toString('latin1')));
    gz.on('close', ()    => settle(Buffer.concat(chunks).toString('latin1')));
    gz.on('error', err   => { if (stopped) settle(Buffer.concat(chunks).toString('latin1')); else fail(err); });
  });

  const endGz = () => { if (!stopped) { stopped = true; gz.destroy(); } };
  const reader = res.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { gz.end(); break; }
      gz.write(value);
      if (outBytes >= maxBytes) { endGz(); reader.cancel().catch(() => {}); break; }
    }
  } catch (err) {
    if (!stopped) { stopped = true; gz.destroy(); }
    throw err;
  }

  return result;
}

// ── Structure detection ───────────────────────────────────────────────────────
function detectStructure(xml) {
  const stripped = xml.replace(/<\?xml[^>]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  const rootM    = stripped.match(/^<([A-Za-z][^\s\/>]*)/);
  if (!rootM) throw new Error('Cannot detect root XML element');
  const root = rootM[1];
  const afterRoot   = stripped.replace(/^<[^>]+>/, '').trim();
  const child1M     = afterRoot.match(/^<([A-Za-z][^\s\/>]*)/);
  const child1      = child1M?.[1] ?? null;
  if (!child1) return { root, containerEl: null, firmEl: null };
  const afterChild1 = afterRoot.replace(/^<[^>]+>/, '').trim();
  const child2M     = afterChild1.match(/^<([A-Za-z][^\s\/>]*)/);
  const child2      = child2M?.[1] ?? null;
  if (child2 && child2 !== child1) return { root, containerEl: child1, firmEl: child2 };
  return { root, containerEl: null, firmEl: child1 };
}

// ── Block extractor (word-boundary safe) ─────────────────────────────────────
function extractBlocks(xml, firmEl, n) {
  const openPrefix = `<${firmEl}`;
  const closeTag   = `</${firmEl}>`;
  const blocks     = [];
  let pos = 0;
  while (blocks.length < n) {
    let s = xml.indexOf(openPrefix, pos);
    while (s >= 0) {
      const next = xml[s + openPrefix.length];
      if (!next || /[\s>\/]/.test(next)) break;
      s = xml.indexOf(openPrefix, s + 1);
    }
    if (s < 0) break;
    const e = xml.indexOf(closeTag, s);
    if (e < 0) break;
    blocks.push(xml.slice(s, e + closeTag.length));
    pos = e + closeTag.length;
  }
  return blocks;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60));
  console.log('ADV XML PARSE TEST  (using real connector logic)');
  console.log('='.repeat(60));

  // 1. Download + decompress head
  const xml = await streamHead(ADV_URL, MAX_BYTES);
  console.log(`\nDecompressed head : ${(xml.length / 1e6).toFixed(2)} MB`);

  // 2. Confirm XML
  if (!xml.trimStart().startsWith('<?xml') && !xml.trimStart().startsWith('<')) {
    console.error('\n⚠ NOT XML — first 300 chars:');
    console.error(xml.slice(0, 300));
    process.exit(1);
  }
  console.log('Content           : XML ✓');

  // 3. Detect structure
  const { root, containerEl, firmEl } = detectStructure(xml);
  console.log(`Root element      : <${root}>`);
  if (containerEl) console.log(`Container element : <${containerEl}>`);
  console.log(`Firm element      : <${firmEl ?? '(not detected)'}>`);

  if (!firmEl) {
    console.log('\nCould not auto-detect firm element. XML head (800 chars):');
    console.log(xml.slice(0, 800));
    process.exit(1);
  }

  // 4. Extract 5 firm blocks
  const blocks = extractBlocks(xml, firmEl, SAMPLE);
  console.log(`Extracted         : ${blocks.length} complete <${firmEl}> blocks\n`);

  if (!blocks.length) {
    console.log(`No complete blocks in ${(xml.length / 1e6).toFixed(1)} MB head.`);
    console.log(xml.slice(0, 1000));
    process.exit(1);
  }

  // 5. Parse each block through the REAL connector's parseFirmBlock()
  console.log('='.repeat(60));
  console.log('FIRM SIGNAL EXTRACTION — connector parseFirmBlock()');
  console.log('='.repeat(60));

  let allGood = true;
  for (let i = 0; i < blocks.length; i++) {
    const signal = parseFirmBlock(blocks[i]);

    console.log(`\n── Record ${i + 1} ──────────────────────────────────`);

    if (!signal) {
      console.log('  ✗ parseFirmBlock() returned null (missing CRD or name)');
      allGood = false;
      continue;
    }

    const gaps = [
      !signal.crdNumber  && 'crdNumber',
      !signal.firmName   && 'firmName',
      // clientTypes empty is EXPECTED for private-fund-only advisers (no SMAs)
      signal.clientTypes.length === 0 && !signal.advFlags.hasPrivateFundClients && 'clientTypes (empty)',
    ].filter(Boolean);

    console.log(`  firmName        : ${signal.firmName}`);
    console.log(`  crdNumber       : ${signal.crdNumber}`);
    console.log(`  estimated_aum   : ${
      signal.regulatoryAum !== null
        ? `$${signal.estimated_aum_usd.toLocaleString()} (reported)`
        : `$0 (null — not reported in Item 5.F)`
    }`);
    console.log(`  clientTypes     : [${signal.clientTypes.join(', ') || 'none'}]`);
    console.log(`  inferredSegment : ${signal.inferred_segment}`);
    console.log(`  advFlags        : ${JSON.stringify(signal.advFlags)}`);
    console.log(`  source_url      : ${signal.source_url}`);

    if (gaps.length) {
      console.log(`  ⚠ gaps          : ${gaps.join(', ')}`);
      allGood = false;
    } else {
      console.log('  ✓ all key fields populated');
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(allGood ? 'RESULT: ALL RECORDS OK ✓' : 'RESULT: SOME GAPS (see above)');
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
});

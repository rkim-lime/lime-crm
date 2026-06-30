/**
 * Re-evaluate all pending dedup_queue entries against the corrected
 * matching logic (Fixes A and B from migration 019):
 *
 *   Fix A — CRD/CIK identifier mismatch: if both firms have distinct
 *   non-null regulatory IDs they are definitively different firms →
 *   mark not_duplicate immediately.
 *
 *   Fix B — Updated normalization: if name_similarity() (which uses the
 *   expanded stopword set from name_stopwords) drops below the 0.5
 *   threshold → no longer a fuzzy match → mark not_duplicate.
 *
 * Entries that still qualify under both checks remain 'pending' for
 * human review. Genuine duplicates are not touched.
 *
 * Prerequisites:
 *   Migration 019 must be applied before running this script.
 *   The name_similarity() RPC is created by that migration.
 *
 * Usage:
 *   node --env-file=.env scripts/recheck-dedup-queue.js
 */

import { supabase } from '../src/supabaseClient.js';

const THRESHOLD = 0.5;

async function recheckDedupQueue() {
  console.log('[INFO] Fetching pending dedup_queue entries...');

  const { data: entries, error: fetchErr } = await supabase
    .from('dedup_queue')
    .select('id, prospect_id, match_type, matched_prospect_id, matched_account_id, similarity, matched_name')
    .eq('status', 'pending');

  if (fetchErr) throw new Error(`Failed to fetch dedup_queue: ${fetchErr.message}`);
  console.log(`[INFO] ${entries.length} pending entries to recheck`);

  if (entries.length === 0) {
    console.log('[INFO] Nothing to recheck.');
    return;
  }

  // Pre-fetch all involved prospect identifiers in one query
  const prospectIds = [...new Set([
    ...entries.map(e => e.prospect_id),
    ...entries.filter(e => e.match_type === 'prospect' && e.matched_prospect_id)
              .map(e => e.matched_prospect_id),
  ])];

  const { data: prospectsData, error: pErr } = await supabase
    .from('prospects')
    .select('id, firm_name, crd_number, cik')
    .in('id', prospectIds);
  if (pErr) throw new Error(`Failed to fetch prospects: ${pErr.message}`);
  const prospectMap = Object.fromEntries(prospectsData.map(p => [p.id, p]));

  // Pre-fetch all involved account identifiers
  const accountIds = entries
    .filter(e => e.match_type === 'account' && e.matched_account_id)
    .map(e => e.matched_account_id);

  const accountMap = {};
  if (accountIds.length > 0) {
    const { data: accountsData, error: aErr } = await supabase
      .from('accounts')
      .select('id, name, crd_number, cik')
      .in('id', accountIds);
    if (aErr) throw new Error(`Failed to fetch accounts: ${aErr.message}`);
    for (const a of accountsData) accountMap[a.id] = a;
  }

  let dismissed = 0;
  let stillPending = 0;
  const errors = [];

  for (const entry of entries) {
    const prospect = prospectMap[entry.prospect_id];
    if (!prospect) {
      errors.push({ id: entry.id, reason: 'prospect not found' });
      continue;
    }

    let matchCrd = null, matchCik = null, matchName = '';
    if (entry.match_type === 'prospect' && entry.matched_prospect_id) {
      const mp = prospectMap[entry.matched_prospect_id];
      matchCrd  = mp?.crd_number ?? null;
      matchCik  = mp?.cik        ?? null;
      matchName = mp?.firm_name  ?? entry.matched_name ?? '';
    } else if (entry.match_type === 'account' && entry.matched_account_id) {
      const ma = accountMap[entry.matched_account_id];
      matchCrd  = ma?.crd_number ?? null;
      matchCik  = ma?.cik        ?? null;
      matchName = ma?.name       ?? entry.matched_name ?? '';
    }

    const prospName = prospect.firm_name ?? '';
    const prospCrd  = prospect.crd_number ?? null;
    const prospCik  = prospect.cik        ?? null;

    // Fix A: definitive identifier mismatch → not the same firm
    const crdMismatch = prospCrd && matchCrd && prospCrd !== matchCrd;
    const cikMismatch = prospCik && matchCik && prospCik !== matchCik;

    if (crdMismatch || cikMismatch) {
      const reason = crdMismatch ? `CRD ${prospCrd} ≠ ${matchCrd}` : `CIK ${prospCik} ≠ ${matchCik}`;
      await supabase.from('dedup_queue').update({ status: 'not_duplicate' }).eq('id', entry.id);
      console.log(`  [A] dismiss  "${prospName}" ↔ "${matchName}" — ${reason}`);
      dismissed++;
      continue;
    }

    // Fix B: re-check similarity under updated normalize_firm_name() stopword set
    const { data: sim, error: simErr } = await supabase
      .rpc('name_similarity', { name_a: prospName, name_b: matchName });

    if (simErr) {
      // name_similarity RPC missing (pre-migration 019) — skip this entry
      console.warn(`  [warn] name_similarity RPC unavailable for "${prospName}": ${simErr.message}`);
      stillPending++;
      continue;
    }

    if (sim !== null && sim < THRESHOLD) {
      await supabase.from('dedup_queue').update({ status: 'not_duplicate' }).eq('id', entry.id);
      console.log(`  [B] dismiss  "${prospName}" ↔ "${matchName}" — similarity ${sim.toFixed(3)} < ${THRESHOLD} (stopword expansion)`);
      dismissed++;
    } else {
      console.log(`  [?] keep     "${prospName}" ↔ "${matchName}" — similarity ${sim?.toFixed(3)} (genuine candidate)`);
      stillPending++;
    }
  }

  console.log('\n[INFO] Recheck complete:');
  console.log(`  Dismissed as not_duplicate : ${dismissed}`);
  console.log(`  Still pending (review)     : ${stillPending}`);
  if (errors.length) {
    console.log(`  Errors                     : ${errors.length}`);
    for (const e of errors) console.error(`    ${e.id}: ${e.reason}`);
  }
}

recheckDedupQueue().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});

import { supabase } from './supabase';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── Config loader ─────────────────────────────────────────────────────────────

export async function loadScoringConfig() {
  const { data, error } = await supabase
    .from('scoring_config')
    .select('tier, criterion_key, weight, label')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;

  const grouped = { enterprise: {}, pro: {}, individual: {} };
  for (const row of (data ?? [])) {
    if (grouped[row.tier]) {
      grouped[row.tier][row.criterion_key] = row.weight;
    }
  }
  return grouped;
}

// ── Enterprise scoring ────────────────────────────────────────────────────────

export function scoreEnterprise(account, weights = {}) {
  const criteria = [
    {
      criterion_key: 'aum_over_100m',
      label:         'AUM > $100M',
      earned:        (account.aum_usd ?? 0) > 100_000_000,
    },
    {
      criterion_key: 'adv_over_1m',
      label:         'ADV > $1M',
      earned:        (account.avg_daily_volume_usd ?? 0) > 1_000_000,
    },
    {
      criterion_key: 'fix_version_set',
      label:         'FIX Connectivity',
      earned:        !!(account.fix_version),
    },
    {
      criterion_key: 'colo_required',
      label:         'Colocation Required',
      earned:        account.colo === true,
    },
    {
      criterion_key: 'kyc_approved',
      label:         'KYC Approved',
      earned:        account.kyc_status === 'approved',
    },
    {
      criterion_key: 'multiple_asset_classes',
      label:         'Multi Asset Class',
      earned:        (account.asset_classes ?? []).length > 1,
    },
  ];

  const defaultWeights = {
    aum_over_100m: 25, adv_over_1m: 20, fix_version_set: 15,
    colo_required: 15, kyc_approved: 15, multiple_asset_classes: 10,
  };

  return _buildResult(criteria, { ...defaultWeights, ...weights });
}

// ── Pro scoring ───────────────────────────────────────────────────────────────

export function scorePro(contact, weights = {}) {
  const criteria = [
    {
      criterion_key: 'uses_fix',
      label:         'Uses FIX',
      earned:        contact.uses_fix === true,
    },
    {
      criterion_key: 'uses_rest_api',
      label:         'Uses REST API',
      earned:        contact.uses_rest_api === true,
    },
    {
      criterion_key: 'adv_over_100k',
      label:         'ADV > $100K',
      earned:        (contact.avg_daily_volume_usd ?? 0) > 100_000,
    },
    {
      criterion_key: 'multiple_asset_classes',
      label:         'Multi Asset Class',
      earned:        (contact.asset_classes ?? []).length > 1,
    },
    {
      criterion_key: 'kyc_approved',
      label:         'KYC Approved',
      earned:        contact.kyc_status === 'approved',
    },
    {
      criterion_key: 'has_programming_languages',
      label:         'Programmatic Trader',
      earned:        (contact.programming_languages ?? []).length > 0,
    },
  ];

  const defaultWeights = {
    uses_fix: 25, uses_rest_api: 20, adv_over_100k: 20,
    multiple_asset_classes: 15, kyc_approved: 10, has_programming_languages: 10,
  };

  return _buildResult(criteria, { ...defaultWeights, ...weights });
}

// ── Individual scoring ────────────────────────────────────────────────────────

export function scoreIndividual(lead, weights = {}) {
  const recentlyContacted = lead.updated_at
    ? new Date(lead.updated_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    : false;

  const criteria = [
    {
      criterion_key: 'stage_funded_or_later',
      label:         'Funded or Later',
      earned:        ['funded','first_trade','active'].includes(lead.stage),
    },
    {
      criterion_key: 'stage_first_trade_or_later',
      label:         'First Trade or Later',
      earned:        ['first_trade','active'].includes(lead.stage),
    },
    {
      criterion_key: 'multiple_asset_classes',
      label:         'Multi Asset Class',
      earned:        (lead.asset_classes ?? []).length > 1,
    },
    {
      criterion_key: 'uses_rest_api',
      label:         'Uses REST API',
      earned:        lead.uses_rest_api === true,
    },
    {
      criterion_key: 'recently_contacted',
      label:         'Recently Contacted',
      earned:        recentlyContacted,
    },
  ];

  const defaultWeights = {
    stage_funded_or_later: 30, stage_first_trade_or_later: 25,
    multiple_asset_classes: 20, uses_rest_api: 15, recently_contacted: 10,
  };

  return _buildResult(criteria, { ...defaultWeights, ...weights });
}

// ── Router ────────────────────────────────────────────────────────────────────

export function computeScore(tier, record, weights = {}) {
  if (tier === 'enterprise') return scoreEnterprise(record, weights);
  if (tier === 'pro')        return scorePro(record, weights);
  if (tier === 'individual') return scoreIndividual(record, weights);
  return { score: 0, breakdown: [] };
}

// ── Batch recalculate (no DB writes — caller handles persistence) ─────────────

export async function batchRecalculate(tier, records, weights, _triggeredBy = 'manual') {
  const results = [];
  const CHUNK = 50;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    for (const record of chunk) {
      const { score, breakdown } = computeScore(tier, record, weights);
      results.push({ recordId: record.id, score, breakdown });
    }
    // Yield to event loop between chunks
    await new Promise(r => setTimeout(r, 0));
  }
  return results;
}

// ── Internal helper ───────────────────────────────────────────────────────────

function _buildResult(criteria, weights) {
  let total = 0;
  const breakdown = criteria.map(c => {
    const weight = weights[c.criterion_key] ?? 0;
    const points = c.earned ? weight : 0;
    total += points;
    return { criterion_key: c.criterion_key, label: c.label, weight, earned: c.earned, points };
  });
  return { score: clamp(Math.round(total), 0, 100), breakdown };
}

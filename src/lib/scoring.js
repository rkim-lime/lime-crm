import { supabase } from './supabase';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── Lead scoring ──────────────────────────────────────────────────────────────

export function scoreLead(lead, weights = {}) {
  const recentlyContacted = lead.updated_at
    ? new Date(lead.updated_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    : false;

  return _buildResult([
    { criterion_key: 'stage_funded_or_later',     label: 'Funded or Later',     earned: ['funded','first_trade','active'].includes(lead.stage) },
    { criterion_key: 'stage_first_trade_or_later', label: 'First Trade or Later', earned: ['first_trade','active'].includes(lead.stage) },
    { criterion_key: 'multiple_asset_classes',    label: 'Multi Asset Class',   earned: (lead.asset_classes ?? []).length > 1 },
    { criterion_key: 'uses_rest_api',             label: 'Uses REST API',       earned: lead.uses_rest_api === true },
    { criterion_key: 'recently_contacted',        label: 'Recently Contacted',  earned: recentlyContacted },
  ], weights);
}

// ── Deal scoring ──────────────────────────────────────────────────────────────

export function scoreDeal(deal, weights = {}) {
  const account = deal.account ?? {};
  const closeMs = deal.close_date ? new Date(deal.close_date).getTime() : null;
  const daysToClose = closeMs ? (closeMs - Date.now()) / 86_400_000 : null;

  return _buildResult([
    {
      criterion_key: 'probability_over_50',
      label:         'Probability > 50%',
      earned:        (deal.probability ?? 0) > 50,
    },
    {
      criterion_key: 'aum_over_100m',
      label:         'AUM > $100M',
      earned:        (account.aum_usd ?? 0) > 100_000_000,
    },
    {
      criterion_key: 'kyc_approved',
      label:         'KYC Approved',
      earned:        account.kyc_status === 'approved',
    },
    {
      criterion_key: 'technical_requirements',
      label:         'Technical Requirements Met',
      earned:        !!(deal.colo || deal.hosting || (deal.order_routing ?? []).includes('dma')),
    },
    {
      criterion_key: 'close_date_90_days',
      label:         'Close Date ≤ 90 Days',
      earned:        daysToClose !== null && daysToClose > 0 && daysToClose <= 90,
    },
    {
      criterion_key: 'multiple_asset_classes',
      label:         'Multi Asset Class',
      earned:        (deal.asset_classes ?? []).length > 1,
    },
  ], weights);
}

// ── Contact health scoring ────────────────────────────────────────────────────

export function scoreContactHealth(contact, weights = {}) {
  const recentlyEngaged = contact.updated_at
    ? new Date(contact.updated_at) > new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    : false;

  return _buildResult([
    {
      criterion_key: 'multi_asset',
      label:         'Multi Asset Class',
      earned:        (contact.asset_classes ?? []).length > 1,
    },
    {
      criterion_key: 'recently_engaged',
      label:         'Recently Engaged',
      earned:        recentlyEngaged,
    },
    {
      criterion_key: 'uses_api',
      label:         'Uses REST or FIX API',
      earned:        !!(contact.uses_rest_api || contact.uses_fix),
    },
    {
      criterion_key:       'trading_frequency',
      label:               'High Trading Frequency',
      earned:              null,
      requires_integration: true,
      integration_label:   'Trading system',
    },
    {
      criterion_key:       'account_equity',
      label:               'Funded Account > $10K',
      earned:              null,
      requires_integration: true,
      integration_label:   'Clearing system',
    },
  ], weights);
}

// ── Account health scoring ────────────────────────────────────────────────────

export function scoreAccountHealth(account, weights = {}, extraParams = {}) {
  const { hasOverdueTasks = null, daysSinceActivity = null } = extraParams;

  return _buildResult([
    {
      criterion_key: 'recent_activity',
      label:         'Recent Activity',
      earned:        daysSinceActivity !== null ? daysSinceActivity <= 30 : false,
    },
    {
      criterion_key: 'no_overdue_tasks',
      label:         'No Overdue Tasks',
      earned:        hasOverdueTasks !== null ? !hasOverdueTasks : false,
    },
    {
      criterion_key: 'multi_asset',
      label:         'Multi Asset Class',
      earned:        (account.asset_classes ?? []).length > 1,
    },
    {
      criterion_key: 'fully_onboarded',
      label:         'Fully Onboarded',
      earned:        account.kyc_status === 'approved' &&
                     ['active','live','onboarding'].includes(account.status ?? ''),
    },
    {
      criterion_key:       'adv_vs_expected',
      label:               'ADV vs Expected',
      earned:              null,
      requires_integration: true,
      integration_label:   'Trading system',
    },
    {
      criterion_key:       'no_support_issues',
      label:               'No Open Support Issues',
      earned:              null,
      requires_integration: true,
      integration_label:   'Support system',
    },
  ], weights);
}

// ── Router ────────────────────────────────────────────────────────────────────

export function computeScore(scoreType, record, weights = {}, extraParams = {}) {
  if (scoreType === 'lead')           return scoreLead(record, weights);
  if (scoreType === 'deal')           return scoreDeal(record, weights);
  if (scoreType === 'contact_health') return scoreContactHealth(record, weights);
  if (scoreType === 'account_health') return scoreAccountHealth(record, weights, extraParams);
  return { score: 0, availableScore: 0, breakdown: [] };
}

// ── Batch recalculate ─────────────────────────────────────────────────────────

export async function batchRecalculate(scoreType, records, weights, extraParamsMap = {}) {
  const results = [];
  const CHUNK = 50;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    for (const record of chunk) {
      const extraParams = extraParamsMap[record.id] ?? {};
      const { score, breakdown } = computeScore(scoreType, record, weights, extraParams);
      results.push({ recordId: record.id, score, breakdown });
    }
    await new Promise(r => setTimeout(r, 0));
  }
  return results;
}

// ── Internal helper ───────────────────────────────────────────────────────────

function _buildResult(criteria, weights) {
  let earned = 0;
  let availableScore = 0;

  const breakdown = criteria.map(c => {
    const weight = weights[c.criterion_key] ?? 0;

    if (c.requires_integration) {
      return {
        criterion_key:       c.criterion_key,
        label:               c.label,
        weight,
        earned:              null,
        points:              0,
        requires_integration: true,
        integration_label:   c.integration_label ?? null,
      };
    }

    const met    = c.earned === true;
    const points = met ? weight : 0;
    earned        += points;
    availableScore += weight;

    return {
      criterion_key:       c.criterion_key,
      label:               c.label,
      weight,
      earned:              met,
      points,
      requires_integration: false,
      integration_label:   null,
    };
  });

  return {
    score:          clamp(Math.round(earned), 0, 100),
    availableScore: clamp(availableScore, 0, 100),
    breakdown,
  };
}

// ── Legacy config loader (for backwards compatibility) ────────────────────────

export async function loadScoringConfig() {
  const { data, error } = await supabase
    .from('scoring_config')
    .select('score_type, criterion_key, weight, label')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;

  const grouped = { lead: {}, deal: {}, contact_health: {}, account_health: {} };
  for (const row of (data ?? [])) {
    if (grouped[row.score_type]) {
      grouped[row.score_type][row.criterion_key] = row.weight;
    }
  }
  return grouped;
}

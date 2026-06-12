// Lead / account scoring rubrics — return 0-100 integer

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Enterprise account score — weighted on institutional capacity signals.
 * @param {object} account - row from accounts table
 * @returns {number} 0-100
 */
export function scoreEnterprise(account) {
  let score = 0;

  // AUM (max 30pts): >$1B = 30, >$500M = 20, >$100M = 10, else 0
  const aum = account.aum_usd ?? 0;
  if      (aum >= 1_000_000_000) score += 30;
  else if (aum >= 500_000_000)   score += 20;
  else if (aum >= 100_000_000)   score += 10;

  // ADV (max 25pts): >$50M = 25, >$10M = 15, >$1M = 8, else 0
  const adv = account.avg_daily_volume_usd ?? 0;
  if      (adv >= 50_000_000) score += 25;
  else if (adv >= 10_000_000) score += 15;
  else if (adv >=  1_000_000) score +=  8;

  // FIX version (max 15pts): fix50sp2 = 15, fix50sp1/fix50 = 10, fix44 = 5
  const fix = account.fix_version ?? '';
  if      (fix === 'fix50sp2') score += 15;
  else if (['fix50sp1','fix50'].includes(fix)) score += 10;
  else if (fix === 'fix44')    score +=  5;

  // Colo required (10pts — direct market access signal)
  if (account.colo_required) score += 10;

  // KYC status (max 15pts): approved = 15, pending_review = 8, in_progress = 3
  const kyc = account.kyc_status ?? '';
  if      (kyc === 'approved')       score += 15;
  else if (kyc === 'pending_review') score +=  8;
  else if (kyc === 'in_progress')    score +=  3;

  // Asset class diversity (max 5pts): 1 = 2, 2 = 3, 3+ = 5
  const classes = (account.asset_classes ?? []).length;
  if      (classes >= 3) score += 5;
  else if (classes >= 2) score += 3;
  else if (classes >= 1) score += 2;

  return clamp(Math.round(score), 0, 100);
}

/**
 * Pro contact score — weighted on API usage and trading sophistication.
 * @param {object} contact - row from contacts table
 * @returns {number} 0-100
 */
export function scorePro(contact) {
  let score = 0;

  // FIX connectivity (25pts)
  if (contact.uses_fix) score += 25;

  // REST API usage (20pts)
  if (contact.uses_rest_api) score += 20;

  // ADV (max 20pts): >$5M = 20, >$500K = 12, >$100K = 5
  const adv = contact.avg_daily_volume_usd ?? 0;
  if      (adv >= 5_000_000) score += 20;
  else if (adv >=   500_000) score += 12;
  else if (adv >=   100_000) score +=  5;

  // Asset classes (max 10pts)
  const classes = (contact.asset_classes ?? []).length;
  if      (classes >= 3) score += 10;
  else if (classes >= 2) score +=  6;
  else if (classes >= 1) score +=  3;

  // KYC (max 15pts)
  const kyc = contact.kyc_status ?? '';
  if      (kyc === 'approved')       score += 15;
  else if (kyc === 'pending_review') score +=  8;
  else if (kyc === 'in_progress')    score +=  3;

  // Programming languages (max 10pts): 2+ = 10, 1 = 5
  const langs = (contact.programming_languages ?? []).length;
  if      (langs >= 2) score += 10;
  else if (langs >= 1) score +=  5;

  return clamp(Math.round(score), 0, 100);
}

// Stage ordering for individual lifecycle — higher index = further along
const INDIVIDUAL_STAGE_ORDER = [
  'lead_in', 'engaged', 'api_demo', 'kyc_submitted', 'kyc_approved',
  'funded', 'first_trade', 'active_trader', 'dormant',
];

/**
 * Individual contact score — stage progress, recency, and product breadth.
 * @param {object} contact - row from contacts table (may include linked deal)
 * @param {object} [deal]  - most recent deal row (optional)
 * @returns {number} 0-100
 */
export function scoreIndividual(contact, deal) {
  let score = 0;

  // Deal stage progress (max 40pts)
  const stageKey = deal?.stage ?? '';
  const stageIdx = INDIVIDUAL_STAGE_ORDER.indexOf(stageKey);
  if (stageIdx >= 0) {
    score += Math.round((stageIdx / (INDIVIDUAL_STAGE_ORDER.length - 1)) * 40);
  }

  // Asset classes (max 20pts)
  const classes = (contact.asset_classes ?? []).length;
  if      (classes >= 3) score += 20;
  else if (classes >= 2) score += 12;
  else if (classes >= 1) score +=  6;

  // REST API usage (15pts — self-serve signal)
  if (contact.uses_rest_api) score += 15;

  // Recency of last contact (max 25pts)
  if (contact.last_contacted_at) {
    const daysSince = (Date.now() - new Date(contact.last_contacted_at).getTime()) / 86_400_000;
    if      (daysSince <=  7) score += 25;
    else if (daysSince <= 14) score += 18;
    else if (daysSince <= 30) score += 10;
    else if (daysSince <= 60) score +=  4;
  }

  return clamp(Math.round(score), 0, 100);
}

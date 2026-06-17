-- ============================================================
-- Migration 011: Prospect Engine — scoring_config seed
-- Must run AFTER migration 010 (needs 'prospect_fit' committed).
-- ============================================================

INSERT INTO public.scoring_config
  (score_type, tier, criterion_key, label, description, weight, is_active, sort_order)
VALUES
  ('prospect_fit','enterprise','aum_tier',
   'AUM Tier',
   'Estimated AUM: ≥$500M = full credit, ≥$100M = half, <$100M = quarter',
   20, true, 1),
  ('prospect_fit','enterprise','portfolio_turnover',
   'Portfolio Turnover',
   'Quarterly turnover ≥50% = full, ≥25% = half, <25% = quarter (null = half)',
   25, true, 2),
  ('prospect_fit','enterprise','equity_concentration',
   'Equity Concentration',
   'Non-option equity as % of AUM: ≥70% = full, ≥40% = half, <40% = quarter',
   15, true, 3),
  ('prospect_fit','enterprise','options_present',
   'Options Trading',
   'Firm holds put/call options in the 13F filing',
   15, true, 4),
  ('prospect_fit','enterprise','position_count',
   'Position Count',
   'Number of disclosed positions: ≥100 = full, ≥50 = half, <50 = quarter',
   10, true, 5),
  ('prospect_fit','enterprise','filer_type',
   'Filer Type / Segment',
   'hedge_fund/quant_fund/prop_trader = full, pension = quarter, other = half',
   15, true, 6)
ON CONFLICT (score_type, criterion_key) DO NOTHING;

-- Confirmation: should show criteria_count=6, total_weight=100
SELECT
  score_type,
  COUNT(*)    AS criteria_count,
  SUM(weight) AS total_weight
FROM public.scoring_config
WHERE score_type = 'prospect_fit'
GROUP BY score_type;

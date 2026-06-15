-- 008_strategy_asset_classes.sql
--
-- Adds two new text[] columns to accounts:
--   strategy_asset_classes — all asset classes the client trades / has in strategy
--                            (text[] to support crypto, fixed_income, fx, other
--                            beyond the original 3-value asset_class enum)
--   sold_asset_classes     — asset classes we have contracted and enabled
--
-- Backfills strategy_asset_classes from the existing asset_classes column.
-- Backfills sold_asset_classes for active accounts (if they had contracted
-- asset classes before, we assume they were enabled).

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS strategy_asset_classes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sold_asset_classes     text[] NOT NULL DEFAULT '{}';

-- Backfill strategy_asset_classes from existing asset_classes (cast enum[] → text[])
UPDATE accounts
SET strategy_asset_classes = ARRAY(
  SELECT unnest(asset_classes)::text
)
WHERE asset_classes IS NOT NULL
  AND array_length(asset_classes, 1) > 0;

-- Backfill sold_asset_classes for active accounts
UPDATE accounts
SET sold_asset_classes = ARRAY(
  SELECT unnest(asset_classes)::text
)
WHERE status = 'active'
  AND asset_classes IS NOT NULL
  AND array_length(asset_classes, 1) > 0;

-- GIN indexes for array containment queries used by upsell report
CREATE INDEX IF NOT EXISTS idx_accounts_strategy_asset_classes
  ON accounts USING GIN (strategy_asset_classes);

CREATE INDEX IF NOT EXISTS idx_accounts_sold_asset_classes
  ON accounts USING GIN (sold_asset_classes);

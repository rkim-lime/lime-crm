-- ============================================================
-- Migration 017: Normalization Layer — signal registry,
-- taxonomies, identifier store, canonical columns, size bands
-- ============================================================
--
-- Adds the machinery for Layer 2 (normalized signals with
-- provenance) and Layer 3 (canonical indexed fields).
-- This is schema only; the engine wiring is Part B.
--
-- Design principles:
--   • NO postgres enums — all new value constraints use
--     text + CHECK or reference lookup tables. Existing enum
--     columns (prospect_source, prospect_jurisdiction, etc.)
--     are untouched.
--   • All INSERTs are idempotent via ON CONFLICT DO NOTHING
--     or ON CONFLICT DO UPDATE.
--   • All CREATE TABLE / CREATE INDEX use IF NOT EXISTS.
--
-- No statement requires separate execution. Run as a single
-- transaction. Enum additions (none here) would require
-- separate runs — there are none in this migration.
-- ============================================================


-- ── 1. Signal Registry ────────────────────────────────────────
-- Central registry of all signals the ingestion engine can
-- produce. data_type / canonical_dimension / comparison_method
-- drive normalization logic in Part B.

CREATE TABLE IF NOT EXISTS public.signal_definitions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_key            text        NOT NULL UNIQUE,
  label                 text        NOT NULL,
  data_type             text        NOT NULL
                          CHECK (data_type IN ('number','boolean','string','array')),
  unit                  text,                   -- 'usd','pct',null
  canonical_dimension   text        NOT NULL,   -- 'aum','execution_sensitivity',
                                                -- 'segment','client_type','cross_market'
  comparison_method     text        NOT NULL
                          CHECK (comparison_method IN ('numeric','categorical','boolean')),
  is_promoted_to_column boolean     NOT NULL DEFAULT false,
  producing_sources     text[]      NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.signal_definitions
  (signal_key, label, data_type, unit, canonical_dimension, comparison_method,
   is_promoted_to_column, producing_sources)
VALUES
  ('aum_13f_portfolio',
   'AUM — 13F Portfolio Value',
   'number', 'usd', 'aum', 'numeric', true,
   ARRAY['sec_13f']),

  ('aum_adv_regulatory',
   'AUM — ADV Regulatory (Item 5.F)',
   'number', 'usd', 'aum', 'numeric', true,
   ARRAY['sec_adv']),

  ('turnover_pct',
   'Portfolio Turnover %',
   'number', 'pct', 'execution_sensitivity', 'numeric', false,
   ARRAY['sec_13f']),

  ('equities_pct',
   'Equity Concentration %',
   'number', 'pct', 'execution_sensitivity', 'numeric', false,
   ARRAY['sec_13f']),

  ('options_present',
   'Options Present',
   'boolean', null, 'execution_sensitivity', 'boolean', false,
   ARRAY['sec_13f']),

  ('position_count',
   'Position Count',
   'number', null, 'execution_sensitivity', 'numeric', false,
   ARRAY['sec_13f']),

  ('client_types',
   'Client Types (ADV Part 1, Item 5.D)',
   'array', null, 'client_type', 'categorical', false,
   ARRAY['sec_adv']),

  ('has_private_fund_clients',
   'Has Private Fund Clients (ADV Part 1, Item 7.A)',
   'boolean', null, 'cross_market', 'boolean', false,
   ARRAY['sec_adv']),

  ('segment_inferred',
   'Inferred Segment',
   'string', null, 'segment', 'categorical', true,
   ARRAY['sec_13f', 'sec_adv'])

ON CONFLICT (signal_key) DO NOTHING;


-- ── 2. Taxonomies ─────────────────────────────────────────────
-- Data-driven, versioned value lists. Adding a new value is
-- an INSERT, not a schema change.

CREATE TABLE IF NOT EXISTS public.taxonomies (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  taxonomy_key text        NOT NULL UNIQUE,
  label        text        NOT NULL,
  version      integer     NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.taxonomies (taxonomy_key, label, version) VALUES
  ('segment',     'Firm Segment',     1),
  ('client_type', 'Client Type',      1),
  ('strategy',    'Trading Strategy', 1)
ON CONFLICT (taxonomy_key) DO NOTHING;

-- ── 2a. Taxonomy Values ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.taxonomy_values (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  taxonomy_id uuid        NOT NULL REFERENCES public.taxonomies(id) ON DELETE CASCADE,
  value_key   text        NOT NULL,
  label       text        NOT NULL,
  fit_tier    text        CHECK (fit_tier IN ('high','medium','low')),
  sort_order  integer     NOT NULL DEFAULT 0,
  UNIQUE (taxonomy_id, value_key)
);

-- Segment values
-- fit_tier: high=target profile, medium=acceptable, low=possible, null=not scored
INSERT INTO public.taxonomy_values (taxonomy_id, value_key, label, fit_tier, sort_order)
SELECT t.id, v.value_key, v.label, v.fit_tier, v.sort_order
FROM public.taxonomies t
CROSS JOIN (VALUES
  ('hedge_fund',     'Hedge Fund',        'high',   1),
  ('quant_fund',     'Quantitative Fund', 'high',   2),
  ('prop_trading',   'Prop Trading',      'high',   3),
  ('asset_manager',  'Asset Manager',     'medium', 4),
  ('family_office',  'Family Office',     'medium', 5),
  ('broker_dealer',  'Broker/Dealer',     'medium', 6),
  ('wealth_manager', 'Wealth Manager',    'low',    7),
  ('bank',           'Bank',              'low',    8),
  ('pension',        'Pension/Endowment', 'low',    9),
  ('insurance',      'Insurance',         'low',    10),
  ('other',          'Other',             null,     11)
) AS v(value_key, label, fit_tier, sort_order)
WHERE t.taxonomy_key = 'segment'
ON CONFLICT (taxonomy_id, value_key) DO NOTHING;

-- Client type values
-- fit_tier null — client type scores are handled by fitScore criteria,
-- not by the taxonomy tier (Stage 2 will wire this up)
INSERT INTO public.taxonomy_values (taxonomy_id, value_key, label, fit_tier, sort_order)
SELECT t.id, v.value_key, v.label, null, v.sort_order
FROM public.taxonomies t
CROSS JOIN (VALUES
  ('pooled_investment_vehicle', 'Pooled Investment Vehicle', 1),
  ('private_fund',              'Private Fund',              2),
  ('high_net_worth',            'High Net Worth Individual', 3),
  ('institutional',             'Institutional',             4),
  ('pension_plan',              'Pension Plan',              5),
  ('retail',                    'Retail',                    6),
  ('other',                     'Other',                     7)
) AS v(value_key, label, sort_order)
WHERE t.taxonomy_key = 'client_type'
ON CONFLICT (taxonomy_id, value_key) DO NOTHING;

-- Strategy values
-- fit_tier null — strategies feed execution_sensitivity in Stage 2
INSERT INTO public.taxonomy_values (taxonomy_id, value_key, label, fit_tier, sort_order)
SELECT t.id, v.value_key, v.label, null, v.sort_order
FROM public.taxonomies t
CROSS JOIN (VALUES
  ('hft',                    'High-Frequency Trading',         1),
  ('market_making',          'Market Making',                  2),
  ('arbitrage',              'Arbitrage',                      3),
  ('latency_arbitrage',      'Latency Arbitrage',              4),
  ('cross_market_arbitrage', 'Cross-Market Arbitrage',         5),
  ('statistical_arbitrage',  'Statistical Arbitrage',          6),
  ('algorithmic',            'Algorithmic',                    7),
  ('quant_systematic',       'Quantitative / Systematic',      8),
  ('other',                  'Other',                          9)
) AS v(value_key, label, sort_order)
WHERE t.taxonomy_key = 'strategy'
ON CONFLICT (taxonomy_id, value_key) DO NOTHING;

-- ── 2b. Taxonomy Mappings ─────────────────────────────────────
-- Maps raw source values → canonical taxonomy value_keys.
-- Confidence: 13F name-heuristic=low, ADV client-type-derived=high.
-- Note: ingest_13f uses 'prop_trader' internally; maps → 'prop_trading'.

CREATE TABLE IF NOT EXISTS public.taxonomy_mappings (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  taxonomy_id         uuid        NOT NULL REFERENCES public.taxonomies(id) ON DELETE CASCADE,
  source              text        NOT NULL,  -- 'ingest_13f','ingest_adv'
  source_value        text        NOT NULL,  -- raw value from connector
  canonical_value_key text        NOT NULL,  -- matches taxonomy_values.value_key
  confidence          text        NOT NULL
                        CHECK (confidence IN ('high','medium','low')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (taxonomy_id, source, source_value)
);

-- 13F segment mappings (name-heuristic → confidence=low)
INSERT INTO public.taxonomy_mappings (taxonomy_id, source, source_value, canonical_value_key, confidence)
SELECT t.id, m.source, m.source_value, m.canonical_value_key, m.confidence
FROM public.taxonomies t
CROSS JOIN (VALUES
  ('ingest_13f', 'hedge_fund',    'hedge_fund',   'low'),
  ('ingest_13f', 'quant_fund',    'quant_fund',   'low'),
  ('ingest_13f', 'prop_trader',   'prop_trading', 'low'),  -- connector uses 'prop_trader'
  ('ingest_13f', 'broker_dealer', 'broker_dealer','low'),
  ('ingest_13f', 'pension',       'pension',      'low')
) AS m(source, source_value, canonical_value_key, confidence)
WHERE t.taxonomy_key = 'segment'
ON CONFLICT (taxonomy_id, source, source_value) DO NOTHING;

-- ADV segment mappings (client-type-derived → confidence=high/medium)
INSERT INTO public.taxonomy_mappings (taxonomy_id, source, source_value, canonical_value_key, confidence)
SELECT t.id, m.source, m.source_value, m.canonical_value_key, m.confidence
FROM public.taxonomies t
CROSS JOIN (VALUES
  ('ingest_adv', 'hedge_fund',    'hedge_fund',   'high'),    -- pooled/private-fund clients
  ('ingest_adv', 'quant_fund',    'quant_fund',   'high'),    -- pooled + quant name
  ('ingest_adv', 'pension',       'pension',      'high'),    -- pension_plans clientType only
  ('ingest_adv', 'broker_dealer', 'broker_dealer','medium')   -- HNW/individual only (inferential)
) AS m(source, source_value, canonical_value_key, confidence)
WHERE t.taxonomy_key = 'segment'
ON CONFLICT (taxonomy_id, source, source_value) DO NOTHING;


-- ── 3. Prospect Identifiers ───────────────────────────────────
-- Open typed identifier store. One authoritative row per
-- (identifier_type, identifier_value) across the whole system.
-- prospect_id and account_id are nullable so a single row can
-- link to either, both, or neither entity.
--
-- PLAIN unique index — no partial WHERE clause. Partial indexes
-- break ON CONFLICT (lesson from migration 016).

CREATE TABLE IF NOT EXISTS public.prospect_identifiers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id      uuid        REFERENCES public.prospects(id) ON DELETE SET NULL,
  account_id       uuid        REFERENCES public.accounts(id)  ON DELETE SET NULL,
  identifier_type  text        NOT NULL,   -- 'cik','crd'; extensible
  identifier_value text        NOT NULL,
  source           text        NOT NULL DEFAULT 'ingestion',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS prospect_identifiers_type_value_unique
  ON public.prospect_identifiers(identifier_type, identifier_value);

CREATE INDEX IF NOT EXISTS prospect_identifiers_prospect_id_idx
  ON public.prospect_identifiers(prospect_id) WHERE prospect_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS prospect_identifiers_account_id_idx
  ON public.prospect_identifiers(account_id) WHERE account_id IS NOT NULL;

-- ── 3a. Backfill identifiers from existing records ────────────
-- Insert accounts first (authoritative when a firm is matched).
-- Then prospects (non-audit-only = canonical prospect records).
-- ON CONFLICT merges both references into one row when the same
-- identifier links to both an account and a prospect.

INSERT INTO public.prospect_identifiers
  (account_id, identifier_type, identifier_value, source)
SELECT id, 'cik', cik, 'backfill'
FROM public.accounts
WHERE cik IS NOT NULL
ON CONFLICT (identifier_type, identifier_value)
DO UPDATE SET account_id = EXCLUDED.account_id;

INSERT INTO public.prospect_identifiers
  (account_id, identifier_type, identifier_value, source)
SELECT id, 'crd', crd_number, 'backfill'
FROM public.accounts
WHERE crd_number IS NOT NULL
ON CONFLICT (identifier_type, identifier_value)
DO UPDATE SET account_id = EXCLUDED.account_id;

INSERT INTO public.prospect_identifiers
  (prospect_id, identifier_type, identifier_value, source)
SELECT id, 'cik', cik, 'backfill'
FROM public.prospects
WHERE cik IS NOT NULL AND is_audit_only = false
ON CONFLICT (identifier_type, identifier_value)
DO UPDATE SET prospect_id = EXCLUDED.prospect_id;

INSERT INTO public.prospect_identifiers
  (prospect_id, identifier_type, identifier_value, source)
SELECT id, 'crd', crd_number, 'backfill'
FROM public.prospects
WHERE crd_number IS NOT NULL AND is_audit_only = false
ON CONFLICT (identifier_type, identifier_value)
DO UPDATE SET prospect_id = EXCLUDED.prospect_id;


-- ── 4. Normalization columns on prospects ─────────────────────
-- Layer 2: normalized_signals jsonb — open keyed store of
--   {value, basis, source, as_of, confidence} tuples.
-- Layer 3: canonical indexed columns for fast filter/sort.
-- jurisdiction already exists as prospect_jurisdiction enum;
-- we add an index only.

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS aum_canonical       numeric,
  ADD COLUMN IF NOT EXISTS aum_basis           text,   -- '13f_portfolio','adv_regulatory'
  ADD COLUMN IF NOT EXISTS aum_source          text,   -- 'sec_13f','sec_adv'
  ADD COLUMN IF NOT EXISTS aum_as_of           date,
  ADD COLUMN IF NOT EXISTS segment_canonical   text,
  ADD COLUMN IF NOT EXISTS segment_confidence  text
                             CHECK (segment_confidence IN ('high','medium','low')),
  ADD COLUMN IF NOT EXISTS size_tier           text,
  ADD COLUMN IF NOT EXISTS signal_completeness numeric
                             CHECK (signal_completeness BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS normalized_signals  jsonb,
  ADD COLUMN IF NOT EXISTS normalized_at       timestamptz;

CREATE INDEX IF NOT EXISTS prospects_jurisdiction_idx
  ON public.prospects(jurisdiction);

CREATE INDEX IF NOT EXISTS prospects_aum_canonical_idx
  ON public.prospects(aum_canonical DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS prospects_segment_canonical_idx
  ON public.prospects(segment_canonical);

CREATE INDEX IF NOT EXISTS prospects_size_tier_idx
  ON public.prospects(size_tier);

CREATE INDEX IF NOT EXISTS prospects_signal_completeness_idx
  ON public.prospects(signal_completeness DESC NULLS LAST);


-- ── 5. Mirror normalization columns on accounts ───────────────
-- Matched firms get normalized too. jurisdiction is new on
-- accounts (use text — no enum for new columns).

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS jurisdiction        text,
  ADD COLUMN IF NOT EXISTS aum_canonical       numeric,
  ADD COLUMN IF NOT EXISTS aum_basis           text,
  ADD COLUMN IF NOT EXISTS aum_source          text,
  ADD COLUMN IF NOT EXISTS aum_as_of           date,
  ADD COLUMN IF NOT EXISTS segment_canonical   text,
  ADD COLUMN IF NOT EXISTS segment_confidence  text
                             CHECK (segment_confidence IN ('high','medium','low')),
  ADD COLUMN IF NOT EXISTS size_tier           text,
  ADD COLUMN IF NOT EXISTS signal_completeness numeric
                             CHECK (signal_completeness BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS normalized_signals  jsonb,
  ADD COLUMN IF NOT EXISTS normalized_at       timestamptz;

CREATE INDEX IF NOT EXISTS accounts_jurisdiction_idx
  ON public.accounts(jurisdiction);

CREATE INDEX IF NOT EXISTS accounts_aum_canonical_idx
  ON public.accounts(aum_canonical DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS accounts_segment_canonical_idx
  ON public.accounts(segment_canonical);

CREATE INDEX IF NOT EXISTS accounts_size_tier_idx
  ON public.accounts(size_tier);

CREATE INDEX IF NOT EXISTS accounts_signal_completeness_idx
  ON public.accounts(signal_completeness DESC NULLS LAST);


-- ── 6. Size Tier Config ───────────────────────────────────────
-- Tunable AUM bands. Bands below are PLACEHOLDERS — provisional
-- pending sales input. Adjust min_aum/max_aum via UPDATE;
-- the engine reads this table at normalization time.
--
-- Tier semantics (placeholder):
--   mega  : >= $50B
--   large : $10B – $50B
--   mid   :  $1B – $10B
--   small :       < $1B (or AUM unknown/null → see engine logic)

CREATE TABLE IF NOT EXISTS public.size_tier_config (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_key   text        NOT NULL UNIQUE
               CHECK (tier_key IN ('mega','large','mid','small')),
  min_aum    numeric,    -- NULL = no lower bound
  max_aum    numeric,    -- NULL = no upper bound
  sort_order integer     NOT NULL DEFAULT 0
);

-- PLACEHOLDER BANDS — pending sales calibration before Stage 2
INSERT INTO public.size_tier_config (tier_key, min_aum, max_aum, sort_order) VALUES
  ('mega',  50000000000, null,        1),   -- >= $50B
  ('large', 10000000000, 50000000000, 2),   -- $10B–$50B
  ('mid',    1000000000, 10000000000, 3),   -- $1B–$10B
  ('small',        null,  1000000000, 4)    -- < $1B
ON CONFLICT (tier_key) DO NOTHING;


-- ── 7. RLS on new tables ──────────────────────────────────────
-- Config/registry tables: read for authenticated, writes via
-- service_role only (service_role bypasses RLS).
-- prospect_identifiers mirrors prospect RLS (read for all auth).

ALTER TABLE public.signal_definitions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxonomies            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxonomy_values       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxonomy_mappings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.size_tier_config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_identifiers  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "signal_definitions_select"   ON public.signal_definitions;
DROP POLICY IF EXISTS "taxonomies_select"            ON public.taxonomies;
DROP POLICY IF EXISTS "taxonomy_values_select"       ON public.taxonomy_values;
DROP POLICY IF EXISTS "taxonomy_mappings_select"     ON public.taxonomy_mappings;
DROP POLICY IF EXISTS "size_tier_config_select"      ON public.size_tier_config;
DROP POLICY IF EXISTS "prospect_identifiers_select"  ON public.prospect_identifiers;

CREATE POLICY "signal_definitions_select"  ON public.signal_definitions
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "taxonomies_select"          ON public.taxonomies
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "taxonomy_values_select"     ON public.taxonomy_values
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "taxonomy_mappings_select"   ON public.taxonomy_mappings
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "size_tier_config_select"    ON public.size_tier_config
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "prospect_identifiers_select" ON public.prospect_identifiers
  FOR SELECT USING (auth.uid() IS NOT NULL);


-- ── 8. Confirmation ───────────────────────────────────────────
-- Run after migration to verify expected counts.
-- Expected (fresh DB): signal_definitions=9, taxonomies=3,
--   segment_values=11, client_type_values=7, strategy_values=9,
--   total taxonomy_values=27, taxonomy_mappings=9, size_tiers=4,
--   promoted_signals=3.
-- identifiers_backfilled varies by existing data.

SELECT
  (SELECT COUNT(*)
     FROM public.signal_definitions)                          AS signal_definitions,
  (SELECT COUNT(*)
     FROM public.signal_definitions
    WHERE is_promoted_to_column)                              AS promoted_signals,
  (SELECT COUNT(*) FROM public.taxonomies)                    AS taxonomies,
  (SELECT COUNT(*) FROM public.taxonomy_values)               AS taxonomy_values,
  (SELECT COUNT(*) FROM public.taxonomy_values tv
     JOIN public.taxonomies t ON t.id = tv.taxonomy_id
    WHERE t.taxonomy_key = 'segment')                         AS segment_values,
  (SELECT COUNT(*) FROM public.taxonomy_values tv
     JOIN public.taxonomies t ON t.id = tv.taxonomy_id
    WHERE t.taxonomy_key = 'client_type')                     AS client_type_values,
  (SELECT COUNT(*) FROM public.taxonomy_values tv
     JOIN public.taxonomies t ON t.id = tv.taxonomy_id
    WHERE t.taxonomy_key = 'strategy')                        AS strategy_values,
  (SELECT COUNT(*) FROM public.taxonomy_mappings)             AS taxonomy_mappings,
  (SELECT COUNT(*) FROM public.size_tier_config)              AS size_tiers,
  (SELECT COUNT(*) FROM public.prospect_identifiers)          AS identifiers_backfilled;

-- ============================================================
-- Migration 026: Asset-class relevance — schema (Part A)
-- ============================================================
--
-- Builds the gate-then-score funnel's ELIGIBILITY layer: a
-- value-weighted 13F asset-class breakdown → per-firm relevance
-- verdict, kept SEPARATE from the fit score. Config-driven
-- throughout (mirrors segment_name_signals / taxonomy_values).
--
-- This migration is SCHEMA + CONFIG only. The classifier, verdict
-- derivation, activity metrics, gate wiring, and UI land in Parts
-- B/C. Idempotent: IF NOT EXISTS / ON CONFLICT. Single transaction.
--
-- Design notes
--   • Buckets: equity, option, adr, etf_trust, debt, other.
--   • put_call is the authoritative OPTION signal (handled in code,
--     before class_title) — ~24% of 13F value wears equity-like
--     class_titles, so class_title alone would misclassify options.
--   • Relevance verdict ∈ {relevant, likely_relevant, suspect,
--     irrelevant, unknown}. NEVER gate on absence (gate_on_absence
--     default false): empty/tiny/absent 13F → unknown, stays in.
--   • Fail-safe: unmatched class_titles → 'other' → served=true.
-- ============================================================


-- ── 1. served_asset_classes — which buckets count as "served" ──
CREATE TABLE IF NOT EXISTS public.served_asset_classes (
  bucket_key text        PRIMARY KEY,
  label      text        NOT NULL,
  served     boolean     NOT NULL,
  sort_order integer     NOT NULL DEFAULT 0,
  notes      text
);

INSERT INTO public.served_asset_classes (bucket_key, label, served, sort_order, notes) VALUES
  ('equity',    'Equity',           true,  1, 'common/ordinary shares, class shares, REITs'),
  ('option',    'Option',           true,  2, 'put/call — authoritative via put_call flag'),
  ('adr',       'ADR / ADS',        true,  3, 'sponsored ADR/ADS, registry shares'),
  ('etf_trust', 'ETF / Trust Unit', true,  4, 'ETFs, trust units, name-assisted fund lines'),
  ('debt',      'Debt',             false, 5, 'notes/bonds/debentures — NOT served'),
  ('other',     'Other',            true,  6, 'unmatched — fail-safe served=true (tunable)')
ON CONFLICT (bucket_key) DO NOTHING;


-- ── 2. asset_class taxonomy (value list, mirrors 017) ──────────
INSERT INTO public.taxonomies (taxonomy_key, label, version) VALUES
  ('asset_class', 'Asset Class', 1)
ON CONFLICT (taxonomy_key) DO NOTHING;

INSERT INTO public.taxonomy_values (taxonomy_id, value_key, label, fit_tier, sort_order)
SELECT t.id, v.value_key, v.label, NULL, v.sort_order
FROM public.taxonomies t
CROSS JOIN (VALUES
  ('equity',    'Equity',           1),
  ('option',    'Option',           2),
  ('adr',       'ADR / ADS',        3),
  ('etf_trust', 'ETF / Trust Unit', 4),
  ('debt',      'Debt',             5),
  ('other',     'Other',            6)
) AS v(value_key, label, sort_order)
WHERE t.taxonomy_key = 'asset_class'
ON CONFLICT (taxonomy_id, value_key) DO NOTHING;


-- ── 3. asset_class_patterns — class_title→bucket + ETF name-assist
--
-- pattern_kind:
--   'class_title' — regex matched (case-insensitive) against
--                   prospect_holdings.class_title.
--   'etf_name'    — regex matched against issuer_name to catch ETFs
--                   whose class_title is generic (e.g. 'TR UNIT') or
--                   equity-like. Applied as an ASSIST (Part B) before
--                   the equity catch-all.
-- Intended precedence (enforced in Part B): put_call(code) →
--   adr → debt → etf_trust(class_title) → etf_name(issuer) →
--   equity(catch-all) → other. Lower sort_order = higher priority.
-- Seeded against the REAL class_title distribution (625 distinct
-- strings; top 40 = 91.5% of value; 'other' ~1.1%).
CREATE TABLE IF NOT EXISTS public.asset_class_patterns (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern      text    NOT NULL,
  bucket       text    NOT NULL,   -- references served_asset_classes.bucket_key
  pattern_kind text    NOT NULL CHECK (pattern_kind IN ('class_title','etf_name')),
  sort_order   integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  notes        text,
  UNIQUE (pattern, pattern_kind)
);

INSERT INTO public.asset_class_patterns (pattern, bucket, pattern_kind, sort_order, notes) VALUES
  -- ADR / ADS (before equity so 'SPONSORED ADS' isn't caught by SHS)
  ('SPON\w*\s+AD[RS]|\bAD[RS]\b|REGISTRY\s+SH', 'adr', 'class_title', 10, 'sponsored ADR/ADS, NY registry shs'),
  -- Debt (coupon+date NOTEs, bonds, debentures)
  ('\bNOTE\b|\bBOND\b|\bDEB\b|DEBENTURE|\bMTN\b|\bSR\s+NT\b|\bSUB\s+NT\b', 'debt', 'class_title', 20, 'notes/bonds/debentures'),
  -- ETF / trust unit by class_title
  ('\bETF\b|TR\s+UNIT|TRUST\s+UNIT|UNIT\s+INV|DEP(OSITARY)?\s+UN', 'etf_trust', 'class_title', 30, 'ETF / trust / depositary units'),
  -- ETF name-assist (matched vs issuer_name) — funds with generic titles
  ('\bSPDR\b|ISHARES|VANGUARD|INVESCO|PROSHARES|WISDOMTREE|DIREXION|GLOBAL\s+X|\bARK\b|SELECT\s+SECTOR|STATE\s+STREET|GOLD\s+MINERS|RUSSELL\s+\d+|\bS&P\s+\d+|\bETF\b', 'etf_trust', 'etf_name', 40, 'ETF fund-name assist'),
  -- Equity catch-all (broadest; last before 'other')
  ('\bCOM\b|COMMON|\bSHS?\b|SHARES?|\bSTOCK\b|\bSTK\b|ORD(INARY)?|\bCL\s+[A-Z]\b|CLASS\s+[A-Z]|CAP(ITAL)?\s+STK|\bREIT\b|\bSBI\b', 'equity', 'class_title', 50, 'common/ordinary/class shares, REIT, SBI')
ON CONFLICT (pattern, pattern_kind) DO NOTHING;


-- ── 4. relevance_adv_name_flags — ADV negative name signals ────
-- The credit/realty CARRY-FORWARD from the segment work. A match is
-- a SOFT flag → 'suspect' (low confidence): the firm stays in with a
-- review flag + soft penalty. A name NEVER auto-disqualifies (no gate).
CREATE TABLE IF NOT EXISTS public.relevance_adv_name_flags (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern       text    NOT NULL UNIQUE,
  implied_class text    NOT NULL,   -- the non-served class the name implies (informational)
  verdict       text    NOT NULL DEFAULT 'suspect'
                   CHECK (verdict IN ('suspect','irrelevant')),
  confidence    text    NOT NULL DEFAULT 'low'
                   CHECK (confidence IN ('high','medium','low')),
  sort_order    integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  notes         text
);

INSERT INTO public.relevance_adv_name_flags (pattern, implied_class, sort_order) VALUES
  ('realty|real\s+estate',              'real_estate',    1),
  ('energy',                            'energy',         2),
  ('credit',                            'credit',         3),
  ('fixed\s+income',                    'debt',           4),
  ('\bbond\b',                          'debt',           5),
  ('mortgage',                          'mortgage',       6),
  ('municipal|\bmuni\b',                'municipal',      7),
  ('commodit',                          'commodities',    8),
  ('\bFX\b|foreign\s+exchange|\bcurrency\b', 'fx',        9),
  ('crypto|digital\s+asset|blockchain', 'crypto',         10),
  ('private\s+equity|\bPE\b',           'private_equity', 11)
ON CONFLICT (pattern) DO NOTHING;


-- ── 5. asset_class_relevance_config — single-row knobs ─────────
-- (mirrors icp_filter_config). Propose-and-tune; Part B reads these.
CREATE TABLE IF NOT EXISTS public.asset_class_relevance_config (
  id                    integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Absence handling: FALSE = empty/absent 13F NEVER gates (→ unknown).
  gate_on_absence       boolean      NOT NULL DEFAULT false,
  -- "Enough to evaluate" thresholds.
  min_holdings          integer      NOT NULL DEFAULT 10,
  min_served_value      numeric               DEFAULT NULL,
  -- ADV with no 13F and no negative name flag defaults to this verdict.
  no_signal_adv_default text         NOT NULL DEFAULT 'likely_relevant'
                          CHECK (no_signal_adv_default IN
                                 ('relevant','likely_relevant','suspect','irrelevant','unknown')),
  -- Verdict thresholds on served_fraction (0..1).
  relevant_min_fraction   numeric    NOT NULL DEFAULT 0.80,
  likely_min_fraction     numeric    NOT NULL DEFAULT 0.50,
  irrelevant_max_fraction numeric    NOT NULL DEFAULT 0.20,
  -- Moderate magnitudes. suspect_penalty is a soft fit deduction (Part C);
  -- the gate itself is exclusion (reversible), not a penalty.
  suspect_penalty       numeric      NOT NULL DEFAULT 15,
  -- Positive-lead ("possible HFT") trigger: a firm with AUM (from any source)
  -- >= this AND a tiny/empty 13F book (holdings < min_holdings) is flagged for
  -- enrichment, NOT gated. Tunable; default $1B.
  possible_hft_min_aum  numeric      NOT NULL DEFAULT 1000000000,
  updated_at            timestamptz  NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES public.profiles(id)
);

INSERT INTO public.asset_class_relevance_config (id) VALUES (1) ON CONFLICT DO NOTHING;


-- ── 5b. relevance_verdict_actions — verdict → gate/penalize/pass ──
-- Config-driven action map so Part C's gate is not a hardcoded rule-list.
--   gate     = excluded/deprioritized (reversible via override) — irrelevant only
--   penalize = stays in + review flag + soft penalty (suspect_penalty)
--   pass     = no effect
-- Only 'irrelevant' gates by default; the absence path ('unknown') always passes.
CREATE TABLE IF NOT EXISTS public.relevance_verdict_actions (
  verdict text PRIMARY KEY
            CHECK (verdict IN ('relevant','likely_relevant','suspect','irrelevant','unknown')),
  action  text NOT NULL CHECK (action IN ('gate','penalize','pass')),
  notes   text
);

INSERT INTO public.relevance_verdict_actions (verdict, action, notes) VALUES
  ('relevant',        'pass',     'high served fraction'),
  ('likely_relevant', 'pass',     'moderate served fraction / ADV default'),
  ('unknown',         'pass',     'absence path — NEVER gated'),
  ('suspect',         'penalize', 'review flag + soft penalty; stays in'),
  ('irrelevant',      'gate',     'debt-dominant book — excluded, reversible via override')
ON CONFLICT (verdict) DO NOTHING;


-- ── 6. Per-filing relevance + activity (time-series; one row per
--       filing on the existing prospect_filings table — no overwrite
--       of other filings) ──────────────────────────────────────────
ALTER TABLE public.prospect_filings
  ADD COLUMN IF NOT EXISTS served_fraction        numeric,
  ADD COLUMN IF NOT EXISTS asset_breakdown        jsonb,   -- { bucket: {value, fraction} }
  ADD COLUMN IF NOT EXISTS detected_asset_classes text[],
  ADD COLUMN IF NOT EXISTS activity_metrics       jsonb,   -- { turnover_pct, position_churn_pct, options_value_fraction, position_count }
  ADD COLUMN IF NOT EXISTS relevance_computed_at  timestamptz;


-- ── 7. Firm-level current verdict (mirror on prospects + accounts)
ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS asset_class_relevance          text
        CHECK (asset_class_relevance IN ('relevant','likely_relevant','suspect','irrelevant','unknown')),
  ADD COLUMN IF NOT EXISTS asset_class_confidence         text
        CHECK (asset_class_confidence IN ('high','medium','low')),
  ADD COLUMN IF NOT EXISTS asset_class_served_fraction    numeric,
  ADD COLUMN IF NOT EXISTS asset_class_breakdown          jsonb,
  ADD COLUMN IF NOT EXISTS asset_class_flags              jsonb,   -- {review, possible_hft, adv_name_flag,...}
  ADD COLUMN IF NOT EXISTS asset_class_relevance_override text
        CHECK (asset_class_relevance_override IN ('relevant','likely_relevant','suspect','irrelevant','unknown')),
  ADD COLUMN IF NOT EXISTS asset_class_override_by         uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS asset_class_override_at         timestamptz,
  ADD COLUMN IF NOT EXISTS asset_class_computed_at         timestamptz;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS asset_class_relevance          text
        CHECK (asset_class_relevance IN ('relevant','likely_relevant','suspect','irrelevant','unknown')),
  ADD COLUMN IF NOT EXISTS asset_class_confidence         text
        CHECK (asset_class_confidence IN ('high','medium','low')),
  ADD COLUMN IF NOT EXISTS asset_class_served_fraction    numeric,
  ADD COLUMN IF NOT EXISTS asset_class_breakdown          jsonb,
  ADD COLUMN IF NOT EXISTS asset_class_flags              jsonb,
  ADD COLUMN IF NOT EXISTS asset_class_relevance_override text
        CHECK (asset_class_relevance_override IN ('relevant','likely_relevant','suspect','irrelevant','unknown')),
  ADD COLUMN IF NOT EXISTS asset_class_override_by         uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS asset_class_override_at         timestamptz,
  ADD COLUMN IF NOT EXISTS asset_class_computed_at         timestamptz;

CREATE INDEX IF NOT EXISTS prospects_asset_class_relevance_idx
  ON public.prospects(asset_class_relevance);
CREATE INDEX IF NOT EXISTS accounts_asset_class_relevance_idx
  ON public.accounts(asset_class_relevance);


-- ── 8. Register new signals (reuse signal machinery) ───────────
INSERT INTO public.signal_definitions
  (signal_key, label, data_type, unit, canonical_dimension, comparison_method,
   is_promoted_to_column, producing_sources)
VALUES
  ('served_asset_fraction', 'Served Asset-Class Fraction',
   'number', 'pct', 'asset_class', 'numeric', true,  ARRAY['sec_13f']),
  ('asset_class_relevance',  'Asset-Class Relevance Verdict',
   'string', null,  'asset_class', 'categorical', true, ARRAY['sec_13f','sec_adv']),
  ('position_churn_pct',     'Position Churn % (q/q)',
   'number', 'pct', 'execution_sensitivity', 'numeric', false, ARRAY['sec_13f']),
  ('options_value_fraction', 'Options Value Fraction',
   'number', 'pct', 'execution_sensitivity', 'numeric', false, ARRAY['sec_13f'])
ON CONFLICT (signal_key) DO NOTHING;


-- ── 9. RLS on new config tables (authenticated read; writes via
--       service_role, which bypasses RLS — mirrors 017/024) ────────
ALTER TABLE public.served_asset_classes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_class_patterns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relevance_adv_name_flags      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_class_relevance_config  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relevance_verdict_actions     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "served_asset_classes_select"         ON public.served_asset_classes;
DROP POLICY IF EXISTS "asset_class_patterns_select"         ON public.asset_class_patterns;
DROP POLICY IF EXISTS "relevance_adv_name_flags_select"     ON public.relevance_adv_name_flags;
DROP POLICY IF EXISTS "asset_class_relevance_config_select" ON public.asset_class_relevance_config;
DROP POLICY IF EXISTS "relevance_verdict_actions_select"    ON public.relevance_verdict_actions;

CREATE POLICY "served_asset_classes_select"         ON public.served_asset_classes
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "asset_class_patterns_select"         ON public.asset_class_patterns
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "relevance_adv_name_flags_select"     ON public.relevance_adv_name_flags
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "asset_class_relevance_config_select" ON public.asset_class_relevance_config
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "relevance_verdict_actions_select"    ON public.relevance_verdict_actions
  FOR SELECT USING (auth.uid() IS NOT NULL);


-- ── 10. Confirmation ───────────────────────────────────────────
-- Expect: served_buckets=6 (5 served, debt not), asset_class_values=6,
-- class_title_patterns + etf_name patterns=5, adv_name_flags=11,
-- config row=1, new signals=4.
SELECT
  (SELECT COUNT(*) FROM public.served_asset_classes)                         AS served_buckets,
  (SELECT COUNT(*) FROM public.served_asset_classes WHERE served)            AS served_true,
  (SELECT COUNT(*) FROM public.taxonomy_values tv JOIN public.taxonomies t ON t.id=tv.taxonomy_id
     WHERE t.taxonomy_key='asset_class')                                     AS asset_class_values,
  (SELECT COUNT(*) FROM public.asset_class_patterns)                         AS patterns,
  (SELECT COUNT(*) FROM public.asset_class_patterns WHERE pattern_kind='etf_name') AS etf_name_patterns,
  (SELECT COUNT(*) FROM public.relevance_adv_name_flags)                     AS adv_name_flags,
  (SELECT COUNT(*) FROM public.asset_class_relevance_config)                 AS config_rows,
  (SELECT COUNT(*) FROM public.relevance_verdict_actions)                    AS verdict_actions,
  (SELECT COUNT(*) FROM public.relevance_verdict_actions WHERE action='gate') AS gating_verdicts,
  (SELECT COUNT(*) FROM public.signal_definitions
     WHERE signal_key IN ('served_asset_fraction','asset_class_relevance','position_churn_pct','options_value_fraction')) AS new_signals;

-- Served-bucket seed (eyeball served flags):
SELECT bucket_key, label, served, sort_order FROM public.served_asset_classes ORDER BY sort_order;

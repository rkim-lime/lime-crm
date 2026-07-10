# Tunable Parameters

Standing rule: **no hardcoded thresholds / limits / weights / rule-lists in code** —
every tunable lives in a config table and is read at runtime. This doc is the
index of those knobs. A config UI is a later unified build; edit via SQL for now.

## Asset-class relevance (migrations 026–027)

### `asset_class_relevance_config` (single row, id = 1)
| knob | default | meaning |
|---|---|---|
| `gate_on_absence` | `false` | if false, an empty/absent 13F NEVER gates (→ `unknown`) |
| `min_holdings` | `10` | minimum holdings to evaluate a 13F book; below → `unknown` |
| `min_served_value` | `null` | optional $ floor for "enough to evaluate" |
| `no_signal_adv_default` | `likely_relevant` | ADV, no 13F, no name flag → this verdict |
| `relevant_min_fraction` | `0.80` | served_fraction ≥ → `relevant` |
| `likely_min_fraction` | `0.50` | served_fraction ≥ → `likely_relevant` |
| `irrelevant_max_fraction` | `0.20` | served_fraction ≤ **AND** non-served bucket dominant → `irrelevant` |
| `suspect_penalty` | `15` | soft display-priority deduction for `suspect` (fit_score left intrinsic) |
| `possible_hft_min_aum` | `1000000000` | AUM ≥ this (+ tiny book) → possible_hft lead |
| `possible_hft_requires_13f_filer` | `true` | if true, possible_hft fires only for firms that HAVE a 13F filing with a tiny book (an ADV-only adviser with no 13F is expected, not a mismatch). false → AUM+holdings only |

### `served_asset_classes` (per bucket)
`served` boolean. Seed: equity/option/adr/etf_trust = true; **debt = false**; other = true (fail-safe).

### `asset_class_patterns` (classifier rules)
`pattern` (regex), `bucket`, `pattern_kind` (`class_title` | `etf_name`), `sort_order` (precedence),
`is_active`. Precedence: `put_call`→option (structural, in code) → adr → debt → etf_trust →
etf_name issuer-assist → equity → other.

### `relevance_adv_name_flags` (ADV negative-name soft flags)
`pattern` (regex), `implied_class`, `verdict` (default `suspect`), `confidence`, `sort_order`, `is_active`.
Seed: realty, energy, credit, fixed income, bond, mortgage, municipal, commodities, FX, crypto, private equity.

### `relevance_verdict_actions` (verdict → action)
`verdict` → `action` ∈ {`gate`, `penalize`, `pass`}. Seed: irrelevant→gate, suspect→penalize, rest→pass.
Only `gate` excludes (reversibly, via the prospect override columns); `unknown` always passes.

## Segment derivation (migrations 024–025, 028)
- `segment_name_signals` — name→segment rules (`sort_order` precedence). `signal_kind`:
  - `name_signal` — direct name→segment (with optional `vetoes_hedge_fund`).
  - `fund_name` — corroborates hedge_fund.
  - `fund_type` — fund-subtype (quant/prop). **`promote_from text[]`** = base composition
    verdicts eligible to promote to the subtype; a match on a base NOT in `promote_from`
    keeps the base and raises `segment_flags.possible_<target>`. `promote_from` governs ONLY
    the composition path — the empty-clientTypes name path treats every rule as a direct target.
- `taxonomy_values.label` — segment display labels (single source of truth).
- `taxonomy_values.fit_tier` — per-segment fit tier (high/medium/low; NULL = abstain).
- **`fit_tier_ratios`** (migration 028) — `tier → ratio` (high 1.0 / medium 0.5 / low 0.25).
  fitScore maps `taxonomy_values.fit_tier` → ratio through this table; injected into
  `computeFitScore` (never fetched inside), so the Config UI preview can score a candidate config.

## Sanity checks (migrations 029–030)
- **`check_definitions`** — the check catalogue. Per-row tunables: `is_active`,
  `severity` (warn|fail), `scope_type`/`scope_value`, and **`params` (jsonb)** for
  per-check thresholds:
  - `no_segment_over_90pct` → `params.max_share` (default `0.90`)
  - `segment_distribution_shift` → `params.max_shift_pct` (default `10`)
- **`signal_definitions.derivation`** (jsonb) — the drift registry that
  `drift_stored_matches_derived` walks. `{target, kind, ...}` per signal
  (passthrough / derived / by_source / skip). A NULL/absent descriptor makes the
  drift check FAIL for that signal (coverage-hole guard) — adding a signal
  without a descriptor breaks loudly. Code holds the fn-name → pure-fn dispatch map.
- Note: `resolveFirm`'s module-level `_matcherConfig` (via `setMatcherData`) is a
  weaker (non-per-call) config seam — which is why `matchReason` isn't drift-checked
  and is covered by the `dedup_resolved_has_match_reason` invariant instead.

## Other existing config
- `icp_filter_config` — min AUM / turnover / positions, excluded segments.
- `size_tier_config` — AUM band thresholds.
- `scoring_config` — fit-score criterion weights.

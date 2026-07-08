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

## Segment derivation (migrations 024–025)
- `segment_name_signals` — name→segment rules, veto flags, fund-name corroboration (`sort_order` precedence).
- `taxonomy_values.label` — segment display labels (single source of truth).

## Other existing config
- `icp_filter_config` — min AUM / turnover / positions, excluded segments.
- `size_tier_config` — AUM band thresholds.
- `scoring_config` — fit-score criterion weights.

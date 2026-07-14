// Config-UI preview tests. The crown-jewel assertion (CONFIG_UI_BUILD.md
// verification anchor): preview's predicted delta EQUALS what a recompute
// produces — verified by driving the real engine fn independently and matching
// the preview aggregation against it. Plus the guardrails: threshold inversion
// blocked, invalid regex blocked, test-panel match counts correct.
//
// Frontend suite (src/**). Imports the shared engine via the Vite toolchain, so
// preview here == preview in the browser == preview in ingestion.

import { describe, it, expect } from 'vitest';
import { deriveRelevanceVerdict } from '../../shared/engine/assetClass.js';
import { CONFIG, SERVED_SET } from '../../shared/engine/__fixtures__/parityCases.js';
import {
  previewRelevanceReband, rebandVerdict, previewSegmentReband, previewFitDistribution,
  compileRegex, matchNames, patternDiff, validateThresholdOrder, turningOnGateAbsence,
  RELEVANCE_VERDICTS,
} from '../../shared/engine/preview.js';

const REL = CONFIG.relevanceConfig;

// Stored-firm fixtures spanning every band (as persisted: served_fraction +
// value-weighted breakdown + holding count — no holdings traversal).
const FIRMS = [
  { id: 1, firm_name: 'Relevant Equity Fund',  served_fraction: 0.85, position_count: 100, breakdown: { equity: { value: 850 }, debt: { value: 150 } } },
  { id: 2, firm_name: 'Very Relevant Fund',    served_fraction: 0.95, position_count: 120, breakdown: { equity: { value: 950 }, debt: { value: 50 } } },
  { id: 3, firm_name: 'Likely Fund',           served_fraction: 0.60, position_count: 80,  breakdown: { equity: { value: 600 }, debt: { value: 400 } } },
  { id: 4, firm_name: 'Debt Dominant Corp',    served_fraction: 0.10, position_count: 40,  breakdown: { equity: { value: 100 }, debt: { value: 900 } } },
  { id: 5, firm_name: 'Thin Book LLC',         served_fraction: 0.90, position_count: 4,   breakdown: { equity: { value: 90 } } },
];

// Independent recompute: drive the real engine fn firm-by-firm (a DIFFERENT code
// path than preview's internal aggregation) to build the expected distribution.
function recomputeCounts(firms, config) {
  const counts = Object.fromEntries(RELEVANCE_VERDICTS.map((v) => [v, 0]));
  for (const f of firms) {
    const byBucket = Object.fromEntries(Object.entries(f.breakdown).map(([b, v]) => [b, v.value]));
    const total_value = Object.values(byBucket).reduce((s, v) => s + v, 0);
    const verdict = deriveRelevanceVerdict({
      served_fraction: f.served_fraction, total_value, holdingCount: f.position_count, byBucket, servedSet: SERVED_SET, config,
    }).verdict;
    counts[verdict]++;
  }
  return counts;
}

describe('relevance re-band — preview/actual agreement', () => {
  it('current-config bands match the anchors', () => {
    expect(rebandVerdict(FIRMS[0], REL, SERVED_SET)).toBe('relevant');
    expect(rebandVerdict(FIRMS[2], REL, SERVED_SET)).toBe('likely_relevant');
    expect(rebandVerdict(FIRMS[3], REL, SERVED_SET)).toBe('irrelevant'); // debt-dominant, served ≤ 0.2
    expect(rebandVerdict(FIRMS[4], REL, SERVED_SET)).toBe('unknown');    // thin book, insufficient
  });

  it('raising relevant_min 0.80→0.90 moves exactly the firms a recompute moves', () => {
    const candidate = { ...REL, relevant_min_fraction: 0.90 };
    const preview = previewRelevanceReband({
      firms: FIRMS, currentConfig: REL, candidateConfig: candidate, servedSet: SERVED_SET,
    });

    // THE CONTRACT: preview's predicted post-save distribution == engine applied
    // firm-by-firm via the independent code path.
    expect(preview.counts.to).toEqual(recomputeCounts(FIRMS, candidate));
    expect(preview.counts.from).toEqual(recomputeCounts(FIRMS, REL));

    // Firm 1 (0.85) drops relevant→likely_relevant; nothing else moves.
    expect(preview.moved).toBe(1);
    expect(preview.transitions).toEqual({ 'relevant→likely_relevant': 1 });
    expect(preview.changedFirms).toEqual([{ id: 1, firm_name: 'Relevant Equity Fund', from: 'relevant', to: 'likely_relevant' }]);
  });

  it('gate count is reported (0 gated stays 0 when thresholds tighten upward)', () => {
    const candidate = { ...REL, relevant_min_fraction: 0.90 };
    const preview = previewRelevanceReband({
      firms: FIRMS, currentConfig: REL, candidateConfig: candidate, servedSet: SERVED_SET,
      verdictActions: [{ verdict: 'irrelevant', action: 'gate' }],
    });
    // Firm 4 is irrelevant under both → 1 gated before and after, delta 0.
    expect(preview.gated).toEqual({ before: 1, after: 1, delta: 0 });
  });

  it('lowering irrelevant_max below a firm\'s served_fraction un-gates it (delta reflected)', () => {
    // Firm 4 at 0.10 is irrelevant. Drop irrelevant_max under 0.10 so 0.10 no
    // longer qualifies as irrelevant → becomes suspect. gated: 1→0.
    const candidate = { ...REL, irrelevant_max_fraction: 0.05 };
    const preview = previewRelevanceReband({
      firms: FIRMS, currentConfig: REL, candidateConfig: candidate, servedSet: SERVED_SET,
    });
    expect(preview.counts.to).toEqual(recomputeCounts(FIRMS, candidate));
    expect(preview.gated.delta).toBe(-1);
  });
});

describe('segment re-derive — ADV firms, shared deriveAdvSegment', () => {
  const advFirms = [
    { id: 1, firm_name: 'Zephyr Global Holdings', clientTypes: [], hasPrivateFundClients: false }, // no current match → unknown
    { id: 2, firm_name: 'Trevian Wealth Management', clientTypes: [], hasPrivateFundClients: false }, // matches 'wealth'
  ];

  it('adding a name-signal rule changes exactly the newly-matched firm', () => {
    const candidate = [...CONFIG.nameSignals, {
      pattern: '\\bglobal\\b', target_segment: 'family_office', signal_kind: 'name_signal',
      vetoes_hedge_fund: false, confidence: 'low', sort_order: 5, is_active: true, promote_from: null,
    }];
    const preview = previewSegmentReband({ firms: advFirms, currentSignals: CONFIG.nameSignals, candidateSignals: candidate });
    expect(preview.changed).toBe(1);
    expect(preview.changes).toEqual([{ id: 1, firm_name: 'Zephyr Global Holdings', from: 'unknown', to: 'family_office' }]);
  });

  it('no rule change → no segment change', () => {
    const preview = previewSegmentReband({ firms: advFirms, currentSignals: CONFIG.nameSignals, candidateSignals: CONFIG.nameSignals });
    expect(preview.changed).toBe(0);
  });
});

describe('fit distribution — shared computeFitScore', () => {
  const FIT_CFG = { weights: CONFIG.weights, segmentTiers: CONFIG.segmentTiers, tierRatios: CONFIG.tierRatios };
  const strong = (segment_canonical) => ({
    estimated_aum_usd: 6_000_000_000, portfolio_turnover_pct: 60, equities_pct: 90,
    options_present: true, position_count: 120, segment_canonical,
  });
  const firms = [strong('wealth_manager'), strong('bank'), strong('asset_manager')];

  it('raising the low-tier ratio lifts low-tier firms; mean rises', () => {
    const candidate = { ...FIT_CFG, tierRatios: { ...FIT_CFG.tierRatios, low: 0.5 } };
    const preview = previewFitDistribution({ firms, currentCfg: FIT_CFG, candidateCfg: candidate });
    expect(preview.changed).toBeGreaterThanOrEqual(2); // wealth_manager + bank are low-tier
    expect(preview.mean.after).toBeGreaterThan(preview.mean.before);
  });
});

describe('regex test panel + validation', () => {
  const names = ['Trevian Wealth Management', 'Zephyr Global Holdings', 'Aqua Wealth Partners', 'Point72 Asset Management'];

  it('matchNames returns correct count + samples', () => {
    const r = matchNames('wealth', names);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(2);
    expect(r.total).toBe(4);
    expect(r.matched).toEqual(['Trevian Wealth Management', 'Aqua Wealth Partners']);
  });

  it('invalid regex is blocked, never throws', () => {
    expect(compileRegex('(unclosed').ok).toBe(false);
    const r = matchNames('(unclosed', names);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.count).toBe(0);
  });

  it('patternDiff reports added/removed against real names', () => {
    const d = patternDiff('wealth', 'wealth|global', names);
    expect(d.ok).toBe(true);
    expect(d.beforeCount).toBe(2);
    expect(d.afterCount).toBe(3);
    expect(d.added).toEqual(['Zephyr Global Holdings']);
    expect(d.removed).toEqual([]);
  });

  it('patternDiff blocks when the new pattern is invalid', () => {
    expect(patternDiff('wealth', '(bad', names).ok).toBe(false);
  });
});

describe('asset_class_relevance_config guardrails', () => {
  it('valid threshold ordering passes', () => {
    expect(validateThresholdOrder(REL).ok).toBe(true);
  });

  it('threshold inversion is rejected with a clear error', () => {
    const inverted = { ...REL, relevant_min_fraction: 0.10 }; // rel now below likely(0.5)
    const r = validateThresholdOrder(inverted);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/irrelevant_max.*<.*likely_min.*<.*relevant_min/);
  });

  it('non-numeric thresholds rejected', () => {
    expect(validateThresholdOrder({ ...REL, likely_min_fraction: '' }).ok).toBe(false);
  });

  it('gate_on_absence off→on triggers the confirmation gate; other transitions do not', () => {
    expect(turningOnGateAbsence({ gate_on_absence: false }, { gate_on_absence: true })).toBe(true);
    expect(turningOnGateAbsence({ gate_on_absence: true }, { gate_on_absence: true })).toBe(false);
    expect(turningOnGateAbsence({ gate_on_absence: true }, { gate_on_absence: false })).toBe(false);
    expect(turningOnGateAbsence({ gate_on_absence: false }, { gate_on_absence: false })).toBe(false);
  });
});

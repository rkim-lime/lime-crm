import { describe, it, expect } from 'vitest';
import {
  coerceValue, isMatcherEditable, RELEVANCE_FIELDS,
  ADV_VERDICTS, VERDICT_ACTIONS, NO_SIGNAL_DEFAULTS, CONFIDENCES,
} from './configSpecs';

describe('coerceValue', () => {
  it('bool → boolean', () => {
    expect(coerceValue('bool', true)).toBe(true);
    expect(coerceValue('bool', '')).toBe(false);
    expect(coerceValue('bool', 1)).toBe(true);
  });
  it('int → integer', () => {
    expect(coerceValue('int', '10')).toBe(10);
    expect(coerceValue('int', '10.9')).toBe(10);
    expect(coerceValue('int', '')).toBeNull();
  });
  it('num/frac → number, empty → null', () => {
    expect(coerceValue('num', '1000000000')).toBe(1_000_000_000);
    expect(coerceValue('frac', '0.85')).toBe(0.85);
    expect(coerceValue('num', '')).toBeNull();       // e.g. min_served_value cleared
    expect(coerceValue('frac', null)).toBeNull();
    expect(coerceValue('num', 'abc')).toBeNull();
  });
  it('enum/text → passthrough', () => {
    expect(coerceValue('enum', 'likely_relevant')).toBe('likely_relevant');
    expect(coerceValue('text', 'Equity Fund')).toBe('Equity Fund');
  });
});

describe('isMatcherEditable', () => {
  it('only stage-1/stage-2 thresholds are editable this stage', () => {
    expect(isMatcherEditable('stage1_recall_threshold')).toBe(true);
    expect(isMatcherEditable('stage2_decision_threshold')).toBe(true);
    expect(isMatcherEditable('distinctiveness_threshold')).toBe(false);
    expect(isMatcherEditable('weighting_strength')).toBe(false);
    expect(isMatcherEditable('freq_recompute_cadence')).toBe(false);
  });
});

describe('RELEVANCE_FIELDS spec', () => {
  it('covers every tier-1 relevance knob', () => {
    const keys = RELEVANCE_FIELDS.map((f) => f.key);
    for (const k of [
      'gate_on_absence', 'min_holdings', 'no_signal_adv_default', 'suspect_penalty',
      'possible_hft_min_aum', 'possible_hft_requires_13f_filer',
      'relevant_min_fraction', 'likely_min_fraction', 'irrelevant_max_fraction',
    ]) expect(keys).toContain(k);
  });
  it('every field has a renderable type', () => {
    for (const f of RELEVANCE_FIELDS) expect(['bool', 'int', 'num', 'frac', 'enum']).toContain(f.type);
  });
  it('the enum field carries options', () => {
    const enumF = RELEVANCE_FIELDS.find((f) => f.type === 'enum');
    expect(enumF.options).toEqual(NO_SIGNAL_DEFAULTS);
  });
});

describe('enum option lists mirror the CHECK constraints', () => {
  it('exact sets', () => {
    expect(ADV_VERDICTS).toEqual(['suspect', 'irrelevant']);
    expect(VERDICT_ACTIONS).toEqual(['gate', 'penalize', 'pass']);
    expect(NO_SIGNAL_DEFAULTS).toEqual(['relevant', 'likely_relevant', 'suspect', 'irrelevant', 'unknown']);
    expect(CONFIDENCES).toEqual(['high', 'medium', 'low']);
  });
});

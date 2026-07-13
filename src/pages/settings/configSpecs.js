// Pure specs + coercion for the Config UI surfaces (stage C2). No React — unit-tested.
// Enum option lists mirror the tables' CHECK constraints (schema-defined, not tunables).

export const ADV_VERDICTS       = ['suspect', 'irrelevant'];                              // relevance_adv_name_flags.verdict
export const NO_SIGNAL_DEFAULTS = ['relevant', 'likely_relevant', 'suspect', 'irrelevant', 'unknown']; // asset_class_relevance_config
export const VERDICT_ACTIONS    = ['gate', 'penalize', 'pass'];                           // relevance_verdict_actions.action
export const CONFIDENCES        = ['high', 'medium', 'low'];

// matcher_config keys editable this stage; everything else is shown read-only (tier-2).
export const MATCHER_EDITABLE = new Set(['stage1_recall_threshold', 'stage2_decision_threshold']);
export function isMatcherEditable(key) {
  return MATCHER_EDITABLE.has(key);
}

// asset_class_relevance_config knob form spec. type drives the control + coercion.
export const RELEVANCE_FIELDS = [
  { key: 'gate_on_absence',                 label: 'Gate on absence',                 type: 'bool',
    help: 'When ON, an empty/absent 13F book can gate a firm as irrelevant. Default OFF — an absent book routes to unknown.' },
  { key: 'min_holdings',                    label: 'Min holdings to evaluate',        type: 'int' },
  { key: 'min_served_value',                label: 'Min served value (USD)',          type: 'num', nullable: true },
  { key: 'relevant_min_fraction',           label: 'Relevant when served ≥',          type: 'frac' },
  { key: 'likely_min_fraction',             label: 'Likely-relevant when served ≥',   type: 'frac' },
  { key: 'irrelevant_max_fraction',         label: 'Irrelevant when served ≤',        type: 'frac' },
  { key: 'suspect_penalty',                 label: 'Suspect penalty (fit points)',    type: 'num' },
  { key: 'no_signal_adv_default',           label: 'No-signal ADV default verdict',   type: 'enum', options: NO_SIGNAL_DEFAULTS },
  { key: 'possible_hft_min_aum',            label: 'Possible-HFT min AUM (USD)',       type: 'num' },
  { key: 'possible_hft_requires_13f_filer', label: 'Possible-HFT requires 13F filer', type: 'bool' },
];

// Coerce a raw form value to the DB type. Returns null for an empty nullable number.
export function coerceValue(type, raw) {
  switch (type) {
    case 'bool': return !!raw;
    case 'int': {
      const n = parseInt(raw, 10);
      return Number.isFinite(n) ? n : null;
    }
    case 'num':
    case 'frac': {
      if (raw === '' || raw == null) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    default: return raw; // enum / text
  }
}

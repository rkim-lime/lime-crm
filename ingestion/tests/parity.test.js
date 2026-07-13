import { describe, it, expect } from 'vitest';
import { inferSegment, deriveAdvSegment } from '../../shared/engine/computeSignals.js';
import { deriveRelevanceVerdict } from '../../shared/engine/assetClass.js';
import { computeFitScore } from '../../shared/engine/fitScore.js';
import { cases } from '../../shared/engine/__fixtures__/parityCases.js';

// Parity — INGESTION side. The SAME shared/engine functions + the SAME golden
// fixtures are asserted here (Node) and in src/engine/parity.test.js (Vite). Both
// green ⇒ the two toolchains import one shared source and compute identically.
const FNS = { inferSegment, deriveAdvSegment, computeFitScore, deriveRelevanceVerdict };

describe('shared/engine parity (real DB config) — ingestion', () => {
  for (const c of cases) {
    it(`${c.fn}: ${c.label}`, () => {
      expect(FNS[c.fn](...c.args)).toEqual(c.expected);
    });
  }
});

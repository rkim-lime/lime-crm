/**
 * Unit tests for connectors/ingest_13f/parse13F.js
 *
 * Pure function — no mocking, no network. Uses inline XML fixtures plus
 * the shared fixture file.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync }          from 'fs';
import { fileURLToPath }         from 'url';
import { join, dirname }         from 'path';
import { parse13F }              from '../src/connectors/ingest_13f/parse13F.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const FIXTURE_XML = readFileSync(join(__dir, 'fixtures/13f-info-table.xml'), 'utf8');

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Minimal valid information table with one holding
const SINGLE_ROW_XML = `<?xml version="1.0" encoding="UTF-8"?>
<informationTable>
  <infoTable>
    <nameOfIssuer>NVIDIA CORP</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>67066G104</cusip>
    <value>10000</value>
    <shrsOrPrnAmt><sshPrnamt>50000</sshPrnamt></shrsOrPrnAmt>
  </infoTable>
</informationTable>`;

// No information table at all (the Raymond James case — some filers omit the table)
const NO_TABLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<informationTable></informationTable>`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parse13F', () => {
  describe('basic parsing (fixture file)', () => {
    it('returns correct holding count — invalid short CUSIP is filtered', () => {
      // Fixture has 4 rows; 1 has a 3-char CUSIP → filtered → 3 valid holdings
      const { holdingCount } = parse13F(FIXTURE_XML, '2025-09-30');
      expect(holdingCount).toBe(3);
    });

    it('parses issuer names and CUSIPs correctly', () => {
      const { holdings } = parse13F(FIXTURE_XML, '2025-09-30');
      expect(holdings[0].issuerName).toBe('APPLE INC');
      expect(holdings[0].cusip).toBe('037833100');
      expect(holdings[1].issuerName).toBe('MICROSOFT CORP');
      expect(holdings[1].cusip).toBe('594918104');
    });

    it('detects Put option from putCall field', () => {
      const { holdings } = parse13F(FIXTURE_XML, '2025-09-30');
      const putHolding = holdings.find(h => h.putCall === 'Put');
      expect(putHolding).toBeDefined();
      expect(putHolding?.issuerName).toMatch(/SPDR/i);
    });

    it('parses share counts from shrsOrPrnAmt', () => {
      const { holdings } = parse13F(FIXTURE_XML, '2025-09-30');
      expect(holdings[0].shares).toBe(25000);
      expect(holdings[1].shares).toBe(10000);
    });
  });

  describe('value scaling: pre-2023 (thousands) vs post-2023 (dollars)', () => {
    it('pre-2023 periodOfReport: multiplies value by 1000', () => {
      // Apple row: value=5000 in XML → 5000 * 1000 = 5,000,000 USD
      const { holdings } = parse13F(FIXTURE_XML, '2022-09-30');
      expect(holdings[0].valueUsd).toBe(5_000_000);
    });

    it('post-2023 periodOfReport: uses value as-is (no multiplier)', () => {
      // Apple row: value=5000 in XML → 5000 USD
      const { holdings } = parse13F(FIXTURE_XML, '2023-03-31');
      expect(holdings[0].valueUsd).toBe(5_000);
    });

    it('boundary: exactly 2023-01-01 is post-2023 (uses dollars)', () => {
      const { holdings } = parse13F(SINGLE_ROW_XML, '2023-01-01');
      expect(holdings[0].valueUsd).toBe(10_000);
    });

    it('null periodOfReport: treated as post-2023 (no multiplier)', () => {
      const { holdings } = parse13F(SINGLE_ROW_XML, null);
      expect(holdings[0].valueUsd).toBe(10_000);
    });

    it('totalValueUsd sums all valid holdings with correct scaling', () => {
      // Pre-2023: Apple(5000) + MSFT(3000) + SPDR(1000) = 9000 rows * 1000 = 9,000,000
      const { totalValueUsd } = parse13F(FIXTURE_XML, '2022-06-30');
      expect(totalValueUsd).toBe(9_000_000);
    });
  });

  describe('edge cases', () => {
    it('empty information table → zero holdings, zero total', () => {
      const { holdings, totalValueUsd, holdingCount } = parse13F(NO_TABLE_XML, '2024-09-30');
      expect(holdings).toEqual([]);
      expect(totalValueUsd).toBe(0);
      expect(holdingCount).toBe(0);
    });

    it('single valid holding parses correctly', () => {
      const { holdings, holdingCount } = parse13F(SINGLE_ROW_XML, '2025-06-30');
      expect(holdingCount).toBe(1);
      expect(holdings[0].issuerName).toBe('NVIDIA CORP');
      expect(holdings[0].cusip).toBe('67066G104');
      expect(holdings[0].shares).toBe(50000);
    });

    it('filters out CUSIPs shorter than 8 characters', () => {
      const xml = `<informationTable>
        <infoTable>
          <nameOfIssuer>VALID CO</nameOfIssuer><titleOfClass>COM</titleOfClass>
          <cusip>12345678</cusip><value>100</value>
          <shrsOrPrnAmt><sshPrnamt>10</sshPrnamt></shrsOrPrnAmt>
        </infoTable>
        <infoTable>
          <nameOfIssuer>SHORT CO</nameOfIssuer><titleOfClass>COM</titleOfClass>
          <cusip>1234567</cusip><value>999</value>
          <shrsOrPrnAmt><sshPrnamt>99</sshPrnamt></shrsOrPrnAmt>
        </infoTable>
      </informationTable>`;
      const { holdingCount } = parse13F(xml, '2025-03-31');
      expect(holdingCount).toBe(1);
    });

    it('missing value field defaults to 0', () => {
      const xml = `<informationTable>
        <infoTable>
          <nameOfIssuer>NO VALUE CO</nameOfIssuer>
          <cusip>037833100</cusip>
          <shrsOrPrnAmt><sshPrnamt>100</sshPrnamt></shrsOrPrnAmt>
        </infoTable>
      </informationTable>`;
      const { holdings } = parse13F(xml, '2024-01-01');
      expect(holdings[0].valueUsd).toBe(0);
    });
  });
});

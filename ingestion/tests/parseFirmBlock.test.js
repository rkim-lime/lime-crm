/**
 * Unit tests for connectors/ingest_adv/index.js — parseFirmBlock / normalizeFromFirm
 *
 * Pure XML parsing — no mocking, no network.
 * Fixture blocks are trimmed real-world examples with confirmed Q-code paths.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { parseFirmBlock }                  from '../src/connectors/ingest_adv/index.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Rabenold Advisors — HNW/individual clients, no private fund, AUM reported
const RABENOLD_XML = `<Firm>
  <Info FirmCrdNb="283882" LegalNm="RABENOLD ADVISORS, INC." BusNm="RABENOLD ADVISORS" SECNb="801-12345"/>
  <FormInfo>
    <Part1A>
      <Item5F Q5F1="Y" Q5F2C="35557038" Q5F2A="20000000" Q5F2B="15557038"/>
      <Item5D Q5DA1="12" Q5DB1="8" Q5DM1="0" Q5DF1="0" Q5DC1="0"/>
      <Item7A/>
    </Part1A>
  </FormInfo>
</Firm>`;

// MK Capital — private fund only: null AUM (Item5F Q5F1="N", no Q5F2C),
// empty Item5D, Item7A has attributes (is an object, not empty string)
const MK_CAPITAL_XML = `<Firm>
  <Info FirmCrdNb="312360" LegalNm="MK CAPITAL COMPANY"/>
  <FormInfo>
    <Part1A>
      <Item5F Q5F1="N"/>
      <Item5D/>
      <Item7A Q7A1="N" Q7A2="N" Q7A3="Y" Q7A16="Y"/>
    </Part1A>
  </FormInfo>
</Firm>`;

// Clearbridge — diversified institutional: pooled vehicles, pension, institutional
const CLEARBRIDGE_XML = `<Firm>
  <Info FirmCrdNb="151223" LegalNm="CLEARBRIDGE INVESTMENTS (NORTH AMERICA) PTY LIMITED"/>
  <FormInfo>
    <Part1A>
      <Item5F Q5F1="Y" Q5F2C="2228148061"/>
      <Item5D Q5DA1="0" Q5DB1="0" Q5DM1="15" Q5DF1="12" Q5DC1="8" Q5DI1="3" Q5DJ1="2" Q5DK1="1"/>
      <Item7A Q7A1="Y" Q7A2="N" Q7A16="N"/>
    </Part1A>
  </FormInfo>
</Firm>`;

// Firm with only BusNm (no LegalNm) — fallback name test
const BUS_NM_ONLY_XML = `<Firm>
  <Info FirmCrdNb="999001" BusNm="ACME ADVISORS LLC"/>
  <FormInfo>
    <Part1A>
      <Item5F Q5F1="N"/>
      <Item5D/>
      <Item7A/>
    </Part1A>
  </FormInfo>
</Firm>`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parseFirmBlock', () => {
  describe('Rabenold Advisors — standard RIA with reported AUM', () => {
    let signal;
    beforeAll(() => { signal = parseFirmBlock(RABENOLD_XML); });

    it('extracts firm name from LegalNm', () => {
      expect(signal.firmName).toBe('RABENOLD ADVISORS, INC.');
    });

    it('extracts CRD number', () => {
      expect(signal.crdNumber).toBe('283882');
    });

    it('extracts regulatory AUM from Q5F2C', () => {
      expect(signal.regulatoryAum).toBe(35557038);
      expect(signal.estimated_aum_usd).toBe(35557038);
    });

    it('detects individual and HNW client types from Item5D counts', () => {
      expect(signal.clientTypes).toContain('individuals');
      expect(signal.clientTypes).toContain('high_net_worth');
    });

    it('hasPrivateFundClients is false (Item7A is empty — self-closing tag)', () => {
      expect(signal.advFlags.hasPrivateFundClients).toBe(false);
    });

    it('sets source to sec_adv', () => {
      expect(signal.source).toBe('sec_adv');
    });

    it('sets source_url using CRD', () => {
      expect(signal.source_url).toBe('https://adviserinfo.sec.gov/firm/summary/283882');
    });
  });

  describe('MK Capital — private-fund-only firm (the null-AUM edge case)', () => {
    let signal;
    beforeAll(() => { signal = parseFirmBlock(MK_CAPITAL_XML); });

    it('extracts name and CRD', () => {
      expect(signal.firmName).toBe('MK CAPITAL COMPANY');
      expect(signal.crdNumber).toBe('312360');
    });

    it('regulatoryAum is null (Q5F1="N", no Q5F2C attribute)', () => {
      expect(signal.regulatoryAum).toBeNull();
    });

    it('estimated_aum_usd is 0 (fallback from null regulatoryAum)', () => {
      expect(signal.estimated_aum_usd).toBe(0);
    });

    it('clientTypes is empty (no Item5D counts)', () => {
      expect(signal.clientTypes).toEqual([]);
    });

    it('hasPrivateFundClients is true (Item7A has Q-code attributes = object)', () => {
      expect(signal.advFlags.hasPrivateFundClients).toBe(true);
    });

    it('produces a complete valid signal despite null AUM', () => {
      expect(signal.firmName).toBeTruthy();
      expect(signal.crdNumber).toBeTruthy();
      expect(signal.source).toBe('sec_adv');
      expect(typeof signal.estimated_aum_usd).toBe('number');
    });
  });

  describe('Clearbridge — institutional with pooled vehicles', () => {
    let signal;
    beforeAll(() => { signal = parseFirmBlock(CLEARBRIDGE_XML); });

    it('parses large AUM correctly', () => {
      expect(signal.regulatoryAum).toBe(2228148061);
    });

    it('detects pooled investment vehicles (Q5DM1 > 0)', () => {
      expect(signal.clientTypes).toContain('pooled_investment_vehicles');
    });

    it('detects pension clients (Q5DF1 > 0)', () => {
      expect(signal.clientTypes).toContain('pension_plans');
    });

    it('detects institutional clients (Q5DC1, Q5DI1, etc. > 0)', () => {
      expect(signal.clientTypes).toContain('institutional');
    });

    it('hasPrivateFundClients is true (Item7A has attributes)', () => {
      expect(signal.advFlags.hasPrivateFundClients).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('falls back to BusNm when LegalNm is absent', () => {
      const signal = parseFirmBlock(BUS_NM_ONLY_XML);
      expect(signal.firmName).toBe('ACME ADVISORS LLC');
    });

    it('returns null for a block with no CRD or name', () => {
      const result = parseFirmBlock('<Firm><Info/></Firm>');
      expect(result).toBeNull();
    });

    it('cik is always null (ADV primary key is CRD, not CIK)', () => {
      const signal = parseFirmBlock(RABENOLD_XML);
      expect(signal.cik).toBeNull();
    });

    it('position_count is always 0 (ADV Part 1 has no holdings data)', () => {
      const signal = parseFirmBlock(RABENOLD_XML);
      expect(signal.position_count).toBe(0);
    });

    it('equities_pct is 0 and options_present is false (no holdings data)', () => {
      const signal = parseFirmBlock(RABENOLD_XML);
      expect(signal.equities_pct).toBe(0);
      expect(signal.options_present).toBe(false);
    });
  });
});

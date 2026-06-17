import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix:   true,
  isArray:          (name) => name === 'infoTable',
});

/**
 * Parse 13F information table XML into structured holdings.
 *
 * Value scaling: pre-2023 filings report value in thousands of dollars;
 * 2023+ filings report in whole dollars. We detect by periodOfReport date.
 */
export function parse13F(xmlString, periodOfReport) {
  const raw = parser.parse(xmlString);

  // Handle namespace variations in the root element name
  const root = raw.informationTable ?? Object.values(raw).find(v => v?.infoTable);
  const rows = root?.infoTable ?? [];

  const inThousands = periodOfReport && new Date(periodOfReport) < new Date('2023-01-01');
  const multiplier  = inThousands ? 1000 : 1;

  const holdings = rows.map(row => {
    const rawValue = parseInt(row.value ?? 0, 10) || 0;

    return {
      issuerName:   String(row.nameOfIssuer ?? '').trim(),
      cusip:        String(row.cusip ?? '').trim(),
      titleOfClass: String(row.titleOfClass ?? '').trim(),
      putCall:      row.putCall ?? null,
      valueUsd:     rawValue * multiplier,
      shares:       parseInt(row.shrsOrPrnAmt?.sshPrnamt ?? 0, 10) || 0,
    };
  }).filter(h => h.cusip.length >= 8); // valid CUSIPs are 8–9 chars

  const totalValueUsd = holdings.reduce((s, h) => s + h.valueUsd, 0);

  return { holdings, totalValueUsd, holdingCount: holdings.length };
}

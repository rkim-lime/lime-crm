/**
 * @typedef {{
 *   accessionNo:    string,
 *   periodOfReport: string,
 *   filedAt:        string,
 * }} FilingMeta
 *
 * @typedef {{
 *   cusip:        string,
 *   issuerName:   string,
 *   titleOfClass: string,
 *   putCall:      string | null,
 *   valueUsd:     number,
 *   shares:       number,
 * }} Holding
 *
 * @typedef {{
 *   filing:        FilingMeta,
 *   holdings:      Holding[],
 *   totalValueUsd: number,
 *   holdingCount:  number,
 * }} Quarter
 *
 * @typedef {{
 *   firmName:               string,
 *   cik:                    string | null,
 *   estimated_aum_usd:      number,
 *   position_count:         number,
 *   portfolio_turnover_pct: number | null,
 *   equities_pct:           number,
 *   options_present:        boolean,
 *   inferred_segment:       string,
 *   source:                 string,
 *   source_url:             string,
 *   quarters:               Quarter[],
 *   crdNumber?:             string,
 *   secNumber?:             string,
 *   clientTypes?:           string[],
 *   advFlags?:              { hasPrivateFundClients: boolean },
 *   regulatoryAum?:         number,
 * }} FirmSignal
 *
 * @typedef {{
 *   supabase:    import('@supabase/supabase-js').SupabaseClient,
 *   logger:      { info: Function, warn: Function, error: Function, debug: Function },
 *   config:      Record<string, any>,
 *   onProgress:  Function | null,
 * }} ConnectorContext
 *
 * @typedef {{
 *   key:       string,
 *   discover:  (config: Record<string, any>, ctx: ConnectorContext) => Promise<Array<{cik: string, firmName: string}>>,
 *   fetch:     (filer: {cik: string, firmName: string}, config: Record<string, any>, ctx: ConnectorContext) => Promise<Quarter[]>,
 *   normalize: (filer: {cik: string, firmName: string}, quarters: Quarter[]) => FirmSignal,
 * }} Connector
 */

export {};

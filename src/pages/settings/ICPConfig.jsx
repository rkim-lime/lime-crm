import { useState, useEffect } from 'react';
import Layout from '../../components/Layout';
import { useICPConfig, useUpdateICPConfig } from '../../hooks/useDedup';
import { ErrorBanner } from '../shared';

const LABEL = { fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 };
const HINT  = { fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 4 };

const ALL_SEGMENTS = [
  { value: 'hedge_fund',    label: 'Hedge Fund'     },
  { value: 'quant_fund',    label: 'Quant Fund'     },
  { value: 'prop_trader',   label: 'Prop Trader'    },
  { value: 'broker_dealer', label: 'Broker-Dealer'  },
  { value: 'pension',       label: 'Pension'        },
  { value: 'insurance',     label: 'Insurance'      },
  { value: 'family_office', label: 'Family Office'  },
  { value: 'retail_trader', label: 'Retail Trader'  },
];

export default function ICPConfig() {
  const config   = useICPConfig();
  const update   = useUpdateICPConfig();

  const [minAum,      setMinAum]      = useState('');
  const [minTurnover, setMinTurnover] = useState('');
  const [minPositions,setMinPositions]= useState('');
  const [excluded,    setExcluded]    = useState([]);
  const [saved,       setSaved]       = useState(false);
  const [error,       setError]       = useState(null);

  useEffect(() => {
    if (!config.data) return;
    const c = config.data;
    setMinAum(c.min_aum_usd      != null ? String(c.min_aum_usd)      : '');
    setMinTurnover(c.min_turnover_pct  != null ? String(c.min_turnover_pct)  : '');
    setMinPositions(c.min_position_count != null ? String(c.min_position_count) : '');
    setExcluded(c.excluded_segments ?? []);
  }, [config.data]);

  const toggleSegment = (seg) => {
    setExcluded(prev =>
      prev.includes(seg) ? prev.filter(s => s !== seg) : [...prev, seg]
    );
  };

  const handleSave = async () => {
    setError(null);
    try {
      await update.mutateAsync({
        min_aum_usd:       minAum      ? Number(minAum)       : null,
        min_turnover_pct:  minTurnover ? Number(minTurnover)  : null,
        min_position_count:minPositions? Number(minPositions) : null,
        excluded_segments: excluded,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setError(err.message);
    }
  };

  function fmtAumDisplay(n) {
    const v = Number(n);
    if (!n || isNaN(v)) return null;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
    return `$${v.toLocaleString()}`;
  }

  return (
    <Layout title="ICP Criteria">
      <div style={{ maxWidth: 580 }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>ICP Filter Criteria</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13.5 }}>
            Define what makes a prospect ICP-qualified. Applied during ingestion and used as
            the default filter on the prospects list.
          </p>
        </div>

        {config.isLoading && (
          <div>
            {[240, 180, 180, 220].map((w, i) => (
              <div key={i} className="skeleton skeleton-text" style={{ width: w, marginBottom: 14 }} />
            ))}
          </div>
        )}
        {config.error && <ErrorBanner message={config.error.message} onRetry={config.refetch} />}

        {!config.isLoading && !config.error && (
          <div className="card card-body">
            {error && <div className="error-state" style={{ marginBottom: 16 }}>{error}</div>}

            {/* Minimum AUM */}
            <div style={{ marginBottom: 20 }}>
              <label style={LABEL}>Minimum AUM (USD)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  className="form-input"
                  type="number"
                  min={0}
                  step={1_000_000}
                  value={minAum}
                  onChange={e => setMinAum(e.target.value)}
                  placeholder="e.g. 100000000"
                  style={{ flex: 1 }}
                />
                {fmtAumDisplay(minAum) && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    = {fmtAumDisplay(minAum)}
                  </span>
                )}
              </div>
              <div style={HINT}>Prospects with estimated AUM below this will have passes_icp = false</div>
            </div>

            {/* Minimum turnover */}
            <div style={{ marginBottom: 20 }}>
              <label style={LABEL}>Minimum Portfolio Turnover (%)</label>
              <input
                className="form-input"
                type="number"
                min={0}
                max={100}
                step={1}
                value={minTurnover}
                onChange={e => setMinTurnover(e.target.value)}
                placeholder="e.g. 10 for 10%"
              />
              <div style={HINT}>Prospects with lower turnover will have passes_icp = false</div>
            </div>

            {/* Minimum position count */}
            <div style={{ marginBottom: 20 }}>
              <label style={LABEL}>Minimum Position Count</label>
              <input
                className="form-input"
                type="number"
                min={0}
                step={1}
                value={minPositions}
                onChange={e => setMinPositions(e.target.value)}
                placeholder="e.g. 5"
              />
              <div style={HINT}>Prospects with fewer positions will have passes_icp = false</div>
            </div>

            {/* Excluded segments */}
            <div style={{ marginBottom: 24 }}>
              <label style={LABEL}>Excluded Segments</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {ALL_SEGMENTS.map(seg => {
                  const active = excluded.includes(seg.value);
                  return (
                    <button
                      key={seg.value}
                      type="button"
                      onClick={() => toggleSegment(seg.value)}
                      style={{
                        padding: '5px 12px', borderRadius: 20, fontSize: 12.5, cursor: 'pointer',
                        border: active ? '1px solid var(--red)' : '1px solid var(--border)',
                        background: active ? '#fef2f2' : 'var(--bg-secondary)',
                        color: active ? 'var(--red)' : 'var(--text-secondary)',
                        fontWeight: active ? 600 : 400,
                      }}
                    >
                      {active ? '✕ ' : ''}{seg.label}
                    </button>
                  );
                })}
              </div>
              <div style={HINT}>Prospects in these segments will have passes_icp = false</div>
            </div>

            {/* Save */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={update.isPending}
              >
                {update.isPending ? 'Saving…' : 'Save Criteria'}
              </button>
              {saved && (
                <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 500 }}>✓ Saved</span>
              )}
            </div>

            {/* Note */}
            <div style={{
              marginTop: 20, padding: '10px 14px',
              background: '#fffbeb', border: '1px solid #fde68a',
              borderRadius: 6, fontSize: 13, color: '#92400e', lineHeight: 1.5,
            }}>
              <strong>Note:</strong> Changes apply to prospects ingested <em>after</em> saving.
              Existing prospects keep their current ICP status until re-ingested.
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

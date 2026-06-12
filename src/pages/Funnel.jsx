import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useDeals } from '../hooks/useDeals';
import { TierBadge, fmtCurrency, ErrorBanner, EmptyState } from './shared';

const INDIVIDUAL_STAGES = [
  { key: 'lead_in',      label: 'Lead In' },
  { key: 'engaged',      label: 'Engaged' },
  { key: 'api_demo',     label: 'API Demo' },
  { key: 'kyc_submitted',label: 'KYC Sub.' },
  { key: 'kyc_approved', label: 'KYC OK' },
  { key: 'funded',       label: 'Funded' },
  { key: 'first_trade',  label: '1st Trade' },
  { key: 'active_trader',label: 'Active' },
  { key: 'dormant',      label: 'Dormant' },
];

const INST_STAGE_LABELS = {
  prospecting:      'Prospecting',
  qualified:        'Qualified',
  proposal:         'Proposal',
  legal_compliance: 'Legal & Compliance',
  negotiating:      'Negotiating',
  onboarding:       'Onboarding',
};

const INST_CLOSED = ['live', 'lost'];

export default function Funnel() {
  const navigate = useNavigate();

  const individual = useDeals({ tier: 'individual' });
  const enterprise = useDeals({ tier: 'enterprise', motion: 'enterprise' });
  const pro        = useDeals({ tier: 'pro',        motion: 'pro' });

  const indDeals  = individual.data ?? [];
  const countByStage = (key) => indDeals.filter(d => d.stage === key).length;

  const entActive = enterprise.data?.filter(d => !INST_CLOSED.includes(d.stage)) ?? [];
  const proActive  = pro.data?.filter(d => !INST_CLOSED.includes(d.stage)) ?? [];

  const entValue = entActive.reduce((s, d) => s + (d.estimated_commission ?? 0), 0);
  const proValue = proActive.reduce((s, d) => s + (d.estimated_commission ?? 0), 0);

  return (
    <Layout title="Conversion Funnels">
      {individual.error && <ErrorBanner message={individual.error.message} onRetry={individual.refetch} />}

      {/* ── Individual funnel ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Individual</h2>
          <TierBadge tier="individual" />
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 4 }}>{indDeals.length} total</span>
        </div>

        <div className="funnel-track">
          {INDIVIDUAL_STAGES.map(({ key, label }, i) => {
            const n = countByStage(key);
            const isLast = i === INDIVIDUAL_STAGES.length - 1;
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                <div
                  className={`funnel-stage${n > 0 ? ' funnel-stage-active' : ''}`}
                  onClick={() => n > 0 && navigate(`/deals?stage=${key}`)}
                  style={{ cursor: n > 0 ? 'pointer' : 'default', flex: 1 }}
                >
                  <div className="funnel-stage-count">
                    {individual.isLoading
                      ? <div className="skeleton skeleton-text" style={{ width: 20, height: 20 }} />
                      : n}
                  </div>
                  <div className="funnel-stage-label">{label}</div>
                </div>
                {!isLast && <div className="funnel-arrow">›</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Enterprise + Pro panels ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Institutional Pipelines</h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <InstitutionalPanel
            tier="enterprise"
            label="Enterprise"
            deals={entActive}
            totalValue={entValue}
            isLoading={enterprise.isLoading}
            onNavigate={() => navigate('/pipeline/enterprise')}
          />
          <InstitutionalPanel
            tier="pro"
            label="Pro"
            deals={proActive}
            totalValue={proValue}
            isLoading={pro.isLoading}
            onNavigate={() => navigate('/pipeline/pro')}
          />
        </div>
      </div>
    </Layout>
  );
}

function InstitutionalPanel({ tier, label, deals, totalValue, isLoading, onNavigate }) {
  const stageCounts = Object.entries(INST_STAGE_LABELS).map(([key, stageLabel]) => ({
    key, label: stageLabel, count: deals.filter(d => d.stage === key).length,
  }));

  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="card-title">{label}</span>
          <TierBadge tier={tier} />
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onNavigate}>View pipeline →</button>
      </div>
      <div style={{ padding: '12px 18px' }}>
        {isLoading ? (
          <div className="skeleton skeleton-text" style={{ width: '60%', margin: '12px 0' }} />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 24, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 600 }}>Active Deals</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2, marginTop: 2 }}>{deals.length}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 600 }}>Pipeline Value</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2, marginTop: 2 }}>{fmtCurrency(totalValue)}</div>
              </div>
            </div>
            {deals.length === 0 ? (
              <EmptyState text="No active deals" />
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {stageCounts.filter(s => s.count > 0).map(s => (
                  <div key={s.key} style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', padding: '3px 8px', borderRadius: 99, whiteSpace: 'nowrap' }}>
                    {s.label} ({s.count})
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

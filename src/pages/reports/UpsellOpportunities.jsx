import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import DealForm from '../../components/DealForm';
import { useUpsellOpportunities } from '../../hooks/useUpsellOpportunities';
import { useProfiles } from '../../hooks/useDashboard';
import { TierBadge, StatusBadge, StrategyAssetPills, UpsellGapPills, ErrorBanner, TableSkeleton, EmptyState } from '../shared';

const SUPPORTED = ['equities', 'options', 'futures'];
const GAP_LABELS = { equities: 'Equities', options: 'Options', futures: 'Futures' };

export default function UpsellOpportunities() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ tier: '', status: '', gapClass: '', salesOwnerId: '' });
  const [dealDefaults, setDealDefaults] = useState(null);

  const profiles = useProfiles();
  const { data, isLoading, error } = useUpsellOpportunities(filters);

  const total      = data?.length ?? 0;
  const futuresGap  = data?.filter(a => a.gap.includes('futures')).length  ?? 0;
  const optionsGap  = data?.filter(a => a.gap.includes('options')).length  ?? 0;
  const equitiesGap = data?.filter(a => a.gap.includes('equities')).length ?? 0;

  const profileOpts = (profiles.data ?? []).map(p => ({ value: p.id, label: p.full_name || p.email }));

  return (
    <Layout title="Upsell Opportunities">
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 20 }}>
        Accounts with asset classes in their strategy that we haven't contracted for yet
      </p>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total with Gap',  value: total,       color: '#854F0B', bg: '#FAEEDA' },
          { label: 'Futures Gap',     value: futuresGap,  color: '#854F0B', bg: '#FFF7ED' },
          { label: 'Options Gap',     value: optionsGap,  color: '#3B6D11', bg: '#EAF3DE' },
          { label: 'Equities Gap',    value: equitiesGap, color: '#185FA5', bg: '#E6F1FB' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} style={{ background: bg, borderRadius: 8, padding: '14px 18px' }}>
            <div style={{ fontSize: 11, color, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="filters-bar" style={{ marginBottom: 16 }}>
        <select className="filter-select" value={filters.gapClass} onChange={e => setFilters(f => ({ ...f, gapClass: e.target.value }))}>
          <option value="">All gap types</option>
          {SUPPORTED.map(c => <option key={c} value={c}>{GAP_LABELS[c]}</option>)}
        </select>
        <select className="filter-select" value={filters.tier} onChange={e => setFilters(f => ({ ...f, tier: e.target.value }))}>
          <option value="">All tiers</option>
          {['enterprise','pro','individual'].map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
        </select>
        <select className="filter-select" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value="">All statuses</option>
          {['prospect','active','inactive'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
        </select>
        <select className="filter-select" value={filters.salesOwnerId} onChange={e => setFilters(f => ({ ...f, salesOwnerId: e.target.value }))}>
          <option value="">All sales owners</option>
          {profileOpts.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>

      {error && <ErrorBanner message={error.message} />}

      {isLoading ? <TableSkeleton cols={7} /> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Sales Owner</th>
                <th>Status</th>
                <th>Trades</th>
                <th>Contracted</th>
                <th>Gap</th>
                <th style={{ width: 120 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {!data?.length && (
                <tr><td colSpan={7}><EmptyState icon="✓" text="No upsell opportunities — all strategy asset classes are contracted" /></td></tr>
              )}
              {data?.map(account => (
                <tr key={account.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/accounts/${account.id}`)}>
                  <td>
                    <div className="table-name">{account.name}</div>
                    <TierBadge tier={account.tier} />
                  </td>
                  <td><span style={{ fontSize: 13 }}>{account.sales_owner?.full_name ?? '—'}</span></td>
                  <td><StatusBadge status={account.status} /></td>
                  <td><StrategyAssetPills classes={account.strategy_asset_classes} /></td>
                  <td>
                    {account.sold_asset_classes?.length > 0
                      ? <StrategyAssetPills classes={account.sold_asset_classes} />
                      : <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>None</span>
                    }
                  </td>
                  <td>
                    <UpsellGapPills
                      strategyClasses={account.strategy_asset_classes}
                      soldClasses={account.sold_asset_classes}
                    />
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => setDealDefaults({ tier: account.tier })}
                    >
                      Create Deal
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dealDefaults && (
        <DealForm
          defaultTier={dealDefaults.tier}
          onClose={() => setDealDefaults(null)}
          onSuccess={() => setDealDefaults(null)}
        />
      )}
    </Layout>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import RoleGate from '../components/RoleGate';
import AccountForm from '../components/AccountForm';
import ActionMenu from '../components/ActionMenu';
import ConfirmModal from '../components/ConfirmModal';
import { useIsAdmin } from '../components/RoleGate';
import { useAccounts, useDeleteAccount, useArchiveAccount } from '../hooks/useAccounts';
import { useAuth } from '../hooks/useAuth.jsx';
import { TierBadge, SegmentBadge, StatusBadge, KycBadge, AssetPills, TableSkeleton, ErrorBanner, EmptyState } from './shared';

const TIER_SEGMENTS = {
  enterprise: ['hft_firm','hedge_fund','quant_fund','broker_dealer','family_office','prime_broker'],
  pro:        ['prop_trader','quant_developer','algo_trader'],
  individual: ['retail_trader'],
};
const ALL_SEGMENTS = Object.values(TIER_SEGMENTS).flat();
const TIERS = ['enterprise','pro','individual'];
const SEG_LABELS = {
  hft_firm:'HFT Firm', hedge_fund:'Hedge Fund', quant_fund:'Quant Fund',
  broker_dealer:'Broker-Dealer', family_office:'Family Office', prime_broker:'Prime Broker',
  prop_trader:'Prop Trader', quant_developer:'Quant Dev', algo_trader:'Algo Trader', retail_trader:'Retail',
};

export default function Accounts() {
  const [search, setSearch]   = useState('');
  const [tier, setTier]       = useState('');
  const [segment, setSegment] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [myOwner, setMyOwner] = useState(false);
  const [panel, setPanel]     = useState(null);
  const [confirm, setConfirm] = useState(null); // { type: 'delete'|'archive', account }
  const navigate  = useNavigate();
  const isAdmin   = useIsAdmin();
  const { session } = useAuth();
  const currentUserId = session?.user?.id;

  const visibleSegments = tier ? (TIER_SEGMENTS[tier] ?? ALL_SEGMENTS) : ALL_SEGMENTS;
  const handleTierChange = (t) => { setTier(t); if (t && segment && !TIER_SEGMENTS[t]?.includes(segment)) setSegment(''); };

  const myOwnerFilter = myOwner ? currentUserId : undefined;
  const { data, isLoading, error, refetch } = useAccounts({ search, tier, segment, status: statusFilter, myOwner: myOwnerFilter });
  const deleteAccount  = useDeleteAccount();
  const archiveAccount = useArchiveAccount();

  const handleConfirm = async () => {
    if (!confirm) return;
    try {
      if (confirm.type === 'delete') {
        await deleteAccount.mutateAsync(confirm.account.id);
      } else {
        await archiveAccount.mutateAsync(confirm.account.id);
      }
      setConfirm(null);
    } catch (err) {
      // mutation error displayed inline in modal via loading state; rethrow to surface it
      setConfirm(c => c ? { ...c, error: err.message } : null);
    }
  };

  const loading = deleteAccount.isPending || archiveAccount.isPending;

  return (
    <Layout title="Accounts">
      <div className="filters-bar">
        <div className="search-wrap">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input className="search-input" placeholder="Search accounts…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="filter-select" value={tier} onChange={e => handleTierChange(e.target.value)}>
          <option value="">All tiers</option>
          {TIERS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
        </select>
        <select className="filter-select" value={segment} onChange={e => setSegment(e.target.value)}>
          <option value="">All segments</option>
          {visibleSegments.map(s => <option key={s} value={s}>{SEG_LABELS[s]??s}</option>)}
        </select>
        <div className="tier-toggle">
          {[['','All'],['active','Active'],['inactive','Inactive']].map(([val, lbl]) => (
            <button
              key={lbl}
              className={`tier-toggle-btn${statusFilter === val ? ' active' : ''}`}
              onClick={() => setStatusFilter(val)}
            >{lbl}</button>
          ))}
        </div>
        <button
          className={`btn btn-sm${myOwner ? ' btn-primary' : ' btn-secondary'}`}
          onClick={() => setMyOwner(v => !v)}
        >
          My Accounts {myOwner && data ? `(${data.length})` : ''}
        </button>
        <span style={{ flex: 1 }} />
        <RoleGate allow={['admin','sales','operations']}>
          <button className="btn btn-primary btn-sm" onClick={() => setPanel('create')}>+ New Account</button>
        </RoleGate>
      </div>

      {error && <ErrorBanner message={error.message} onRetry={refetch} />}

      {isLoading ? <TableSkeleton cols={9} /> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account</th><th>Tier</th><th>Segment</th><th>Status</th>
                <th>Asset classes</th><th>KYC</th><th>ADV</th>
                <th>Sales Owner</th><th>Service Manager</th>
                <th style={{ width: 48 }} />
              </tr>
            </thead>
            <tbody>
              {!data?.length && <tr><td colSpan={10}><EmptyState icon="🏢" text="No accounts found" /></td></tr>}
              {data?.map(a => (
                <tr
                  key={a.id}
                  style={{ opacity: a.status === 'inactive' ? 0.45 : 1 }}
                  onClick={() => navigate(`/accounts/${a.id}`)}
                >
                  <td>
                    <div className="table-name">{a.name}</div>
                    <div className="table-sub">{a.jurisdiction?.toUpperCase()}</div>
                  </td>
                  <td><TierBadge tier={a.tier} /></td>
                  <td><SegmentBadge segment={a.segment} /></td>
                  <td><StatusBadge status={a.status} /></td>
                  <td><AssetPills classes={a.asset_classes} /></td>
                  <td><KycBadge status={a.kyc_status} /></td>
                  <td>{a.avg_daily_volume_usd ? <span style={{ fontSize:13 }}>${(a.avg_daily_volume_usd/1_000_000).toFixed(0)}M</span> : <span className="text-tertiary">—</span>}</td>
                  <td><span style={{ fontSize: 13 }}>{a.sales_owner?.full_name ?? '—'}</span></td>
                  <td>
                    {a.service_manager
                      ? <span style={{ fontSize: 13 }}>{a.service_manager.full_name}</span>
                      : ['active', 'onboarding'].includes(a.status)
                        ? <span style={{ fontSize: 12, color: '#d97706', fontWeight: 600 }}>⚠ Needed</span>
                        : <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>—</span>
                    }
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <ActionMenu items={[
                      { label: 'Edit', onClick: () => setPanel(a) },
                      ...(isAdmin ? [
                        { label: 'Archive', onClick: () => setConfirm({ type: 'archive', account: a }) },
                        { label: 'Delete', danger: true, onClick: () => setConfirm({ type: 'delete', account: a }) },
                      ] : []),
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {panel === 'create' && <AccountForm onClose={() => setPanel(null)} onSuccess={() => setPanel(null)} />}
      {panel && panel !== 'create' && <AccountForm account={panel} onClose={() => setPanel(null)} onSuccess={() => setPanel(null)} />}

      <ConfirmModal
        isOpen={!!confirm}
        title={confirm?.type === 'delete' ? `Delete ${confirm?.account?.name}?` : `Archive ${confirm?.account?.name}?`}
        message={
          confirm?.type === 'delete'
            ? `This will permanently remove the account and all linked data. This cannot be undone.`
            : `This will set the account status to inactive.`
        }
        confirmLabel={confirm?.type === 'delete' ? 'Delete' : 'Archive'}
        confirmVariant={confirm?.type === 'delete' ? 'danger' : 'warning'}
        loading={loading}
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />
    </Layout>
  );
}

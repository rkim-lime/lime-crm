import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import RoleGate from '../components/RoleGate';
import DealForm from '../components/DealForm';
import ActionMenu from '../components/ActionMenu';
import ConfirmModal from '../components/ConfirmModal';
import { useIsAdmin } from '../components/RoleGate';
import { useDealsWithScores, useUpdateDeal, useDeleteDeal } from '../hooks/useDeals';
import { TierBadge, StageBadge, AssetPills, fmtCurrency, fmtDate, TableSkeleton, ErrorBanner, EmptyState } from './shared';

const INST_STAGES = [
  { key: 'prospecting',      label: 'Prospecting' },
  { key: 'qualified',        label: 'Qualified' },
  { key: 'proposal',         label: 'Proposal' },
  { key: 'legal_compliance', label: 'Legal & Compliance' },
  { key: 'negotiating',      label: 'Negotiating' },
  { key: 'onboarding',       label: 'Onboarding' },
  { key: 'live',             label: 'Live' },
  { key: 'lost',             label: 'Lost' },
];
const IND_STAGES = [
  { key: 'lead_in',       label: 'Lead In' },
  { key: 'engaged',       label: 'Engaged' },
  { key: 'api_demo',      label: 'API Demo' },
  { key: 'kyc_submitted', label: 'KYC Submitted' },
  { key: 'kyc_approved',  label: 'KYC Approved' },
  { key: 'funded',        label: 'Funded' },
  { key: 'first_trade',   label: 'First Trade' },
  { key: 'active_trader', label: 'Active Trader' },
  { key: 'dormant',       label: 'Dormant' },
];
const ALL_STAGES = [...INST_STAGES, ...IND_STAGES];
const TIERS = ['enterprise','pro','individual'];

export default function Deals() {
  const [search, setSearch]     = useState('');
  const [stage, setStage]       = useState('');
  const [tier, setTier]         = useState('');
  const [dealForm, setDealForm] = useState(null);
  const [confirm, setConfirm]   = useState(null); // { deal }
  const navigate = useNavigate();
  const isAdmin  = useIsAdmin();

  const { data, isLoading, error, refetch } = useDealsWithScores({ search, stage, tier });
  const update = useUpdateDeal();
  const deleteDeal = useDeleteDeal();

  const stagesForFilter = tier === 'individual' ? IND_STAGES : tier ? INST_STAGES : ALL_STAGES;

  const handleDelete = async () => {
    if (!confirm) return;
    await deleteDeal.mutateAsync(confirm.deal.id);
    setConfirm(null);
  };

  return (
    <Layout title="Deals">
      <div className="filters-bar">
        <div className="search-wrap">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input className="search-input" placeholder="Search deals…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="filter-select" value={tier} onChange={e => { setTier(e.target.value); setStage(''); }}>
          <option value="">All tiers</option>
          {TIERS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
        </select>
        <select className="filter-select" value={stage} onChange={e => setStage(e.target.value)}>
          <option value="">All stages</option>
          {stagesForFilter.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <RoleGate allow={['admin','sales']}>
          <button className="btn btn-primary btn-sm" onClick={() => setDealForm('create')}>+ New Deal</button>
        </RoleGate>
      </div>

      {error && <ErrorBanner message={error.message} onRetry={refetch} />}

      {isLoading ? <TableSkeleton cols={7} /> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Deal</th>
                <th>Account</th>
                <th>Tier</th>
                <th>Stage</th>
                <th>Est. commission</th>
                <th>Close date</th>
                <th>Prob.</th>
                <th>Score</th>
                <th style={{ width: 48 }} />
              </tr>
            </thead>
            <tbody>
              {!data?.length && <tr><td colSpan={9}><EmptyState icon="◎" text="No deals found" /></td></tr>}
              {data?.map(d => (
                <tr key={d.id} onClick={() => navigate(`/deals/${d.id}`)}>
                  <td>
                    <div className="table-name">{d.name}</div>
                    <div style={{ marginTop: 3 }}><AssetPills classes={d.asset_classes} /></div>
                  </td>
                  <td><div style={{ fontWeight: 500, fontSize: 13.5 }}>{d.account?.name ?? '—'}</div></td>
                  <td><TierBadge tier={d.tier} /></td>
                  <td>
                    <StagePopover deal={d} onUpdate={(stage) => update.mutate({ id: d.id, stage, _prevStage: d.stage })} />
                  </td>
                  <td><span style={{ fontWeight: 600 }}>{fmtCurrency(d.estimated_commission)}</span></td>
                  <td><span style={{ fontSize: 13 }}>{fmtDate(d.close_date)}</span></td>
                  <td>
                    <span style={{ fontWeight: 600, color: d.probability >= 70 ? 'var(--green)' : d.probability >= 40 ? 'var(--yellow)' : 'var(--text-secondary)' }}>
                      {d.probability}%
                    </span>
                  </td>
                  <td>
                    {d.score_computed != null ? (
                      <span style={{ fontWeight: 600, color: d.score_computed >= 75 ? 'var(--green)' : d.score_computed >= 50 ? 'var(--yellow)' : 'var(--text-secondary)' }}>
                        {d.score_computed}
                      </span>
                    ) : <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>—</span>}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <ActionMenu items={[
                      { label: 'Edit', onClick: () => setDealForm(d) },
                      ...(isAdmin ? [
                        { label: 'Delete', danger: true, onClick: () => setConfirm({ deal: d }) },
                      ] : []),
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dealForm === 'create' && <DealForm onClose={() => setDealForm(null)} onSuccess={() => setDealForm(null)} />}
      {dealForm && dealForm !== 'create' && <DealForm deal={dealForm} onClose={() => setDealForm(null)} onSuccess={() => setDealForm(null)} />}

      <ConfirmModal
        isOpen={!!confirm}
        title={`Delete ${confirm?.deal?.name}?`}
        message="This cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleteDeal.isPending}
        onConfirm={handleDelete}
        onCancel={() => setConfirm(null)}
      />
    </Layout>
  );
}

function StagePopover({ deal, onUpdate }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const stages = ['enterprise','pro'].includes(deal.tier) ? INST_STAGES : IND_STAGES;

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <span style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>
        <StageBadge stage={deal.stage} />
      </span>
      {open && (
        <div className="stage-popover" onClick={e => e.stopPropagation()}>
          {stages.map(s => (
            <button
              key={s.key}
              className={`stage-popover-item${deal.stage === s.key ? ' active' : ''}`}
              onClick={() => { onUpdate(s.key); setOpen(false); }}
            >{s.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

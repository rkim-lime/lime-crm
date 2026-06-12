import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import RoleGate from '../components/RoleGate';
import DealForm from '../components/DealForm';
import ConfirmModal from '../components/ConfirmModal';
import { useIsAdmin } from '../components/RoleGate';
import { useDeals, useUpdateDeal, usePromoteDeal, useCloseDeal, useDeleteDeal } from '../hooks/useDeals';
import { TierBadge, SegmentBadge, AssetPills, fmtCurrency, ErrorBanner } from './shared';

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

const INDIVIDUAL_STAGES = [
  { key: 'visitor',     label: 'Visitor' },
  { key: 'lead',        label: 'Lead' },
  { key: 'nurture',     label: 'Nurture' },
  { key: 'activated',   label: 'Activated' },
  { key: 'funded',      label: 'Funded' },
  { key: 'first_trade', label: 'First Trade' },
  { key: 'active',      label: 'Active Trader' },
  { key: 'dormant',     label: 'Dormant' },
  { key: 'churned',     label: 'Churned' },
];

const TIER_LABELS = { enterprise: 'Enterprise', pro: 'Pro', individual: 'Individual' };

export default function Pipeline() {
  const { tier: tierParam } = useParams();
  const navigate            = useNavigate();
  const tier                = tierParam ?? 'enterprise';

  const [search, setSearch]               = useState('');
  const [dealForm, setDealForm]           = useState(null);
  const [confirm, setConfirm]             = useState(null); // { action, deal, targetTier? }
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { deal }
  const [pendingStages, setPendingStages] = useState({});
  const [dndError, setDndError]           = useState('');
  const isAdmin = useIsAdmin();

  // Individual pipeline: filter by motion only.
  // Enterprise / Pro: filter by motion (which matches tier after migration 002 backfill).
  const { data, isLoading, error, refetch } = useDeals(
    tier === 'individual' ? { motion: 'individual' } : { motion: tier }
  );
  const update     = useUpdateDeal();
  const promote    = usePromoteDeal();
  const close      = useCloseDeal();
  const deleteDeal = useDeleteDeal();

  const stages = tier === 'individual' ? INDIVIDUAL_STAGES : INST_STAGES;

  // Apply optimistic stage overrides
  const rawDeals = (data ?? []).map(d =>
    pendingStages[d.id] ? { ...d, stage: pendingStages[d.id] } : d
  );
  // No blanket stage exclusion — all stage columns are explicit in the stage list above.
  const deals = rawDeals.filter(d =>
    !search || d.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleDrop = (dealId, newStage) => {
    const deal = (data ?? []).find(d => d.id === dealId);
    if (!deal || deal.stage === newStage) return;
    const prevStage = deal.stage;
    setDndError('');
    setPendingStages(ps => ({ ...ps, [dealId]: newStage }));
    update.mutate(
      { id: dealId, stage: newStage, _prevStage: prevStage },
      {
        onSuccess: () => setPendingStages(ps => { const n = { ...ps }; delete n[dealId]; return n; }),
        onError: (err) => {
          setPendingStages(ps => { const n = { ...ps }; delete n[dealId]; return n; });
          setDndError(`Move failed: ${err.message}`);
          setTimeout(() => setDndError(''), 4000);
        },
      }
    );
  };

  const handleConfirm = () => {
    if (!confirm) return;
    const { action, deal, targetTier } = confirm;
    if (action === 'promote')  promote.mutate({ id: deal.id, newTier: targetTier });
    if (action === 'won')      close.mutate({ id: deal.id, outcome: 'live' });
    if (action === 'lost')     close.mutate({ id: deal.id, outcome: 'lost' });
    if (action === 'activate') update.mutate({ id: deal.id, stage: 'active',   _prevStage: deal.stage });
    if (action === 'churn')    update.mutate({ id: deal.id, stage: 'churned',  _prevStage: deal.stage });
    setConfirm(null);
  };

  // ConfirmModal copy varies by action
  const confirmTitle = !confirm ? '' : {
    promote:  `Promote to ${TIER_LABELS[confirm.targetTier]}?`,
    won:      'Mark as Closed Won?',
    lost:     'Mark as Closed Lost?',
    activate: 'Mark as Active Trader?',
    churn:    'Mark as Churned?',
  }[confirm.action] ?? '';

  const confirmMessage = !confirm ? '' : {
    promote:  `This will move "${confirm.deal.name}" to the ${TIER_LABELS[confirm.targetTier]} pipeline and reset its stage.`,
    won:      `"${confirm.deal.name}" will be moved to Closed Won.`,
    lost:     `"${confirm.deal.name}" will be marked as Closed Lost.`,
    activate: `"${confirm.deal.name}" will be moved to Active Trader.`,
    churn:    `"${confirm.deal.name}" will be marked as Churned.`,
  }[confirm.action] ?? '';

  const confirmVariant = confirm?.action === 'lost' || confirm?.action === 'churn' ? 'danger' : 'warning';
  const confirmLabel   = {
    lost: 'Close Lost', churn: 'Mark Churned',
  }[confirm?.action] ?? 'Confirm';

  return (
    <Layout title={`${TIER_LABELS[tier] ?? 'Pipeline'} Pipeline`}>
      <div className="filters-bar">
        <div className="search-wrap">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input className="search-input" placeholder="Search deals…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="tier-toggle">
          {['enterprise', 'pro', 'individual'].map(t => (
            <button
              key={t}
              className={`tier-toggle-btn${tier === t ? ' active' : ''}`}
              onClick={() => navigate(`/pipeline/${t}`)}
            >{TIER_LABELS[t]}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <RoleGate allow={['admin', 'sales']}>
          <button className="btn btn-primary btn-sm" onClick={() => setDealForm('create')}>+ New Deal</button>
        </RoleGate>
      </div>

      {error    && <ErrorBanner message={error.message} onRetry={refetch} />}
      {dndError && (
        <div style={{ margin: '0 0 12px', padding: '8px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, color: '#dc2626' }}>
          {dndError}
        </div>
      )}

      <div className="kanban-board">
        {stages.map(({ key, label }) => {
          const col    = deals.filter(d => d.stage === key);
          const colVal = col.reduce((s, d) => s + (d.estimated_commission ?? 0), 0);
          return (
            <div
              key={key}
              className="kanban-col"
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDragEnter={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drag-over'); }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('drag-over');
                const dealId = e.dataTransfer.getData('text/plain');
                if (dealId) handleDrop(dealId, key);
              }}
            >
              <div className="kanban-col-header">
                <span className="kanban-col-title">{label}</span>
                <span className="kanban-col-count">{col.length}</span>
              </div>
              {isLoading
                ? Array.from({ length: 2 }, (_, i) => <div key={i} className="skeleton skeleton-card" />)
                : col.map(deal => (
                  <KanbanCard
                    key={deal.id}
                    deal={deal}
                    tier={tier}
                    isAdmin={isAdmin}
                    onEdit={() => setDealForm(deal)}
                    onPromote={(targetTier) => setConfirm({ action: 'promote', deal, targetTier })}
                    onWon={() => setConfirm({ action: 'won', deal })}
                    onLost={() => setConfirm({ action: 'lost', deal })}
                    onActivate={() => setConfirm({ action: 'activate', deal })}
                    onChurn={() => setConfirm({ action: 'churn', deal })}
                    onDelete={() => setDeleteConfirm({ deal })}
                    onNavigate={() => navigate(`/deals/${deal.id}`)}
                  />
                ))
              }
              {!isLoading && col.length > 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', padding: '4px 2px', fontWeight: 500 }}>
                  Total: {fmtCurrency(colVal)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {dealForm === 'create' && <DealForm onClose={() => setDealForm(null)} onSuccess={() => setDealForm(null)} />}
      {dealForm && dealForm !== 'create' && <DealForm deal={dealForm} onClose={() => setDealForm(null)} onSuccess={() => setDealForm(null)} />}

      <ConfirmModal
        isOpen={!!confirm}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={confirmLabel}
        confirmVariant={confirmVariant}
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />

      <ConfirmModal
        isOpen={!!deleteConfirm}
        title={`Delete ${deleteConfirm?.deal?.name}?`}
        message="This cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleteDeal.isPending}
        onConfirm={async () => { await deleteDeal.mutateAsync(deleteConfirm.deal.id); setDeleteConfirm(null); }}
        onCancel={() => setDeleteConfirm(null)}
      />
    </Layout>
  );
}

function KanbanCard({ deal, tier, isAdmin, onEdit, onPromote, onWon, onLost, onActivate, onChurn, onDelete, onNavigate }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const promoteTargets = tier === 'pro'        ? [{ key: 'enterprise', label: 'Enterprise' }]
    : tier === 'individual' ? [{ key: 'pro', label: 'Pro' }, { key: 'enterprise', label: 'Enterprise' }]
    : [];

  return (
    <div
      className="kanban-card"
      draggable={true}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', deal.id); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={onNavigate}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 4 }}>
        <div>
          <div className="kanban-card-name">{deal.name}</div>
          <div className="kanban-card-account">{deal.account?.name}</div>
        </div>
        <div ref={menuRef} className="card-menu" onClick={e => e.stopPropagation()}>
          <button className="card-menu-btn" onClick={() => setMenuOpen(o => !o)}>⋮</button>
          {menuOpen && (
            <div className="card-menu-dropdown">
              <RoleGate allow={['admin', 'sales']}>
                <button onClick={() => { onEdit(); setMenuOpen(false); }}>Edit</button>
              </RoleGate>
              {promoteTargets.map(t => (
                <RoleGate key={t.key} allow={['admin', 'sales']}>
                  <button onClick={() => { onPromote(t.key); setMenuOpen(false); }}>Promote to {t.label}</button>
                </RoleGate>
              ))}
              {tier === 'individual' ? (
                <RoleGate allow={['admin', 'sales']}>
                  <button onClick={() => { onActivate(); setMenuOpen(false); }}>Mark Active</button>
                  <button style={{ color: 'var(--red)' }} onClick={() => { onChurn(); setMenuOpen(false); }}>Mark Churned</button>
                </RoleGate>
              ) : (
                <RoleGate allow={['admin', 'sales']}>
                  <button onClick={() => { onWon(); setMenuOpen(false); }}>Close Won</button>
                  <button style={{ color: 'var(--red)' }} onClick={() => { onLost(); setMenuOpen(false); }}>Close Lost</button>
                </RoleGate>
              )}
              {isAdmin && (
                <button style={{ color: 'var(--red)' }} onClick={() => { onDelete(); setMenuOpen(false); }}>Delete</button>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
        <TierBadge tier={deal.tier} />
        <SegmentBadge segment={deal.account?.segment} />
      </div>
      <AssetPills classes={deal.asset_classes} />
      <div className="kanban-card-meta" style={{ marginTop: 8 }}>
        <span className="kanban-card-value">{fmtCurrency(deal.estimated_commission)}</span>
        <span className="kanban-card-prob">{deal.probability}%</span>
      </div>
    </div>
  );
}

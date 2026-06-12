import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import RoleGate from '../components/RoleGate';
import DealForm from '../components/DealForm';
import LeadForm from '../components/LeadForm';
import ConvertLeadModal from '../components/ConvertLeadModal';
import ConfirmModal from '../components/ConfirmModal';
import { useIsAdmin } from '../components/RoleGate';
import { useDeals, useUpdateDeal, usePromoteDeal, useCloseDeal, useDeleteDeal } from '../hooks/useDeals';
import { useLeads, useUpdateLead, useDeleteLead } from '../hooks/useLeads';
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
  const isIndividual        = tier === 'individual';

  const [search, setSearch]               = useState('');
  const [dealForm, setDealForm]           = useState(null);
  const [leadForm, setLeadForm]           = useState(null);
  const [convertLead, setConvertLead]     = useState(null);
  const [confirm, setConfirm]             = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [pendingStages, setPendingStages] = useState({});
  const [dndError, setDndError]           = useState('');
  const isAdmin = useIsAdmin();

  // ── Data: individual uses leads, B2B uses deals ─────────────
  const dealsQuery = useDeals(
    !isIndividual ? { motion: tier } : { motion: 'individual', status: 'never-match' }
  );
  const leadsQuery = useLeads(
    isIndividual ? {} : { status: 'never-match' }
  );

  const updateDeal     = useUpdateDeal();
  const updateLead     = useUpdateLead();
  const promote        = usePromoteDeal();
  const close          = useCloseDeal();
  const deleteDeal     = useDeleteDeal();
  const deleteLead     = useDeleteLead();

  const stages = isIndividual ? INDIVIDUAL_STAGES : INST_STAGES;

  // Normalize leads to kanban-card-compatible shape
  const rawLeads = (leadsQuery.data ?? []).map(l => ({
    _type:        'lead',
    id:           l.id,
    name:         l.contact ? `${l.contact.first_name} ${l.contact.last_name}` : '—',
    stage:        l.stage,
    status:       l.status,
    lead_score:   l.lead_score,
    source:       l.source,
    asset_classes: l.asset_classes ?? [],
    estimated_commission: null,
    probability:  null,
    account:      null,
    _raw:         l,
  }));

  const rawDeals = (dealsQuery.data ?? []).map(d => ({ _type: 'deal', ...d }));

  const rawItems = isIndividual ? rawLeads : rawDeals;

  // Apply optimistic stage overrides
  const items = rawItems
    .map(item => pendingStages[item.id] ? { ...item, stage: pendingStages[item.id] } : item)
    .filter(item => !search || item.name.toLowerCase().includes(search.toLowerCase()));

  const isLoading = isIndividual ? leadsQuery.isLoading : dealsQuery.isLoading;
  const queryError = isIndividual ? leadsQuery.error : dealsQuery.error;
  const refetch   = isIndividual ? leadsQuery.refetch : dealsQuery.refetch;

  const handleDrop = (itemId, newStage) => {
    const item = rawItems.find(i => i.id === itemId);
    if (!item || item.stage === newStage) return;
    const prevStage = item.stage;
    setDndError('');
    setPendingStages(ps => ({ ...ps, [itemId]: newStage }));
    const mutate = isIndividual ? updateLead : updateDeal;
    mutate.mutate(
      { id: itemId, stage: newStage, _prevStage: prevStage, ...(isIndividual ? { _prevStatus: item.status } : {}) },
      {
        onSuccess: () => setPendingStages(ps => { const n = { ...ps }; delete n[itemId]; return n; }),
        onError: (err) => {
          setPendingStages(ps => { const n = { ...ps }; delete n[itemId]; return n; });
          setDndError(`Move failed: ${err.message}`);
          setTimeout(() => setDndError(''), 4000);
        },
      }
    );
  };

  const handleConfirm = () => {
    if (!confirm) return;
    const { action, item, targetTier } = confirm;
    if (action === 'promote')  promote.mutate({ id: item.id, newTier: targetTier });
    if (action === 'won')      close.mutate({ id: item.id, outcome: 'live' });
    if (action === 'lost')     close.mutate({ id: item.id, outcome: 'lost' });
    if (action === 'activate') updateLead.mutate({ id: item.id, stage: 'active',   _prevStage: item.stage, _prevStatus: item.status });
    if (action === 'churn')    updateLead.mutate({ id: item.id, stage: 'churned', status: 'churned', _prevStage: item.stage, _prevStatus: item.status });
    setConfirm(null);
  };

  const confirmTitle = !confirm ? '' : {
    promote:  `Promote to ${TIER_LABELS[confirm.targetTier]}?`,
    won:      'Mark as Closed Won?',
    lost:     'Mark as Closed Lost?',
    activate: 'Mark as Active Trader?',
    churn:    'Mark as Churned?',
  }[confirm.action] ?? '';

  const confirmMessage = !confirm ? '' : {
    promote:  `"${confirm.item.name}" will move to the ${TIER_LABELS[confirm.targetTier]} pipeline.`,
    won:      `"${confirm.item.name}" will be moved to Closed Won.`,
    lost:     `"${confirm.item.name}" will be marked as Closed Lost.`,
    activate: `"${confirm.item.name}" will be moved to Active Trader.`,
    churn:    `"${confirm.item.name}" will be marked as Churned.`,
  }[confirm.action] ?? '';

  const confirmVariant = ['lost','churn'].includes(confirm?.action) ? 'danger' : 'warning';
  const confirmLabel   = { lost: 'Close Lost', churn: 'Mark Churned' }[confirm?.action] ?? 'Confirm';

  return (
    <Layout title={`${TIER_LABELS[tier] ?? 'Pipeline'} Pipeline`}>
      <div className="filters-bar">
        <div className="search-wrap">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input className="search-input" placeholder={isIndividual ? 'Search leads…' : 'Search deals…'} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="tier-toggle">
          {['enterprise', 'pro', 'individual'].map(t => (
            <button key={t} className={`tier-toggle-btn${tier === t ? ' active' : ''}`} onClick={() => navigate(`/pipeline/${t}`)}>
              {TIER_LABELS[t]}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <RoleGate allow={['admin', 'sales']}>
          {isIndividual ? (
            <button className="btn btn-primary btn-sm" onClick={() => setLeadForm('create')}>+ Add Lead</button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => setDealForm('create')}>+ New Deal</button>
          )}
        </RoleGate>
      </div>

      {queryError && <ErrorBanner message={queryError.message} onRetry={refetch} />}
      {dndError && (
        <div style={{ margin: '0 0 12px', padding: '8px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, color: '#dc2626' }}>
          {dndError}
        </div>
      )}

      <div className="kanban-board">
        {stages.map(({ key, label }) => {
          const col    = items.filter(i => i.stage === key);
          const colVal = col.reduce((s, i) => s + (i.estimated_commission ?? 0), 0);
          return (
            <div
              key={key}
              className="kanban-col"
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
              onDragEnter={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drag-over'); }}
              onDrop={e => {
                e.preventDefault();
                e.currentTarget.classList.remove('drag-over');
                const itemId = e.dataTransfer.getData('text/plain');
                if (itemId) handleDrop(itemId, key);
              }}
            >
              <div className="kanban-col-header">
                <span className="kanban-col-title">{label}</span>
                <span className="kanban-col-count">{col.length}</span>
              </div>
              {isLoading
                ? Array.from({ length: 2 }, (_, i) => <div key={i} className="skeleton skeleton-card" />)
                : col.map(item => (
                  <KanbanCard
                    key={item.id}
                    item={item}
                    isIndividual={isIndividual}
                    isAdmin={isAdmin}
                    onEdit={() => isIndividual ? setLeadForm(item._raw) : setDealForm(item)}
                    onConvert={() => setConvertLead(item._raw)}
                    onPromote={targetTier => setConfirm({ action: 'promote', item, targetTier })}
                    onWon={() => setConfirm({ action: 'won', item })}
                    onLost={() => setConfirm({ action: 'lost', item })}
                    onActivate={() => setConfirm({ action: 'activate', item })}
                    onChurn={() => setConfirm({ action: 'churn', item })}
                    onDelete={() => setDeleteConfirm({ item })}
                    onNavigate={() => isIndividual ? navigate(`/leads/${item.id}`) : navigate(`/deals/${item.id}`)}
                    tier={tier}
                  />
                ))
              }
              {!isLoading && col.length > 0 && !isIndividual && (
                <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', padding: '4px 2px', fontWeight: 500 }}>
                  Total: {fmtCurrency(colVal)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Deal forms (B2B) */}
      {dealForm === 'create' && <DealForm onClose={() => setDealForm(null)} onSuccess={() => setDealForm(null)} />}
      {dealForm && dealForm !== 'create' && <DealForm deal={dealForm} onClose={() => setDealForm(null)} onSuccess={() => setDealForm(null)} />}

      {/* Lead forms (Individual) */}
      {leadForm === 'create' && <LeadForm onClose={() => setLeadForm(null)} onSuccess={() => setLeadForm(null)} />}
      {leadForm && leadForm !== 'create' && <LeadForm lead={leadForm} onClose={() => setLeadForm(null)} onSuccess={() => setLeadForm(null)} />}

      {convertLead && <ConvertLeadModal lead={convertLead} onClose={() => setConvertLead(null)} />}

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
        title={`Delete ${deleteConfirm?.item?.name}?`}
        message="This cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleteDeal.isPending || deleteLead.isPending}
        onConfirm={async () => {
          const item = deleteConfirm.item;
          if (isIndividual) {
            await deleteLead.mutateAsync(item.id);
          } else {
            await deleteDeal.mutateAsync(item.id);
          }
          setDeleteConfirm(null);
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
    </Layout>
  );
}

function KanbanCard({ item, isIndividual, isAdmin, onEdit, onConvert, onPromote, onWon, onLost, onActivate, onChurn, onDelete, onNavigate, tier }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const promoteTargets = tier === 'pro'        ? [{ key: 'enterprise', label: 'Enterprise' }]
    : tier === 'individual' ? [{ key: 'pro', label: 'Pro' }, { key: 'enterprise', label: 'Enterprise' }]
    : [];

  return (
    <div
      className="kanban-card"
      draggable
      onDragStart={e => { e.dataTransfer.setData('text/plain', item.id); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={onNavigate}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 4 }}>
        <div style={{ minWidth: 0 }}>
          <div className="kanban-card-name">{item.name}</div>
          {!isIndividual && <div className="kanban-card-account">{item.account?.name}</div>}
          {isIndividual && item.source && (
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 1 }}>
              {item.source.replace(/_/g, ' ')}
            </div>
          )}
        </div>
        <div ref={menuRef} className="card-menu" onClick={e => e.stopPropagation()}>
          <button className="card-menu-btn" onClick={() => setMenuOpen(o => !o)}>⋮</button>
          {menuOpen && (
            <div className="card-menu-dropdown">
              <RoleGate allow={['admin', 'sales']}>
                <button onClick={() => { onEdit(); setMenuOpen(false); }}>Edit</button>
              </RoleGate>
              {isIndividual && (
                <RoleGate allow={['admin', 'sales']}>
                  <button onClick={() => { onConvert(); setMenuOpen(false); }}>Convert →</button>
                </RoleGate>
              )}
              {promoteTargets.map(t => (
                <RoleGate key={t.key} allow={['admin', 'sales']}>
                  <button onClick={() => { onPromote(t.key); setMenuOpen(false); }}>Promote to {t.label}</button>
                </RoleGate>
              ))}
              {isIndividual ? (
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
        {!isIndividual && <TierBadge tier={item.tier} />}
        {!isIndividual && <SegmentBadge segment={item.account?.segment} />}
        {isIndividual && item.lead_score != null && (
          <span style={{
            fontSize: 11.5, fontWeight: 700, borderRadius: 99, padding: '1px 7px',
            background: 'var(--bg-tertiary)', color:
              item.lead_score >= 80 ? 'var(--green)' :
              item.lead_score >= 50 ? 'var(--yellow)' : 'var(--text-tertiary)',
          }}>
            {item.lead_score}
          </span>
        )}
      </div>
      <AssetPills classes={item.asset_classes} />
      {!isIndividual && (
        <div className="kanban-card-meta" style={{ marginTop: 8 }}>
          <span className="kanban-card-value">{fmtCurrency(item.estimated_commission)}</span>
          <span className="kanban-card-prob">{item.probability}%</span>
        </div>
      )}
    </div>
  );
}

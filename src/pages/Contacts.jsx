import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import RoleGate from '../components/RoleGate';
import ContactForm from '../components/ContactForm';
import ActionMenu from '../components/ActionMenu';
import ConfirmModal from '../components/ConfirmModal';
import { useIsAdmin } from '../components/RoleGate';
import { useContacts, useDeleteContact, useArchiveContact } from '../hooks/useContacts';
import { TierBadge, SegmentBadge, StatusBadge, KycBadge, AssetPills, LeadScore, TableSkeleton, ErrorBanner, EmptyState } from './shared';

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

export default function Contacts() {
  const [search, setSearch]   = useState('');
  const [tier, setTier]       = useState('');
  const [segment, setSegment] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [panel, setPanel]     = useState(null);
  const [confirm, setConfirm] = useState(null); // { type: 'delete'|'archive', contact }
  const navigate = useNavigate();
  const isAdmin  = useIsAdmin();

  const visibleSegments = tier ? (TIER_SEGMENTS[tier] ?? ALL_SEGMENTS) : ALL_SEGMENTS;
  const handleTierChange = (t) => { setTier(t); if (t && segment && !TIER_SEGMENTS[t]?.includes(segment)) setSegment(''); };

  const { data, isLoading, error, refetch } = useContacts({ search, tier, segment, status: statusFilter });
  const deleteContact  = useDeleteContact();
  const archiveContact = useArchiveContact();

  const handleConfirm = async () => {
    if (!confirm) return;
    try {
      if (confirm.type === 'delete') {
        await deleteContact.mutateAsync(confirm.contact.id);
      } else {
        await archiveContact.mutateAsync(confirm.contact.id);
      }
      setConfirm(null);
    } catch (err) {
      setConfirm(c => c ? { ...c, error: err.message } : null);
    }
  };

  const loading = deleteContact.isPending || archiveContact.isPending;

  return (
    <Layout title="Contacts">
      <div className="filters-bar">
        <div className="search-wrap">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input className="search-input" placeholder="Search contacts…" value={search} onChange={e => setSearch(e.target.value)} />
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
          {[['','All'],['active','Active'],['unsubscribed','Archived']].map(([val, lbl]) => (
            <button
              key={val}
              className={`tier-toggle-btn${statusFilter === val ? ' active' : ''}`}
              onClick={() => setStatusFilter(val)}
            >{lbl}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <RoleGate allow={['admin','sales','operations']}>
          <button className="btn btn-primary btn-sm" onClick={() => setPanel('create')}>+ New Contact</button>
        </RoleGate>
      </div>

      {error && <ErrorBanner message={error.message} onRetry={refetch} />}

      {isLoading ? <TableSkeleton cols={8} /> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Tier</th><th>Segment</th><th>Status</th>
                <th>Score</th><th>Asset classes</th><th>KYC</th><th>Sales Owner</th>
                <th style={{ width: 48 }} />
              </tr>
            </thead>
            <tbody>
              {!data?.length && <tr><td colSpan={9}><EmptyState icon="👤" text="No contacts found" /></td></tr>}
              {data?.map(c => (
                <tr
                  key={c.id}
                  style={{ opacity: c.status === 'unsubscribed' ? 0.45 : 1 }}
                  onClick={() => navigate(`/contacts/${c.id}`)}
                >
                  <td>
                    <div className="table-name">{c.first_name} {c.last_name}</div>
                    <div className="table-sub">{c.title} · {c.email}</div>
                  </td>
                  <td><TierBadge tier={c.tier} /></td>
                  <td><SegmentBadge segment={c.segment} /></td>
                  <td><StatusBadge status={c.status} /></td>
                  <td>{c.tier === 'individual' ? <LeadScore score={c.lead_score} /> : <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>—</span>}</td>
                  <td><AssetPills classes={c.asset_classes} /></td>
                  <td><KycBadge status={c.kyc_status} /></td>
                  <td><span style={{ fontSize: 13 }}>{c.sales_owner?.full_name ?? '—'}</span></td>
                  <td onClick={e => e.stopPropagation()}>
                    <ActionMenu items={[
                      { label: 'Edit', onClick: () => setPanel(c) },
                      ...(isAdmin ? [
                        { label: 'Archive', onClick: () => setConfirm({ type: 'archive', contact: c }) },
                        { label: 'Delete', danger: true, onClick: () => setConfirm({ type: 'delete', contact: c }) },
                      ] : []),
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {panel === 'create' && <ContactForm onClose={() => setPanel(null)} onSuccess={() => setPanel(null)} />}
      {panel && panel !== 'create' && <ContactForm contact={panel} onClose={() => setPanel(null)} onSuccess={() => setPanel(null)} />}

      <ConfirmModal
        isOpen={!!confirm}
        title={confirm?.type === 'delete' ? `Delete ${confirm?.contact?.first_name} ${confirm?.contact?.last_name}?` : `Archive ${confirm?.contact?.first_name} ${confirm?.contact?.last_name}?`}
        message={
          confirm?.type === 'delete'
            ? `This will permanently remove the contact and all linked data. This cannot be undone.`
            : `This will set the contact status to unsubscribed.`
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

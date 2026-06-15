import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Layout from '../../components/Layout';
import AssignOwnerModal from '../../components/AssignOwnerModal';
import {
  useDealsWithoutOwner,
  useAccountsWithoutOwner,
  useAccountsNeedingServiceManager,
  useLeadsWithoutOwner,
} from '../../hooks/useOwnershipHygiene';
import { TierBadge, SegmentBadge, StatusBadge, StageBadge, fmtDate, ErrorBanner, TableSkeleton } from '../shared';

function StatCard({ label, value, loading, warn }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      {loading
        ? <div className="skeleton skeleton-text" style={{ width: 48, height: 28, marginTop: 4 }} />
        : <div className="metric-value" style={{ color: warn && value > 0 ? 'var(--yellow)' : value === 0 ? 'var(--green)' : undefined }}>
            {value ?? '—'}
          </div>
      }
    </div>
  );
}

function EmptyOk({ text }) {
  return (
    <div style={{ padding: '20px 16px', textAlign: 'center', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13, color: 'var(--green)' }}>
      {text}
    </div>
  );
}

function TableSection({ title, isLoading, error, onRetry, isEmpty, emptyText, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>{title}</div>
      {error && <ErrorBanner message={error.message} onRetry={onRetry} />}
      {isLoading ? <TableSkeleton cols={5} rows={4} /> : isEmpty ? <EmptyOk text={emptyText} /> : children}
    </div>
  );
}

export default function OwnershipHygiene() {
  const navigate = useNavigate();
  const qc       = useQueryClient();

  const dealsNoOwner   = useDealsWithoutOwner();
  const accountsNoOwner = useAccountsWithoutOwner();
  const accountsNoSM   = useAccountsNeedingServiceManager();
  const leadsNoOwner   = useLeadsWithoutOwner();

  const [modal, setModal] = useState(null);

  const totalIssues = (
    (dealsNoOwner.data?.length    ?? 0) +
    (accountsNoOwner.data?.length ?? 0) +
    (accountsNoSM.data?.length    ?? 0) +
    (leadsNoOwner.data?.length    ?? 0)
  );

  const [lastRefreshed, setLastRefreshed] = useState(() => new Date());
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ownership-hygiene'] });
    setLastRefreshed(new Date());
  };

  return (
    <Layout title="Ownership Hygiene">
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <button className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }} onClick={() => navigate(-1)}>← Back</button>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
            Accounts and deals that need owner or service manager assignment
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text-tertiary)' }}>
          <span>Last refreshed: {lastRefreshed.toLocaleTimeString()}</span>
          <button className="btn btn-secondary btn-sm" onClick={refresh}>Refresh</button>
        </div>
      </div>

      {/* Summary */}
      <div className="metrics-grid" style={{ marginBottom: 28 }}>
        <StatCard label="Deals without Sales Owner"    value={dealsNoOwner.data?.length}    loading={dealsNoOwner.isLoading}    warn />
        <StatCard label="Accounts without Sales Owner" value={accountsNoOwner.data?.length} loading={accountsNoOwner.isLoading} warn />
        <StatCard label="Active/Onboarding without Service Manager" value={accountsNoSM.data?.length} loading={accountsNoSM.isLoading} warn />
        <StatCard label="Leads without Sales Owner"    value={leadsNoOwner.data?.length}    loading={leadsNoOwner.isLoading}    warn />
      </div>

      {/* TABLE 1 — Deals missing owner */}
      <TableSection
        title="Deals Missing Sales Owner"
        isLoading={dealsNoOwner.isLoading}
        error={dealsNoOwner.error}
        onRetry={dealsNoOwner.refetch}
        isEmpty={!dealsNoOwner.data?.length}
        emptyText="✓ All deals have a Sales Owner"
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Deal Name</th><th>Account</th><th>Tier</th><th>Stage</th><th>Created</th><th style={{ width: 80 }} /></tr>
            </thead>
            <tbody>
              {dealsNoOwner.data?.map(d => (
                <tr key={d.id}>
                  <td><div className="table-name" style={{ cursor: 'pointer' }} onClick={() => navigate(`/deals/${d.id}`)}>{d.name}</div></td>
                  <td><span style={{ fontSize: 13 }}>{d.account?.name ?? '—'}</span></td>
                  <td><TierBadge tier={d.tier} /></td>
                  <td><StageBadge stage={d.stage} /></td>
                  <td><span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>{fmtDate(d.created_at)}</span></td>
                  <td>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setModal({ recordType: 'deal', recordId: d.id, fieldName: 'sales_owner_id', title: `Assign Sales Owner — ${d.name}` })}
                    >
                      Assign
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableSection>

      {/* TABLE 2 — Accounts missing owner */}
      <TableSection
        title="Accounts Missing Sales Owner"
        isLoading={accountsNoOwner.isLoading}
        error={accountsNoOwner.error}
        onRetry={accountsNoOwner.refetch}
        isEmpty={!accountsNoOwner.data?.length}
        emptyText="✓ All accounts have a Sales Owner"
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Account</th><th>Tier</th><th>Segment</th><th>Status</th><th>Created</th><th style={{ width: 80 }} /></tr>
            </thead>
            <tbody>
              {accountsNoOwner.data?.map(a => (
                <tr key={a.id}>
                  <td><div className="table-name" style={{ cursor: 'pointer' }} onClick={() => navigate(`/accounts/${a.id}`)}>{a.name}</div></td>
                  <td><TierBadge tier={a.tier} /></td>
                  <td><SegmentBadge segment={a.segment} /></td>
                  <td><StatusBadge status={a.status} /></td>
                  <td><span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>{fmtDate(a.created_at)}</span></td>
                  <td>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setModal({ recordType: 'account', recordId: a.id, fieldName: 'sales_owner_id', title: `Assign Sales Owner — ${a.name}` })}
                    >
                      Assign
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableSection>

      {/* TABLE 3 — Active/onboarding accounts missing service manager */}
      <TableSection
        title="Active/Onboarding Accounts Missing Service Manager"
        isLoading={accountsNoSM.isLoading}
        error={accountsNoSM.error}
        onRetry={accountsNoSM.refetch}
        isEmpty={!accountsNoSM.data?.length}
        emptyText="✓ All active accounts have a Service Manager"
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Account</th><th>Sales Owner</th><th>Status</th><th>Deal Stage</th><th style={{ width: 80 }} /></tr>
            </thead>
            <tbody>
              {accountsNoSM.data?.map(a => (
                <tr key={a.id}>
                  <td><div className="table-name" style={{ cursor: 'pointer' }} onClick={() => navigate(`/accounts/${a.id}`)}>{a.name}</div></td>
                  <td><span style={{ fontSize: 13 }}>{a.sales_owner?.full_name ?? <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</span></td>
                  <td><StatusBadge status={a.status} /></td>
                  <td>{a.deal_stage ? <StageBadge stage={a.deal_stage} /> : <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>—</span>}</td>
                  <td>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setModal({ recordType: 'account', recordId: a.id, fieldName: 'service_manager_id', title: `Assign Service Manager — ${a.name}` })}
                    >
                      Assign
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableSection>

      {/* TABLE 4 — Leads missing owner */}
      <TableSection
        title="Leads Missing Sales Owner"
        isLoading={leadsNoOwner.isLoading}
        error={leadsNoOwner.error}
        onRetry={leadsNoOwner.refetch}
        isEmpty={!leadsNoOwner.data?.length}
        emptyText="✓ All leads have a Sales Owner"
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Contact</th><th>Stage</th><th>Source</th><th>Created</th><th style={{ width: 80 }} /></tr>
            </thead>
            <tbody>
              {leadsNoOwner.data?.map(l => {
                const name = l.contact ? `${l.contact.first_name} ${l.contact.last_name}` : '—';
                return (
                  <tr key={l.id}>
                    <td>
                      <div className="table-name" style={{ cursor: 'pointer' }} onClick={() => navigate(`/leads/${l.id}`)}>{name}</div>
                      <div className="table-sub">{l.contact?.email}</div>
                    </td>
                    <td><span className={`badge badge-${l.stage}`}>{l.stage}</span></td>
                    <td><span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{l.source?.replace(/_/g, ' ') ?? '—'}</span></td>
                    <td><span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>{fmtDate(l.created_at)}</span></td>
                    <td>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setModal({ recordType: 'lead', recordId: l.id, fieldName: 'sales_owner_id', title: `Assign Sales Owner — ${name}` })}
                      >
                        Assign
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </TableSection>

      {modal && (
        <AssignOwnerModal
          recordType={modal.recordType}
          recordId={modal.recordId}
          fieldName={modal.fieldName}
          title={modal.title}
          currentOwnerId={null}
          onClose={() => setModal(null)}
        />
      )}
    </Layout>
  );
}

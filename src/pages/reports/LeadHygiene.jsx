import { useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import ConvertLeadModal from '../../components/ConvertLeadModal';
import AssignOwnerModal from '../../components/AssignOwnerModal';
import { useState } from 'react';
import { useOrphanedConversions, useLeadMetrics } from '../../hooks/useLeads';
import { useLeadsWithoutOwner } from '../../hooks/useOwnershipHygiene';
import { TierBadge, fmtDate, ErrorBanner, TableSkeleton } from '../shared';

function daysSince(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export default function LeadHygiene() {
  const navigate   = useNavigate();
  const orphaned   = useOrphanedConversions();
  const metrics    = useLeadMetrics();
  const leadsNoOwner = useLeadsWithoutOwner();
  const [convertLead, setConvertLead] = useState(null);
  const [assignModal, setAssignModal] = useState(null);

  const m = metrics.data;

  return (
    <Layout title="Lead Hygiene">
      <button className="btn btn-ghost btn-sm" style={{ marginBottom: 16 }} onClick={() => navigate(-1)}>
        ← Back
      </button>

      {/* Summary stats */}
      <div className="metrics-grid" style={{ marginBottom: 24 }}>
        <div className="metric-card">
          <div className="metric-label">Total Active Leads</div>
          {metrics.isLoading
            ? <div className="skeleton skeleton-text" style={{ width: 60, height: 28, marginTop: 4 }} />
            : <div className="metric-value">{m?.totalLeads ?? '—'}</div>
          }
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Converted</div>
          {metrics.isLoading
            ? <div className="skeleton skeleton-text" style={{ width: 60, height: 28, marginTop: 4 }} />
            : <div className="metric-value" style={{ color: 'var(--accent)' }}>
                {m ? Object.values(m.byStage).reduce((s, v) => s + v, 0) - (m.totalLeads) : '—'}
              </div>
          }
        </div>
        <div className="metric-card">
          <div className="metric-label">Orphaned Conversions</div>
          {orphaned.isLoading
            ? <div className="skeleton skeleton-text" style={{ width: 60, height: 28, marginTop: 4 }} />
            : <div className="metric-value" style={{ color: (orphaned.data?.length ?? 0) > 0 ? 'var(--yellow)' : 'var(--green)' }}>
                {orphaned.data?.length ?? '—'}
              </div>
          }
        </div>
        <div className="metric-card">
          <div className="metric-label">Conversion Rate</div>
          {metrics.isLoading
            ? <div className="skeleton skeleton-text" style={{ width: 60, height: 28, marginTop: 4 }} />
            : <div className="metric-value">{m?.conversionRate ?? 0}%</div>
          }
        </div>
        <div className="metric-card">
          <div className="metric-label">Leads without Sales Owner</div>
          {leadsNoOwner.isLoading
            ? <div className="skeleton skeleton-text" style={{ width: 60, height: 28, marginTop: 4 }} />
            : <div className="metric-value" style={{ color: (leadsNoOwner.data?.length ?? 0) > 0 ? 'var(--yellow)' : 'var(--green)' }}>
                {leadsNoOwner.data?.length ?? '—'}
              </div>
          }
        </div>
      </div>

      {orphaned.error && <ErrorBanner message={orphaned.error.message} onRetry={orphaned.refetch} />}

      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: 'var(--text-primary)' }}>
        Orphaned Conversions
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
        These leads were marked converted but have no linked deal and were converted more than 7 days ago.
        Create or link a deal to resolve each one.
      </p>

      {orphaned.isLoading ? (
        <TableSkeleton cols={5} rows={4} />
      ) : (orphaned.data?.length ?? 0) === 0 ? (
        <div style={{ padding: '28px 16px', textAlign: 'center', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13, color: 'var(--text-tertiary)' }}>
          No orphaned conversions. All converted leads have linked deals.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Converted At</th>
                <th>Target Tier</th>
                <th>Days Since Conversion</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {orphaned.data.map(lead => {
                const name = lead.contact
                  ? `${lead.contact.first_name} ${lead.contact.last_name}`
                  : 'Unknown';
                const days = daysSince(lead.converted_at);
                return (
                  <tr key={lead.id}>
                    <td>
                      <div className="table-name">{name}</div>
                      <div className="table-sub">{lead.contact?.email}</div>
                    </td>
                    <td style={{ fontSize: 13 }}>{fmtDate(lead.converted_at)}</td>
                    <td>
                      {lead.converted_to_tier
                        ? <TierBadge tier={lead.converted_to_tier} />
                        : <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                      }
                    </td>
                    <td>
                      <span style={{ fontSize: 13, fontWeight: 600, color: days > 30 ? 'var(--red)' : 'var(--yellow)' }}>
                        {days}d
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => setConvertLead(lead)}
                        >
                          Create Deal
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => navigate(`/leads/${lead.id}`)}
                        >
                          Review →
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Leads missing Sales Owner */}
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, marginTop: 32, color: 'var(--text-primary)' }}>
        Leads Missing Sales Owner
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
        These leads have no Sales Owner assigned. Assign an owner so the right person is accountable.
      </p>
      {leadsNoOwner.isLoading ? (
        <TableSkeleton cols={4} rows={4} />
      ) : (leadsNoOwner.data?.length ?? 0) === 0 ? (
        <div style={{ padding: '28px 16px', textAlign: 'center', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13, color: 'var(--green)' }}>
          ✓ All leads have a Sales Owner assigned.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Stage</th>
                <th>Source</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {leadsNoOwner.data.map(lead => {
                const name = lead.contact
                  ? `${lead.contact.first_name} ${lead.contact.last_name}`
                  : 'Unknown';
                return (
                  <tr key={lead.id}>
                    <td>
                      <div className="table-name">{name}</div>
                      <div className="table-sub">{lead.contact?.email}</div>
                    </td>
                    <td><span className={`badge badge-${lead.stage}`}>{lead.stage}</span></td>
                    <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{lead.source?.replace(/_/g, ' ') ?? '—'}</td>
                    <td style={{ fontSize: 13 }}>{fmtDate(lead.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => setAssignModal({ recordType: 'lead', recordId: lead.id, title: `Assign Sales Owner — ${name}` })}
                        >
                          Assign
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => navigate(`/leads/${lead.id}`)}
                        >
                          Review →
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {convertLead && (
        <ConvertLeadModal
          lead={convertLead}
          onClose={() => setConvertLead(null)}
        />
      )}
      {assignModal && (
        <AssignOwnerModal
          recordType={assignModal.recordType}
          recordId={assignModal.recordId}
          fieldName="sales_owner_id"
          title={assignModal.title}
          currentOwnerId={null}
          onClose={() => setAssignModal(null)}
        />
      )}
    </Layout>
  );
}

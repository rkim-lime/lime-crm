import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useActivities } from '../hooks/useActivities';
import { ActivityIcon, fmtRelTime, ErrorBanner, EmptyState } from './shared';

const TYPES = ['email','call','meeting','note','deal_stage_change','document_uploaded','task_completed','onboarding_step'];

export default function Activity() {
  const [type, setType] = useState('');
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useActivities({ type, limit: 100 });

  return (
    <Layout title="Activity Feed">
      <div className="filters-bar">
        <select className="filter-select" value={type} onChange={e => setType(e.target.value)}>
          <option value="">All types</option>
          {TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      {error && <ErrorBanner message={error.message} onRetry={refetch} />}

      <div className="card">
        {isLoading && (
          Array.from({ length: 8 }, (_, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="skeleton" style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton skeleton-text" style={{ width: '40%', marginBottom: 6 }} />
                <div className="skeleton skeleton-text" style={{ width: '70%' }} />
              </div>
            </div>
          ))
        )}

        {!isLoading && !data?.length && <EmptyState icon="⚡" text="No activity yet" />}

        <div className="activity-feed">
          {data?.map(a => (
            <div key={a.id} className="activity-item">
              <div className={`activity-icon activity-icon-${a.type}`}>
                <ActivityIcon type={a.type} />
              </div>
              <div className="activity-body">
                <div className="activity-title">{a.title}</div>
                {a.body && <div className="activity-text">{a.body}</div>}
                <div className="activity-time" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span>{fmtRelTime(a.occurred_at)}</span>
                  {a.account && (
                    <span style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => navigate(`/accounts/${a.account_id}`)}>
                      · {a.account.name}
                    </span>
                  )}
                  {a.contact && (
                    <span style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => navigate(`/contacts/${a.contact_id}`)}>
                      · {a.contact.first_name} {a.contact.last_name}
                    </span>
                  )}
                  {a.deal && (
                    <span style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => navigate(`/deals/${a.deal_id}`)}>
                      · {a.deal.name}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                <span className={`badge badge-${a.type.replace(/_/g,'-')}`} style={{ fontSize: 10.5 }}>{a.type.replace(/_/g,' ')}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}

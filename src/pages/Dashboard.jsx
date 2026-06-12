import Layout from '../components/Layout';
import { useAccounts } from '../hooks/useAccounts';
import { useDeals } from '../hooks/useDeals';
import { useTasks } from '../hooks/useTasks';
import { useActivities } from '../hooks/useActivities';
import { SegmentBadge, StageBadge, ActivityIcon, fmtCurrency, fmtRelTime } from './shared';

const STAGES = ['prospecting','qualified','proposal_sent','technical_due_diligence','negotiating','onboarding','closed_won','closed_lost'];

export default function Dashboard() {
  const accounts   = useAccounts();
  const deals      = useDeals();
  const tasks      = useTasks({ status: 'open' });
  const activities = useActivities({ limit: 10 });

  const activeAccounts = accounts.data?.filter(a => a.status === 'active').length ?? 0;
  const openDeals      = deals.data?.filter(d => !['closed_won','closed_lost'].includes(d.stage)).length ?? 0;
  const totalPipeline  = deals.data?.reduce((s, d) => s + (d.estimated_commission ?? 0), 0) ?? 0;
  const openTasks      = tasks.data?.length ?? 0;

  return (
    <Layout title="Dashboard">
      {/* Metrics */}
      <div className="metrics-grid">
        <MetricCard label="Active accounts" value={activeAccounts} loading={accounts.isLoading} />
        <MetricCard label="Open deals"      value={openDeals}      loading={deals.isLoading} />
        <MetricCard label="Pipeline value"  value={fmtCurrency(totalPipeline)} loading={deals.isLoading} />
        <MetricCard label="Open tasks"      value={openTasks}      loading={tasks.isLoading} />
      </div>

      <div className="grid-2" style={{ gap: 20 }}>
        {/* Pipeline summary */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Pipeline by stage</span>
          </div>
          <div style={{ padding: '8px 0' }}>
            {deals.isLoading ? <SkeletonRows n={6} /> : deals.error ? <ErrorMsg msg={deals.error.message} retry={deals.refetch} /> : (
              STAGES.filter(s => !['closed_won','closed_lost'].includes(s)).map(stage => {
                const stageDeals = deals.data.filter(d => d.stage === stage);
                if (!stageDeals.length) return null;
                const val = stageDeals.reduce((s, d) => s + (d.estimated_commission ?? 0), 0);
                return (
                  <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
                    <StageBadge stage={stage} />
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginRight: 8 }}>{stageDeals.length} deal{stageDeals.length !== 1 ? 's' : ''}</span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{fmtCurrency(val)}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Activity feed */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Recent activity</span>
          </div>
          {activities.isLoading ? <SkeletonRows n={6} /> : activities.error ? <ErrorMsg msg={activities.error.message} retry={activities.refetch} /> : (
            <div className="activity-feed">
              {activities.data?.map(a => (
                <div key={a.id} className="activity-item">
                  <div className={`activity-icon activity-icon-${a.type}`}>
                    <ActivityIcon type={a.type} />
                  </div>
                  <div className="activity-body">
                    <div className="activity-title">{a.title}</div>
                    {a.body && <div className="activity-text">{a.body}</div>}
                    <div className="activity-time">{fmtRelTime(a.occurred_at)}</div>
                  </div>
                </div>
              ))}
              {!activities.data?.length && <div className="empty-state"><div className="empty-state-text">No recent activity</div></div>}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

function MetricCard({ label, value, loading }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      {loading ? <div className="skeleton skeleton-text" style={{ width: 80, height: 28, marginTop: 4 }} /> : <div className="metric-value">{value}</div>}
    </div>
  );
}

function SkeletonRows({ n }) {
  return Array.from({ length: n }, (_, i) => (
    <div key={i} className="skeleton skeleton-row" />
  ));
}

function ErrorMsg({ msg, retry }) {
  return (
    <div className="error-state" style={{ margin: 16 }}>
      <span style={{ flex: 1 }}>{msg}</span>
      <button className="btn btn-sm btn-secondary" onClick={retry}>Retry</button>
    </div>
  );
}

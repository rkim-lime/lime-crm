import { useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { useDedupQueue, useDedupQueueCount, useResolveDedup } from '../hooks/useDedup';
import { fmtRelTime, ErrorBanner } from './shared';

const SEGMENT_LABELS = {
  hedge_fund:    'Hedge Fund',
  quant_fund:    'Quant Fund',
  prop_trader:   'Prop Trader',
  broker_dealer: 'Broker-Dealer',
  pension:       'Pension',
  family_office: 'Family Office',
};

function fmtAUM(n) {
  if (n == null) return '—';
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3)  return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function ResolutionBadge({ status }) {
  const MAP = {
    merged:         { label: 'Merged',           bg: '#f0fdf4', color: '#16a34a' },
    not_duplicate:  { label: 'Different firms',  bg: '#eff6ff', color: '#2563eb' },
    dismissed:      { label: 'Dismissed',        bg: '#f8fafc', color: '#94a3b8' },
  };
  const s = MAP[status] ?? MAP.dismissed;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 3, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

// ── Single queue item card ────────────────────────────────────────────────────

function QueueCard({ item, resolve }) {
  const [confirming, setConfirming] = useState(false);
  const isResolved   = item.status !== 'pending';
  const isVsAccount  = item.match_type === 'account';
  const prospect     = item.prospect;
  const matchedName  = isVsAccount
    ? (item.matched_account?.name ?? item.matched_name)
    : (item.matched_prospect?.firm_name ?? item.matched_name);
  const matchedAUM   = isVsAccount ? item.matched_account?.aum_usd : item.matched_prospect?.estimated_aum_usd;
  const matchedUrl   = isVsAccount
    ? (item.matched_account_id  ? `/accounts/${item.matched_account_id}` : null)
    : (item.matched_prospect_id ? `/prospects/${item.matched_prospect_id}` : null);

  const handleMerge = () => {
    if (!confirming) { setConfirming(true); return; }
    setConfirming(false);
    resolve({ queueId: item.id, resolution: 'merged', queue: item });
  };

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden',
      marginBottom: 10, opacity: isResolved ? 0.7 : 1,
    }}>
      {/* Comparison row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 1fr 180px', alignItems: 'center' }}>
        {/* LEFT: flagged prospect */}
        <div style={{ padding: '14px 16px', borderRight: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 4 }}>
            Flagged Prospect
          </div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{prospect?.firm_name ?? '—'}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>
            {fmtAUM(prospect?.estimated_aum_usd)}
            {prospect?.fit_score != null ? ` · Fit ${prospect.fit_score}` : ''}
            {prospect?.inferred_segment ? ` · ${SEGMENT_LABELS[prospect.inferred_segment] ?? prospect.inferred_segment}` : ''}
          </div>
          {prospect?.cik && (
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 2, fontFamily: 'monospace' }}>
              CIK {prospect.cik}
            </div>
          )}
          {prospect?.id && (
            <Link to={`/prospects/${prospect.id}`} style={{ fontSize: 11.5, color: 'var(--accent)', textDecoration: 'none', marginTop: 4, display: 'inline-block' }}>
              View Prospect →
            </Link>
          )}
        </div>

        {/* MIDDLE: similarity */}
        <div style={{ padding: '14px 8px', textAlign: 'center', background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 800, fontSize: 22, color: 'var(--accent)', lineHeight: 1 }}>
            {Math.round((item.similarity ?? 0) * 100)}%
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginBottom: 6 }}>match</div>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
            background: isVsAccount ? '#eff6ff' : '#f0fdf4',
            color:      isVsAccount ? '#2563eb' : '#16a34a',
          }}>
            vs {isVsAccount ? 'Account' : 'Prospect'}
          </span>
        </div>

        {/* RIGHT: matched record */}
        <div style={{ padding: '14px 16px', borderRight: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 4 }}>
            {isVsAccount ? 'Matched Account' : 'Matched Prospect'}
          </div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{matchedName ?? '—'}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>
            {fmtAUM(matchedAUM)}
            {isVsAccount && item.matched_account?.tier ? ` · ${item.matched_account.tier}` : ''}
            {!isVsAccount && item.matched_prospect?.fit_score != null
              ? ` · Fit ${item.matched_prospect.fit_score}` : ''}
          </div>
          {matchedUrl && (
            <Link to={matchedUrl} style={{ fontSize: 11.5, color: 'var(--accent)', textDecoration: 'none', marginTop: 4, display: 'inline-block' }}>
              View {isVsAccount ? 'Account' : 'Prospect'} →
            </Link>
          )}
        </div>

        {/* ACTIONS */}
        <div style={{ padding: '12px 14px' }}>
          {isResolved ? (
            <div>
              <ResolutionBadge status={item.status} />
              <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 5 }}>
                {fmtRelTime(item.resolved_at)}
              </div>
            </div>
          ) : confirming ? (
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.4 }}>
                Archive <strong>{prospect?.firm_name?.split(' ').slice(0, 2).join(' ')}</strong> and route its data to <strong>{(matchedName ?? '').split(' ').slice(0, 2).join(' ')}</strong>?
              </div>
              <div style={{ display: 'flex', gap: 5 }}>
                <button className="btn btn-primary btn-sm" onClick={handleMerge}>Confirm</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <button className="btn btn-primary btn-sm" onClick={handleMerge}>
                Same firm — merge
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => resolve({ queueId: item.id, resolution: 'not_duplicate', queue: item })}
              >
                Different firms
              </button>
              <button
                onClick={() => resolve({ queueId: item.id, resolution: 'dismissed', queue: item })}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-tertiary)', padding: '2px 0', textAlign: 'left' }}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Meta row */}
      <div style={{
        padding: '7px 16px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)',
        fontSize: 11.5, color: 'var(--text-tertiary)', display: 'flex', gap: 16,
      }}>
        <span>Flagged {fmtRelTime(item.created_at)}</span>
        {prospect?.source && <span>Source: {prospect.source.replace(/_/g, ' ')}</span>}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const STATUS_OPTS = [
  { value: 'pending',      label: 'Pending review' },
  { value: 'merged',       label: 'Merged'         },
  { value: 'not_duplicate',label: 'Different firms' },
  { value: 'dismissed',    label: 'Dismissed'      },
];

const MATCH_OPTS = [
  { value: '',         label: 'All match types' },
  { value: 'prospect', label: 'vs Prospect'     },
  { value: 'account',  label: 'vs Account'      },
];

export default function DedupQueue() {
  const [statusFilter,    setStatusFilter]    = useState('pending');
  const [matchTypeFilter, setMatchTypeFilter] = useState('');

  const { data: pendingCount = 0 } = useDedupQueueCount();
  const queue   = useDedupQueue({ status: statusFilter, matchType: matchTypeFilter });
  const resolve = useResolveDedup();

  const handleResolve = (args) => resolve.mutate(args);

  const items = queue.data ?? [];

  return (
    <Layout title="Duplicate Review">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Duplicate Review</h1>
            {pendingCount > 0 && (
              <span style={{
                background: '#d97706', color: '#fff', borderRadius: 10,
                fontSize: 12, fontWeight: 700, padding: '2px 9px',
              }}>
                {pendingCount} pending
              </span>
            )}
          </div>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13.5 }}>
            Possible duplicate firms flagged during ingestion — confirm or dismiss
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="filters-bar" style={{ marginBottom: 20 }}>
        {STATUS_OPTS.map(o => (
          <button
            key={o.value}
            className={`btn btn-sm ${statusFilter === o.value ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setStatusFilter(o.value)}
          >
            {o.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <select className="filter-select" value={matchTypeFilter} onChange={e => setMatchTypeFilter(e.target.value)}>
          {MATCH_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {queue.error && <ErrorBanner message={queue.error.message} onRetry={queue.refetch} />}

      {queue.isLoading && (
        <div>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 10, padding: '18px 20px' }}>
              <div className="skeleton skeleton-text" style={{ width: 200, marginBottom: 8 }} />
              <div className="skeleton skeleton-text" style={{ width: '60%' }} />
            </div>
          ))}
        </div>
      )}

      {!queue.isLoading && !queue.error && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>✓</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
            {statusFilter === 'pending' ? 'No duplicates to review' : 'Nothing here'}
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--text-tertiary)' }}>
            {statusFilter === 'pending'
              ? 'New possible duplicates appear here automatically during ingestion'
              : `No ${statusFilter.replace('_', ' ')} items match these filters`}
          </div>
        </div>
      )}

      {!queue.isLoading && items.map(item => (
        <QueueCard key={item.id} item={item} resolve={handleResolve} />
      ))}
    </Layout>
  );
}

import { useComputedScore, useScoreHistory } from '../hooks/useScoringConfig';
import { fmtRelTime } from '../pages/shared';

const DEFAULT_LABELS = {
  lead:           'Lead Score',
  deal:           'Deal Score',
  contact_health: 'Contact Health',
  account_health: 'Account Health',
};

// ── Score breakdown card ──────────────────────────────────────────────────────

export function ScoreCard({ scoreType, record, extraParams, label }) {
  const title = label ?? DEFAULT_LABELS[scoreType] ?? 'Score';
  const { score, availableScore, breakdown, isLoading } = useComputedScore(scoreType, record, extraParams);

  const ratio      = availableScore > 0 ? score / availableScore : 0;
  const scoreColor = ratio >= 0.75 ? 'var(--green)' : ratio >= 0.5 ? 'var(--yellow)' : 'var(--red)';
  const barPct     = availableScore > 0 ? Math.min((score / availableScore) * 100, 100) : 0;

  const hasIntegration = breakdown.some(b => b.requires_integration);

  if (isLoading) {
    return (
      <div className="card card-body">
        <div className="skeleton skeleton-text" style={{ width: '40%', marginBottom: 12 }} />
        <div className="skeleton skeleton-text" style={{ width: '80%' }} />
      </div>
    );
  }

  return (
    <div className="card card-body">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
        <div style={{ textAlign: 'right', lineHeight: 1 }}>
          <span style={{ fontSize: 26, fontWeight: 800, color: scoreColor }}>{score}</span>
          {hasIntegration && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
              / {availableScore} available
            </div>
          )}
        </div>
      </div>
      <div style={{ height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ height: '100%', background: scoreColor, width: `${barPct}%`, borderRadius: 3, transition: 'width .3s' }} />
      </div>
      {breakdown.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <tbody>
            {breakdown.map(b => (
              <tr key={b.criterion_key} style={{ opacity: b.weight === 0 ? .4 : 1 }}>
                <td style={{ padding: '4px 0', color: 'var(--text-secondary)', width: '100%' }}>
                  {b.label}
                  {b.requires_integration && b.integration_label && (
                    <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                      via {b.integration_label}
                    </span>
                  )}
                </td>
                <td style={{ padding: '4px 0 4px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                  {b.requires_integration ? (
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }} title="Requires integration">⊘</span>
                  ) : (
                    <span style={{ color: b.earned ? 'var(--green)' : 'var(--text-tertiary)' }}>
                      {b.earned ? '✓' : '✗'}
                    </span>
                  )}
                </td>
                <td style={{ padding: '4px 0 4px 8px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap',
                  color: b.points > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                  {b.requires_integration ? (
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>~{b.weight}</span>
                  ) : b.points}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Score history mini-timeline ───────────────────────────────────────────────

export function ScoreHistoryMini({ recordType, recordId }) {
  const history = useScoreHistory(recordType, recordId);

  if (history.isLoading || !history.data?.length) return null;

  const last3 = history.data.slice(0, 3);

  return (
    <div className="card card-body">
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Score History</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {last3.map(h => {
          const color = h.score >= 75 ? 'var(--green)' : h.score >= 50 ? 'var(--yellow)' : 'var(--red)';
          const triggerLabel = {
            manual:        'Manual',
            weight_change: 'Weights updated',
            record_update: 'Record updated',
            scheduled:     'Scheduled',
          }[h.triggered_by] ?? h.triggered_by;

          return (
            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'var(--bg-tertiary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, color, flexShrink: 0,
              }}>{h.score}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 500 }}>{triggerLabel}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{fmtRelTime(h.calculated_at)}</div>
              </div>
              <div style={{ height: 28, width: 60, flexShrink: 0 }}>
                <div style={{ height: '100%', background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden', display: 'flex', alignItems: 'flex-end' }}>
                  <div style={{ width: '100%', height: `${h.score}%`, background: color, borderRadius: 3, transition: 'height .3s' }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

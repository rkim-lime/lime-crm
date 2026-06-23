import { useState, useEffect } from 'react';
import Layout from '../../components/Layout';
import SlidePanel from '../../components/SlidePanel';
import ConfirmModal from '../../components/ConfirmModal';
import JobDefinitionForm from '../../components/JobDefinitionForm';
import ScheduleEditor from '../../components/ScheduleEditor';
import { useAuth } from '../../hooks/useAuth';
import {
  useJobDefinitions,
  useJobRuns,
  useJobRun,
  useTriggerJobRun,
  useCancelJobRun,
  useResetJobRun,
  useDeleteJobDefinition,
  useUpdateJobDefinition,
} from '../../hooks/useJobs';
import { fmtRelTime, ErrorBanner, EmptyState, TableSkeleton } from '../shared';

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtDuration(run) {
  if (!run.started_at) return '—';
  const start = new Date(run.started_at).getTime();
  const end   = run.finished_at ? new Date(run.finished_at).getTime() : Date.now();
  const secs  = Math.floor((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

// claimed_at is refreshed every 30s by the worker heartbeat; >90s of silence = dead worker
const STALE_RUNNING_MS = 90_000;
function isRunStuck(run) {
  return (
    run.status === 'running' &&
    run.claimed_at != null &&
    Date.now() - new Date(run.claimed_at).getTime() > STALE_RUNNING_MS
  );
}

function fmtRunStats(stats) {
  if (!stats || !Object.keys(stats).length) return null;
  const parts = [];
  if (stats.prospects > 0)      parts.push(`${stats.prospects} new`);
  if (stats.merges > 0)         parts.push(`${stats.merges} merged`);
  if (stats.accountMatches > 0) parts.push(`${stats.accountMatches} matched`);
  if (stats.dupes > 0)          parts.push(`${stats.dupes} dupes`);
  if (stats.skipped > 0)        parts.push(`${stats.skipped} skipped`);
  if (stats.errors > 0)         parts.push(`${stats.errors} err`);
  return parts.join(' · ') || 'No new data';
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function fmtNextRun(iso) {
  if (!iso) return null;
  const d    = new Date(iso);
  const diff = d.getTime() - Date.now();
  if (diff < 0)               return 'past due';
  if (diff < 3_600_000) {
    const mins = Math.floor(diff / 60000);
    return `in ${mins}m`;
  }
  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3_600_000);
    return `in ${hours}h`;
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtConfig(config) {
  if (!config || !Object.keys(config).length) return 'Default config';
  const parts = [];
  if (config.limit)            parts.push(`limit ${config.limit}`);
  if (config.minAum)           parts.push(`min $${(config.minAum / 1e9).toFixed(1)}B AUM`);
  if (config.sortBy)           parts.push(`sort: ${config.sortBy}`);
  if (config.filerTypes?.length) parts.push(`[${config.filerTypes.join(', ')}]`);
  return parts.join(' · ') || 'Default config';
}

function scheduleLabel(sched) {
  if (!sched) return null;
  if (sched.schedule_type === 'cron') return `Cron: ${sched.cron_expression}`;
  const h  = sched.hour_of_day   ?? 2;
  const m  = sched.minute_of_hour ?? 0;
  const ap = h < 12 ? 'AM' : 'PM';
  const timeStr = `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ap}`;
  const tz      = sched.timezone === 'America/New_York' ? 'ET'
    : sched.timezone === 'America/Chicago'    ? 'CT'
    : sched.timezone === 'America/Los_Angeles'? 'PT'
    : sched.timezone ?? 'ET';
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  switch (sched.recurrence) {
    case 'daily':     return `Daily at ${timeStr} ${tz}`;
    case 'weekly':    return `Weekly on ${DAYS[sched.day_of_week ?? 1]} at ${timeStr} ${tz}`;
    case 'monthly':   return `Monthly on day ${sched.day_of_month ?? 1} at ${timeStr} ${tz}`;
    case 'quarterly': return `Quarterly on day ${sched.day_of_month ?? 1} at ${timeStr} ${tz}`;
    default:          return sched.recurrence ?? 'Custom';
  }
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_MAP = {
  queued:    { bg: '#f1f5f9', color: '#64748b', label: 'Queued'    },
  running:   { bg: '#eff6ff', color: '#2563eb', label: 'Running', pulse: true },
  completed: { bg: '#f0fdf4', color: '#16a34a', label: 'Completed' },
  failed:    { bg: '#fef2f2', color: '#dc2626', label: 'Failed'    },
  cancelled: { bg: '#f8fafc', color: '#94a3b8', label: 'Cancelled' },
};

function RunStatusBadge({ status }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.queued;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: s.bg, color: s.color,
      padding: '2px 9px', borderRadius: 4, fontSize: 11.5, fontWeight: 600,
    }}>
      {s.pulse && (
        <span className="job-running-dot" style={{
          width: 6, height: 6, borderRadius: '50%',
          background: s.color, display: 'inline-block', flexShrink: 0,
        }} />
      )}
      {s.label}
    </span>
  );
}

// ── Job Definition card ───────────────────────────────────────────────────────

function JobDefinitionCard({ def, canWrite, isAdmin, isTriggering, onRunNow, onEdit, onSchedule, onDelete, onToggleActive }) {
  const schedule = def.schedules?.find(s => s.is_active) ?? def.schedules?.[0];

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px',
      marginBottom: 10, background: 'var(--bg-primary)',
      opacity: def.is_active ? 1 : 0.65,
      transition: 'opacity 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontWeight: 600, fontSize: 14.5 }}>{def.name}</span>
            <span style={{
              fontSize: 10.5, fontWeight: 700, background: '#eff6ff', color: '#2563eb',
              padding: '1px 6px', borderRadius: 3,
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              {def.job_type === 'ingest_13f' ? '13F'
                : def.job_type === 'ingest_13h' ? '13H'
                : def.job_type === 'ingest_adv' ? 'ADV'
                : def.job_type}
            </span>
            {!def.is_active && (
              <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>inactive</span>
            )}
          </div>
          {def.description && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 5px', lineHeight: 1.45 }}>
              {def.description}
            </p>
          )}
          <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginBottom: 2 }}>
            {fmtConfig(def.config)}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
            {schedule?.is_active
              ? `${scheduleLabel(schedule)} · next: ${fmtNextRun(schedule.next_run_at) ?? '?'}`
              : schedule
              ? `${scheduleLabel(schedule)} (paused)`
              : 'No schedule — manual only'
            }
          </div>
        </div>

        {canWrite && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={def.is_active}
                onChange={() => onToggleActive(def)}
                style={{ cursor: 'pointer' }}
              />
              Active
            </label>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => onRunNow(def)}
              disabled={isTriggering}
            >
              ▶ Run Now
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => onEdit(def)}>Edit</button>
            <button className="btn btn-secondary btn-sm" onClick={() => onSchedule(def)}>
              {schedule ? 'Schedule' : '+ Schedule'}
            </button>
            {isAdmin && (
              <button
                className="btn btn-sm"
                style={{ color: 'var(--red)', border: '1px solid var(--border)', background: 'none' }}
                onClick={() => onDelete(def.id)}
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Run history table ─────────────────────────────────────────────────────────

function RunTable({ runs, canWrite, onView, onCancel, onReset }) {
  if (!runs.length) {
    return <EmptyState icon="○" text="No runs yet — click Run Now on a job definition to queue one" />;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Job</th>
            <th>Status</th>
            <th>Trigger</th>
            <th>Queued</th>
            <th>Duration</th>
            <th>Results</th>
            <th style={{ width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {runs.map(run => (
            <tr key={run.id} style={{ cursor: 'pointer' }} onClick={() => onView(run.id)}>
              <td style={{ fontWeight: 500 }}>{run.definition?.name ?? '—'}</td>
              <td><RunStatusBadge status={run.status} /></td>
              <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{run.trigger_source}</td>
              <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{fmtRelTime(run.queued_at)}</td>
              <td style={{ fontSize: 12.5 }}>{fmtDuration(run)}</td>
              <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{fmtRunStats(run.stats) ?? '—'}</td>
              <td onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-sm btn-secondary" onClick={() => onView(run.id)}>View</button>
                  {canWrite && run.status === 'queued' && (
                    <button
                      className="btn btn-sm"
                      style={{ color: 'var(--red)', border: '1px solid var(--border)', background: 'none' }}
                      onClick={() => onCancel(run.id)}
                    >
                      Cancel
                    </button>
                  )}
                  {canWrite && isRunStuck(run) && (
                    <button
                      className="btn btn-sm"
                      title="Worker appears dead — reset to re-queue"
                      style={{ color: '#d97706', border: '1px solid #fde68a', background: '#fffbeb' }}
                      onClick={() => onReset(run.id)}
                    >
                      Reset
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Run detail panel ──────────────────────────────────────────────────────────

function RunDetailPanel({ runId, onClose }) {
  const runQ      = useJobRun(runId);
  const cancelRun = useCancelJobRun();
  const resetRun  = useResetJobRun();
  const run       = runQ.data;

  return (
    <SlidePanel
      title={run ? `Run — ${run.definition?.name ?? 'Unknown Job'}` : 'Run Detail'}
      onClose={onClose}
      width={700}
    >
      {runQ.isLoading && (
        <div>
          {[120, '80%', '60%', '80%'].map((w, i) => (
            <div key={i} className="skeleton skeleton-text" style={{ width: w, marginBottom: 12 }} />
          ))}
        </div>
      )}

      {run && (
        <div>
          {/* Status + live indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
            <RunStatusBadge status={run.status} />
            {(run.status === 'queued' || run.status === 'running') && (
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Auto-refreshing</span>
            )}
            {run.status === 'queued' && (
              <button
                className="btn btn-sm"
                style={{ marginLeft: 'auto', color: 'var(--red)', border: '1px solid var(--border)', background: 'none' }}
                onClick={() => cancelRun.mutate(runId)}
                disabled={cancelRun.isPending}
              >
                Cancel
              </button>
            )}
            {isRunStuck(run) && (
              <button
                className="btn btn-sm"
                style={{ marginLeft: 'auto', color: '#d97706', border: '1px solid #fde68a', background: '#fffbeb' }}
                onClick={() => resetRun.mutate(runId)}
                disabled={resetRun.isPending}
                title="Worker heartbeat lost — re-queue this run for any available worker"
              >
                {resetRun.isPending ? 'Resetting…' : 'Reset to queued'}
              </button>
            )}
          </div>

          {/* Key info grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 20px', marginBottom: 24 }}>
            {[
              ['Job',      run.definition?.name ?? '—'],
              ['Type',     run.definition?.job_type ?? '—'],
              ['Trigger',  run.trigger_source],
              ['Queued',   fmtDateTime(run.queued_at)],
              ['Started',  fmtDateTime(run.started_at)],
              ['Finished', fmtDateTime(run.finished_at)],
              ['Duration', fmtDuration(run)],
              ['Worker',   run.claimed_by ? run.claimed_by.split('-').slice(0, 2).join('-') : '—'],
            ].map(([label, val]) => (
              <div key={label}>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 2 }}>
                  {label}
                </div>
                <div style={{ fontSize: 13.5 }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Stats */}
          {run.stats && Object.keys(run.stats).length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 10 }}>
                Results
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {Object.entries(run.stats).map(([k, v]) => (
                  <div key={k} style={{
                    padding: '8px 14px', background: 'var(--bg-secondary)', borderRadius: 6,
                    textAlign: 'center', minWidth: 60,
                  }}>
                    <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{v}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 2 }}>{k}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Config snapshot */}
          {run.config_snapshot && Object.keys(run.config_snapshot).length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 8 }}>
                Config Snapshot
              </div>
              <pre style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: 10, borderRadius: 6, margin: 0, overflow: 'auto' }}>
                {JSON.stringify(run.config_snapshot, null, 2)}
              </pre>
            </div>
          )}

          {/* Error message */}
          {run.error_message && (
            <div style={{ marginBottom: 24, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: '#dc2626' }}>Error: </span>
              <span style={{ fontSize: 13, color: '#dc2626' }}>{run.error_message}</span>
            </div>
          )}

          {/* Log */}
          {run.log ? (
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                Log
                {run.status === 'running' && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#2563eb', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                    <span className="job-running-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#2563eb', display: 'inline-block' }} />
                    live
                  </span>
                )}
              </div>
              <pre style={{
                fontFamily: 'monospace', fontSize: 11.5,
                background: '#0f172a', color: '#e2e8f0',
                padding: 12, borderRadius: 6,
                maxHeight: 420, overflow: 'auto', margin: 0,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.55,
              }}>
                {run.log}
              </pre>
            </div>
          ) : run.status === 'queued' ? (
            <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-tertiary)', fontSize: 13.5 }}>
              Waiting for worker to pick up this job...
            </div>
          ) : null}
        </div>
      )}
    </SlidePanel>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DataPipelines() {
  const [formOpen,      setFormOpen]      = useState(false);
  const [editingDef,    setEditingDef]    = useState(null);
  const [schedulingDef, setSchedulingDef] = useState(null);
  const [deletingDefId, setDeletingDefId] = useState(null);
  const [viewingRunId,  setViewingRunId]  = useState(null);
  const [toast,         setToast]         = useState(null);

  const { role } = useAuth();
  const canWrite = ['admin', 'sales', 'operations'].includes(role);
  const isAdmin  = role === 'admin';

  const defs      = useJobDefinitions();
  const runs      = useJobRuns({ limit: 50 });
  const triggerRun = useTriggerJobRun();
  const cancelRun  = useCancelJobRun();
  const resetRun   = useResetJobRun();
  const deleteDef  = useDeleteJobDefinition();
  const updateDef  = useUpdateJobDefinition();

  const anyActive = (runs.data ?? []).some(r => r.status === 'running' || r.status === 'queued');
  const stuckQueued = (runs.data ?? []).some(r =>
    r.status === 'queued' &&
    !r.started_at &&
    Date.now() - new Date(r.queued_at).getTime() > 60_000
  );
  const stuckRunning = (runs.data ?? []).filter(isRunStuck);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // Inject pulse animation CSS once
  useEffect(() => {
    const id = 'job-status-css';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `@keyframes job-pulse{0%,100%{opacity:1}50%{opacity:.3}}.job-running-dot{animation:job-pulse 1.5s ease-in-out infinite}`;
    document.head.appendChild(s);
  }, []);

  const handleRunNow = async (def) => {
    try {
      const result = await triggerRun.mutateAsync({ definition: def });
      setToast(`"${def.name}" queued — worker will pick it up shortly`);
      setViewingRunId(result.id);
    } catch (err) {
      setToast(`Error: ${err.message}`);
    }
  };

  const handleToggleActive = async (def) => {
    try {
      await updateDef.mutateAsync({ id: def.id, is_active: !def.is_active });
    } catch (err) {
      setToast(`Error: ${err.message}`);
    }
  };

  const handleDeleteConfirm = async () => {
    try {
      await deleteDef.mutateAsync(deletingDefId);
      setDeletingDefId(null);
    } catch (err) {
      setToast(`Delete failed: ${err.message}`);
      setDeletingDefId(null);
    }
  };

  return (
    <Layout title="Data Pipelines">
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 9999,
          background: 'var(--bg-primary)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '12px 16px', boxShadow: '0 4px 20px rgba(0,0,0,.13)',
          fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 10, maxWidth: 380,
        }}>
          <span style={{ flex: 1 }}>{toast}</span>
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 0, fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>
      )}

      {/* Worker not-started warning */}
      {stuckQueued && (
        <div style={{
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8,
          padding: '12px 16px', marginBottom: 20,
          display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5,
        }}>
          <span>⚠️</span>
          <span>
            A job has been queued for over a minute with no worker activity. Run{' '}
            <code style={{ background: '#fef9c3', padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>npm run worker</code>{' '}
            in the <strong>ingestion/</strong> directory to start the worker.
          </span>
        </div>
      )}

      {/* Stuck-running warning */}
      {stuckRunning.length > 0 && (
        <div style={{
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8,
          padding: '12px 16px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5,
        }}>
          <span>⚠</span>
          <span style={{ flex: 1 }}>
            A job appears stuck — the worker may have stopped. You can reset it to re-queue.
          </span>
          <button
            className="btn btn-sm"
            style={{ color: '#d97706', border: '1px solid #fde68a', background: '#fef9c3', whiteSpace: 'nowrap' }}
            onClick={() => resetRun.mutate(stuckRunning[0].id)}
            disabled={resetRun.isPending}
          >
            {resetRun.isPending ? 'Resetting…' : 'Reset job'}
          </button>
        </div>
      )}

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Data Pipelines</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13.5 }}>
            Configure SEC ingestion jobs, set schedules, and monitor run history
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { defs.refetch(); runs.refetch(); }}
          >
            ↻ Refresh
          </button>
          {canWrite && (
            <button className="btn btn-primary btn-sm" onClick={() => { setEditingDef(null); setFormOpen(true); }}>
              + New Job
            </button>
          )}
        </div>
      </div>

      {/* Section A: Job Definitions */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 12 }}>
          Job Definitions
        </div>

        {defs.isLoading && (
          <div>
            {[200, 160, 200].map((w, i) => (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px', marginBottom: 10 }}>
                <div className="skeleton skeleton-text" style={{ width: w, marginBottom: 8 }} />
                <div className="skeleton skeleton-text" style={{ width: 120 }} />
              </div>
            ))}
          </div>
        )}
        {defs.error && <ErrorBanner message={defs.error.message} onRetry={defs.refetch} />}
        {!defs.isLoading && !defs.error && defs.data?.length === 0 && (
          <EmptyState icon="◎" text="No job definitions yet — click '+ New Job' to create one" />
        )}
        {defs.data?.map(def => (
          <JobDefinitionCard
            key={def.id}
            def={def}
            canWrite={canWrite}
            isAdmin={isAdmin}
            isTriggering={triggerRun.isPending}
            onRunNow={handleRunNow}
            onEdit={d => { setEditingDef(d); setFormOpen(false); }}
            onSchedule={d => setSchedulingDef(d)}
            onDelete={id => setDeletingDefId(id)}
            onToggleActive={handleToggleActive}
          />
        ))}
      </div>

      {/* Section B: Run History */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
            Run History
          </div>
          {anyActive && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#2563eb' }}>
              <span className="job-running-dot" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#2563eb' }} />
              Live
            </div>
          )}
        </div>

        {runs.isLoading && <TableSkeleton cols={6} rows={5} />}
        {runs.error && <ErrorBanner message={runs.error.message} onRetry={runs.refetch} />}
        {!runs.isLoading && !runs.error && (
          <RunTable
            runs={runs.data ?? []}
            canWrite={canWrite}
            onView={setViewingRunId}
            onCancel={id => cancelRun.mutate(id)}
            onReset={id => resetRun.mutate(id)}
          />
        )}
      </div>

      {/* Panels + modals */}
      {(formOpen || editingDef) && (
        <JobDefinitionForm
          definition={editingDef ?? undefined}
          onClose={() => { setFormOpen(false); setEditingDef(null); }}
        />
      )}
      {schedulingDef && (
        <ScheduleEditor
          definition={schedulingDef}
          onClose={() => setSchedulingDef(null)}
        />
      )}
      {deletingDefId && (
        <ConfirmModal
          title="Delete Job Definition"
          message="This will also delete all associated schedules. Run history is preserved."
          confirmLabel="Delete"
          danger
          loading={deleteDef.isPending}
          onConfirm={handleDeleteConfirm}
          onClose={() => setDeletingDefId(null)}
        />
      )}
      {viewingRunId && (
        <RunDetailPanel runId={viewingRunId} onClose={() => setViewingRunId(null)} />
      )}
    </Layout>
  );
}

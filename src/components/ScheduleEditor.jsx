import { useState } from 'react';
import Modal from './Modal';
import { useUpsertJobSchedule, useDeleteJobSchedule } from '../hooks/useJobs';

const LABEL = { fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 };
const ROW   = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 };

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const TIMEZONES = [
  { value: 'America/New_York',    label: 'Eastern (ET)' },
  { value: 'America/Chicago',     label: 'Central (CT)' },
  { value: 'America/Denver',      label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'UTC',                 label: 'UTC' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateCron(expr) {
  if (!expr?.trim()) return false;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const isValid = (val, min, max) => {
    if (val === '*') return true;
    if (/^\*\/\d+$/.test(val)) return true;
    if (/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(val)) {
      return val.match(/\d+/g).map(Number).every(n => n >= min && n <= max);
    }
    return false;
  };

  const [m, h, dom, mon, dow] = parts;
  return isValid(m, 0, 59) && isValid(h, 0, 23) && isValid(dom, 1, 31)
      && isValid(mon, 1, 12) && isValid(dow, 0, 7);
}

function isMarketHours(hour, minute, recurrence, dayOfWeek) {
  const totalMins  = Number(hour) * 60 + Number(minute);
  const marketOpen = 9 * 60 + 30;
  const marketClose = 16 * 60;
  if (totalMins < marketOpen || totalMins >= marketClose) return false;
  if (recurrence === 'weekly' && (Number(dayOfWeek) === 0 || Number(dayOfWeek) === 6)) return false;
  return true;
}

function cronMarketHours(expr) {
  if (!validateCron(expr)) return false;
  const parts = expr.trim().split(/\s+/);
  if (parts[1] === '*') return false;
  const h = parseInt(parts[1], 10);
  const m = parseInt(parts[0], 10) || 0;
  if (isNaN(h)) return false;
  const totalMins = h * 60 + m;
  return totalMins >= (9 * 60 + 30) && totalMins < 16 * 60;
}

function computeNextRunAt({ recurrence, hour, minute, dayOfWeek, dayOfMonth }) {
  const h   = Number(hour);
  const m   = Number(minute);
  const now = new Date();

  const todayAt = new Date();
  todayAt.setHours(h, m, 0, 0);

  if (recurrence === 'daily') {
    const d = new Date(todayAt);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }

  if (recurrence === 'weekly') {
    const target   = Number(dayOfWeek ?? 1);
    const d        = new Date(todayAt);
    let daysUntil  = (target - d.getDay() + 7) % 7;
    if (daysUntil === 0 && d <= now) daysUntil = 7;
    d.setDate(d.getDate() + daysUntil);
    return d.toISOString();
  }

  if (recurrence === 'monthly') {
    const dom = Number(dayOfMonth ?? 1);
    const d   = new Date(todayAt);
    d.setDate(dom);
    if (d <= now) { d.setMonth(d.getMonth() + 1); d.setDate(dom); }
    return d.toISOString();
  }

  if (recurrence === 'quarterly') {
    const dom          = Number(dayOfMonth ?? 1);
    const quarterStarts = [0, 3, 6, 9];
    const curMonth      = now.getMonth();
    let nextQStart      = quarterStarts.find(qs => qs > curMonth) ?? 0;
    const d             = new Date(todayAt);
    if (nextQStart === 0) d.setFullYear(d.getFullYear() + 1);
    d.setMonth(nextQStart);
    d.setDate(dom);
    return d.toISOString();
  }

  return null;
}

function computeCronNextRunAt(expr) {
  if (!validateCron(expr)) return null;
  const parts = expr.trim().split(/\s+/);
  const mStr  = parts[0];
  const hStr  = parts[1];
  const now   = new Date();
  const d     = new Date();
  d.setSeconds(0, 0);

  const m = mStr === '*' ? 0  : parseInt(mStr, 10);
  const h = hStr === '*' ? now.getHours() : parseInt(hStr, 10);

  if (!isNaN(m) && !isNaN(h)) {
    d.setHours(h, m);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  return new Date(now.getTime() + 86_400_000).toISOString();
}

function previewLabel({ mode, recurrence, hour, minute, dayOfWeek, dayOfMonth, timezone, cronExpr }) {
  const tzShort = timezone === 'America/New_York' ? 'ET'
    : timezone === 'America/Chicago'     ? 'CT'
    : timezone === 'America/Denver'      ? 'MT'
    : timezone === 'America/Los_Angeles' ? 'PT'
    : timezone ?? 'ET';

  if (mode === 'cron') {
    if (!cronExpr) return null;
    if (!validateCron(cronExpr)) return '⚠ Invalid cron expression';
    return `Custom cron: ${cronExpr}`;
  }

  const h       = Number(hour);
  const m       = Number(minute);
  const ap      = h < 12 ? 'AM' : 'PM';
  const timeStr = `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ap} ${tzShort}`;

  switch (recurrence) {
    case 'daily':     return `Runs every day at ${timeStr}`;
    case 'weekly':    return `Runs every ${DAYS[dayOfWeek ?? 1]} at ${timeStr}`;
    case 'monthly':   return `Runs on day ${dayOfMonth ?? 1} of every month at ${timeStr}`;
    case 'quarterly': return `Runs on day ${dayOfMonth ?? 1} of Jan / Apr / Jul / Oct at ${timeStr}`;
    default:          return null;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ScheduleEditor({ definition, onClose }) {
  const existing = definition.schedules?.find(s => s.is_active) ?? definition.schedules?.[0];

  const [scheduleId,  setScheduleId]  = useState(existing?.id               ?? null);
  const [enabled,     setEnabled]     = useState(existing?.is_active         ?? true);
  const [mode,        setMode]        = useState(existing?.schedule_type     ?? 'preset');
  const [recurrence,  setRecurrence]  = useState(existing?.recurrence        ?? 'daily');
  const [hour,        setHour]        = useState(existing?.hour_of_day       ?? 2);
  const [minute,      setMinute]      = useState(existing?.minute_of_hour    ?? 0);
  const [dayOfWeek,   setDayOfWeek]   = useState(existing?.day_of_week       ?? 1);
  const [dayOfMonth,  setDayOfMonth]  = useState(existing?.day_of_month      ?? 1);
  const [timezone,    setTimezone]    = useState(existing?.timezone           ?? 'America/New_York');
  const [cronExpr,    setCronExpr]    = useState(existing?.cron_expression   ?? '');
  const [error,       setError]       = useState(null);

  const upsert     = useUpsertJobSchedule();
  const deleteSched = useDeleteJobSchedule();
  const isPending  = upsert.isPending || deleteSched.isPending;

  const showMarketWarn = mode === 'preset'
    ? isMarketHours(hour, minute, recurrence, dayOfWeek)
    : cronMarketHours(cronExpr);

  const cronValid = mode !== 'cron' || validateCron(cronExpr);
  const canSave   = mode === 'preset' || cronValid;

  const preview = previewLabel({ mode, recurrence, hour, minute, dayOfWeek, dayOfMonth, timezone, cronExpr });

  const handleSave = async () => {
    setError(null);
    try {
      const nextRunAt = enabled
        ? (mode === 'preset'
            ? computeNextRunAt({ recurrence, hour, minute, dayOfWeek, dayOfMonth })
            : computeCronNextRunAt(cronExpr))
        : null;

      await upsert.mutateAsync({
        id:               scheduleId || undefined,
        job_definition_id: definition.id,
        schedule_type:    mode,
        recurrence:       mode === 'preset' ? recurrence : null,
        hour_of_day:      mode === 'preset' ? Number(hour)   : null,
        minute_of_hour:   mode === 'preset' ? Number(minute) : null,
        day_of_week:      (mode === 'preset' && recurrence === 'weekly')    ? Number(dayOfWeek)  : null,
        day_of_month:     (mode === 'preset' && (recurrence === 'monthly' || recurrence === 'quarterly')) ? Number(dayOfMonth) : null,
        timezone,
        cron_expression:  mode === 'cron' ? cronExpr.trim() : null,
        is_active:        enabled,
        next_run_at:      nextRunAt,
      });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async () => {
    if (!scheduleId) { onClose(); return; }
    try {
      await deleteSched.mutateAsync({ id: scheduleId, job_definition_id: definition.id });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  const footerLeft = scheduleId ? (
    <button
      className="btn btn-sm"
      style={{ color: 'var(--red)', border: '1px solid var(--border)', background: 'none' }}
      onClick={handleDelete}
      disabled={isPending}
    >
      Remove Schedule
    </button>
  ) : null;

  return (
    <Modal
      title={`Schedule — ${definition.name}`}
      onClose={onClose}
      width={520}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div>{footerLeft}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={isPending || !canSave}>
              {isPending ? 'Saving…' : scheduleId ? 'Save Schedule' : 'Create Schedule'}
            </button>
          </div>
        </div>
      }
    >
      {error && <div className="error-state" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Enabled toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 500, fontSize: 13.5 }}>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          Schedule enabled
        </label>
        {!enabled && (
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Job will only run manually</span>
        )}
      </div>

      {enabled && (
        <>
          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 20, border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', width: 'fit-content' }}>
            {['preset', 'cron'].map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                style={{
                  padding: '6px 16px', border: 'none', cursor: 'pointer', fontSize: 13,
                  background: mode === m ? 'var(--accent)' : 'var(--bg-secondary)',
                  color:      mode === m ? '#fff'          : 'var(--text-secondary)',
                  fontWeight: mode === m ? 600 : 400,
                }}
              >
                {m === 'preset' ? 'Preset' : 'Cron'}
              </button>
            ))}
          </div>

          {/* Preset mode */}
          {mode === 'preset' && (
            <>
              <div style={{ marginBottom: 14 }}>
                <label style={LABEL}>Recurrence</label>
                <select className="form-select" value={recurrence} onChange={e => setRecurrence(e.target.value)}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </div>

              <div style={ROW}>
                <div>
                  <label style={LABEL}>Hour</label>
                  <select className="form-select" value={hour} onChange={e => setHour(e.target.value)}>
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>
                        {i % 12 || 12}:00 {i < 12 ? 'AM' : 'PM'} ({String(i).padStart(2,'0')}:00)
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={LABEL}>Minute</label>
                  <select className="form-select" value={minute} onChange={e => setMinute(e.target.value)}>
                    {[0, 15, 30, 45].map(m => (
                      <option key={m} value={m}>:{String(m).padStart(2,'0')}</option>
                    ))}
                  </select>
                </div>
              </div>

              {recurrence === 'weekly' && (
                <div style={{ marginBottom: 14 }}>
                  <label style={LABEL}>Day of Week</label>
                  <select className="form-select" value={dayOfWeek} onChange={e => setDayOfWeek(e.target.value)}>
                    {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </div>
              )}

              {(recurrence === 'monthly' || recurrence === 'quarterly') && (
                <div style={{ marginBottom: 14 }}>
                  <label style={LABEL}>Day of Month</label>
                  <select className="form-select" value={dayOfMonth} onChange={e => setDayOfMonth(e.target.value)}>
                    {Array.from({ length: 28 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>Day {i + 1}</option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ marginBottom: 14 }}>
                <label style={LABEL}>Timezone</label>
                <select className="form-select" value={timezone} onChange={e => setTimezone(e.target.value)}>
                  {TIMEZONES.map(tz => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Cron mode */}
          {mode === 'cron' && (
            <div style={{ marginBottom: 14 }}>
              <label style={LABEL}>Cron Expression</label>
              <input
                className="form-input"
                value={cronExpr}
                onChange={e => setCronExpr(e.target.value)}
                placeholder="0 2 * * *"
                style={{ fontFamily: 'monospace', fontSize: 14 }}
                autoFocus
              />
              <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 5 }}>
                5 fields: minute hour day month weekday — e.g. <code>0 2 * * *</code> = daily at 2:00 AM
              </div>
              {cronExpr && !validateCron(cronExpr) && (
                <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 5 }}>
                  Invalid cron expression — must be 5 space-separated fields
                </div>
              )}
              {cronExpr && validateCron(cronExpr) && (
                <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 5 }}>✓ Valid</div>
              )}
            </div>
          )}

          {/* Market hours warning */}
          {showMarketWarn && (
            <div style={{
              background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6,
              padding: '10px 14px', marginBottom: 14, fontSize: 13,
            }}>
              ⚠️ This schedule falls within US market hours (9:30 AM – 4:00 PM ET).
              {' '}Consider off-hours scheduling to reduce load on SEC EDGAR servers.
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div style={{
              background: 'var(--bg-secondary)', borderRadius: 6, padding: '10px 14px',
              fontSize: 13, color: 'var(--text-secondary)',
            }}>
              {preview}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

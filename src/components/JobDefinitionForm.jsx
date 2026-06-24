import { useState } from 'react';
import SlidePanel from './SlidePanel';
import { useCreateJobDefinition, useUpdateJobDefinition } from '../hooks/useJobs';

const LABEL = { fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 };
const SECTION_HEAD = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 12,
};
const HINT = { fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 4, lineHeight: 1.45 };

export default function JobDefinitionForm({ definition, onClose }) {
  const isEdit = !!definition;

  const [name,         setName]         = useState(definition?.name         ?? '');
  const [description,  setDescription]  = useState(definition?.description  ?? '');
  const [jobType,      setJobType]      = useState(definition?.job_type     ?? 'ingest_13f');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error,        setError]        = useState(null);

  // ── 13F config fields ─────────────────────────────────────────
  const [limit,  setLimit]  = useState(definition?.config?.limit   ?? 50);
  const [minAum, setMinAum] = useState(definition?.config?.minAum  ?? '');
  const [sortBy, setSortBy] = useState(definition?.config?.sortBy  ?? '');

  // ── ADV config fields ─────────────────────────────────────────
  const [advBulkUrl, setAdvBulkUrl] = useState(definition?.config?.advBulkUrl ?? '');
  const [advLimit,   setAdvLimit]   = useState(definition?.config?.limit      ?? 50);
  const [advMinAum,  setAdvMinAum]  = useState(definition?.config?.minAum     ?? '');

  const create    = useCreateJobDefinition();
  const update    = useUpdateJobDefinition();
  const isPending = create.isPending || update.isPending;

  const config = jobType === 'ingest_adv'
    ? {
        limit:  Number(advLimit) || 50,
        ...(advBulkUrl.trim()           ? { advBulkUrl: advBulkUrl.trim() } : {}),
        ...(advMinAum !== ''            ? { minAum: Number(advMinAum) }     : {}),
      }
    : {
        limit:  Number(limit) || 50,
        ...(minAum !== '' && minAum !== null ? { minAum: Number(minAum) } : {}),
        ...(sortBy ? { sortBy } : {}),
      };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    if (jobType === 'ingest_adv' && advBulkUrl.trim() && !advBulkUrl.trim().startsWith('https://')) {
      setError('ADV Bulk URL must start with https://'); return;
    }
    setError(null);
    try {
      const payload = {
        name:        name.trim(),
        description: description.trim() || null,
        job_type:    jobType,
        config,
      };
      if (isEdit) {
        await update.mutateAsync({ id: definition.id, ...payload });
      } else {
        await create.mutateAsync(payload);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <SlidePanel
      title={isEdit ? 'Edit Job Definition' : 'New Job Definition'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={isPending || !name.trim()}>
            {isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Job'}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="error-state" style={{ marginBottom: 16 }}>{error}</div>
        )}

        {/* Name */}
        <div style={{ marginBottom: 16 }}>
          <label style={LABEL}>
            Name <span style={{ color: 'var(--red)' }}>*</span>
          </label>
          <input
            className="form-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. ADV — Registered Advisers"
            autoFocus
          />
        </div>

        {/* Description */}
        <div style={{ marginBottom: 16 }}>
          <label style={LABEL}>Description</label>
          <textarea
            className="form-input"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            placeholder="Optional — purpose or notes for this job"
            style={{ resize: 'vertical' }}
          />
        </div>

        {/* Job type */}
        <div style={{ marginBottom: 24 }}>
          <label style={LABEL}>Job Type</label>
          <select
            className="form-select"
            value={jobType}
            onChange={e => setJobType(e.target.value)}
            disabled={isEdit}
          >
            <option value="ingest_13f">SEC 13F — Institutional Investment Managers</option>
            <option value="ingest_adv">SEC ADV — Registered Investment Advisers</option>
            <option value="ingest_13h" disabled>SEC 13H — Large Trader (coming soon)</option>
          </select>
          {isEdit && (
            <div style={HINT}>Job type cannot be changed after creation.</div>
          )}
        </div>

        {/* Config builder — conditional on job type */}
        <div style={{ marginBottom: 8 }}>
          <div style={SECTION_HEAD}>Configuration</div>

          {jobType === 'ingest_adv' ? (
            /* ── ADV config ─────────────────────────────────── */
            <>
              <div style={{ marginBottom: 6, padding: '10px 12px', background: '#eff6ff', borderRadius: 6, fontSize: 12.5, color: '#1e40af', lineHeight: 1.5 }}>
                ADV ingests SEC-registered investment advisers from the quarterly IAPD bulk dataset.
              </div>

              <div style={{ marginBottom: 14, marginTop: 12 }}>
                <label style={LABEL}>ADV Bulk Data URL</label>
                <input
                  className="form-input"
                  type="url"
                  value={advBulkUrl}
                  onChange={e => setAdvBulkUrl(e.target.value)}
                  placeholder="https://adviserinfo.sec.gov/..."
                />
                <div style={HINT}>
                  The SEC rotates this file quarterly.{' '}
                  <a
                    href="https://adviserinfo.sec.gov/compilation"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--accent)' }}
                  >
                    → Find the latest file
                  </a>
                  {' '}then paste the direct download link here. You can also leave this blank and
                  provide the URL at run time via the Run Now button.
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={LABEL}>Batch Size (limit)</label>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  max={20000}
                  value={advLimit}
                  onChange={e => setAdvLimit(e.target.value)}
                />
                <div style={HINT}>Number of adviser rows to process per run</div>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label style={LABEL}>Minimum AUM (USD)</label>
                <input
                  className="form-input"
                  type="number"
                  min={0}
                  step={1_000_000}
                  value={advMinAum}
                  onChange={e => setAdvMinAum(e.target.value)}
                  placeholder="e.g. 100000000 for $100M (leave blank for no minimum)"
                />
                <div style={HINT}>
                  Skip advisers whose regulatory AUM (Item 5.F) is below this threshold
                </div>
              </div>
            </>
          ) : (
            /* ── 13F config ─────────────────────────────────── */
            <>
              <div style={{ marginBottom: 14 }}>
                <label style={LABEL}>Batch Size (limit)</label>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  max={500}
                  value={limit}
                  onChange={e => setLimit(e.target.value)}
                />
                <div style={HINT}>Number of 13F filers to process per run</div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={LABEL}>Minimum AUM (USD)</label>
                <input
                  className="form-input"
                  type="number"
                  min={0}
                  step={1_000_000}
                  value={minAum}
                  onChange={e => setMinAum(e.target.value)}
                  placeholder="e.g. 100000000 for $100M (leave blank for no minimum)"
                />
                <div style={HINT}>Skip filers whose computed AUM is below this threshold</div>
              </div>

              <div style={{ marginBottom: 8 }}>
                <label style={LABEL}>Sort By</label>
                <select
                  className="form-select"
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value)}
                >
                  <option value="">Default (most recent filing date)</option>
                  <option value="aum">AUM descending (largest first)</option>
                </select>
              </div>
            </>
          )}
        </div>

        {/* Raw JSON preview */}
        <div style={{ marginTop: 20 }}>
          <button
            type="button"
            style={{ fontSize: 12, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 5 }}
            onClick={() => setShowAdvanced(v => !v)}
          >
            {showAdvanced ? '▼' : '▶'} Advanced — raw config JSON
          </button>
          {showAdvanced && (
            <pre style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: 10, borderRadius: 6, marginTop: 8, overflow: 'auto' }}>
              {JSON.stringify(config, null, 2)}
            </pre>
          )}
        </div>
      </form>
    </SlidePanel>
  );
}
